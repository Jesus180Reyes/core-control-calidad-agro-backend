# SPEC 19 — Aprobación de pesajes por el aprobador

> **Status:** Implemented
> **Depends on:** SPEC 03, SPEC 10, SPEC 13
> **Date:** 2026-09-10
> **Objective:** Agregar `PATCH /pesajes/:id/aprobar/byApprover`, que marca un pesaje activo y sin revisar de un lote en etapa `CLIENTE_FINAL` como aprobado (`aprobado = 1`, `aprobado_por`, `aprobado_en`), y documentar retroactivamente el flujo del aprobador que entró al repositorio sin spec.

---

## Why this spec exists

El diagrama termina con un aprobador que revisa, uno por uno, los pesajes del lote que el supervisor ya mandó a cliente final. Ese flujo está **a medio construir y sin spec**.

**Lo primero que hay que saber de este spec es que la mitad de su contexto no está documentada en ninguna parte.** Entre el 8 y el 10 de septiembre de 2026 entraron a `main` cinco commits —`544508a`, `af47797`, `aa4020d`, `bb0c4be` y `92e9d43`— que agregaron tres columnas a `pesajes` por DDL a mano, tres endpoints nuevos y dos validadores privados. Ninguno tiene spec, `CLAUDE.md` no menciona ninguno de los tres endpoints, y el único rastro es el mensaje de los commits. Este spec los adopta: los describe tal como están, sin cambiarlos, igual que SPEC 10 hizo con `GET /pesajes/byLote/:loteId` y SPEC 12 con `GET /lotes/cliente/:clienteId/all`.

Lo que falta del flujo es la mitad positiva. Hoy el aprobador **solo puede rechazar**: `PATCH /pesajes/:id/rechazar/byApprover` escribe `aprobado = 0`, pero no existe nada que escriba `aprobado = 1`. Un pesaje bueno se queda en `NULL` para siempre, indistinguible de uno que nadie miró. Eso es lo que este spec agrega, y es casi todo lo que agrega.

Hay cuatro cosas más que conviene tener claras antes de leer el resto.

**La primera: `aprobado` es de tres estados, no un booleano.** `1` es "el aprobador lo aprobó", `0` es "el aprobador lo rechazó" y `NULL` es "nadie lo ha revisado". `NULL` **no** significa "no aprobado". La columna está tipada `boolean | null` desde `af47797`, que preserva los tres estados (`true` / `false` / `null`), y las dos lecturas ya la mapean así.

**La segunda: `aprobado = 0` y `isActive = 0` son cosas distintas y no hay que confundirlas.** `isActive = 0` es la anulación lógica que escribe `PATCH /pesajes/:id/rechazar` desde SPEC 10: el pesaje desaparece de las lecturas. `aprobado = 0` es el veredicto del aprobador sobre un pesaje que **sigue activo y visible**. Por eso `rechazarPesajeApprover` no toca `isActive`.

**La tercera: este spec cierra un hueco de la revisión doble, y para eso toca un método ya mergeado.** `rechazarPesajeApprover` valida hoy `motivo_rechazo !== null` para decidir si el pesaje ya fue revisado. Esa condición no detecta un pesaje **aprobado**: después de que exista este endpoint, un pesaje con `aprobado = 1` tendría `motivo_rechazo` en `NULL` y se podría rechazar encima, sobrescribiendo la aprobación. Los dos métodos pasan a validar `aprobado !== null`, que es la señal correcta. Sin este cambio, el endpoint nuevo nacería con un agujero el mismo día.

**La cuarta: es la séptima escritura del proyecto abierta a cualquier usuario autenticado.** No llama a `validateVinculoOperador` y no siembra fila en `catalogo_permisos` ni en `permisos`, igual que las seis anteriores. Es decisión explícita y está en Risks.

---

## Scope

**In:**

- Nuevo método `approvePesajeForApprover(pesajeId, userId)` en `src/modules/pesajes/repository/pesajes.repository.ts`, dentro de una transacción.
- Nuevo método `aprobarByApprover(pesajeId, userId)` en `src/modules/pesajes/pesajes.service.ts`, pass-through al repositorio.
- Nuevo handler `@Patch(':id/aprobar/byApprover')` en `src/modules/pesajes/pesajes.controller.ts`, con `@Param('id', ParseIntPipe)` y **sin `@Body()`**.
- Nuevo endpoint `PATCH /pesajes/:id/aprobar/byApprover`, protegido solo por el `JwtAuthGuard` global.
- El `UPDATE` escribe exactamente **tres** columnas: `aprobado = 1`, `aprobado_por` (del `req.user.userId`) y `aprobado_en` (`NOW()` de MySQL).
- Nuevo validador privado `validatePesajeSinRevisar(pesaje)` en `PesajesRepository`, que lanza 400 si `aprobado !== null`.
- Agregar `'aprobado'` al `select` del validador existente `validatePesajeActivo`, sin cambiar su firma, su condición ni sus mensajes.
- **Corrección de `rechazarPesajeApprover`**: pasa a usar `validatePesajeSinRevisar` en vez de su chequeo actual de `motivo_rechazo !== null`. Cierra el hueco de la revisión doble.
- Reuso de los validadores existentes `validatePesajeActivo`, `validateLoteEnClienteFinal` y `resolveEtapa`, sin modificarlos más allá del `select` anterior.
- Respuesta `200` con la forma `{ ok, msg }`, sin payload de recurso y sin body en la petición.
- `400` si el pesaje no existe, está anulado (`isActive = 0`), ya fue revisado por el aprobador, no tiene lote, o su lote no está cerrado / no está en `CLIENTE_FINAL` / fue rechazado.
- **Sin DDL**: las tres columnas `aprobado`, `aprobado_por` y `aprobado_en` ya existen en `pesajes` desde el 2026-09-08.
- **Sin cambios en `src/database/types/types.ts`**: las tres columnas ya están declaradas en `PesajesTable`.
- Actualizar `CLAUDE.md` con el endpoint nuevo **y** con los tres que entraron sin spec: `PATCH /pesajes/:id/rechazar/byApprover`, `PATCH /lotes/:id/rechazar/byApprover` y `GET /lotes/cliente/:clienteId/all/approver`, más el DDL de las tres columnas y los conteos que cambian.

