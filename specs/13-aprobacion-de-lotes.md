# SPEC 13 — Aprobación de lotes

> **Status:** Draft
> **Depends on:** SPEC 02, SPEC 03, SPEC 12
> **Date:** 2026-09-02
> **Objective:** Agregar `PATCH /lotes/:id/aprobar`, que aprueba un lote abierto en etapa `EN_PROCESO`, lo pasa a la etapa `CLIENTE_FINAL`, lo cierra (`estado = 'cerrado'`, `cerrado_en = NOW()`) y guarda quién lo aprobó y cuándo en dos columnas nuevas de `lotes`.

---

## Why this spec exists

El supervisor revisa el lote pesado y lo da por bueno. A partir de ese momento el lote ya no se sigue trabajando en planta: pasa a la etapa `CLIENTE_FINAL` del diagrama. Hoy no hay forma de expresar eso: `createLote` clava `etapa_id: 1` (`EN_PROCESO`) y el **único** endpoint que cambia esa columna es `PATCH /lotes/:id/rechazar`, que la pone en `RECHAZADO`. Un lote solo puede quedarse donde nació o ser anulado.

Este es el primer spec que mueve un lote hacia adelante en el flujo. Hay que ser explícito con cinco cosas.

**La primera: este spec convierte `estado = 'cerrado'` en un valor ambiguo de verdad.** SPEC 12 lo dejó anotado como un riesgo teórico: el rechazo escribía `'cerrado'` y era lo único que podía cerrar un lote, así que la ambigüedad no se podía materializar. Deja de ser teórica hoy. A partir de este spec, `estado = 'cerrado'` significa **o** "rechazado" **o** "aprobado y enviado a cliente final", y el `estado` por sí solo no los distingue. Tampoco los distingue `cerrado_en`, que los dos escriben. Lo que los separa es qué columna de auditoría está llena: `motivo_rechazo` en el rechazo, `aprobado_por` en la aprobación.

**La segunda: aprobar un lote lo saca de circulación por API, y eso es lo que se pidió.** Los dos `GET` de lotes filtran `estado = 'abierto'`, así que un lote aprobado desaparece de los dos. `POST /pesajes` y `PATCH /pesajes/:id/rechazar` llaman a `validateLoteAbierto`, así que los dos empiezan a responder 400. Un lote aprobado no admite un pesaje más y no se puede consultar. Esto choca con el diagrama, que pone el PIN de supervisor para pesajes fuera de rango **en la etapa cliente final** — es decir, el diagrama espera que en `CLIENTE_FINAL` todavía se pese. La alternativa (dejar `estado = 'abierto'` y mover solo el `etapa_id`) se presentó y se descartó. Queda registrado en Decisions y en Risks.

**La tercera: es el primer `estado = 'cerrado'` del proyecto que no es un rechazo, y sigue sin ser el cierre de lote.** No hay agregados por lote, no hay `resumen_ia`, no hay etapa `FINALIZADO`. La aprobación cierra el lote como efecto de mandarlo a cliente final, no como resultado de un cálculo. El spec que implemente el cierre real hereda un valor `'cerrado'` ya usado por dos operaciones distintas.

**La cuarta: el `etapa_id` se resuelve por `codigo`, no por el id 2.** El pedido decía "el id 2 que es Cliente final". Se implementa resolviendo la fila de `etapas` con `codigo = 'CLIENTE_FINAL'` dentro de la transacción, que es lo que SPEC 12 hizo con `RECHAZADO` y lo que hace `resolveEstadoCalidad` en `PesajesRepository`. Los ids difieren entre ambientes y un id clavado escribiría la etapa equivocada **sin fallar**. La validación de que el lote está en `EN_PROCESO` se hace igual, resolviendo esa fila por su `codigo`.

**La quinta: es la cuarta operación de escritura del proyecto abierta a cualquier usuario autenticado.** Por decisión explícita, `PATCH /lotes/:id/aprobar` **no** llama a `validateVinculoOperador` y **no** siembra fila en `permisos`. Es el mismo criterio de los tres `rechazar`, con dos agravantes: `LotesRepository` valida el vínculo en `getLotesByCliente` y en `createLote`, así que este archivo queda con dos de cuatro métodos saltándoselo; y esta operación no es destructiva sino de **aprobación**, o sea que cualquier `Operador` puede dar por bueno el lote de un cliente que no es suyo. Se asume y se registra en Risks.

---

## Scope

**In:**

- DDL a mano en MySQL: dos columnas nuevas y nullables en `lotes` — `aprobado_por` y `aprobado_en` — más una FK de `aprobado_por` a `usuarios(id)`.
- **Sin DDL sobre `lotes.estado`, `lotes.etapa_id` ni `lotes.cerrado_en`**: las tres ya existen y ya se escriben.
- **Sin DDL sobre `etapas`**: las filas `EN_PROCESO` y `CLIENTE_FINAL` ya están sembradas.
- Actualizar `LotesTable` en `src/database/types/types.ts` con las dos columnas.
- Nuevo método `aprobarLote(loteId, userId)` en `src/modules/lotes/repository/lotes.repository.ts`, dentro de una transacción.
- Tres validadores privados nuevos en el mismo repositorio: `resolveEtapa(codigo, db)`, `validateEtapaEnProceso(lote, db)` y `validateLoteTienePesajes(loteId, db)`.
- Agregar `'etapa_id'` al `select` del validador existente `validateLoteAbierto`, sin cambiar su firma, su lógica ni sus mensajes.
- Nuevo método `aprobar(loteId, userId)` en `src/modules/lotes/lotes.service.ts`, pass-through al repositorio.
- Nuevo handler `@Patch(':id/aprobar')` en `src/modules/lotes/lotes.controller.ts`, con `@Param('id', ParseIntPipe)` y **sin `@Body()`**.
- Nuevo endpoint `PATCH /lotes/:id/aprobar`, protegido únicamente por el `JwtAuthGuard` global (no lleva `@Public()`).
- El `UPDATE` escribe exactamente cinco columnas: `estado = 'cerrado'`, `etapa_id` (el id de la etapa `CLIENTE_FINAL`), `cerrado_en` (`NOW()` de MySQL), `aprobado_por` (del `req.user.userId`) y `aprobado_en` (`NOW()` de MySQL).
- Respuesta `200` con la forma `{ ok, msg }`, sin payload de recurso y sin body en la petición.
- `400` si el lote no existe, si no está abierto, si su etapa actual no es `EN_PROCESO`, si no tiene ningún pesaje activo, o si falta la fila `EN_PROCESO` o `CLIENTE_FINAL` en `etapas`.
- Actualizar `CLAUDE.md`: fila `lotes` de la tabla de endpoints; las dos columnas nuevas y su FK; el conteo de `PATCH`es, de `UPDATE`s y de rutas que se saltan `validateVinculoOperador`; y **la advertencia de que `estado = 'cerrado'` ya significa dos cosas distintas**, con `motivo_rechazo` y `aprobado_por` como las señales que las separan.

**Out of scope (for future specs):**