**Out of scope (for future specs):**

- La transición `CLIENTE_FINAL` → `FINALIZADO`. Aprobar un pesaje **no toca el lote**, y `FINALIZADO` sigue sin escribirse nunca.
- Cerrar o finalizar el lote cuando todos sus pesajes quedan revisados. Aprobar el último pesaje no dispara nada.
- Aprobar en lote: varios `pesaje_id` en una llamada, o "aprobar todos los pesajes de este lote".
- Deshacer una aprobación o un rechazo del aprobador, y cambiar de opinión sobre un pesaje ya revisado.
- Un `?aprobado` en `GET /pesajes/byLote/:loteId` para listar lo pendiente de revisar. El campo `aprobado` ya viaja en la respuesta y el frontend puede separar en cliente.
- Devolver `aprobado_por` o `aprobado_en` en cualquier endpoint de lectura. Siguen invisibles por API.
- Una observación o comentario de aprobación. El endpoint no recibe body y no hay columna donde guardarla.
- El PIN de supervisor para autorizar pesajes fuera de rango en cliente final, que es lo que el diagrama pone en esta etapa.
- Derivar la aprobación de los datos: este spec **no** mira `fuera_de_rango` ni `estado_calidad_id`. La decisión es del humano que llama al endpoint.
- Corregir el `where('lotes.etapa_id', '=', 2)` **clavado** de `getAllLotesByClienteForApprover`. Ver Risks.
- Unificar las copias de `validateLoteEnClienteFinal` y `resolveEtapa`, que ahora viven duplicadas en `PesajesRepository` y en `LotesRepository`.
- Permitir pesajes nuevos en la etapa `CLIENTE_FINAL`. `POST /pesajes` sigue respondiendo 400 sobre un lote cerrado, que es lo que SPEC 13 dejó anotado.
- Sembrar filas en `catalogo_permisos` o en `permisos`, y **aplicar** permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`.
- Validar el vínculo `cliente_operador`, exigir un rol de aprobador, o exigir que quien aprueba no sea quien pesó.
- Cualquier DDL: ni columnas, ni índices, ni FK.
- Cambios a `POST /pesajes`, `PATCH /pesajes/:id/rechazar`, `GET /pesajes/byLote/:loteId`, `GET /pesajes/historial` y a los cuatro endpoints de escritura de `lotes` y `clientes`.

---

## Data model

**Este spec no introduce datos nuevos.** No hay DDL y `src/database/types/types.ts` no se toca.

### El DDL que ya está aplicado (documentado aquí por primera vez)

Las tres columnas se agregaron a mano el 2026-09-08, sin spec. Se transcriben para que exista una fuente:

```sql
ALTER TABLE pesajes
  ADD COLUMN aprobado TINYINT(1) NULL AFTER rechazado_en,
  ADD COLUMN aprobado_por INT NULL AFTER aprobado,
  ADD COLUMN aprobado_en DATETIME NULL AFTER aprobado_por;

ALTER TABLE pesajes
  ADD CONSTRAINT fk_pesajes_aprobado_por
  FOREIGN KEY (aprobado_por) REFERENCES usuarios(id);
```

El paso 1 del plan verifica contra MySQL que esto es exactamente lo que hay. Si difiere, manda la base y se corrige este spec.

Esa FK es la **séptima** excepción del proyecto a la regla de validar solo en código, después de `permisos` → `roles`, las cuatro de auditoría de SPEC 10 a 13 y `permisos.permiso_id` de SPEC 14. Misma justificación: es auditoría y una fila huérfana la dejaría sin valor probatorio.

### `PesajesTable`, sin cambios

```ts
export interface PesajesTable {
  // ...campos existentes sin cambios...
  motivo_rechazo: string | null;
  rechazado_por: number | null;
  rechazado_en: Date | string | null;
  aprobado: boolean | null;      // ya declarada
  aprobado_por: number | null;   // ya declarada
  aprobado_en: Date | string | null; // ya declarada
}
```

### Los tres estados de `aprobado`

| Valor | Significado | Quién lo escribe |
| --- | --- | --- |
| `NULL` | Nadie ha revisado el pesaje. **No significa "no aprobado".** | Nadie: es el valor con el que nace toda fila. |
| `1` / `true` | El aprobador lo aprobó. | **Este spec**, y nada más. |
| `0` / `false` | El aprobador lo rechazó. | `rechazarPesajeApprover` (commit `af47797`). |

Las dos lecturas de pesajes ya devuelven `aprobado` mapeado a `true` / `false` / `null`, así que la API expone los tres estados desde antes de este spec.

**`aprobado` no es `isActive`.** La tabla que hay que tener presente:

| Columna | Qué dice | Quién la escribe | Efecto en las lecturas |
| --- | --- | --- | --- |
| `isActive = 0` | El pesaje fue **anulado** por el operador. | `PATCH /pesajes/:id/rechazar` (SPEC 10) | Desaparece de los dos `GET`. |
| `aprobado = 0` | El aprobador lo **rechazó**, pero el pesaje sigue vivo. | `PATCH /pesajes/:id/rechazar/byApprover` | **Sigue apareciendo**, con `aprobado: false`. |
| `aprobado = 1` | El aprobador lo **aprobó**. | `PATCH /pesajes/:id/aprobar/byApprover` — este spec | Sigue apareciendo, con `aprobado: true`. |

### DTO

**Este endpoint no tiene DTO.** No recibe body: el `id` viene en la ruta y el usuario del token. Es el segundo endpoint de escritura del proyecto sin schema Zod, después de `PATCH /lotes/:id/aprobar` (SPEC 13). Un body enviado de todas formas se ignora.

### El `UPDATE`

```sql
UPDATE pesajes
SET aprobado = 1,
    aprobado_por = ?,
    aprobado_en = NOW()