- La transición `CLIENTE_FINAL` → `FINALIZADO`. No hay endpoint para finalizar un lote y este spec no lo agrega.
- El **cierre** de lote con resultado bueno entendido como cálculo: agregados por lote (peso total, conteos por estado de calidad) y `resumen_ia`. La aprobación cierra el lote como efecto de mandarlo a cliente final, no como resultado de un cálculo.
- Separar por `estado` un lote rechazado de un lote aprobado. Los dos quedan en `'cerrado'`, y separarlos es trabajo del spec que revise el ciclo de vida.
- Permitir pesajes en la etapa `CLIENTE_FINAL`. El lote queda cerrado, así que `POST /pesajes` responde 400. El diagrama espera lo contrario y eso queda como trabajo futuro.
- El PIN de supervisor para autorizar pesajes fuera de rango en la etapa cliente final.
- Derivar la aprobación de los datos: este spec **no** mira `fuera_de_rango` ni `estado_calidad_id` de los pesajes. La decisión de aprobar es del humano que llama al endpoint.
- Deshacer una aprobación. No hay endpoint de reversión y no lo habrá en este spec.
- Aprobar en lote (varios `lote_id` en una sola llamada).
- Diseñar o documentar la tabla `etapas` entera, y corregir el literal `etapa_id: 1` de `createLote`. Este spec consume las filas `EN_PROCESO` y `CLIENTE_FINAL` y nada más.
- Un endpoint de catálogo `GET /catalogos/etapas`, que SPEC 09 no incluyó.
- Sembrar filas en `etapas`: las dos que hacen falta ya existen.
- Unificar `resolveEtapa` con el `resolveEtapaRechazado` de SPEC 12, que queda como duplicado deliberado.
- Cambios a `GET /lotes/cliente/:clienteId` y `GET /lotes/cliente/:clienteId/all`: mantienen su filtro `estado = 'abierto'`, sus campos y su orden. Un lote aprobado desaparece de los dos.
- Agregarle la validación de vínculo a `GET /lotes/cliente/:clienteId/all`, que hoy no la tiene.
- Un endpoint para listar lotes cerrados, aprobados o en cliente final, y cualquier query param del estilo `?etapa=CLIENTE_FINAL`.
- Devolver `aprobado_por` o `aprobado_en` en cualquier endpoint de lectura.
- Cambios a `POST /pesajes`, `PATCH /pesajes/:id/rechazar` y `GET /pesajes/byLote/:loteId`.
- Cambios a `PATCH /lotes/:id/rechazar`, que empieza a responder 400 sobre un lote aprobado sin que se toque una línea.
- Cambios a `validateNombreLoteDisponible`, que ya hace lo correcto: un lote aprobado tiene `motivo_rechazo IS NULL`, así que su `nombre_lote` **sigue ocupado**.
- Sembrar filas en `permisos`. Se decidió explícitamente no hacerlo (ver Decisions). La tabla sigue con las 11 filas de SPEC 08.
- **Aplicar** permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`.
- Exigir un rol de supervisor. Nada en el proyecto discrimina por rol y `req.user` sigue siendo `{ userId, username }`.
- Validar el vínculo `cliente_operador`. Decisión explícita: cualquier usuario autenticado puede aprobar cualquier lote.
- Exigir que quien aprueba sea quien creó el lote (`lotes.created_by`).
- Una observación o comentario de aprobación. El endpoint no recibe body.

---

## Data model

### DDL (ejecutar a mano en MySQL)

Las dos columnas son nullables porque las filas existentes no tienen valor y no se van a rellenar:

```sql
ALTER TABLE lotes
  ADD COLUMN aprobado_por INT NULL AFTER rechazado_en,
  ADD COLUMN aprobado_en DATETIME NULL AFTER aprobado_por;

ALTER TABLE lotes
  ADD CONSTRAINT fk_lotes_aprobado_por
  FOREIGN KEY (aprobado_por) REFERENCES usuarios(id);
```

Los nombres son el eco de `rechazado_por` / `rechazado_en`, a propósito: es la otra mitad del rastro de la misma tabla y debe leerse igual.

No hay tercera columna de texto. El rechazo tiene `motivo_rechazo` porque anular algo exige explicarlo; aprobar no lleva texto y el endpoint no recibe body.

La FK es la quinta excepción del proyecto a la regla de validar solo en código, después de `permisos` → `roles` y las tres `rechazado_por` → `usuarios(id)` de SPEC 10, 11 y 12. Se justifica igual: es un dato de auditoría y una fila huérfana lo dejaría sin valor probatorio.

`lotes.created_by` **sigue sin FK** y este spec no se la agrega. La tabla queda con tres columnas de usuario, dos con FK (`rechazado_por`, `aprobado_por`) y una sin ella.

### Cambio en `src/database/types/types.ts`

`LotesTable` gana dos claves al final:

```ts
export interface LotesTable {
  // ...campos existentes sin cambios...
  motivo_rechazo: string | null;
  rechazado_por: number | null;
  rechazado_en: Date | string | null;
  aprobado_por: number | null;
  aprobado_en: Date | string | null;
}
```

Ninguna es `Generated<>`: las dos las escribe la aplicación, no MySQL, y ninguna tiene `DEFAULT`.

Las otras tres columnas que la aprobación escribe ya están declaradas y no cambian de tipo: `estado: Generated<string | null>`, `etapa_id: number | null` y `cerrado_en: Date | string | null`.

### Las filas de `etapas` que este spec consume

`EtapasTable` no se modifica y no se siembra ninguna fila. Se consumen dos:

| `codigo` | Rol en este spec |
| --- | --- |
| `EN_PROCESO` | Etapa **de origen**. Se resuelve por `codigo` para comparar contra el `etapa_id` del lote. Es la que `createLote` escribe hoy con su literal `etapa_id: 1`. |
| `CLIENTE_FINAL` | Etapa **de destino**. Se resuelve por `codigo` y su `id` es lo que se escribe. |

Las dos se resuelven **dentro de la transacción** y con 400 si la fila no existe. El id 2 que se mencionó al pedir la funcionalidad **no aparece en el código**: los ids difieren entre ambientes.

El literal `etapa_id: 1` de `createLote` **no se toca**: corregirlo es parte de documentar `etapas`, que está fuera de alcance. Nótese la consecuencia: si en algún ambiente `EN_PROCESO` no fuera el id 1, `createLote` crearía lotes en otra etapa y este endpoint los rechazaría con 400. Está en Risks.

### DTO

**Este endpoint no tiene DTO.** No recibe body: el `id` viene en la ruta y el usuario del token. Es el primer `PATCH` del proyecto sin `@Body()` y el primer endpoint de escritura sin schema Zod.

Campos que **no** vienen del body, porque no hay body:

- `estado` — lo fija el repositorio en `'cerrado'`.
- `etapa_id` — resuelto desde `etapas` por `codigo = 'CLIENTE_FINAL'`.
- `cerrado_en` y `aprobado_en` — `NOW()` de MySQL, en el mismo `UPDATE`.
- `aprobado_por` — del `req.user.userId` (token JWT).

### El `UPDATE`

```sql
UPDATE lotes
SET estado = 'cerrado',
    etapa_id = ?,
    cerrado_en = NOW(),
    aprobado_por = ?,
    aprobado_en = NOW()
WHERE id = ?;
```

Son cinco columnas. Tres de ellas son las mismas que escribe `rechazarLote` (`estado`, `etapa_id`, `cerrado_en`), con otro valor en `etapa_id`. No toca `cliente_id`, `nombre_lote`, `producto_id`, `unidad_medida_id`, `variedad_o_talla`, `peso_minimo`, `peso_ideal`, `peso_maximo`, `resumen_ia`, `created_by`, `created_at`, `motivo_rechazo`, `rechazado_por` ni `rechazado_en`. Un lote aprobado conserva todos sus datos originales.

`cerrado_en` y `aprobado_en` van a tener el mismo valor en la práctica, porque los escribe el mismo `NOW()` de la misma sentencia. Son columnas distintas por la misma razón que en SPEC 12: la primera dice cuándo terminó el ciclo de vida del lote, la segunda cuándo se ejecutó esta aprobación.

### Cómo se distingue un lote aprobado de uno rechazado

Esta es la tabla más importante del spec, porque es el problema que SPEC 12 dejó anotado como teórico y que este spec materializa:

| Señal | Rechazado | Aprobado | Sirve para distinguirlos |
| --- | --- | --- | --- |
| `estado` | `'cerrado'` | `'cerrado'` | **No.** Idéntico en los dos. |
| `cerrado_en` | escrito | escrito | **No.** Escrito en los dos. |
| `motivo_rechazo` | `NOT NULL` | `NULL` | **Sí, es la señal canónica del rechazo.** |  
| `aprobado_por` / `aprobado_en` | `NULL` | `NOT NULL` | **Sí, es la señal canónica de la aprobación.** |
| `etapa_id` | etapa `RECHAZADO` | etapa `CLIENTE_FINAL` | Sí, pero indirecta: exige resolver la fila de `etapas` y la columna es nullable. |

Regla para todo código nuevo: un lote rechazado es `motivo_rechazo IS NOT NULL`, un lote aprobado es `aprobado_por IS NOT NULL`, y `estado = 'cerrado'` **no dice cuál de los dos es**. Las dos columnas son mutuamente excluyentes por construcción, porque cada endpoint exige que el lote esté abierto antes de escribir.

### Definición de "aprobable"

Un lote se puede aprobar si cumple **las tres** condiciones, verificadas en este orden:

1. `estado = 'abierto'` **y** `cerrado_en IS NULL` — el validador `validateLoteAbierto` que ya existe.
2. Su `etapa_id` es el id de la fila de `etapas` con `codigo = 'EN_PROCESO'`.
3. Tiene al menos un pesaje con `lote_id` = el lote y `isActive = 1`.

El orden importa porque decide qué mensaje de error ve el cliente. Un lote **rechazado** falla en la condición 1 (`estado = 'cerrado'`), así que recibe `no esta abierto` y nunca llega a la condición 2, que habría dicho que su etapa es `RECHAZADO`. Un lote **ya aprobado** falla también en la condición 1, por la misma razón. Igual que en SPEC 12, no hay mensaje propio para "ya fue aprobado".

La condición 3 filtra `isActive = 1`, que es el mismo filtro de `GET /pesajes/byLote/:loteId`. Un lote cuyos únicos pesajes fueron rechazados cuenta como lote sin pesajes y no se puede aprobar.

### Petición y respuestas

Petición (sin body):

```
PATCH /lotes/9/aprobar
Authorization: Bearer <token>
```

Respuesta (200):

```json
{
  "ok": true,
  "msg": "Lote aprobado correctamente"
}
```

Errores, todos `400` con la forma estándar de Nest:

| Caso | Mensaje |
| --- | --- |
| El lote no existe | `El lote con id '9' no existe` |
| El lote no está abierto, incluido el ya aprobado y el rechazado | `El lote 'LOTE-001' no esta abierto` |
| El lote no está en etapa `EN_PROCESO` | `El lote 'LOTE-001' no esta en la etapa EN_PROCESO` |
| El lote no tiene pesajes activos | `El lote 'LOTE-001' no tiene pesajes registrados` |
| No existe la fila `EN_PROCESO` en `etapas` | `La etapa con codigo 'EN_PROCESO' no existe` |
| No existe la fila `CLIENTE_FINAL` en `etapas` | `La etapa con codigo 'CLIENTE_FINAL' no existe` |
| `id` de ruta no numérico | El error de `ParseIntPipe` |

No hay error de validación de Zod en este endpoint: no hay body que validar. Un body enviado de todas formas se ignora.

### Efecto observable en los endpoints existentes

Ningún endpoint cambia de código. Toda esta tabla es efecto de poner `estado = 'cerrado'`:

| Endpoint | Efecto sobre un lote aprobado |
| --- | --- |
| `GET /lotes/cliente/:clienteId` | Desaparece: ya filtra `estado = 'abierto'`. |
| `GET /lotes/cliente/:clienteId/all` | Desaparece: ya filtra `estado = 'abierto'`. |
| `POST /lotes` | El `nombre_lote` del lote aprobado **sigue ocupado** para ese cliente: el filtro de SPEC 12 mira `motivo_rechazo IS NULL` y la aprobación no escribe esa columna. |
| `POST /pesajes` | Falla con 400 `El lote 'X' no esta abierto`. **Un lote aprobado no admite más pesajes.** |
| `PATCH /pesajes/:id/rechazar` | Falla con 400 `El lote 'X' no esta abierto`. Los pesajes de un lote aprobado quedan imposibles de anular. |
| `GET /pesajes/byLote/:loteId` | **Sigue devolviendo los pesajes activos.** No valida el lote. |
| `PATCH /lotes/:id/rechazar` | Falla con 400 `El lote 'X' no esta abierto`. **Un lote aprobado ya no se puede rechazar.** |

La fila de `POST /lotes` es la buena noticia del diseño de SPEC 12: su filtro por `motivo_rechazo` en vez de por `estado` hace que la aprobación **no** libere el nombre, sin tocar una línea. Es exactamente el caso que SPEC 12 simuló a mano en su paso 13 poniendo un lote en `'cerrado'` con `motivo_rechazo = NULL`; a partir de este spec el caso existe de verdad.

Las tres últimas filas son las incoherencias asumidas y están en Risks.

Escribir `etapa_id` **no tiene ningún efecto observable por API**, igual que en SPEC 12: las dos rutas que exponen `etapas.nombre as etapa` filtran `estado = 'abierto'`, así que el lote aprobado ya no aparece en ninguna. El dato queda solo para consultas en la base.

---

## Implementation plan

1. Ejecutar a mano el `ALTER TABLE` de las dos columnas y el de la FK. Confirmar con `DESCRIBE lotes;` que las dos aparecen como nullables y con `SHOW CREATE TABLE lotes;` que la FK quedó creada. Confirmar que las filas existentes tienen las dos en `NULL` y que su `estado`, su `etapa_id` y su `cerrado_en` no cambiaron.
2. Confirmar con `SELECT id, codigo, nombre FROM etapas;` que existen las filas `codigo = 'EN_PROCESO'` y `codigo = 'CLIENTE_FINAL'`, con esa escritura exacta (mayúsculas y guion bajo, no `CLIENTE FINAL`). Anotar sus `id` para las verificaciones manuales y confirmar que los lotes abiertos existentes tienen el `etapa_id` de `EN_PROCESO`. Si algún `codigo` difiere, usar el valor real y corregirlo en este spec antes de escribir código.
3. Agregar las dos claves a `LotesTable` en `src/database/types/types.ts`. Confirmar que la app sigue compilando (`npm run build`): ningún endpoint existente las escribe.
4. Agregar `'etapa_id'` al `select` de `validateLoteAbierto` en `LotesRepository`. No se cambia su firma, su condición ni sus mensajes: `rechazarLote` sigue funcionando igual. Confirmar que compila.
5. Agregar el resolvedor privado `resolveEtapa(codigo, db)` a `LotesRepository`: `selectFrom('etapas').select(['id', 'codigo']).where('codigo', '=', codigo)`, lanzando `BadRequestException` con `La etapa con codigo '${codigo}' no existe` si no hay fila. Devuelve la fila. No se toca `resolveEtapaRechazado`, que queda como duplicado deliberado.
6. Agregar el validador privado `validateEtapaEnProceso(lote, db)` a `LotesRepository`: llama a `resolveEtapa('EN_PROCESO', db)` y lanza `BadRequestException` con `El lote '${lote.nombre_lote}' no esta en la etapa EN_PROCESO` si `lote.etapa_id !== enProceso.id`. Un `etapa_id` en `NULL` también falla, porque `null !== id`.
7. Agregar el validador privado `validateLoteTienePesajes(lote, db)` a `LotesRepository`: `selectFrom('pesajes').select('id').where('lote_id', '=', lote.id).where('isActive', '=', 1).limit(1)`, lanzando `BadRequestException` con `El lote '${lote.nombre_lote}' no tiene pesajes registrados` si no hay ninguna fila.
8. Agregar `aprobarLote(loteId, userId)` a `LotesRepository`: abre `this.db.transaction().execute(...)`, llama en orden a `validateLoteAbierto`, `validateEtapaEnProceso`, `validateLoteTienePesajes` y `resolveEtapa('CLIENTE_FINAL', trx)`, y ejecuta el `updateTable('lotes').set({ estado: 'cerrado', etapa_id: etapa.id, cerrado_en: sql`NOW()`, aprobado_por: userId, aprobado_en: sql`NOW()` }).where('id', '=', loteId)`. No llama a `validateVinculoOperador`. Devuelve `true`. El `sql` de `kysely` ya está importado en el archivo.
9. Agregar `aprobar(loteId, userId)` a `LotesService` como pass-through, igual en forma a `rechazar` pero sin DTO.
10. Agregar el handler `@Patch(':id/aprobar')` a `LotesController`, declarado **después** de `@Patch(':id/rechazar')`, con `@Param('id', ParseIntPipe) id: number` y `@Req() req: Request`, **sin `@Body()`**. Lee `const { userId } = req.user as { userId: number }`. Responde `{ ok: true, msg: 'Lote aprobado correctamente' }`. Sin `@Public()` y sin `@HttpCode`.
11. Levantar con `npm run start:dev` y confirmar que compila y que `PATCH /lotes/:id/aprobar` aparece en el log de rutas de Nest, junto a los cuatro endpoints de lotes ya existentes, y que `PATCH /lotes/:id/rechazar` sigue apareciendo.
12. Verificación manual del camino feliz: crear un lote con `POST /lotes`, agregarle un pesaje con `POST /pesajes`, confirmar que aparece en `GET /lotes/cliente/:clienteId`, aprobarlo, confirmar 200, y confirmar en MySQL que la fila tiene `estado = 'cerrado'`, el `etapa_id` de la etapa `CLIENTE_FINAL`, `cerrado_en` y `aprobado_en` con la hora actual e iguales entre sí, `aprobado_por` con el id del token, y `motivo_rechazo`, `rechazado_por` y `rechazado_en` **todavía en `NULL`**.
13. Verificación manual de la desaparición: confirmar que el lote aprobado ya **no** aparece en `GET /lotes/cliente/:clienteId` ni en `GET /lotes/cliente/:clienteId/all`, que `POST /pesajes` contra él responde 400 `no esta abierto`, que `PATCH /pesajes/:id/rechazar` sobre uno de sus pesajes responde 400 `no esta abierto`, que `PATCH /lotes/:id/rechazar` sobre él responde 400 `no esta abierto`, y que `GET /pesajes/byLote/:loteId` **sigue devolviendo** sus pesajes.
14. Verificación manual del `nombre_lote`: hacer `POST /lotes` con el **mismo `nombre_lote`** y el mismo `cliente_id` del lote aprobado y confirmar 400 `El lote 'X' ya esta registrado para este cliente`. Es lo contrario de lo que pasa con un lote rechazado, y verifica que el filtro de SPEC 12 mira `motivo_rechazo` y no el `estado`.
15. Verificación manual de los errores: aprobar el mismo lote otra vez y confirmar 400 sin que `aprobado_por`, `aprobado_en` ni `cerrado_en` cambien; aprobar un lote rechazado y confirmar 400 `no esta abierto`; aprobar un lote sin ningún pesaje activo y confirmar 400 `no tiene pesajes registrados`; rechazar todos los pesajes de un lote abierto y confirmar que ese lote tampoco se puede aprobar; poner a mano el `etapa_id` de un lote abierto en la etapa `CLIENTE_FINAL` y confirmar 400 `no esta en la etapa EN_PROCESO`; aprobar un `id` inexistente y confirmar 400; llamar a `PATCH /lotes/abc/aprobar` y confirmar 400; llamar sin header `Authorization` y confirmar 401.
16. Verificación manual de la ausencia de control de acceso: login con un `Operador` **no** vinculado al cliente del lote y confirmar que lo aprueba igual, con **200 y no 403**. Es el resultado esperado de este spec y el criterio que documenta que el vínculo no se valida.
17. Actualizar `CLAUDE.md`: agregar `PATCH /lotes/:id/aprobar` a la fila `lotes` de la tabla de endpoints; anotar las dos columnas nuevas de `lotes` y su FK, que pasa a ser la quinta excepción; agregar este endpoint a la lista de rutas que se saltan `validateVinculoOperador`, que pasa de seis a siete, y a la de escrituras abiertas, que pasa de tres a cuatro; corregir el conteo de `PATCH`es, de `UPDATE`s y de `:id` del proyecto, que pasan de tres a cuatro; anotar que este es el primer endpoint de escritura sin DTO ni body; y reescribir la advertencia sobre `estado = 'cerrado'` para decir que **ya significa dos cosas distintas**, que un lote rechazado es `motivo_rechazo IS NOT NULL`, que un lote aprobado es `aprobado_por IS NOT NULL`, y que sigue sin existir el cierre de lote como cálculo. Anotar también que `CLIENTE_FINAL` ya se escribe y que `FINALIZADO` sigue sin escribirse nunca.

---

## Acceptance criteria

- [ ] `DESCRIBE lotes;` muestra `aprobado_por INT` y `aprobado_en DATETIME`, las dos nullables.
- [ ] `SHOW CREATE TABLE lotes;` muestra la FK de `aprobado_por` a `usuarios(id)`, y sigue mostrando la de `rechazado_por`.
- [ ] Las filas de `lotes` anteriores al DDL tienen las dos columnas en `NULL`, y su `estado`, su `etapa_id` y su `cerrado_en` sin cambios.
- [ ] `LotesTable` en `src/database/types/types.ts` declara las dos columnas nuevas, ninguna como `Generated<>`.
- [ ] `EtapasTable` y la tabla `etapas` no se modificaron, y no se sembró ninguna fila nueva en ella.
- [ ] La app arranca sin errores de compilación (`npm run start:dev`).
- [ ] La tabla `permisos` sigue teniendo exactamente las 11 filas de SPEC 08: no se sembró ninguna fila nueva.
- [ ] No se creó ningún DTO: `src/modules/lotes/dto/` sigue con exactamente dos archivos, `create-lote.dto.ts` y `rechazar-lote.dto.ts`.
- [ ] El handler de aprobación no tiene `@Body()` y el endpoint funciona con una petición sin body.
- [ ] `PATCH /lotes/:id/aprobar` aparece en el log de rutas de Nest al arrancar, y `PATCH /lotes/:id/rechazar` sigue apareciendo.
- [ ] `src/app.module.ts` no cambió: `LotesModule` ya estaba registrado.
- [ ] No se creó ningún módulo, controller ni service nuevo: solo se modificaron `lotes.controller.ts`, `lotes.service.ts`, `repository/lotes.repository.ts` y `src/database/types/types.ts`.
- [ ] Aprobar un lote abierto, en etapa `EN_PROCESO` y con al menos un pesaje activo responde 200 con exactamente `{ ok: true, msg: 'Lote aprobado correctamente' }`.
- [ ] La respuesta **no** incluye ninguna clave de recurso: no hay `lote`, ni `data`, ni la etapa devuelta.
- [ ] Después de aprobar, la fila tiene `estado = 'cerrado'`, y no `'aprobado'` ni `'cliente_final'`.
- [ ] Después de aprobar, `etapa_id` es el `id` de la fila de `etapas` con `codigo = 'CLIENTE_FINAL'`, resuelto por `codigo` y no por un id clavado en el código. **El número 2 no aparece en ninguna línea del código de este spec.**
- [ ] Después de aprobar, `cerrado_en` y `aprobado_en` tienen la fecha y hora de la aprobación, no `NULL`, y son iguales entre sí.
- [ ] Después de aprobar, `aprobado_por` es el `userId` del token que llamó, no el `created_by` del lote.
- [ ] Después de aprobar, `motivo_rechazo`, `rechazado_por` y `rechazado_en` siguen en `NULL`: la aprobación no toca el rastro del rechazo.
- [ ] La aprobación **no** modifica `cliente_id`, `nombre_lote`, `producto_id`, `unidad_medida_id`, `variedad_o_talla`, `peso_minimo`, `peso_ideal`, `peso_maximo`, `resumen_ia`, `created_by` ni `created_at` de la fila.
- [ ] Un lote aprobado desaparece de `GET /lotes/cliente/:clienteId`, y el resto de los lotes del cliente sigue apareciendo igual.
- [ ] Un lote aprobado desaparece de `GET /lotes/cliente/:clienteId/all`.
- [ ] `POST /lotes` sigue respondiendo 400 `El lote 'X' ya esta registrado para este cliente` cuando el nombre lo usa un lote **aprobado** del mismo cliente: la aprobación **no** libera el `nombre_lote`.
- [ ] `POST /lotes` sigue liberando el `nombre_lote` de un lote **rechazado**: el comportamiento de SPEC 12 no cambió.
- [ ] `POST /pesajes` contra un lote aprobado responde 400 con `El lote 'X' no esta abierto`. **Es el comportamiento esperado de este spec.**
- [ ] `PATCH /pesajes/:id/rechazar` sobre un pesaje de un lote aprobado responde 400 con `El lote 'X' no esta abierto`. **Es el comportamiento esperado.**
- [ ] `PATCH /lotes/:id/rechazar` sobre un lote aprobado responde 400 con `El lote 'X' no esta abierto`. **Un lote aprobado no se puede rechazar.**
- [ ] `GET /pesajes/byLote/:loteId` de un lote aprobado **sigue devolviendo** sus pesajes activos, con los mismos campos y el mismo orden. **Es el comportamiento esperado.**
- [ ] Los pesajes del lote aprobado no cambian: ninguno queda con `isActive = 0` por efecto de la aprobación.
- [ ] Aprobar un `id` que no existe responde 400 con `El lote con id 'X' no existe`, no 404 y no 500.
- [ ] Aprobar un lote ya aprobado responde 400 con `El lote 'X' no esta abierto`, no con un mensaje de "ya fue aprobado".
- [ ] Aprobar un lote rechazado responde 400 con `El lote 'X' no esta abierto`, y **no** con el mensaje de etapa: la validación de lote abierto corre primero.
- [ ] Tras cualquiera de esos 400, `aprobado_por`, `aprobado_en` y `cerrado_en` de la fila quedan intactos: el segundo intento no sobrescribe nada.
- [ ] Un lote abierto cuyo `etapa_id` no es el de `EN_PROCESO` responde 400 con `El lote 'X' no esta en la etapa EN_PROCESO`.
- [ ] Un lote abierto en `EN_PROCESO` **sin ningún pesaje** responde 400 con `El lote 'X' no tiene pesajes registrados`.
- [ ] Un lote abierto en `EN_PROCESO` cuyos únicos pesajes tienen `isActive = 0` responde 400 con `El lote 'X' no tiene pesajes registrados`: el conteo filtra `isActive = 1`.
- [ ] Un `id` de ruta no numérico (`PATCH /lotes/abc/aprobar`) responde 400 por `ParseIntPipe`.
- [ ] `PATCH /lotes/:id/aprobar` sin header `Authorization` responde 401: el endpoint no es `@Public()`.
- [ ] `PATCH /lotes/:id/aprobar` con un token expirado o firmado con otro secreto responde 401.
- [ ] Un `Operador` **sin** fila en `cliente_operador` para el cliente del lote lo aprueba igual: responde **200, no 403**. **Este spec no valida el vínculo.**
- [ ] Un usuario que no creó el lote puede aprobarlo: no se compara contra `lotes.created_by`.
- [ ] No se exige ningún rol: cualquier usuario autenticado aprueba, y `req.user` sigue siendo `{ userId, username }`.
- [ ] Cuando cualquier validación falla, ninguna columna de la fila cambia: la transacción no deja escrituras parciales.
- [ ] Si falta la fila `codigo = 'EN_PROCESO'` en `etapas`, la aprobación responde 400 `La etapa con codigo 'EN_PROCESO' no existe`.
- [ ] Si falta la fila `codigo = 'CLIENTE_FINAL'` en `etapas`, la aprobación responde 400 `La etapa con codigo 'CLIENTE_FINAL' no existe`.
- [ ] `PATCH /lotes/:id/rechazar` sigue funcionando exactamente igual que antes de este spec: mismo mensaje, mismas seis columnas escritas, mismo `etapa_id` de `RECHAZADO`. Agregar `etapa_id` al `select` de `validateLoteAbierto` no cambió su comportamiento.
- [ ] `resolveEtapaRechazado` sigue existiendo y `rechazarLote` sigue llamándolo: este spec no lo unificó con `resolveEtapa`.
- [ ] `GET /lotes/cliente/:clienteId` y `GET /lotes/cliente/:clienteId/all` no cambiaron: mismos campos, mismo filtro `estado = 'abierto'`, mismo orden, mismos joins.
- [ ] `GET /lotes/cliente/:clienteId` sigue validando el vínculo `cliente_operador` y sigue respondiendo 403 sin él.
- [ ] `createLote` sigue escribiendo `etapa_id: 1` y `estado: 'abierto'`: este spec no toca ese literal.
- [ ] No existe ningún endpoint para deshacer una aprobación, para finalizar un lote (`FINALIZADO`) ni para listar lotes aprobados o cerrados.
- [ ] Ninguna fila de `lotes` queda nunca con `motivo_rechazo` y `aprobado_por` llenos a la vez: los dos endpoints exigen que el lote esté abierto.
- [ ] No se agregó `GET /catalogos/etapas` ni ningún otro endpoint sobre `etapas`.
- [ ] `GET /permisos/me` responde exactamente igual que antes de este spec: siete códigos para `Admin` y cuatro para `Operador`, ninguno de aprobación de lotes.
- [ ] El payload del JWT no cambió.
- [ ] `POST /clientes`, `GET /clientes`, `GET /clientes/all`, `PATCH /clientes/:id/rechazar` (SPEC 01, 08, 11), `POST /pesajes` (SPEC 03, SPEC 04), `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh` (SPEC 05), `GET /permisos/me` (SPEC 07) y los tres `GET /catalogos/*` (SPEC 09) siguen funcionando igual.
- [ ] `CLAUDE.md` lista `PATCH /lotes/:id/aprobar` en la tabla de endpoints y documenta las dos columnas nuevas.
- [ ] `CLAUDE.md` advierte que `estado = 'cerrado'` significa **dos** cosas distintas, que un lote rechazado es `motivo_rechazo IS NOT NULL`, que un lote aprobado es `aprobado_por IS NOT NULL`, y que sigue sin existir el cierre de lote como cálculo.

---

## Decisions

- **Sí:** "aprobar" significa **mover el lote a la etapa `CLIENTE_FINAL` y cerrarlo**. Decisión explícita del usuario. El caso real es el supervisor que revisa el lote pesado, lo da por bueno y lo manda al cliente final.
- **Sí:** `estado` pasa a `'cerrado'`. Decisión explícita del usuario, tomada **después** de que se le presentaran las tres consecuencias con detalle: el lote desaparece de los dos `GET`, `POST /pesajes` empieza a responder 400 y `'cerrado'` deja de identificar el rechazo. Es lo que se pidió textualmente.
- **No:** dejar `estado = 'abierto'` y mover solo el `etapa_id`, que era la recomendación. Se descarta pese a que habría dejado el lote visible en los listados con etapa `Cliente final` y habría permitido los pesajes de esa etapa, que es lo que el diagrama espera. Consecuencia asumida y registrada en Risks: el flujo de pesaje en cliente final queda bloqueado hasta que un spec futuro lo desbloquee.
- **No:** un tercer valor de `estado`, `'cliente_final'`. Se descarta: habría exigido cambiar el filtro de los dos `GET` de lotes y las dos copias de `validateLoteAbierto`, o el lote habría desaparecido igual con más código escrito.
- **Sí:** se escribe `cerrado_en = NOW()`. Decisión explícita del usuario. Deja las dos columnas del ciclo de vida coherentes y hace que `validateLoteAbierto` falle por las dos condiciones, no solo por una.
- **No:** dejar `cerrado_en` en `NULL` con `estado = 'cerrado'`. Se descarta: sería un estado de fila que hoy no existe y cualquier query que use `cerrado_en` para saber si el lote terminó lo leería mal.
- **Sí:** `cerrado_en` y `aprobado_en` son columnas distintas aunque hoy guarden el mismo valor. Se mantiene el criterio de SPEC 12: la primera es del ciclo de vida del lote, la segunda del rastro de esta operación.
- **Sí:** la señal canónica de la aprobación es `aprobado_por IS NOT NULL`, y la del rechazo sigue siendo `motivo_rechazo IS NOT NULL`. Es la consecuencia obligada de que las dos operaciones compartan el `estado` y el `cerrado_en`. Queda escrito en el modelo de datos como regla para todo código nuevo.
- **Sí:** el `etapa_id` de destino se resuelve por `codigo = 'CLIENTE_FINAL'` dentro de la transacción, con 400 si la fila falta. Decisión explícita del usuario, contra el `etapa_id: 2` que el pedido mencionaba. Mismo patrón de `resolveEtapaRechazado` (SPEC 12) y de `resolveEstadoCalidad` en `PesajesRepository`.
- **No:** clavar `etapa_id: 2` como hace `createLote` con su `etapa_id: 1`. Se descarta: si el id difiere entre ambientes, la aprobación escribiría la etapa equivocada **sin fallar**, que es el peor modo de error posible.
- **Sí:** la etapa de origen `EN_PROCESO` también se resuelve por `codigo` para comparar, no por el id 1. Misma razón.
- **Sí:** se agrega un `resolveEtapa(codigo, db)` genérico y se deja `resolveEtapaRechazado` intacto. El archivo queda con dos formas de resolver una etapa. Se acepta a cambio de no tocar el código de SPEC 12, que es el criterio que ese mismo spec aplicó al duplicar `validateLoteAbierto` en vez de compartirlo.
- **No:** reescribir `rechazarLote` para que use el `resolveEtapa` genérico, aunque el mensaje de error resultante sería idéntico. Se descarta: modifica el camino de un endpoint ya implementado sin necesidad funcional. Unificar los dos es una limpieza propia, y hay un criterio de aceptación que verifica que `resolveEtapaRechazado` sigue en su lugar.
- **No:** un tercer `resolveEtapaClienteFinal(db)` dedicado, copiando literalmente la forma de SPEC 12. Se descarta: serían tres copias de la misma consulta de ocho líneas en el mismo archivo, y este spec necesita dos códigos distintos.
- **Sí:** DDL con dos columnas de auditoría, `aprobado_por` y `aprobado_en`. Decisión explícita del usuario. Sin esto, no quedaría registro de qué supervisor aprobó el lote ni cuándo, y la aprobación sería la única operación de escritura relevante del proyecto sin rastro.
- **Sí:** FK real de `aprobado_por` a `usuarios(id)`. Quinta excepción del proyecto a la regla de validar solo en código, con la misma justificación que las tres de rechazo: es un dato de auditoría y una fila huérfana lo dejaría sin valor probatorio.
- **No:** una tercera columna de texto, `observacion_aprobacion`, con un campo opcional en el body. Se descarta por decisión explícita del usuario. Consecuencia: el endpoint no recibe body y no lleva DTO.
- **No:** sin DDL, escribiendo solo `estado`, `etapa_id` y `cerrado_en`. Se descarta pese a ser el alcance mínimo: dejaría la aprobación sin autor, y con `'cerrado'` compartido con el rechazo tampoco habría forma de distinguir las dos operaciones en la base.
- **Sí:** las dos columnas son nullables. Las filas existentes no tienen valor y no se van a rellenar.
- **Sí:** el endpoint **no tiene DTO ni body**. Es la consecuencia directa de no llevar observación. Es el primer `PATCH` del proyecto sin `@Body()` y el primer endpoint de escritura sin schema Zod. Un body enviado de todas formas se ignora.
- **Sí:** solo se aprueba un lote con `estado = 'abierto'` y `cerrado_en IS NULL`. Decisión explícita del usuario. Reusa `validateLoteAbierto`, que ya existe en este repositorio, y protege el rastro: un lote ya aprobado o ya rechazado no se puede aprobar.
- **Sí:** el caso "ya aprobado" cae en el mensaje genérico `El lote 'X' no esta abierto`, sin chequeo ni mensaje propios. Es lo mismo que SPEC 12 aceptó para "ya rechazado" y la consecuencia de marcar el estado en una columna de ciclo de vida.
- **Sí:** solo se aprueba un lote cuya etapa actual es `EN_PROCESO`. Decisión explícita del usuario. Fuerza el orden del flujo del diagrama y bloquea la aprobación de un lote que ya está en otra etapa.
- **Sí:** solo se aprueba un lote con al menos un pesaje activo. Decisión explícita del usuario: no hay nada que aprobar en un lote vacío. Es la primera validación del proyecto que consulta otra tabla para contar filas en vez de resolver una fila concreta.
- **Sí:** el conteo de pesajes filtra `isActive = 1`, igual que `GET /pesajes/byLote/:loteId`. Consecuencia anotada: un lote cuyos únicos pesajes fueron rechazados cuenta como lote sin pesajes y no se puede aprobar. Es lo correcto — no hay resultado que dar por bueno.
- **No:** exigir que ningún pesaje activo tenga `fuera_de_rango = 1`. Se descarta por decisión explícita del usuario. Habría convertido la aprobación en automática según los datos, y el diagrama dice que un fuera de rango se autoriza con PIN de supervisor, mecanismo que todavía no existe. La decisión de aprobar se queda en el humano que llama al endpoint.
- **No:** mirar `estado_calidad_id` de los pesajes. Se descarta por lo mismo: la derivación del estado de calidad es SPEC 04 y no está implementada.
- **Sí:** el orden de las validaciones es lote abierto → etapa `EN_PROCESO` → tiene pesajes → resolver `CLIENTE_FINAL`. Importa porque decide el mensaje: un lote rechazado falla en la primera y nunca llega a la de etapa, que habría dicho que su etapa es `RECHAZADO`. Hay un criterio de aceptación que lo fija.
- **Sí:** `PATCH /lotes/:id/aprobar`. Copia el precedente de los tres `rechazar`. No choca con `PATCH /lotes/:id/rechazar` porque el segundo segmento es distinto, ni con las dos rutas `cliente/...` porque el verbo y el primer segmento son distintos.
- **Sí:** el handler se declara después del de `rechazar`, y los dos después de las dos rutas `cliente/...`. Es el orden que evita el problema que `CLAUDE.md` ya advierte para un `GET /lotes/:id` futuro.
- **Sí:** el `id` va en la ruta, no en el body. Es el recurso que se está modificando, y además no hay body.
- **Sí:** la respuesta es solo `{ ok, msg }`. Decisión explícita del usuario. Los cuatro `PATCH` del proyecto quedan con la misma forma.
- **No:** `{ ok, msg, lote: { id, estado, etapa, aprobado_en } }`, que habría vuelto a la convención de payload con clave nombrada. Se descarta por la decisión anterior, pese al argumento de que después de aprobar el lote es inalcanzable por API y esta respuesta sería la última vez que el cliente lo ve.
- **Sí:** el `UPDATE` y sus validaciones van dentro de una transacción, con los validadores recibiendo el `trx`. Es la convención de escritura del proyecto.
- **Sí:** `cerrado_en` y `aprobado_en` se escriben con `NOW()` de MySQL, no con un `new Date()` de Node. Se mantiene la decisión de SPEC 10, 11 y 12: misma fuente de hora que `created_at`, y un solo `NOW()` por sentencia garantiza que las dos columnas queden idénticas.
- **Sí:** cualquier usuario autenticado puede aprobar cualquier lote, sin `validateVinculoOperador`. Decisión explícita del usuario, tomada después de que se le presentaran las dos alternativas y se le señalara que aquí el problema es peor que en SPEC 12: `LotesRepository` queda con dos de sus cuatro métodos saltándose el vínculo, y esta no es una operación destructiva sino de aprobación, así que un `Operador` puede dar por bueno el lote de un cliente que no es suyo.
- **No:** exigir el vínculo `cliente_operador` con 403, que es la convención declarada del proyecto y lo que hacen `getLotesByCliente` y `createLote` en la misma clase. Se descarta. Se anota la consecuencia que motivó la duda, la misma de SPEC 11 y 12: hoy nada discrimina por rol, así que exigir el vínculo habría dejado a un `Admin` sin filas en `cliente_operador` sin poder aprobar ningún lote.
- **No:** exigir un rol de supervisor. Se descarta: no hay `PermissionsGuard`, `req.user` es `{ userId, username }` y el `rol_id` no viaja en el token. Inventar el chequeo aquí duplicaría el mecanismo que el spec del guard tiene que construir.
- **No:** exigir que quien aprueba sea quien creó el lote (`lotes.created_by`). Se descarta por la misma razón que en los tres specs de rechazo: bloquearía justo al supervisor, que es quien aprueba y no quien creó el lote.
- **Sí:** ninguna fila nueva en `permisos`. Decisión explícita del usuario. La tabla sigue en 11 filas. Es la sexta excepción a la regla de SPEC 06, y la quinta consecutiva.
- **No:** sembrar `lotes.aprobar` para `Admin` (una fila, tabla en 12), que es lo que la convención pide. Se descarta. Consecuencia asumida: el `PermissionsGuard` futuro va a encontrar **cuatro** escrituras sin código de permiso que exigir, y tendrá que inventar los cuatro.
- **Sí:** la aprobación es irreversible. Mismo criterio que los tres rechazos. La fila no se borra, así que se puede revertir por SQL a mano si hace falta.
- **No:** un endpoint que devuelva el lote a `EN_PROCESO` y `estado = 'abierto'`. Se descarta: abre la pregunta de qué pasa con el rastro de la aprobación anterior y con el `cerrado_en` escrito.
- **Sí:** el `nombre_lote` de un lote aprobado **sigue ocupado**. No hay decisión que tomar ni código que escribir: el filtro de `validateNombreLoteDisponible` mira `motivo_rechazo IS NULL` y la aprobación no escribe esa columna. Es exactamente el caso que SPEC 12 simuló a mano al elegir ese filtro en vez de uno por `estado`, y confirma que la elección fue correcta.
- **Sí:** sin cascada sobre `pesajes`. Se mantiene el criterio de SPEC 11 y 12: los pesajes del lote aprobado no se tocan.
- **No:** aprobar en lote (varios ids en una llamada). Se descarta: abre la pregunta de qué pasa si uno de los ids falla.
- **Sí:** este spec cubre **solo** la transición `EN_PROCESO` → `CLIENTE_FINAL`. Decisión explícita del usuario. `FINALIZADO` sigue sin escribirse nunca.
- **No:** cubrir también `CLIENTE_FINAL` → `FINALIZADO` en este spec. Se descarta: exige decidir qué significa `FINALIZADO` con el lote ya cerrado desde la primera aprobación, y son dos specs.
- **No:** corregir el literal `etapa_id: 1` de `createLote`, ni documentar `etapas` entera, ni agregar `GET /catalogos/etapas`. Se mantiene la decisión de SPEC 12: la tabla entró al esquema sin spec y ordenarla es su propio trabajo.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **`estado = 'cerrado'` ya significa dos cosas distintas.** SPEC 12 lo dejó como riesgo teórico; este spec lo materializa. Cualquier query o código que asuma que `'cerrado'` significa "rechazado" — o "terminó bien" — va a estar equivocado en parte de las filas, y `cerrado_en` tampoco los separa. | **Sin mitigar en el esquema**, por decisión explícita del usuario. La mitigación es documental y de convención: el modelo de datos trae la tabla que fija `motivo_rechazo IS NOT NULL` para el rechazo y `aprobado_por IS NOT NULL` para la aprobación, hay criterios de aceptación que lo verifican, y el paso 17 lo reescribe en `CLAUDE.md`. El spec que implemente el cierre por cálculo hereda el problema con **dos** operaciones ya usando el valor. |
| **Un lote aprobado no admite más pesajes y desaparece de los dos listados**, así que el flujo de pesaje en la etapa cliente final que el diagrama describe queda inalcanzable. `POST /pesajes` responde 400 en cuanto el lote se aprueba. | **Sin mitigar por diseño**, por decisión explícita del usuario tomada con la consecuencia sobre la mesa. Es el riesgo principal de este spec. Hay criterios de aceptación que lo fijan como comportamiento esperado. La mitigación real es el spec que implemente el pesaje en cliente final, que tendrá que decidir si el lote deja de cerrarse aquí o si `validateLoteAbierto` cambia. |
| **Cualquier usuario autenticado puede aprobar cualquier lote**, incluido un `Operador` sin ninguna fila en `cliente_operador` para ese cliente. Es la cuarta escritura abierta del proyecto y la primera que no es destructiva: aprueba trabajo de un cliente ajeno. | **Sin mitigar por diseño**, por decisión explícita del usuario. Hay un criterio de aceptación que lo verifica y lo registra como comportamiento esperado. `LotesRepository` queda con dos de cuatro métodos validando el vínculo. La mitigación real es el spec del `PermissionsGuard`. |
| **Un lote aprobado ya no se puede rechazar.** `rechazarLote` llama a `validateLoteAbierto`, así que responde 400. Una aprobación por error no se puede corregir con un rechazo. | Sin mitigar por decisión (la aprobación es irreversible). La fila no se borra, así que se puede revertir por SQL a mano. El requisito de que el lote tenga pesajes reduce las aprobaciones accidentales sobre lotes recién creados. |
| **Los pesajes de un lote aprobado quedan imposibles de anular.** Es el mismo callejón sin salida que SPEC 12 dejó para los lotes rechazados, ahora también en el camino feliz, que es mucho más frecuente. | Sin mitigar por decisión explícita (sin cascada). Hay un criterio de aceptación que lo fija. Corregirlo exige tocar SPEC 10 y va en su propio spec. |
| `GET /pesajes/byLote/:loteId` **sigue devolviendo los pesajes de un lote aprobado**: no valida el lote. La app puede mostrar los pesajes de un lote que no aparece en ningún listado. | Sin mitigar por decisión explícita. Es la misma incoherencia que SPEC 11 y 12 ya asumieron. Aquí juega a favor: es la única forma que le queda a la app de mostrar lo que se aprobó. |
| Si en algún ambiente `EN_PROCESO` no es el id 1, `createLote` sigue creando lotes con `etapa_id: 1` y **ningún lote se puede aprobar**: `validateEtapaEnProceso` responde 400 siempre. El literal y el validador quedan desacoplados. | Mitigado en el plan: el paso 2 verifica con un `SELECT` que los lotes abiertos existentes tienen el `etapa_id` de `EN_PROCESO` antes de escribir código. Corregir el literal está fuera de alcance por decisión, así que el riesgo queda anotado para el spec que documente `etapas`. |
| El `codigo` real de la fila no es `CLIENTE_FINAL` sino `CLIENTE FINAL` o algo distinto, y el endpoint responde 400 siempre. | Mitigado: el paso 2 del plan pide confirmar la escritura exacta con un `SELECT` y corregir este spec antes de escribir código. El error es 400 con un mensaje que nombra el `codigo` buscado, así que es evidente. |
| Ahora hay dos formas de resolver una etapa en el mismo archivo: `resolveEtapaRechazado(db)` y `resolveEtapa(codigo, db)`. Alguien agrega una tercera. | Sin mitigar en el código, por decisión registrada. Hay un criterio de aceptación que verifica que `resolveEtapaRechazado` sigue en su lugar, así que la duplicación es deliberada y visible. Unificarlas es una limpieza propia. |
| Agregar `'etapa_id'` al `select` de `validateLoteAbierto` toca un validador que `rechazarLote` también usa. | Es un cambio aditivo: no cambia la firma, la condición ni los mensajes. Hay un criterio de aceptación que verifica que `PATCH /lotes/:id/rechazar` responde y escribe exactamente igual que antes. |
| El endpoint no lleva DTO, así que es el único de escritura sin schema Zod. Alguien agrega después un campo al body y no hay dónde validarlo. | Asumido: es la consecuencia de no tener observación de aprobación. El día que haga falta un campo, se crea `aprobar-lote.dto.ts` siguiendo la forma de `rechazar-lote.dto.ts`. |
| Al no sembrar ninguna fila en `permisos`, el `PermissionsGuard` futuro se encuentra con **cuatro** escrituras sin código de permiso — esta y las tres de rechazo — y sin saber si fue decisión o descuido. | Queda registrado aquí, en dos decisiones y en `CLAUDE.md`. El paso 17 del plan lo incluye. La regla de SPEC 06 lleva cinco specs seguidos sin cumplirse. |
| Un lote aprobado no aparece en ningún endpoint, así que la app no puede mostrar qué se aprobó ni cuándo. | Sin mitigar por decisión explícita. Las dos columnas quedan escritas desde el día uno, así que cuando llegue el endpoint de lectura el dato histórico ya existe. |
| El DDL se aplica en un ambiente y no en otro, y el `UPDATE` falla por columna inexistente. Es el riesgo heredado de no tener migraciones. | Sin mitigación automática. El paso 1 del plan verifica con `DESCRIBE lotes;` y `SHOW CREATE TABLE lotes;`. El DDL queda escrito en este spec, que es la única fuente. |
| Alguien lee "aprobar lote" y asume que es el estado de calidad `APROBADO` del diagrama, o la derivación automática de SPEC 04. | Está en el objetivo, en la sección de por qué existe el spec y en las decisiones. No se toca `estados_calidad` ni `estado_calidad_id`, y no se mira `fuera_de_rango`. |

---

## What is **not** in this spec

- La transición `CLIENTE_FINAL` → `FINALIZADO`: no hay endpoint para finalizar un lote y `FINALIZADO` sigue sin escribirse nunca.
- El cierre de lote como cálculo: agregados por lote, conteos por estado de calidad y `resumen_ia`.
- Separar por `estado` un lote rechazado de un lote aprobado: los dos quedan en `'cerrado'`, y las señales son `motivo_rechazo` y `aprobado_por`.
- Permitir pesajes en la etapa `CLIENTE_FINAL`: el lote queda cerrado y `POST /pesajes` responde 400.
- El PIN de supervisor para autorizar pesajes fuera de rango en cliente final.
- Derivar la aprobación de los datos: no se mira `fuera_de_rango` ni `estado_calidad_id`.
- Exigir un rol de supervisor, o cualquier discriminación por rol.
- Deshacer una aprobación: no hay endpoint de reversión.
- Aprobar varios lotes en una llamada.
- Diseñar o documentar la tabla `etapas` entera, corregir el literal `etapa_id: 1` de `createLote`, y `GET /catalogos/etapas`.
- Sembrar filas en `etapas`: las filas `EN_PROCESO` y `CLIENTE_FINAL` ya existen.
- Unificar `resolveEtapa` con el `resolveEtapaRechazado` de SPEC 12.
- Cambios a `GET /lotes/cliente/:clienteId` y `GET /lotes/cliente/:clienteId/all`, ni agregarle a este último la validación de vínculo que no tiene.
- Cambios a `POST /pesajes`, `PATCH /pesajes/:id/rechazar`, `GET /pesajes/byLote/:loteId` y `PATCH /lotes/:id/rechazar`.
- Cambios a `validateNombreLoteDisponible`: el `nombre_lote` de un lote aprobado sigue ocupado y así se quiere.
- Un endpoint para listar lotes aprobados o cerrados, y cualquier query param para incluirlos.
- Devolver `aprobado_por` o `aprobado_en` en algún endpoint de lectura.
- Una observación o comentario de aprobación, y por tanto cualquier DTO para este endpoint.
- Sembrar filas en `permisos`: la tabla sigue con las 11 filas de SPEC 08.
- Aplicar permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`.
- Validar el vínculo `cliente_operador`, ni exigir que quien aprueba sea quien creó el lote.
- Borrado físico de lotes.

Cada uno de estos, si se necesita, va en su propio spec.