WHERE id = ?;
```

Son tres columnas. **No toca** `isActive`, `motivo_rechazo`, `rechazado_por`, `rechazado_en`, `peso_bruto`, `tara`, `peso_neto`, `fuera_de_rango`, `estado_calidad_id`, `lote_id`, `usuario_id`, `dispositivo_identificador`, `secuencia_dispositivo` ni `created_at`.

Es el **espejo** de `rechazarPesajeApprover`, que escribe `aprobado = 0` más el trío `motivo_rechazo` / `rechazado_por` / `rechazado_en`. La aprobación tiene una columna menos porque no lleva motivo.

`aprobado_en` se escribe con `NOW()` de MySQL, no con un `new Date()` de Node: misma fuente de hora que `created_at`, como en SPEC 10 a 13.

### Definición de "aprobable"

Un pesaje se puede aprobar si cumple **las cuatro** condiciones, verificadas en este orden:

1. Existe, y `isActive = 1` — el validador existente `validatePesajeActivo`.
2. `aprobado IS NULL` — el validador nuevo `validatePesajeSinRevisar`.
3. `lote_id IS NOT NULL`.
4. Su lote está `estado = 'cerrado'`, con `motivo_rechazo IS NULL`, y su `etapa_id` es el de la fila de `etapas` con `codigo = 'CLIENTE_FINAL'` — el validador existente `validateLoteEnClienteFinal`.

Es exactamente el orden y el conjunto de `rechazarPesajeApprover`, con la condición 2 reforzada. Los cuatro pasos corren **dentro** de la transacción, recibiendo el `trx`.

La condición 4 es lo que hace que el aprobador solo pueda trabajar sobre lotes que el supervisor ya mandó a cliente final con `PATCH /lotes/:id/aprobar`. Un pesaje de un lote todavía abierto en `EN_PROCESO` no se puede aprobar.

### Los mensajes de la condición 2

`validatePesajeSinRevisar` distingue los dos casos por el valor de la columna, para no perder el mensaje que `rechazarPesajeApprover` ya da hoy:

| Estado del pesaje | Mensaje |
| --- | --- |
| `aprobado = 0` | `El pesaje con id 'X' ya fue rechazado por el aprobador` — **idéntico al actual** |
| `aprobado = 1` | `El pesaje con id 'X' ya fue aprobado por el aprobador` |

### Qué cubre el chequeo nuevo que el viejo no cubría

| Caso | `motivo_rechazo !== null` (hoy) | `aprobado !== null` (este spec) |
| --- | --- | --- |
| Pesaje sin revisar | pasa | pasa |
| Ya rechazado por el aprobador | **corta** | **corta** (`aprobado = 0`) |
| Ya aprobado por el aprobador | **no corta** — el agujero | **corta** (`aprobado = 1`) |
| Anulado por el operador (`isActive = 0`) | nunca llega: `validatePesajeActivo` corta antes | igual |

No se pierde cobertura: el único caso con `motivo_rechazo` lleno y `aprobado` en `NULL` sería el del rechazo del operador, y ese trae `isActive = 0`, así que muere un validador antes.

### Petición y respuestas

```
PATCH /pesajes/57/aprobar/byApprover
Authorization: Bearer <token>
```

```json
{
  "ok": true,
  "msg": "Pesaje aprobado correctamente"
}
```

Errores, todos `400` con la forma estándar de Nest:

| Caso | Mensaje |
| --- | --- |
| El pesaje no existe | `El pesaje con id '57' no existe` |
| El pesaje fue anulado por el operador | `El pesaje con id '57' ya fue rechazado` |
| El pesaje ya fue aprobado | `El pesaje con id '57' ya fue aprobado por el aprobador` |
| El pesaje ya fue rechazado por el aprobador | `El pesaje con id '57' ya fue rechazado por el aprobador` |
| El pesaje no tiene lote | `El pesaje con id '57' no tiene un lote asociado` |
| El lote fue rechazado | `El lote 'LOTE-001' ya fue rechazado` |
| El lote no está cerrado | `El lote 'LOTE-001' no esta cerrado` |
| El lote no está en cliente final | `El lote 'LOTE-001' no esta en la etapa CLIENTE_FINAL` |
| Falta la fila `CLIENTE_FINAL` en `etapas` | `La etapa con codigo 'CLIENTE_FINAL' no existe` |
| `id` de ruta no numérico | El error de `ParseIntPipe` |
| Sin header `Authorization` | 401 del `JwtAuthGuard` |

No hay error de Zod: no hay body que validar.

### El flujo del aprobador que ya existía y que este spec documenta

Tres endpoints entraron sin spec y `CLAUDE.md` no los menciona. Se describen **tal como están**, sin cambiarlos:

| Endpoint | Commit | Qué hace |
| --- | --- | --- |
| `GET /lotes/cliente/:clienteId/all/approver` | `aa4020d` | Misma consulta y mismos diez campos que `GET /lotes/cliente/:clienteId/all`, pero filtrando `estado = 'cerrado'` y **`etapa_id = 2` clavado**. Es la bandeja del aprobador. No valida `cliente_operador`. **Es el primer endpoint del proyecto que lista lotes cerrados.** |
| `PATCH /lotes/:id/rechazar/byApprover` | `bb0c4be` | Rechaza un lote que ya está en `CLIENTE_FINAL`. Escribe **cuatro** columnas: `etapa_id` (la fila `RECHAZADO`, resuelta por `codigo`), `motivo_rechazo`, `rechazado_por` y `rechazado_en`. **No** escribe `estado` ni `cerrado_en`, porque el lote ya venía cerrado de `PATCH /lotes/:id/aprobar`. Body: un `motivo` de 5–255 chars. |
| `PATCH /pesajes/:id/rechazar/byApprover` | `af47797`, `92e9d43` | Rechaza un pesaje de un lote en `CLIENTE_FINAL`. Escribe `aprobado = 0` más el trío `motivo_rechazo` / `rechazado_por` / `rechazado_en`. **No toca `isActive`**: el pesaje sigue visible. Body: un `motivo` de 5–255 chars. |

Los tres responden `{ ok, msg }` sin payload, ninguno valida `cliente_operador` y ninguno tiene fila en `catalogo_permisos`.

Con el endpoint de este spec, el flujo del aprobador queda completo: lista los lotes en cliente final, aprueba o rechaza cada pesaje, y aprueba o rechaza el lote entero.

---

## Implementation plan

1. Verificar contra MySQL el DDL que este spec documenta: `DESCRIBE pesajes;` debe mostrar `aprobado`, `aprobado_por` y `aprobado_en`, las tres nullables, y `SHOW CREATE TABLE pesajes;` la FK de `aprobado_por` a `usuarios(id)`. Confirmar con `SELECT COUNT(*) FROM pesajes WHERE aprobado IS NOT NULL;` cuántas filas ya fueron revisadas. Si el DDL real difiere de la transcripción del modelo de datos, corregir **este spec** antes de escribir código.
2. Confirmar con `SELECT id, codigo, nombre FROM etapas;` que existe la fila `codigo = 'CLIENTE_FINAL'` y anotar su `id` para las verificaciones. Confirmar que ese id es **2**, que es lo que `getAllLotesByClienteForApprover` tiene clavado; si no lo es, ese endpoint está roto en este ambiente y hay que anotarlo (no se corrige aquí, ver Risks).
3. Preparar los datos de prueba: un lote con al menos dos pesajes activos, aprobado con `PATCH /lotes/:id/aprobar` para que quede `cerrado` y en `CLIENTE_FINAL`. Confirmar que aparece en `GET /lotes/cliente/:clienteId/all/approver` y que sus pesajes salen en `GET /pesajes/byLote/:loteId` con `aprobado: null`.
4. Agregar `'aprobado'` al `select` de `validatePesajeActivo` en `PesajesRepository`. No se cambia su firma, su condición ni sus mensajes. Confirmar que compila (`npm run build`) y que `PATCH /pesajes/:id/rechazar` sigue funcionando igual.
5. Agregar el validador privado `validatePesajeSinRevisar(pesaje)` a `PesajesRepository`: si `pesaje.aprobado === null` no hace nada; si es `false` lanza `BadRequestException` con `El pesaje con id '${pesaje.id}' ya fue rechazado por el aprobador`; si es `true`, con `... ya fue aprobado por el aprobador`. No consulta la base: recibe la fila que `validatePesajeActivo` ya trajo.
6. Reemplazar en `rechazarPesajeApprover` el bloque que chequea `pesaje.motivo_rechazo !== null` por una llamada a `validatePesajeSinRevisar(pesaje)`, dejando el resto del método intacto. Verificar que rechazar un pesaje ya rechazado por el aprobador sigue dando el **mismo mensaje** que antes.
7. Agregar `approvePesajeForApprover(pesajeId, userId)` a `PesajesRepository`: abre `this.db.transaction().execute(...)`, llama en orden a `validatePesajeActivo`, `validatePesajeSinRevisar`, el chequeo de `lote_id === null` y `validateLoteEnClienteFinal`, y ejecuta el `updateTable('pesajes').set({ aprobado: true, aprobado_por: userId, aprobado_en: sql\`NOW()\` }).where('id', '=', pesajeId)`. No llama a `validateVinculoOperador`. Devuelve `true`.
8. Agregar `aprobarByApprover(pesajeId, userId)` a `PesajesService` como pass-through, igual en forma a `rechazarByApprover` pero sin DTO.
9. Agregar el handler `@Patch(':id/aprobar/byApprover')` a `PesajesController`, declarado **después** de `@Patch(':id/rechazar/byApprover')`, con `@Param('id', ParseIntPipe) id: number` y `@Req() req: Request`, **sin `@Body()`**. Responde `{ ok: aprobado, msg: 'Pesaje aprobado correctamente' }`. Sin `@Public()` y sin `@HttpCode`.
10. Levantar con `npm run start:dev` y confirmar que `PATCH /pesajes/:id/aprobar/byApprover` aparece en el log de rutas de Nest, que `@Get('historial')` sigue declarado primero en el archivo, y que las otras cuatro rutas de `pesajes` siguen apareciendo.
11. Verificación del camino feliz: aprobar uno de los pesajes del paso 3, confirmar 200 con `{ ok, msg }`, y confirmar en MySQL que la fila tiene `aprobado = 1`, `aprobado_por` con el id del token y `aprobado_en` con la hora actual, y que `isActive`, `motivo_rechazo`, `rechazado_por`, `rechazado_en`, los tres pesos, `fuera_de_rango` y `estado_calidad_id` **no cambiaron**.
12. Verificación de la lectura: confirmar que ese pesaje sigue apareciendo en `GET /pesajes/byLote/:loteId` y en `GET /pesajes/historial` de su operador, ahora con `aprobado: true`, y que los demás campos son idénticos a los del paso 3. Confirmar que `aprobado_por` y `aprobado_en` **no** aparecen en ninguna de las dos respuestas.
13. Verificación de la revisión doble, que es el punto del paso 6: aprobar el mismo pesaje otra vez y confirmar 400 `ya fue aprobado por el aprobador` sin que `aprobado_por` ni `aprobado_en` cambien; **rechazarlo** con `PATCH /pesajes/:id/rechazar/byApprover` y confirmar 400 con el mismo mensaje y que `aprobado` sigue en `1` y `motivo_rechazo` en `NULL`. **Este segundo caso es el agujero que existía antes de este spec.**
14. Verificación en el otro sentido: rechazar el segundo pesaje con `PATCH /pesajes/:id/rechazar/byApprover`, confirmar que queda `aprobado = 0` con `isActive = 1`, e intentar aprobarlo: 400 `ya fue rechazado por el aprobador`, sin que ninguna columna cambie.
15. Verificación de los errores del pesaje: aprobar un `id` inexistente (400 `no existe`); aprobar un pesaje anulado con `PATCH /pesajes/:id/rechazar` (400 `ya fue rechazado`, del validador de activo, no del de revisado); poner a mano un `lote_id` en `NULL` y aprobar (400 `no tiene un lote asociado`); `PATCH /pesajes/abc/aprobar/byApprover` (400 de `ParseIntPipe`); sin header `Authorization` (401).
16. Verificación de los errores del lote: aprobar un pesaje de un lote **abierto** en `EN_PROCESO` (400 `no esta cerrado`); aprobar un pesaje de un lote rechazado con `PATCH /lotes/:id/rechazar` (400 `ya fue rechazado`); aprobar un pesaje de un lote cerrado cuyo `etapa_id` no es el de `CLIENTE_FINAL` (400 `no esta en la etapa CLIENTE_FINAL`).
17. Verificación de la ausencia de control de acceso: login con un `Operador` **sin** fila en `cliente_operador` para el cliente del lote y confirmar que aprueba igual, con **200 y no 403**. Es el resultado esperado de este spec.
18. Verificación de que nada más cambió: `POST /pesajes`, `PATCH /pesajes/:id/rechazar`, los dos `GET /pesajes*` con sus filtros de SPEC 16, los cinco endpoints de `lotes`, los cuatro de `clientes`, `GET /permisos/me` y los tres `GET /catalogos/*` responden igual. Confirmar que `permisos` sigue con **14 filas** y `catalogo_permisos` con **9**.
19. Actualizar `CLAUDE.md`, que es el paso más largo de este spec porque arrastra lo no documentado:
    - Agregar `PATCH /pesajes/:id/aprobar/byApprover` a la fila `pesajes` de la tabla de endpoints.
    - Agregar los **tres** endpoints que entraron sin spec, con lo que hace cada uno: `PATCH /pesajes/:id/rechazar/byApprover`, `PATCH /lotes/:id/rechazar/byApprover` y `GET /lotes/cliente/:clienteId/all/approver`.
    - Anotar que `GET /lotes/cliente/:clienteId/all/approver` es el **primer endpoint que lista lotes cerrados**, y que tiene `etapa_id = 2` **clavado**, contra la regla de resolver etapas por `codigo`.
    - Corregir el tipo de `pesajes.aprobado`, que `CLAUDE.md` describe como `number | null` y hoy es `boolean | null`, manteniendo la advertencia de que es **tri-estado** y de que `NULL` no significa "no aprobado".
    - Borrar la frase de que las tres columnas de aprobación de `pesajes` están "escritas por nada en absoluto": dos endpoints las escriben.
    - Documentar el DDL de las tres columnas y su FK como la séptima excepción, y decir que este spec la adopta.
    - Corregir los conteos: `PATCH`es y `UPDATE`s pasan de cuatro a **siete**; las rutas que se saltan `validateVinculoOperador` pasan de nueve a **doce**; las escrituras abiertas a cualquier autenticado pasan de cuatro a **siete**.
    - Anotar que `FINALIZADO` **sigue sin escribirse nunca** y que aprobar un pesaje no toca el lote.

---

## Acceptance criteria

- [X] No se ejecutó ningún DDL: `DESCRIBE pesajes;` muestra exactamente las mismas columnas que antes del spec.
- [X] `src/database/types/types.ts` **no cambió**.
- [X] No se creó ningún DTO: `src/modules/pesajes/dto/` sigue con exactamente cuatro archivos (`create-pesaje.dto.ts`, `rechazar-pesaje.dto.ts`, `filtros-pesajes-lote.dto.ts`, `filtros-historial.dto.ts`).
- [X] No se creó ningún módulo, controller, service ni repositorio nuevo: solo se modificaron `pesajes.controller.ts`, `pesajes.service.ts` y `repository/pesajes.repository.ts`.
- [X] `src/app.module.ts` no cambió y la app arranca sin errores de compilación.
- [X] `PATCH /pesajes/:id/aprobar/byApprover` aparece en el log de rutas de Nest, y las otras cuatro rutas de `pesajes` siguen apareciendo.
- [X] `@Get('historial')` sigue declarado antes que cualquier ruta con `:id` en `PesajesController`.
- [X] El handler no tiene `@Body()` y el endpoint funciona con una petición sin body.
- [X] Aprobar un pesaje activo, sin revisar, de un lote cerrado en `CLIENTE_FINAL` responde 200 con exactamente `{ ok: true, msg: 'Pesaje aprobado correctamente' }`.
- [X] La respuesta **no** incluye ninguna clave de recurso: no hay `pesaje`, ni `data`.
- [X] Después de aprobar, la fila tiene `aprobado = 1`, `aprobado_por` con el `userId` del token (no el `usuario_id` del pesaje) y `aprobado_en` con la hora de la aprobación.
- [X] Después de aprobar, `isActive` sigue en `1`: aprobar **no** anula el pesaje.
- [X] Después de aprobar, `motivo_rechazo`, `rechazado_por` y `rechazado_en` siguen en `NULL`.
- [X] La aprobación **no** modifica `peso_bruto`, `tara`, `peso_neto`, `fuera_de_rango`, `estado_calidad_id`, `lote_id`, `usuario_id`, `dispositivo_identificador`, `secuencia_dispositivo` ni `created_at`.
- [X] La aprobación **no** modifica ninguna columna de la tabla `lotes`: el lote sigue `cerrado`, en `CLIENTE_FINAL`, con su `aprobado_por` y su `cerrado_en` intactos.
- [X] El pesaje aprobado sigue apareciendo en `GET /pesajes/byLote/:loteId`, ahora con `aprobado: true`.
- [X] El pesaje aprobado sigue apareciendo en `GET /pesajes/historial` de su operador, con `aprobado: true`.
- [X] Ninguna de las dos lecturas devuelve `aprobado_por` ni `aprobado_en`: los campos de las dos respuestas no cambiaron.
- [X] Aprobar un pesaje **ya aprobado** responde 400 con `El pesaje con id 'X' ya fue aprobado por el aprobador`, y `aprobado_por` y `aprobado_en` quedan intactos.
- [X] Aprobar un pesaje **ya rechazado por el aprobador** (`aprobado = 0`) responde 400 con `El pesaje con id 'X' ya fue rechazado por el aprobador`.
- [X] **`PATCH /pesajes/:id/rechazar/byApprover` sobre un pesaje ya aprobado responde 400** con `ya fue aprobado por el aprobador`, y no sobrescribe `aprobado` ni escribe `motivo_rechazo`. **Este es el agujero que el spec cierra: antes de este cambio respondía 200.**
- [X] `PATCH /pesajes/:id/rechazar/byApprover` sobre un pesaje ya rechazado por el aprobador sigue respondiendo 400 con **exactamente el mismo mensaje que antes** del spec.
- [X] `PATCH /pesajes/:id/rechazar/byApprover` sobre un pesaje sin revisar sigue funcionando igual que antes: escribe `aprobado = 0` y el trío de rechazo, y **no** toca `isActive`.
- [X] Aprobar un pesaje anulado por el operador (`isActive = 0`) responde 400 con `ya fue rechazado`, el mensaje de `validatePesajeActivo`, no el del validador de revisión.
- [X] Aprobar un `id` que no existe responde 400 con `El pesaje con id 'X' no existe`, no 404 y no 500.
- [X] Aprobar un pesaje con `lote_id` en `NULL` responde 400 con `no tiene un lote asociado`.
- [X] Aprobar un pesaje de un lote **abierto** responde 400 con `El lote 'X' no esta cerrado`.
- [X] Aprobar un pesaje de un lote **rechazado** responde 400 con `El lote 'X' ya fue rechazado`.
- [X] Aprobar un pesaje de un lote cerrado que no está en `CLIENTE_FINAL` responde 400 con `no esta en la etapa CLIENTE_FINAL`.
- [X] Si falta la fila `codigo = 'CLIENTE_FINAL'` en `etapas`, responde 400 `La etapa con codigo 'CLIENTE_FINAL' no existe`.
- [X] El número `2` **no aparece** en ninguna línea del código nuevo de este spec: la etapa se resuelve por `codigo`.
- [X] Un `id` de ruta no numérico responde 400 por `ParseIntPipe`.
- [X] Sin header `Authorization`, o con un token inválido, responde 401: el endpoint no es `@Public()`.
- [X] Un `Operador` **sin** fila en `cliente_operador` para el cliente del lote aprueba igual: responde **200, no 403**. **Este spec no valida el vínculo.**
- [X] No se exige ningún rol, y `req.user` sigue siendo `{ userId, username }`.
- [X] Quien aprueba puede ser el mismo usuario que registró el pesaje: no se compara contra `pesajes.usuario_id`.
- [X] Cuando cualquier validación falla, ninguna columna cambia: la transacción no deja escrituras parciales.
- [X] `validatePesajeActivo` conserva su firma, su condición y sus mensajes: lo único que cambió es que su `select` trae `aprobado`.
- [X] `validateLoteEnClienteFinal`, `resolveEtapa`, `validateLoteAbierto`, `validateVinculoOperador`, `validateLote`, `resolveEstadoCalidad` y `resolveCodigoEstadoCalidad` no se modificaron.
- [X] `POST /pesajes` y `PATCH /pesajes/:id/rechazar` funcionan exactamente igual que antes.
- [X] `POST /pesajes` contra un lote en `CLIENTE_FINAL` sigue respondiendo 400 `no esta abierto`: este spec no desbloquea el pesaje en cliente final.
- [X] Los cinco endpoints de `lotes`, los cuatro de `clientes`, `GET /permisos/me`, los tres `GET /catalogos/*` y los dos de `auth` responden igual.
- [X] `permisos` sigue con exactamente **14 filas** y `catalogo_permisos` con **9**: no se sembró ninguna fila.
- [X] No existe ningún endpoint para deshacer una aprobación, para aprobar varios pesajes en una llamada, ni para finalizar el lote.
- [X] `FINALIZADO` sigue sin escribirse nunca, y aprobar el último pesaje sin revisar de un lote no cambia nada del lote.
- [X] `CLAUDE.md` documenta `PATCH /pesajes/:id/aprobar/byApprover` **y** los tres endpoints del aprobador que estaban sin documentar.
- [X] `CLAUDE.md` ya no dice que las tres columnas de aprobación de `pesajes` no las escribe nada, corrige el tipo de `aprobado` a `boolean | null` manteniendo la advertencia de tri-estado, y documenta el DDL y su FK como séptima excepción.
- [X] `CLAUDE.md` anota que `GET /lotes/cliente/:clienteId/all/approver` tiene `etapa_id = 2` clavado, contra la convención de resolver por `codigo`.
- [X] Los conteos de `CLAUDE.md` quedan en **siete** `PATCH`es, **siete** `UPDATE`s, **siete** escrituras abiertas a cualquier autenticado y **doce** rutas que se saltan `validateVinculoOperador`.

---

## Decisions

- **Sí:** aprobar un pesaje es escribir `aprobado = 1`, `aprobado_por` y `aprobado_en`. Decisión explícita del usuario. Es el espejo de `rechazarPesajeApprover` y la primera operación del proyecto que llena esas dos columnas de auditoría, agregadas a mano en septiembre y hasta hoy muertas.
- **No:** escribir solo `aprobado = 1`, que era la idea inicial del pedido. Se descarta: dejaría la aprobación sin autor ni fecha, y sería la única escritura relevante del proyecto sin rastro, justo al lado de un rechazo que sí lo tiene.
- **Sí:** `aprobado` sigue siendo **tri-estado**. `NULL` significa "sin revisar", no "no aprobado". El tipo `boolean | null` que `af47797` dejó preserva los tres valores y las dos lecturas ya los mapean.
- **Sí:** la aprobación **no** toca `isActive`. Es la línea que separa las dos anulaciones: `isActive = 0` es el pesaje anulado por el operador, `aprobado` es el veredicto sobre un pesaje que sigue vivo. Aprobar tampoco escribe `motivo_rechazo`.
- **Sí:** se exige que el lote esté cerrado, en `CLIENTE_FINAL` y sin `motivo_rechazo`, reusando `validateLoteEnClienteFinal`. Decisión explícita del usuario. Aprobar y rechazar exigen exactamente lo mismo, y el validador ya existe: no se escribe código nuevo.
- **No:** validar solo el pesaje y no el lote. Se descarta: dejaría aprobar pesajes de un lote todavía abierto en `EN_PROCESO`, antes de que el supervisor lo mande a cliente final, que es justo el orden que el diagrama impone.
- **No:** permitir aprobar pesajes de un lote ya rechazado por el aprobador. Se descarta: el lote está anulado, no hay nada que dar por bueno dentro de él.
- **Sí:** la revisión del aprobador es **irreversible**, y los dos métodos validan `aprobado !== null`. Decisión explícita del usuario. Mismo criterio que los cinco `PATCH` anteriores: nada en este proyecto se deshace por API.
- **Sí:** se corrige `rechazarPesajeApprover`, que hoy valida `motivo_rechazo !== null`. Decisión explícita del usuario. Sin el cambio, un pesaje aprobado se podría rechazar encima —`motivo_rechazo` estaría en `NULL` y nada lo frenaría— y el endpoint nuevo nacería con el agujero abierto. Es el único método ya mergeado que este spec modifica, y hay un criterio de aceptación dedicado.
- **No:** dejar `rechazarPesajeApprover` intacto y validar solo en el método nuevo. Se descarta: la asimetría resultante (se puede rechazar lo aprobado pero no aprobar lo rechazado) es un agujero, no un diseño.
- **No:** permitir cambiar de opinión, sobrescribiendo una revisión anterior. Se descarta: rompe la irreversibilidad de los cinco `PATCH` existentes y abre qué hacer con `motivo_rechazo`, `rechazado_por` y `rechazado_en` al re-aprobar.
- **Sí:** un validador privado `validatePesajeSinRevisar(pesaje)` compartido por los dos métodos, que distingue el mensaje según el valor de `aprobado`. Preserva **exactamente** el mensaje que `rechazarPesajeApprover` ya devuelve hoy para su caso, y agrega el nuevo. No consulta la base: recibe la fila que `validatePesajeActivo` ya trajo.
- **No:** un mensaje genérico único (`ya fue revisado por el aprobador`) para los dos casos. Se descarta pese a ser el precedente de SPEC 12 y 13 con "ya fue aprobado": aquí cambiaría el texto de un endpoint que ya está en producción, y distinguir los dos casos cuesta un `if`.
- **Sí:** se agrega `'aprobado'` al `select` de `validatePesajeActivo`. Es un cambio aditivo, igual al que SPEC 13 hizo con `'etapa_id'` en `validateLoteAbierto`: no cambia firma, condición ni mensajes.
- **Sí:** `PATCH /pesajes/:id/aprobar/byApprover`, **sin body y sin DTO**. Decisión explícita del usuario. La ruta es el espejo de `:id/rechazar/byApprover` y la ausencia de body el de `PATCH /lotes/:id/aprobar`: aprobar no lleva texto libre.
- **No:** una observación opcional de aprobación. Se descarta: exigiría una columna nueva en `pesajes` y este spec no aplica DDL.
- **No:** aprobar todos los pesajes del lote en una llamada. Se descarta: no es lo que se pidió y abre qué pasa si uno de los pesajes falla la validación a mitad del lote.
- **Sí:** la respuesta es solo `{ ok, msg }`. Los siete `PATCH` del proyecto quedan con la misma forma.
- **Sí:** `aprobado_en` con `NOW()` de MySQL, no con `new Date()` de Node. Se mantiene la decisión de SPEC 10 a 13.
- **Sí:** el `UPDATE` y sus validaciones van dentro de una transacción, con los validadores recibiendo el `trx`. Es la convención de escritura del proyecto.
- **Sí:** cualquier usuario autenticado puede aprobar cualquier pesaje, sin `validateVinculoOperador`. Decisión explícita del usuario. Es la séptima escritura abierta del proyecto y la segunda no destructiva, después de `PATCH /lotes/:id/aprobar`.
- **No:** exigir el vínculo `cliente_operador`. Se descarta con el mismo argumento de SPEC 11, 12 y 13: rompería la simetría con `rechazarPesajeApprover`, que no lo valida, y dejaría a un `ADMIN` sin filas en `cliente_operador` sin poder aprobar nada.
- **No:** exigir un rol de aprobador. Se descarta: no hay `PermissionsGuard`, `req.user` es `{ userId, username }` y el `rol_id` no viaja en el token.
- **No:** exigir que quien aprueba no sea quien registró el pesaje. Se descarta: nadie lo pidió, y el proyecto no tiene con qué expresar esa separación de funciones.
- **Sí:** ninguna fila nueva en `catalogo_permisos` ni en `permisos`. Decisión explícita del usuario. Décima excepción consecutiva a la regla de SPEC 06.
- **No:** sembrar un `APROBAR-PESAJE-LOTE` por simetría con el `RECHAZAR-PESAJE-LOTE` que ya está en la base. Se descarta pese al argumento de que el código existiría el día que llegue el guard. Consecuencia asumida: de las siete escrituras, las cuatro de specs 10 a 13 tienen código y las tres del aprobador no.
- **Sí:** las lecturas no cambian. Decisión explícita del usuario. `GET /pesajes/byLote/:loteId` ya devuelve `aprobado` desde `af47797`, así que el frontend distingue pendiente / aprobado / rechazado y puede separar en cliente.
- **No:** un `?aprobado` tri-estado en `GET /pesajes/byLote/:loteId`. Se descarta de este spec: es un filtro, va con la serie de SPEC 16, y su `.transform()` tendría que ser idempotente por la doble registración de pipes globales.
- **No:** devolver `aprobado_por` y `aprobado_en` en las lecturas. Se descarta: cambia los campos de dos respuestas y es un spec de campos, no de escritura. Consecuencia asumida: se puede aprobar un pesaje pero no se puede ver por API quién lo aprobó.
- **Sí:** aprobar un pesaje **no toca el lote**. Decisión explícita del usuario. No hay conteo de pendientes, no hay transición automática y `FINALIZADO` sigue sin escribirse nunca, igual que después de SPEC 13.
- **No:** mover el lote a `FINALIZADO` al aprobar el último pesaje sin revisar. Se descarta: duplica el alcance y abre qué pasa si alguno de los pesajes del lote fue rechazado por el aprobador.
- **Sí:** este spec **documenta retroactivamente** los tres endpoints del aprobador y el DDL que entraron sin spec. Decisión explícita del usuario. Mismo precedente de SPEC 10 con `GET /pesajes/byLote/:loteId` y de SPEC 12 con `GET /lotes/cliente/:clienteId/all`.
- **No:** un spec aparte solo para documentar lo ya hecho. Se descarta: el endpoint nuevo no se entiende sin ese contexto y separarlos dejaría este spec citando cosas que no existen en `specs/`.
- **No:** corregir el `etapa_id = 2` clavado de `getAllLotesByClienteForApprover`. Se descarta de este spec: es un endpoint que este spec no toca, y cambiarlo "de paso" es justo lo que la convención del repositorio prohíbe. Queda en Risks y en `CLAUDE.md`.
- **No:** unificar las copias de `validateLoteEnClienteFinal` y `resolveEtapa`, que ahora viven en `PesajesRepository` y en `LotesRepository`. Se mantiene el criterio de SPEC 13 con `resolveEtapaRechazado`: la duplicación es deliberada y visible, y unificarla es una limpieza propia.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **Cualquier usuario autenticado puede aprobar cualquier pesaje**, incluido un `Operador` sin fila en `cliente_operador` para ese cliente. Séptima escritura abierta del proyecto. | **Sin mitigar por diseño**, por decisión explícita del usuario. Hay un criterio de aceptación que lo fija como comportamiento esperado. La mitigación real es el spec del `PermissionsGuard`. |
| **El agujero de la revisión doble ya existe hoy** en `rechazarPesajeApprover`: no puede materializarse porque nada escribe `aprobado = 1`, pero se materializaría el mismo día que este endpoint exista. | Mitigado en este spec: los pasos 6 y 13 lo cierran y lo verifican, con un criterio de aceptación dedicado. Es la razón por la que el spec toca un método ya mergeado. |
| **`getAllLotesByClienteForApprover` tiene `where('lotes.etapa_id', '=', 2)` clavado**, que es exactamente el contra-ejemplo que `CLAUDE.md` señala. Si en algún ambiente `CLIENTE_FINAL` no es el id 2, la bandeja del aprobador sale vacía o con los lotes equivocados, **sin fallar**. | Anotado, no corregido: está fuera de alcance por decisión. El paso 2 del plan verifica el id contra la base antes de empezar, y el paso 19 lo escribe en `CLAUDE.md`. El arreglo es resolver por `codigo`, como hacen los dos `PATCH`. |
| **Tres endpoints y un DDL entraron a `main` sin spec**, y `CLAUDE.md` no los menciona. Quien lea la documentación hoy no sabe que el flujo del aprobador existe. | Mitigado por este spec, que los adopta y los describe. El paso 19 es el más largo del plan justamente por eso. El riesgo de fondo —que se siga mergeando sin spec— no lo resuelve un spec. |
| **`aprobado_por` y `aprobado_en` no se pueden leer por API.** Se aprueba un pesaje y no hay forma de ver quién lo aprobó ni cuándo, salvo consultando MySQL. | Sin mitigar por decisión explícita. Las columnas quedan escritas desde el día uno, así que cuando llegue el spec de lectura el dato histórico ya existe. Es el mismo criterio que SPEC 13 aplicó con `aprobado_por` en `lotes`. |
| **No hay forma de pedir "los pesajes que me faltan por revisar"**. El aprobador tiene que traerse todos los del lote y filtrar en el cliente. | Sin mitigar por decisión explícita del usuario. Es viable porque `aprobado` ya viaja en la respuesta de `GET /pesajes/byLote/:loteId`. Un `?aprobado` es un spec de filtros. |
| Una aprobación por error **no se puede deshacer** por API: ni re-aprobar, ni rechazar encima, ni revertir. | Sin mitigar por decisión (la revisión es irreversible). La fila no se borra, así que se revierte por SQL a mano poniendo las tres columnas en `NULL`. |
| Alguien confunde `aprobado = 0` con `isActive = 0`, o lee `aprobado IS NULL` como "no aprobado", y cuenta mal los pesajes de un lote. | Mitigado con documentación: la tabla de tres estados y la de `aprobado` contra `isActive` están en el modelo de datos, y el paso 19 las lleva a `CLAUDE.md`. El tipo `boolean | null` conserva los tres valores. |
| El pesaje aprobado pertenece a un lote **cerrado**, así que `POST /pesajes` y `PATCH /pesajes/:id/rechazar` sobre ese lote siguen respondiendo 400. El aprobador puede aprobar pesajes de un lote donde ya no se puede pesar ni anular nada. | Sin mitigar: es la consecuencia de SPEC 13 que ese spec ya registró, y este no la cambia. El flujo del aprobador funciona porque no pasa por `validateLoteAbierto`. |
| `validateLoteEnClienteFinal` y `resolveEtapa` están duplicados en dos repositorios. Alguien cambia uno y no el otro. | Sin mitigar en el código, por decisión registrada. Mismo precedente que `resolveEtapaRechazado` en SPEC 13. Hay un criterio de aceptación que verifica que este spec no los modificó. |
| El DDL transcrito en el modelo de datos no coincide con lo que hay en MySQL, porque se escribió leyendo el código y no la base. | Mitigado: el paso 1 del plan lo verifica con `DESCRIBE` y `SHOW CREATE TABLE` **antes** de escribir código, y manda la base. |

---

## What is **not** in this spec

- La transición `CLIENTE_FINAL` → `FINALIZADO`, ni finalizar el lote cuando todos sus pesajes quedan revisados. `FINALIZADO` sigue sin escribirse nunca.
- Aprobar varios pesajes en una llamada.
- Deshacer una aprobación o un rechazo del aprobador, y cambiar de opinión sobre un pesaje ya revisado.
- Un `?aprobado` en `GET /pesajes/byLote/:loteId`, ni ningún cambio en los dos `GET` de pesajes.
- Devolver `aprobado_por` o `aprobado_en` en algún endpoint de lectura.
- Una observación de aprobación, y por tanto cualquier DTO para este endpoint.
- El PIN de supervisor para pesajes fuera de rango en cliente final.
- Derivar la aprobación de `fuera_de_rango` o de `estado_calidad_id`.
- Corregir el `etapa_id = 2` clavado de `getAllLotesByClienteForApprover`.
- Unificar las copias de `validateLoteEnClienteFinal` y `resolveEtapa` entre los dos repositorios.
- Permitir pesajes nuevos en la etapa `CLIENTE_FINAL`.
- Cualquier DDL: ni columnas, ni índices, ni FK.
- Cambios a `src/database/types/types.ts`.
- Cambios a `POST /pesajes`, `PATCH /pesajes/:id/rechazar` y a los endpoints de `lotes`, `clientes`, `auth`, `permisos` y `catalogos`.
- Sembrar filas en `catalogo_permisos` o en `permisos`, ni aplicar permisos.
- Validar el vínculo `cliente_operador`, exigir un rol de aprobador, o exigir que quien aprueba no sea quien pesó.
- Borrado físico de pesajes.

Cada uno de estos, si se necesita, va en su propio spec.
