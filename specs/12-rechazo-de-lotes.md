# SPEC 12 — Rechazo de lotes

> **Status:** Implemented
> **Depends on:** SPEC 02, SPEC 03, SPEC 10, SPEC 11
> **Date:** 2026-09-01
> **Objective:** Agregar `PATCH /lotes/:id/rechazar`, que anula un lote poniendo `estado = 'cerrado'`, su `etapa_id` en la etapa `RECHAZADO` y `cerrado_en = NOW()`, y guardando el motivo, el usuario y la fecha del rechazo en tres columnas nuevas de `lotes`.

---

## Why this spec exists

Un lote se crea mal. El nombre quedó equivocado, el producto no era ese, el rango de pesos se capturó con un cero de más. Hoy no hay forma de sacarlo de circulación: `POST /lotes` inserta con `estado: 'abierto'` y nada más, y ningún endpoint puede cambiar ese estado.

Este es el tercer spec de rechazo, después de SPEC 10 (`pesajes`) y SPEC 11 (`clientes`), pero **no es una copia de los dos anteriores**. Hay que ser explícito con seis cosas.

**La primera: `lotes` no tiene columna `isActive`.** Los dos rechazos anteriores solo tuvieron que escribir una columna que ya existía y que los listados ya filtraban. Aquí no existe ese mecanismo a medio construir. Lo que `lotes` tiene es una columna de ciclo de vida, `estado`, que hoy solo toma el valor `'abierto'`, y los dos listados de lotes filtran por ella. Así que el rechazo se marca en `estado`, no en un `isActive` nuevo.

**La segunda: el rechazo usa el vocabulario del cierre, no uno propio.** `estado` pasa a `'cerrado'` y `cerrado_en` a `NOW()`. Es una decisión explícita del usuario y tiene una consecuencia que hay que dejar escrita sin adornos: **`estado` por sí solo no distingue un lote anulado de un lote cerrado con resultado bueno.** Lo que los separa son las otras dos columnas que el rechazo escribe, `etapa_id` (la etapa `RECHAZADO`) y `motivo_rechazo`. Hoy la ambigüedad es teórica, porque el rechazo es lo único que puede cerrar un lote; deja de serlo el día que exista el cierre de verdad.

**La tercera: este spec es el primero del proyecto que escribe `lotes.cerrado_en` y el primero que escribe un `estado` distinto de `'abierto'`.** Todos los specs anteriores dejaron el cierre de lote fuera de alcance y anotaron que nada podía escribir esa columna. Eso deja de ser cierto. **Pero esto no es el cierre de lote:** no hay endpoint para cerrar un lote con resultado bueno, no hay agregados, no hay `resumen_ia`. Las dos columnas se escriben porque el rechazo también termina el ciclo de vida del lote, y `validateLoteAbierto` comprueba las dos.

**La cuarta: el rechazo escribe `lotes.etapa_id`, y la tabla `etapas` no está en ningún spec.** Existe en el esquema, `createLote` le clava `etapa_id: 1` con un literal, los dos listados de lotes la exponen como `etapas.nombre as etapa` y `CLAUDE.md` todavía afirma que el concepto de *Etapa* no está en el esquema. Este spec no la diseña ni la documenta entera — solo la usa y corrige esa afirmación. La fila `codigo = 'RECHAZADO'` ya está sembrada y este spec la resuelve por `codigo`, no por id.

**La quinta: es la tercera operación de escritura del proyecto abierta a cualquier usuario autenticado, y aquí rompe la coherencia del propio archivo.** Por decisión explícita, `PATCH /lotes/:id/rechazar` **no** llama a `validateVinculoOperador`. La diferencia con SPEC 11 es que `ClientesRepository` no validaba el vínculo en ninguna de sus escrituras, mientras que `LotesRepository` **sí lo valida en sus dos métodos actuales**, `getLotesByCliente` y `createLote`. Este será el único método del archivo que se lo salta, y es justo el destructivo. Se asume y se registra en Risks.

**La sexta: el rechazo libera el `nombre_lote` para ese cliente.** Es el único cambio de este spec a un endpoint existente: `validateNombreLoteDisponible` pasa a ignorar los lotes rechazados, así que se puede recrear el lote con el nombre correcto. Es la misma decisión que SPEC 11 asumió para el `rtn`, pero aquí se implementa en vez de heredarse. Y por la ambigüedad de la segunda cosa, el filtro **no** puede mirar el `estado`: mira `motivo_rechazo IS NULL`, que es lo único que identifica un rechazo sin confundirlo con un cierre futuro.

---

## Scope

**In:**

- DDL a mano en MySQL: tres columnas nuevas y nullables en `lotes` — `motivo_rechazo`, `rechazado_por` y `rechazado_en` — más una FK de `rechazado_por` a `usuarios(id)`.
- **Sin DDL sobre `lotes.estado`**: es `VARCHAR`, así que acepta `'cerrado'` tal cual.
- Actualizar `LotesTable` en `src/database/types/types.ts` con las tres columnas.
- Nuevo DTO `src/modules/lotes/dto/rechazar-lote.dto.ts` con un único campo `motivo`, obligatorio, entre 5 y 255 caracteres.
- Nuevo método `rechazarLote(loteId, dto, userId)` en `src/modules/lotes/repository/lotes.repository.ts`, dentro de una transacción.
- Dos validadores privados nuevos en el mismo repositorio: `validateLoteAbierto(loteId, db)` y `resolveEtapaRechazado(db)`.
- Modificar el validador existente `validateNombreLoteDisponible` para que ignore los lotes rechazados.
- Nuevo método `rechazar(loteId, dto, userId)` en `src/modules/lotes/lotes.service.ts`, pass-through al repositorio.
- Nuevo handler `@Patch(':id/rechazar')` en `src/modules/lotes/lotes.controller.ts`, con `@Param('id', ParseIntPipe)`.
- Nuevo endpoint `PATCH /lotes/:id/rechazar`, protegido únicamente por el `JwtAuthGuard` global (no lleva `@Public()`).
- El `UPDATE` escribe exactamente seis columnas: `estado = 'cerrado'`, `etapa_id` (el id de la etapa `RECHAZADO`), `cerrado_en` (`NOW()` de MySQL), `motivo_rechazo`, `rechazado_por` (del `req.user.userId`) y `rechazado_en` (`NOW()` de MySQL).
- Respuesta `200` con la forma `{ ok, msg }`, sin payload de recurso.
- `400` si el lote no existe, si no está abierto (lo que incluye "ya rechazado"), o si la fila `etapas` con `codigo = 'RECHAZADO'` no existe.
- Actualizar `CLAUDE.md`: fila `lotes` de la tabla de endpoints; la tabla `etapas` y la columna `lotes.etapa_id`, hoy sin documentar; `GET /lotes/cliente/:clienteId/all`, hoy sin documentar; las tres columnas nuevas y su FK; la nota de que es la tercera escritura sin `validateVinculoOperador`; y la nota de que `lotes.cerrado_en` ya se escribe.

**Out of scope (for future specs):**

- El **cierre** de lote con resultado bueno. No hay endpoint para cerrar un lote, ni agregados, ni `resumen_ia`. Este spec escribe `estado = 'cerrado'` y `cerrado_en` **solo** en el camino del rechazo, y se queda con el vocabulario que el cierre va a necesitar después.
- Distinguir por `estado` un lote anulado de un lote cerrado con resultado bueno. Los dos van a quedar en `'cerrado'`, y separarlos es trabajo del spec que implemente el cierre.
- Diseñar o documentar la tabla `etapas` completa: sus filas, su significado en el flujo del diagrama (`EN PROCESO` / `CLIENTE FINAL`) y el literal `etapa_id: 1` de `createLote`. Este spec solo consume la fila `RECHAZADO`.
- Un endpoint de catálogo `GET /catalogos/etapas`, que SPEC 09 no incluyó.
- Sembrar la fila `RECHAZADO` en `etapas`: ya existe.
- Deshacer un rechazo. No hay endpoint de reactivación y no lo habrá en este spec.
- Rechazar en lote (varios `lote_id` en una sola llamada).
- Cascada sobre `pesajes`: los pesajes del lote rechazado no se anulan, no se desactivan y no se tocan.
- Cambios a `POST /pesajes`, que ya bloquea los lotes no abiertos por `validateLoteAbierto`.
- Cambios a `PATCH /pesajes/:id/rechazar`, que también llama a `validateLoteAbierto` y por tanto deja de funcionar para los pesajes del lote rechazado.
- Cambios a `GET /pesajes/byLote/:loteId`, que sigue devolviendo los pesajes activos de un lote rechazado porque no valida el lote.
- Cambios a `GET /lotes/cliente/:clienteId` y `GET /lotes/cliente/:clienteId/all`: mantienen su filtro `estado = 'abierto'`, sus campos y su orden. Un lote rechazado desaparece de los dos.
- Agregarle la validación de vínculo a `GET /lotes/cliente/:clienteId/all`, que hoy no la tiene.
- Un endpoint para listar lotes rechazados, y cualquier query param del estilo `?incluirRechazados=true`.
- Devolver `motivo_rechazo`, `rechazado_por` o `rechazado_en` en cualquier endpoint de lectura.
- Borrado físico (`DELETE FROM lotes`).
- Editar un lote (corregir su nombre o su rango de pesos en vez de rechazarlo), y `GET /lotes/:id`.
- Sembrar filas en `permisos`. Se decidió explícitamente no hacerlo (ver Decisions). La tabla sigue con las 11 filas de SPEC 08.
- **Aplicar** permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`.
- Validar el vínculo `cliente_operador`. Decisión explícita: cualquier usuario autenticado puede rechazar cualquier lote.
- Exigir que quien rechaza sea quien creó el lote (`lotes.created_by`).
- Validar que el cliente del lote esté activo. SPEC 11 dejó registrado que un cliente rechazado conserva sus lotes, y eso no cambia.
- Un catálogo de motivos de rechazo. El motivo es texto libre.

---

## Data model

### DDL (ejecutar a mano en MySQL)

Las tres columnas son nullables porque las filas existentes no tienen valor y no se van a rellenar:

```sql
ALTER TABLE lotes
  ADD COLUMN motivo_rechazo VARCHAR(255) NULL AFTER updated_at,
  ADD COLUMN rechazado_por INT NULL AFTER motivo_rechazo,
  ADD COLUMN rechazado_en DATETIME NULL AFTER rechazado_por;

ALTER TABLE lotes
  ADD CONSTRAINT fk_lotes_rechazado_por
  FOREIGN KEY (rechazado_por) REFERENCES usuarios(id);
```

Los nombres son los mismos tres que SPEC 10 puso en `pesajes` y SPEC 11 en `clientes`, a propósito: es la misma operación sobre una tercera tabla y el rastro debe leerse igual en las tres.

`lotes.estado` es `VARCHAR`, así que **no lleva DDL**: acepta `'cerrado'` sin modificar la columna.

La FK es la cuarta excepción del proyecto a la regla de validar solo en código, después de `permisos` → `roles`, `pesajes.rechazado_por` → `usuarios(id)` y `clientes.rechazado_por` → `usuarios(id)`. Se justifica igual: es un dato de auditoría y una fila huérfana lo dejaría sin valor probatorio.

Nótese que `lotes.created_by` **no** tiene FK hoy y este spec no se la agrega. Queda la misma inconsistencia intratabla que SPEC 10 dejó en `pesajes` y SPEC 11 en `clientes`: una columna de usuario con FK y otra sin ella.

### Cambio en `src/database/types/types.ts`

`LotesTable` gana tres claves al final:

```ts
export interface LotesTable {
  // ...campos existentes sin cambios...
  updated_at: Generated<Date | string | null>;
  motivo_rechazo: string | null;
  rechazado_por: number | null;
  rechazado_en: Date | string | null;
}
```

Ninguna es `Generated<>`: las tres las escribe la aplicación, no MySQL, y ninguna tiene `DEFAULT`.

Las otras tres columnas que el rechazo escribe ya están declaradas y no cambian de tipo: `estado: Generated<string | null>`, `etapa_id: number | null` y `cerrado_en: Date | string | null`.

### La tabla `etapas`

Ya existe en el esquema y en `Database`, y no se modifica:

```ts
export interface EtapasTable {
  id: Generated<number>;
  codigo: string;
  nombre: string;
  created_at: Generated<Date>;
}
```

La fila con `codigo = 'RECHAZADO'` **ya está sembrada** y este spec no la inserta. El repositorio la resuelve por `codigo` dentro de la transacción, no por un id fijo, porque los ids difieren entre ambientes. Es el mismo patrón que `resolveEstadoCalidad` usa en `PesajesRepository` para `estados_calidad`.

El literal `etapa_id: 1` que `createLote` escribe hoy **no se toca**: corregirlo es parte de documentar `etapas`, que está fuera de alcance.

### DTO (`src/modules/lotes/dto/rechazar-lote.dto.ts`)

- `motivo: string` — requerido, `.min(5)`, `.max(255)`.

Es el segundo DTO del módulo, junto a `create-lote.dto.ts`, y sigue la misma forma: schema Zod envuelto con `createZodDto()`. Es idéntico en contenido a `rechazar-pesaje.dto.ts` y a `rechazar-cliente.dto.ts`, con los mismos mensajes de error.

El `id` del lote **no** va en el body: viene en la ruta y se convierte con `ParseIntPipe`.

Campos que **no** vienen del body:

- `estado` — lo fija el repositorio en `'cerrado'`.
- `etapa_id` — resuelto desde `etapas` por `codigo = 'RECHAZADO'`.
- `cerrado_en` y `rechazado_en` — `NOW()` de MySQL, en el mismo `UPDATE`.
- `rechazado_por` — del `req.user.userId` (token JWT).

### El `UPDATE`

```sql
UPDATE lotes
SET estado = 'cerrado',
    etapa_id = ?,
    cerrado_en = NOW(),
    motivo_rechazo = ?,
    rechazado_por = ?,
    rechazado_en = NOW()
WHERE id = ?;
```

Son seis columnas, el doble que en los dos rechazos anteriores. No toca `cliente_id`, `nombre_lote`, `producto_id`, `unidad_medida_id`, `variedad_o_talla`, `peso_minimo`, `peso_ideal`, `peso_maximo`, `resumen_ia`, `created_by` ni `created_at`. Un lote rechazado conserva todos sus datos originales; lo que cambia es que deja de estar abierto.

`cerrado_en` y `rechazado_en` van a tener el mismo valor en la práctica, porque los escribe el mismo `NOW()` de la misma sentencia. Son columnas distintas a propósito: la primera dice cuándo terminó el ciclo de vida del lote, la segunda cuándo se ejecutó este rechazo. Hoy coinciden porque el rechazo es lo único que cierra un lote.

### Cómo se identifica un lote rechazado

Esto importa más que en los dos specs anteriores, porque `estado = 'cerrado'` **no** alcanza: es el mismo valor que va a escribir el cierre con resultado bueno cuando exista. Un lote rechazado es, en orden de precisión:

| Señal | Sirve para identificar el rechazo | Por qué |
| --- | --- | --- |
| `motivo_rechazo IS NOT NULL` | **Sí, es la señal canónica.** | Solo este endpoint escribe esa columna, y el `motivo` es obligatorio, así que nunca queda vacía en un rechazo ni llena en nada más. Igual con `rechazado_por` y `rechazado_en`. |
| `etapa_id` = etapa `RECHAZADO` | Sí, pero indirecta. | Depende de resolver la fila de `etapas` para comparar, y la columna es nullable. |
| `estado = 'cerrado'` | **No.** | Hoy funciona por accidente, porque el rechazo es lo único que cierra un lote. Va a dejar de funcionar el día que exista el cierre de verdad. |

Cualquier código nuevo que necesite distinguirlos usa `motivo_rechazo IS NOT NULL`, no el `estado`. El filtro de `validateNombreLoteDisponible` de más abajo es el primer caso y sigue esa regla.

### Definición de "rechazable"

Un lote se puede rechazar si `estado = 'abierto'` **y** `cerrado_en IS NULL`. Es exactamente la condición que `validateLoteAbierto` ya comprueba en `PesajesRepository`, y el validador nuevo de `LotesRepository` es una copia con el mismo mensaje de error.

Eso cubre el caso "ya rechazado" sin un chequeo aparte: un lote rechazado tiene `estado = 'cerrado'` y `cerrado_en` escrito, así que falla las dos condiciones. El mensaje es el genérico de lote no abierto, no uno específico de "ya fue rechazado" — es la diferencia con SPEC 10 y SPEC 11, donde el estado de rechazo era una columna booleana propia.

### Petición y respuestas

Petición:

```
PATCH /lotes/9/rechazar
Authorization: Bearer <token>

{
  "motivo": "El rango de pesos se capturo con un cero de mas"
}
```

Respuesta (200):

```json
{
  "ok": true,
  "msg": "Lote rechazado correctamente"
}
```

Errores, todos `400` con la forma estándar de Nest:

| Caso | Mensaje |
| --- | --- |
| El lote no existe | `El lote con id '9' no existe` |
| El lote no está abierto, incluido el ya rechazado | `El lote 'LOTE-001' no esta abierto` |
| No existe la fila `RECHAZADO` en `etapas` | `La etapa con codigo 'RECHAZADO' no existe` |
| `motivo` ausente, corto o largo | El error de validación de Zod |
| `id` de ruta no numérico | El error de `ParseIntPipe` |

### Cambio en `validateNombreLoteDisponible`

Es el único cambio de este spec a código existente. El validador pasa a ignorar los lotes rechazados:

```sql
SELECT id FROM lotes
WHERE cliente_id = ?
  AND nombre_lote = ?
  AND motivo_rechazo IS NULL;
```

El filtro es `motivo_rechazo IS NULL`, **no** `estado <> 'cerrado'`. Es la consecuencia directa de que el rechazo use el vocabulario del cierre: si el filtro mirara el `estado`, el día que exista el cierre con resultado bueno los lotes cerrados correctamente también liberarían su nombre, que es justo lo que no se quiere. `motivo_rechazo` solo lo escribe este endpoint.

De paso, el filtro queda inmune al problema del `NULL` que tenía la versión basada en `estado`: `IS NULL` es un predicado de tres valores bien definido, mientras que `estado <> 'cerrado'` habría excluido las filas con `estado = NULL` y esas filas habrían dejado de reservar su nombre sin que nada avise.

Es un `.where('motivo_rechazo', 'is', null)` de una línea en Kysely, sin `eb.or([...])`.

### Efecto observable en los endpoints existentes

Solo `POST /lotes` cambia de comportamiento, y solo por el `nombre_lote`. El resto de la tabla es el efecto que se obtiene sin escribir una línea:

| Endpoint | Efecto sobre un lote rechazado |
| --- | --- |
| `GET /lotes/cliente/:clienteId` | Desaparece: ya filtra `estado = 'abierto'`. |
| `GET /lotes/cliente/:clienteId/all` | Desaparece: ya filtra `estado = 'abierto'`. |
| `POST /lotes` | Acepta un lote nuevo con el **mismo `nombre_lote`** para ese cliente. **Es el único cambio de contrato de este spec.** |
| `POST /pesajes` | Falla con 400 `El lote 'X' no esta abierto`: `validateLoteAbierto` ya lo comprueba. |
| `PATCH /pesajes/:id/rechazar` | Falla con 400 `El lote 'X' no esta abierto`. **Los pesajes de un lote rechazado quedan imposibles de anular.** |
| `GET /pesajes/byLote/:loteId` | **Sigue devolviendo los pesajes activos.** No valida el lote. |

Las dos últimas filas son las incoherencias asumidas por este spec y están en Risks.

Nótese que escribir `etapa_id` **no tiene ningún efecto observable por API hoy**: las dos rutas que exponen `etapas.nombre as etapa` filtran `estado = 'abierto'`, así que el lote rechazado ya no aparece en ninguna de las dos. El dato queda solo para consultas en la base. Está en Decisions.

---

## Implementation plan

1. Ejecutar a mano el `ALTER TABLE` de las tres columnas y el de la FK. Confirmar con `DESCRIBE lotes;` que las tres aparecen como nullables y con `SHOW CREATE TABLE lotes;` que la FK quedó creada y que `estado` es `VARCHAR` (no `ENUM`). Confirmar que las filas existentes tienen las tres en `NULL` y que su `estado` y su `cerrado_en` no cambiaron.
2. Confirmar con `SELECT id, codigo, nombre FROM etapas;` que existe la fila `codigo = 'RECHAZADO'` y anotar su `id` para las verificaciones manuales. Si no existe, este spec no puede implementarse: la fila se siembra fuera de él.
3. Agregar las tres claves a `LotesTable` en `src/database/types/types.ts`. Confirmar que la app sigue compilando (`npm run build`): `POST /lotes` no las escribe, así que el insert existente sigue siendo válido.
4. Crear `src/modules/lotes/dto/rechazar-lote.dto.ts` con `rechazarLoteSchema` (`motivo: z.string().min(5).max(255)`) y la clase `RechazarLoteDto extends createZodDto(...)`, copiando los mensajes de error de `rechazar-cliente.dto.ts`.
5. Agregar el validador privado `validateLoteAbierto(loteId, db)` a `LotesRepository`: `selectFrom('lotes').select(['id', 'nombre_lote', 'cliente_id', 'estado', 'cerrado_en']).where('id', '=', loteId)`, lanzando `BadRequestException` si no existe y otro si `estado !== 'abierto' || cerrado_en !== null`. Mismos mensajes que el homónimo de `PesajesRepository`. Devuelve la fila.
6. Agregar el validador privado `resolveEtapaRechazado(db)` a `LotesRepository`: `selectFrom('etapas').select(['id', 'codigo']).where('codigo', '=', 'RECHAZADO')`, lanzando `BadRequestException` si no existe. Devuelve la fila.
7. Agregar `rechazarLote(loteId, dto, userId)` a `LotesRepository`: abre `this.db.transaction().execute(...)`, llama a `validateLoteAbierto`, llama a `resolveEtapaRechazado`, y ejecuta el `updateTable('lotes').set({ estado: 'cerrado', etapa_id: etapa.id, cerrado_en: sql`NOW()`, motivo_rechazo: motivo, rechazado_por: userId, rechazado_en: sql`NOW()` }).where('id', '=', loteId)`. No llama a `validateVinculoOperador`. Devuelve `true`. Importar `sql` de `kysely`.
8. Modificar `validateNombreLoteDisponible` para agregar `.where('motivo_rechazo', 'is', null)`. No se cambia su firma, su mensaje de error ni sus llamadores.
9. Agregar `rechazar(loteId, dto, userId)` a `LotesService` como pass-through, igual en forma a `create`.
10. Agregar el handler `@Patch(':id/rechazar')` a `LotesController` con `@Param('id', ParseIntPipe) id: number`, `@Body() dto: RechazarLoteDto` y `@Req() req: Request`. Lee `const { userId } = req.user as { userId: number }`. Responde `{ ok: true, msg: 'Lote rechazado correctamente' }`. Sin `@Public()` y sin `@HttpCode`. Importar `Patch` de `@nestjs/common`.
11. Levantar con `npm run start:dev` y confirmar que compila y que `PATCH /lotes/:id/rechazar` aparece en el log de rutas de Nest, junto a los tres endpoints de lotes ya existentes.
12. Verificación manual del camino feliz: crear un lote con `POST /lotes`, anotar su `id` y su `nombre_lote`, confirmar que aparece en `GET /lotes/cliente/:clienteId`, rechazarlo con un motivo válido, confirmar 200, confirmar en MySQL que la fila tiene `estado = 'cerrado'`, el `etapa_id` de la etapa `RECHAZADO`, `cerrado_en` y `rechazado_en` con la hora actual, el motivo escrito y `rechazado_por` con el id del token, y confirmar que ya **no** aparece en `GET /lotes/cliente/:clienteId` ni en `GET /lotes/cliente/:clienteId/all`.
13. Verificación manual de la liberación del nombre: hacer `POST /lotes` con el **mismo `nombre_lote`** y el mismo `cliente_id` del lote rechazado, y confirmar 201. Después crear otro con un nombre que ya use un lote **abierto** y confirmar que sigue dando 400 `El lote 'X' ya esta registrado para este cliente`. Por último, poner a mano un lote en `estado = 'cerrado'` con `motivo_rechazo = NULL` (simulando el cierre que todavía no existe) y confirmar que su nombre **sigue ocupado**: es lo que verifica que el filtro mira `motivo_rechazo` y no el `estado`.
14. Verificación manual del efecto en `pesajes`: contra un lote rechazado que ya tenía pesajes, confirmar que `POST /pesajes` responde 400 `no esta abierto`, que `PATCH /pesajes/:id/rechazar` sobre uno de esos pesajes responde 400 `no esta abierto`, y que `GET /pesajes/byLote/:loteId` **sigue devolviéndolos**.
15. Verificación manual de los errores: rechazar el mismo lote otra vez y confirmar 400 sin que el `motivo_rechazo`, el `rechazado_por`, el `rechazado_en` ni el `cerrado_en` originales cambien; rechazar un `id` inexistente y confirmar 400; mandar un `motivo` de tres caracteres y confirmar el error de Zod; llamar a `PATCH /lotes/abc/rechazar` y confirmar 400; llamar sin header `Authorization` y confirmar 401.
16. Verificación manual de la ausencia de control de acceso: login con un `Operador` **no** vinculado al cliente del lote y confirmar que lo rechaza igual, con **200 y no 403**. Es el resultado esperado de este spec y el criterio que documenta que el vínculo no se valida.
17. Actualizar `CLAUDE.md`: agregar `PATCH /lotes/:id/rechazar` y `GET /lotes/cliente/:clienteId/all` a la fila `lotes` de la tabla de endpoints; agregar `etapas` y `lotes.etapa_id` a la sección de dominio y borrar la afirmación de que el concepto de *Etapa* no está en el esquema; borrar la afirmación de que nada puede escribir `lotes.cerrado_en` ni cambiar `lotes.estado`; anotar las tres columnas nuevas de `lotes` y su FK; agregar este endpoint a la lista de rutas que se saltan `validateVinculoOperador`, que pasa de cinco a seis, y anotar que `GET /lotes/cliente/:clienteId/all` es una séptima que nunca la tuvo; corregir el conteo de `PATCH`es, de `UPDATE`s y de `:id` del proyecto, que pasan de dos a tres; anotar que el rechazo libera el `nombre_lote` y que el filtro que lo permite mira `motivo_rechazo`, no el `estado`; y dejar escrito que `estado = 'cerrado'` **no** significa que exista el cierre de lote, y que un lote rechazado se identifica por `motivo_rechazo IS NOT NULL`, no por su `estado`.

---

## Acceptance criteria

- [X] `DESCRIBE lotes;` muestra `motivo_rechazo VARCHAR(255)`, `rechazado_por INT` y `rechazado_en DATETIME`, las tres nullables.
- [X] `SHOW CREATE TABLE lotes;` muestra la FK de `rechazado_por` a `usuarios(id)`, y muestra `estado` como `VARCHAR`, sin cambios: `'cerrado'` no exigió DDL.
- [X] Las filas de `lotes` anteriores al DDL tienen las tres columnas en `NULL`, y su `estado` y su `cerrado_en` sin cambios.
- [X] `LotesTable` en `src/database/types/types.ts` declara las tres columnas nuevas, ninguna como `Generated<>`.
- [X] `EtapasTable` y la tabla `etapas` no se modificaron, y no se sembró ninguna fila nueva en ella.
- [X] La app arranca sin errores de compilación (`npm run start:dev`).
- [X] La tabla `permisos` sigue teniendo exactamente las 11 filas de SPEC 08: no se sembró ninguna fila nueva.
- [X] Existe `src/modules/lotes/dto/rechazar-lote.dto.ts` y su schema tiene exactamente un campo, `motivo`.
- [X] `PATCH /lotes/:id/rechazar` aparece en el log de rutas de Nest al arrancar.
- [X] `src/app.module.ts` no cambió: `LotesModule` ya estaba registrado.
- [X] No se creó ningún módulo, controller ni service nuevo: solo se modificaron `lotes.controller.ts`, `lotes.service.ts` y `repository/lotes.repository.ts`, y se agregó un DTO.
- [X] Rechazar un lote abierto con un motivo válido responde 200 con exactamente `{ ok: true, msg: 'Lote rechazado correctamente' }`.
- [X] La respuesta **no** incluye ninguna clave de recurso: no hay `lote`, ni `data`, ni el motivo devuelto.
- [X] Después del rechazo, la fila tiene `estado = 'cerrado'`, y no `'rechazado'` ni `'anulado'`.
- [X] Después del rechazo, `etapa_id` es el `id` de la fila de `etapas` con `codigo = 'RECHAZADO'`, resuelto por `codigo` y no por un id clavado en el código.
- [X] Después del rechazo, `cerrado_en` tiene la fecha y hora del rechazo, no `NULL`.
- [X] Después del rechazo, `motivo_rechazo` contiene exactamente el texto enviado en el body.
- [X] Después del rechazo, `rechazado_por` es el `userId` del token que llamó, no el `created_by` del lote.
- [X] Después del rechazo, `rechazado_en` tiene la fecha y hora del rechazo, no `NULL`, y coincide con `cerrado_en`.
- [X] El rechazo **no** modifica `cliente_id`, `nombre_lote`, `producto_id`, `unidad_medida_id`, `variedad_o_talla`, `peso_minimo`, `peso_ideal`, `peso_maximo`, `resumen_ia`, `created_by` ni `created_at` de la fila.
- [X] Un lote rechazado desaparece de `GET /lotes/cliente/:clienteId`, y el resto de los lotes del cliente sigue apareciendo igual.
- [X] Un lote rechazado desaparece de `GET /lotes/cliente/:clienteId/all`.
- [X] `POST /lotes` acepta un lote nuevo con el mismo `nombre_lote` y el mismo `cliente_id` que un lote rechazado, y responde 201.
- [X] `POST /lotes` sigue respondiendo 400 `El lote 'X' ya esta registrado para este cliente` cuando el nombre lo usa un lote **abierto** del mismo cliente.
- [X] `POST /lotes` sigue rechazando el nombre duplicado cuando el lote existente tiene `estado = 'cerrado'` pero `motivo_rechazo = NULL`: el filtro mira `motivo_rechazo`, no el `estado`, así que un cierre futuro con resultado bueno no liberará el nombre.
- [X] `POST /lotes` sigue rechazando el nombre duplicado cuando el lote existente tiene `estado = NULL`: `motivo_rechazo IS NULL` no depende del valor del `estado`.
- [X] `POST /pesajes` contra un lote rechazado responde 400 con `El lote 'X' no esta abierto`.
- [X] `PATCH /pesajes/:id/rechazar` sobre un pesaje de un lote rechazado responde 400 con `El lote 'X' no esta abierto`. **Es el comportamiento esperado y este spec no lo cambia.**
- [X] `GET /pesajes/byLote/:loteId` de un lote rechazado **sigue devolviendo** sus pesajes activos, con los mismos campos y el mismo orden. **Es el comportamiento esperado.**
- [X] Los pesajes del lote rechazado no cambian: ninguno queda con `isActive = 0` por efecto de este rechazo.
- [X] Rechazar un `id` que no existe responde 400 con `El lote con id 'X' no existe`, no 404 y no 500.
- [X] Rechazar un lote que ya fue rechazado responde 400 con `El lote 'X' no esta abierto`.
- [X] Tras ese 400, el `motivo_rechazo`, el `rechazado_por`, el `rechazado_en` y el `cerrado_en` del primer rechazo quedan intactos: el segundo intento no sobrescribe nada.
- [X] Un `motivo` de menos de 5 caracteres responde 400 por validación de Zod y no modifica la fila.
- [X] Un `motivo` de más de 255 caracteres responde 400 por validación de Zod y no modifica la fila.
- [X] Un body sin `motivo` responde 400 por validación de Zod.
- [X] Un `id` de ruta no numérico (`PATCH /lotes/abc/rechazar`) responde 400 por `ParseIntPipe`.
- [X] `PATCH /lotes/:id/rechazar` sin header `Authorization` responde 401: el endpoint no es `@Public()`.
- [X] `PATCH /lotes/:id/rechazar` con un token expirado o firmado con otro secreto responde 401.
- [X] Un `Operador` **sin** fila en `cliente_operador` para el cliente del lote lo rechaza igual: responde **200, no 403**. **Este spec no valida el vínculo.**
- [X] Un usuario que no creó el lote puede rechazarlo: no se compara contra `lotes.created_by`.
- [X] Cuando cualquier validación falla, ninguna columna de la fila cambia: la transacción no deja escrituras parciales.
- [X] `GET /lotes/cliente/:clienteId` y `GET /lotes/cliente/:clienteId/all` no cambiaron: mismos campos, mismo filtro `estado = 'abierto'`, mismo orden, mismos joins.
- [X] `GET /lotes/cliente/:clienteId` sigue validando el vínculo `cliente_operador` y sigue respondiendo 403 sin él.
- [X] `createLote` sigue escribiendo `etapa_id: 1` y `estado: 'abierto'`: este spec no toca ese literal.
- [X] No existe ningún endpoint para deshacer un rechazo, para cerrar un lote con resultado bueno ni para listar lotes rechazados: `estado = 'cerrado'` lo escribe **solo** `rechazarLote`.
- [X] Ningún código del proyecto identifica un lote rechazado por `estado = 'cerrado'`: la única señal que se usa es `motivo_rechazo`.
- [X] No se agregó `GET /catalogos/etapas` ni ningún otro endpoint sobre `etapas`.
- [X] `GET /permisos/me` responde exactamente igual que antes de este spec: siete códigos para `Admin` y cuatro para `Operador`, ninguno de rechazo de lotes.
- [X] El payload del JWT no cambió y `req.user` sigue siendo `{ userId, username }`.
- [X] `POST /clientes`, `GET /clientes`, `GET /clientes/all`, `PATCH /clientes/:id/rechazar` (SPEC 01, 08, 11), `POST /pesajes` (SPEC 03, SPEC 04), `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh` (SPEC 05), `GET /permisos/me` (SPEC 07) y los tres `GET /catalogos/*` (SPEC 09) siguen funcionando igual.
- [X] `CLAUDE.md` lista `PATCH /lotes/:id/rechazar` y `GET /lotes/cliente/:clienteId/all` en la tabla de endpoints, documenta la tabla `etapas`, y ya no afirma que el concepto de *Etapa* no está en el esquema ni que nada puede escribir `lotes.cerrado_en` o cambiar `lotes.estado`.
- [X] `CLAUDE.md` advierte que `estado = 'cerrado'` no implica que el cierre de lote exista, y que un lote rechazado se identifica por `motivo_rechazo IS NOT NULL`.

---

## Decisions

- **Sí:** "rechazar" significa **anular el lote** cambiando su `estado`. Decisión explícita del usuario. El caso real es el lote creado mal: nombre equivocado, producto equivocado, rango de pesos mal capturado.
- **Sí:** el rechazo se marca en `lotes.estado` y en `lotes.etapa_id`. Decisión explícita del usuario, que respondió "por el `etapa_id` y estado" cuando se le ofrecieron las tres alternativas.
- **No:** agregar una columna `lotes.isActive` para copiar literalmente SPEC 10 y SPEC 11. Se descarta: los dos listados de lotes filtran por `estado`, no por un `isActive`, así que un lote con `isActive = 0` seguiría apareciendo en los dos `GET` a menos que este spec modificara ambos endpoints de SPEC 02. Más DDL y más superficie tocada para el mismo efecto.
- **No:** escribir las dos cosas, el `estado` y un `isActive = 0`. Se descarta: dos fuentes de verdad para el mismo hecho, que se pueden desincronizar.
- **Sí:** el valor es `'cerrado'`. Decisión explícita del usuario, tomada **después** de que el spec hubiera elegido `'rechazado'` y de que se le señalara que `'cerrado'` deja indistinguibles por `estado` un lote anulado y un lote cerrado con resultado bueno. Reusa el vocabulario de `cerrado_en`, que este mismo `UPDATE` escribe, y deja el ciclo de vida del lote con un solo estado terminal en vez de dos.
- **No:** `'rechazado'`, que era la elección anterior de este spec. Se descarta. Consecuencia asumida y registrada en Risks: el `estado` deja de ser una señal válida para saber si un lote fue anulado, y el spec que implemente el cierre de verdad va a encontrar el valor `'cerrado'` ya en uso por los rechazos.
- **No:** `'anulado'`. Se descarta: introduce una tercera palabra al vocabulario del proyecto.
- **Sí:** la señal canónica para identificar un rechazo es `motivo_rechazo IS NOT NULL`, no el `estado`. Es la consecuencia obligada de la decisión anterior: solo este endpoint escribe esa columna, el `motivo` es obligatorio, y por tanto nunca queda vacía en un rechazo ni llena en nada más. Queda escrito en el modelo de datos como regla para todo código nuevo.
- **No:** apoyarse en `etapa_id = RECHAZADO` como señal principal. Se descarta: obliga a resolver la fila de `etapas` para comparar y la columna es nullable. Sirve como señal secundaria.
- **Sí:** se escribe `etapa_id` con la etapa `RECHAZADO`. Decisión explícita del usuario. Consecuencia anotada sin adornos: **hoy no tiene ningún efecto observable por API**, porque las dos rutas que exponen `etapas.nombre as etapa` filtran `estado = 'abierto'` y el lote rechazado ya no aparece en ninguna. El dato sirve para consultas en la base y para el día en que exista un endpoint que liste lotes no abiertos.
- **No:** dejar el `etapa_id` como estaba, conservando la etapa del flujo en la que el lote se anuló. Se descarta pese a ser información histórica útil y el alcance más pequeño.
- **Sí:** la fila `RECHAZADO` de `etapas` **ya existe** y este spec no la siembra. Dato aportado por el usuario. El paso 2 del plan lo verifica antes de escribir código, porque sin esa fila el endpoint no puede funcionar.
- **Sí:** el `id` de la etapa se resuelve por `codigo = 'RECHAZADO'` dentro de la transacción. Decisión explícita del usuario. Es el mismo patrón de `resolveEstadoCalidad` en `PesajesRepository` y la misma razón por la que `permisos` se siembra resolviendo el rol por nombre: los ids difieren entre ambientes.
- **No:** clavar el id en el código como hace `createLote` con su `etapa_id: 1`. Se descarta: si el id de la fila difiere entre desarrollo y producción, el rechazo escribiría la etapa equivocada **sin fallar**, que es el peor modo de error posible.
- **No:** corregir el literal `etapa_id: 1` de `createLote` en este spec. Se descarta: exige saber qué significa cada fila de `etapas`, que es el spec de documentar esa tabla.
- **No:** diseñar o documentar `etapas` entera, ni agregar `GET /catalogos/etapas`. Se descarta: la tabla entró al esquema sin spec, y ordenarla es su propio trabajo. Este spec solo consume una fila y corrige la frase de `CLAUDE.md` que niega su existencia.
- **Sí:** se escribe `cerrado_en = NOW()`. Decisión explícita del usuario. El rechazo termina el ciclo de vida del lote, y `validateLoteAbierto` comprueba esa columna además del `estado`, así que quedan las dos coherentes.
- **No:** dejar `cerrado_en` en `NULL`. Se descarta pese a que el efecto de bloqueo ya lo daba el `estado` por sí solo, y pese a que esto convierte a este spec en el primero del proyecto que escribe una columna que todos los anteriores dejaron fuera de alcance.
- **Sí:** esto **no** es el cierre de lote, aunque ahora escriba las dos columnas del cierre. No hay endpoint para cerrar un lote con resultado bueno, no hay agregados y no hay `resumen_ia`. Las dos columnas se escriben solo en el camino del rechazo. Se deja escrito porque las frases "nada puede escribir `lotes.cerrado_en`" y "nada puede cambiar `lotes.estado`" aparecen en varios specs y en `CLAUDE.md`, y dejan de ser ciertas.
- **Sí:** `cerrado_en` y `rechazado_en` son columnas distintas aunque hoy guarden el mismo valor. La primera es del ciclo de vida del lote, la segunda del rastro de esta operación. Si algún día otra cosa cierra un lote, la distinción importa.
- **Sí:** `PATCH /lotes/:id/rechazar`. Copia el precedente de SPEC 10 y SPEC 11. No choca con `GET /lotes/cliente/:clienteId` porque el verbo y el primer segmento son distintos.
- **No:** `DELETE /lotes/:id`. Se mantiene la decisión de SPEC 10 y SPEC 11: `DELETE` con body es ambiguo en HTTP, el motivo va en el body, y sugiere borrado físico cuando es baja lógica.
- **Sí:** el `id` va en la ruta, no en el body. Es el recurso que se está modificando.
- **Sí:** DDL con las tres columnas de auditoría — `motivo_rechazo`, `rechazado_por`, `rechazado_en`. Decisión explícita del usuario. Sin esto, anular un lote sería una operación destructiva sin rastro de quién la hizo ni por qué.
- **Sí:** los nombres son exactamente los tres de SPEC 10 y SPEC 11. Es la misma operación sobre una tercera tabla y el rastro debe leerse igual en las tres.
- **Sí:** FK real de `rechazado_por` a `usuarios(id)`. Decisión explícita del usuario. Cuarta excepción del proyecto a la regla de validar solo en código, con la misma justificación: es un dato de auditoría y una fila huérfana lo dejaría sin valor probatorio.
- **No:** el trío sin FK, que habría sido coherente con `lotes.created_by`. Se descarta: rompería con lo que SPEC 10 y SPEC 11 acaban de decidir para la misma columna en las otras dos tablas. Consecuencia asumida: `lotes` queda con una columna de usuario con FK y otra sin ella, igual que `pesajes` y `clientes`.
- **No:** agregarle también la FK a `lotes.created_by`. Se descarta: unificar esa inconsistencia en las tres tablas es su propio spec.
- **No:** solo `estado = 'cerrado'`, sin DDL de auditoría. Se descarta pese a ser el alcance mínimo y de cero riesgo de ambiente desincronizado. Con `'cerrado'` como valor, además, sería la opción que **no** deja ninguna forma de distinguir un rechazo de un cierre.
- **Sí:** las tres columnas son nullables. Las filas existentes no tienen valor y no se van a rellenar.
- **Sí:** `motivo` obligatorio, entre 5 y 255 caracteres. Decisión explícita del usuario. Mismo DTO en contenido y en mensajes que `rechazar-pesaje.dto.ts` y `rechazar-cliente.dto.ts`.
- **No:** `motivo` opcional. Se descarta por la misma razón que en los dos specs anteriores: dejaría la columna de auditoría vacía en parte de las filas.
- **Sí:** el motivo es texto libre. Un catálogo de motivos sería otra tabla, otro endpoint de catálogo y otro spec.
- **Sí:** solo se rechaza un lote con `estado = 'abierto'` y `cerrado_en IS NULL`; 400 en cualquier otro caso. Decisión explícita del usuario. Reusa exactamente la condición de `validateLoteAbierto` y protege el rastro: un lote ya rechazado no se puede re-rechazar.
- **Sí:** el caso "ya rechazado" cae en el mensaje genérico `El lote 'X' no esta abierto`, sin un chequeo ni un mensaje propios. Es la consecuencia de marcar el rechazo en una columna de ciclo de vida en vez de un booleano, y es lo que distingue este spec de SPEC 10 y SPEC 11, que sí tenían un mensaje específico.
- **No:** permitir rechazar cualquier lote que no esté ya rechazado, incluido uno cerrado. Se descarta. Hoy es teórico porque nada más cierra un lote, pero dejaría reabrir un resultado dado por bueno.
- **No:** permitir rechazar solo si el lote no tiene pesajes activos. Se descarta: volvería inutilizable el endpoint justo en el caso más común, el lote que se creó mal y ya tiene pesajes encima.
- **Sí:** el validador se duplica en `LotesRepository` en vez de compartirse con `PesajesRepository`. Los dos repositorios son clases independientes con validadores privados y el proyecto no tiene una capa compartida; extraerla es su propio trabajo. Consecuencia anotada: dos copias de `validateLoteAbierto` que hay que cambiar juntas.
- **Sí:** `BadRequestException` (400) cuando el lote no existe. Es lo que ya hacen `validateCliente` y `validateProducto` en este mismo archivo, y la coherencia dentro del archivo pesa más aquí.
- **No:** `NotFoundException` (404), que sería lo natural para un `:id` de ruta. Se descarta por la decisión anterior, igual que en SPEC 10 y SPEC 11. El proyecto sigue con los dos criterios conviviendo y unificarlos es su propio spec.
- **Sí:** cualquier usuario autenticado puede rechazar cualquier lote, sin `validateVinculoOperador`. Decisión explícita del usuario, tomada después de que se le presentara la alternativa y se le señalara que aquí la excepción es **peor que en SPEC 11**: `ClientesRepository` no validaba el vínculo en ninguna escritura, mientras que `LotesRepository` sí lo valida en sus dos métodos actuales. Este queda como el único método del archivo que se lo salta, y es el destructivo.
- **No:** exigir el vínculo `cliente_operador` con 403, que es la convención de acceso declarada del proyecto y lo que hacen `getLotesByCliente` y `createLote` en la misma clase. Se descarta. Se anota la consecuencia que motivó la duda, la misma de SPEC 11: hoy nada discrimina por rol, así que exigir el vínculo habría dejado a un `Admin` sin filas en `cliente_operador` sin poder rechazar ningún lote.
- **No:** exigir que quien rechaza sea quien creó el lote (`lotes.created_by`). Se descarta por la misma razón que en los dos specs anteriores: bloquearía al supervisor que corrige el error de un operador.
- **No:** verificar el permiso a mano dentro del repositorio. Se mantiene la decisión de SPEC 08: inventaría un mecanismo paralelo al `PermissionsGuard` futuro.
- **Sí:** ninguna fila nueva en `permisos`. Decisión explícita del usuario. La tabla sigue en 11 filas. Es la quinta excepción a la regla de SPEC 06, después de `GET /permisos/me`, los tres catálogos de SPEC 09, el rechazo de pesajes de SPEC 10 y el de clientes de SPEC 11.
- **No:** sembrar `lotes.rechazar` para `Admin` (una fila, tabla en 12), que es lo que la convención pide. Se descarta. Consecuencia asumida: el `PermissionsGuard` futuro va a encontrar **tres** operaciones destructivas sin código de permiso que exigir, y tendrá que inventar los tres.
- **No:** sembrarlo para `Admin` y `Operador` (dos filas, tabla en 13). Se descarta por la decisión anterior.
- **Sí:** sin cascada sobre `pesajes`. Decisión explícita del usuario. Mismo criterio que SPEC 11 tomó para los lotes de un cliente rechazado.
- **No:** rechazar en cascada todos los pesajes activos del lote dentro de la misma transacción. Se descarta pese a que habría evitado el callejón sin salida que queda anotado en Risks: sería la primera escritura del proyecto que toca N filas, un `UPDATE` masivo sin límite.
- **Sí:** el rechazo **libera** el `nombre_lote` para ese cliente. Decisión explícita del usuario, contra la recomendación de no tocar nada. Es el único cambio de contrato de este spec y permite recrear el lote con el nombre correcto, que es el caso de uso que motiva el endpoint.
- **No:** dejar `validateNombreLoteDisponible` como está, con el nombre del lote rechazado quemado para siempre en ese cliente. Se descarta por la decisión anterior. Consecuencia asumida: `lotes` puede terminar con dos filas del mismo `nombre_lote` para un cliente, una abierta y una rechazada, y no hay constraint de MySQL que lo impida porque la unicidad es solo de código, por decisión de SPEC 02.
- **Sí:** el filtro es `motivo_rechazo IS NULL`. Es la consecuencia obligada de que `estado` pase a `'cerrado'`: un filtro por `estado` liberaría también el nombre de los lotes cerrados con resultado bueno el día que el cierre exista, que es exactamente lo que no se quiere. Ventaja lateral: `IS NULL` está bien definido en SQL de tres valores, así que desaparece el problema del `NULL` que tenía la versión por `estado`.
- **No:** `(estado IS NULL OR estado <> 'cerrado')`, que era el filtro que este spec tenía cuando el estado del rechazo era `'rechazado'`. Se descarta por la decisión anterior. Es el cambio menos obvio que arrastró pasar a `'cerrado'`, y por eso hay un criterio de aceptación que verifica que un lote `'cerrado'` **sin** `motivo_rechazo` sigue reservando su nombre.
- **Sí:** el rechazo es irreversible. Se mantiene la decisión de SPEC 10 y SPEC 11. La fila no se borra, así que el dato se puede recuperar por SQL a mano si hace falta.
- **No:** un endpoint de reactivación que devuelva `estado = 'abierto'`. Se descarta: duplica el trabajo, abre la pregunta de qué pasa con el rastro del rechazo anterior y con el `cerrado_en` escrito, y ahora también la de si el `nombre_lote` sigue libre.
- **Sí:** la respuesta es solo `{ ok, msg }`. Decisión explícita del usuario. Es el tercer endpoint del proyecto que no devuelve nada del recurso que tocó, y los tres rechazos quedan con la misma forma.
- **No:** `{ ok, msg, lote: { id, estado, etapa, rechazado_en } }`, que habría vuelto a la convención de payload con clave nombrada del resto del proyecto. Se descarta por la decisión anterior: dejaría los tres endpoints de rechazo con dos formas distintas.
- **Sí:** el `UPDATE` y sus validaciones van dentro de una transacción, con los validadores recibiendo el `trx`. Es la convención de escritura del proyecto.
- **Sí:** `cerrado_en` y `rechazado_en` se escriben con `NOW()` de MySQL, no con un `new Date()` de Node. Se mantiene la decisión de SPEC 10: es la misma fuente de hora que `created_at`, así que las fechas de la misma fila son comparables sin depender de la zona horaria del proceso de Node. Además, un solo `NOW()` por sentencia garantiza que las dos columnas queden idénticas.
- **Sí:** todo va en el módulo `lotes` existente. Es la misma tabla y el mismo dominio.
- **Sí:** `GET /lotes/cliente/:clienteId` y `GET /lotes/cliente/:clienteId/all` no cambian. Su filtro `estado = 'abierto'` ya hace que un lote rechazado desaparezca de los dos, que es el efecto buscado, sin escribir una línea.
- **No:** agregarle la validación de vínculo a `GET /lotes/cliente/:clienteId/all`, que hoy no la tiene. Se descarta: es una ruta que ningún spec cubre y arreglarla es su propio trabajo. Este spec la documenta en `CLAUDE.md` y nada más.
- **No:** un query param `?incluirRechazados=true`. Se mantiene la decisión de SPEC 10 y SPEC 11: exigiría el primer DTO Zod de query del proyecto y una segunda forma de respuesta que mantener.
- **No:** rechazo en lote (varios ids en una llamada). Se descarta: abre la pregunta de qué pasa si uno de los ids falla.
- **No:** editar un lote para corregir su nombre o su rango de pesos en vez de rechazarlo. Se descarta: es otra operación, con otra semántica de auditoría, y va en su propio spec. La liberación del `nombre_lote` es lo que hace viable el camino "rechazar y recrear" mientras eso no exista.
- **No:** borrado físico. Se descarta: perdería la fila y con ella la auditoría, y `pesajes.lote_id` apunta a ella.
- **No:** validar que el cliente del lote esté activo antes de rechazar. Se descarta: SPEC 11 dejó registrado que un cliente rechazado conserva sus lotes, y bloquear el rechazo de esos lotes sería lo contrario de lo que hace falta.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **Cualquier usuario autenticado puede rechazar cualquier lote**, incluido un `Operador` sin ninguna fila en `cliente_operador` para ese cliente. Es la tercera escritura abierta del proyecto, y la primera que se salta la convención **dentro de un archivo que sí la cumple**: `getLotesByCliente` y `createLote` validan el vínculo, `rechazarLote` no. | **Sin mitigar por diseño**, por decisión explícita del usuario tomada con la consecuencia sobre la mesa. Es el riesgo principal de este spec. Hay dos criterios de aceptación que lo verifican y lo dejan registrado como comportamiento esperado. La mitigación real es el spec del `PermissionsGuard`, más el `validateVinculoOperador` que este endpoint decidió no llamar. |
| **Los pesajes de un lote rechazado quedan imposibles de anular para siempre.** `PATCH /pesajes/:id/rechazar` llama a `validateLoteAbierto`, así que responde 400 en cuanto el lote deja de estar abierto. Un pesaje mal capturado en un lote que después se rechaza no se puede corregir por API. | Sin mitigar por decisión explícita (sin cascada). Hay un criterio de aceptación que lo verifica como comportamiento esperado. En la práctica pesa poco, porque el lote entero ya está anulado, pero deja el dato inconsistente: pesajes activos colgando de un lote muerto. Corregirlo exige tocar SPEC 10 y va en su propio spec. |
| `GET /pesajes/byLote/:loteId` **sigue devolviendo los pesajes activos de un lote rechazado**: no valida el lote. La app puede mostrar los pesajes de un lote que ya no aparece en ningún listado de lotes. | Sin mitigar por decisión explícita. Es la misma incoherencia que SPEC 11 dejó entre `clientes` y `lotes`, un nivel más abajo. Hay un criterio de aceptación que la fija como comportamiento esperado. |
| **`estado = 'cerrado'` no distingue un lote anulado de un lote cerrado con resultado bueno.** Hoy la ambigüedad no se puede materializar, porque el rechazo es lo único que cierra un lote. El día que exista el cierre de verdad, cualquier código que haya asumido que `'cerrado'` significa "terminó bien" o "fue anulado" va a estar equivocado en la mitad de las filas. | **Sin mitigar en el esquema**, por decisión explícita del usuario. La mitigación es documental y de convención: el modelo de datos fija `motivo_rechazo IS NOT NULL` como la única señal válida, hay dos criterios de aceptación que lo verifican, y el paso 17 lo escribe en `CLAUDE.md`. El spec del cierre de lote hereda el problema y tendrá que decidir si separa los dos estados. |
| El `nombre_lote` liberado permite dos filas con el mismo nombre para un cliente, una abierta y una rechazada. Si algún día se agrega un `UNIQUE (cliente_id, nombre_lote)` en MySQL, el DDL va a fallar contra los datos existentes. | Asumido por decisión explícita. SPEC 02 ya había decidido que la unicidad viva solo en código, así que hoy no hay constraint que romper. Queda anotado para quien intente agregarla. |
| Alguien implementa el filtro de `validateNombreLoteDisponible` mirando el `estado` en vez de `motivo_rechazo`, porque es lo primero que se le ocurre al leer "ignorar los lotes rechazados". El bug queda invisible hasta que exista el cierre de lote, y entonces los lotes cerrados correctamente empiezan a liberar su nombre. | Mitigado en el plan y en los criterios: el paso 13 pide verificar a mano un lote `'cerrado'` **sin** `motivo_rechazo` y confirmar que su nombre sigue ocupado, y hay un criterio de aceptación con esa misma comprobación. La decisión registra el filtro descartado. |
| Escribir `etapa_id` no tiene ningún efecto observable por API: las dos rutas que exponen la etapa filtran `estado = 'abierto'`. Alguien puede implementar el spec, verificar por API y no ver nunca el cambio. | El paso 12 del plan verifica el `etapa_id` **en MySQL**, no por API, y hay un criterio de aceptación que lo dice explícitamente. La decisión de escribirlo está registrada con esta consecuencia. |
| El `id` de la etapa `RECHAZADO` difiere entre ambientes y el rechazo escribe la etapa equivocada sin fallar. | Mitigado: se resuelve por `codigo` dentro de la transacción y se lanza 400 si la fila no existe. El paso 2 del plan lo verifica con un `SELECT` antes de escribir código. |
| Este spec escribe `lotes.cerrado_en` y pone `lotes.estado` en `'cerrado'`, y varios specs anteriores y `CLAUDE.md` afirman que nada puede hacer ninguna de las dos cosas. Alguien ve una fila cerrada en la base y concluye que el cierre de lote ya está implementado. | El paso 17 del plan corrige las dos frases en `CLAUDE.md`, y hay una decisión y dos criterios de aceptación que dicen que **no** hay endpoint de cierre y que `'cerrado'` lo escribe solo `rechazarLote`. La distinción entre `cerrado_en` y `rechazado_en` queda escrita en el modelo de datos. |
| Ahora hay dos copias de `validateLoteAbierto`, una en `PesajesRepository` y una en `LotesRepository`, con el mismo mensaje de error. Se cambia una y no la otra. | Sin mitigar en el código, por decisión registrada. Los mensajes son idénticos a propósito, así que un `grep` de `no esta abierto` encuentra las dos. |
| Al no sembrar ninguna fila en `permisos`, el `PermissionsGuard` futuro se encuentra con **tres** operaciones destructivas sin código de permiso — esta, la de SPEC 10 y la de SPEC 11 — y sin saber si fue decisión o descuido. | Queda registrado aquí, en tres decisiones y en `CLAUDE.md`. El paso 17 del plan lo incluye. La regla de SPEC 06 lleva cuatro specs seguidos sin cumplirse. |
| El rechazo es irreversible y no hay endpoint para deshacerlo: un rechazo por error deja el lote inaccesible por API para siempre, junto con sus pesajes. | Parcialmente mitigado: la fila no se borra, así que se puede reabrir por SQL a mano. El motivo obligatorio y el `rechazado_por` reducen los rechazos accidentales al obligar a escribir algo. Además, la liberación del `nombre_lote` permite recrear el lote igual y seguir trabajando. |
| Un lote rechazado desaparece de los dos listados y no hay ningún endpoint que lo liste, así que la app no puede mostrar qué se anuló ni por qué. | Sin mitigar por decisión explícita. Las tres columnas quedan escritas en la base desde el día uno, así que cuando llegue el endpoint de lectura el dato histórico ya existe. |
| El DDL se aplica en un ambiente y no en otro, y el `UPDATE` falla por columna inexistente. Es el riesgo heredado de no tener migraciones. | Sin mitigación automática. El paso 1 del plan verifica con `DESCRIBE lotes;` y `SHOW CREATE TABLE lotes;`. El DDL queda escrito en este spec, que es la única fuente. |
| Se agrega `GET /lotes/:id` en el futuro y choca con alguna de las rutas de `cliente/...`. | No lo introduce este spec: `PATCH` y `GET` son verbos distintos y el primer segmento (`:id` frente a `cliente`) desambigua. Se repite el aviso que SPEC 08 y SPEC 11 ya dejaron, porque este spec agrega el primer `:id` de primer nivel al controller de `lotes`. |
| Alguien lee "rechazar lote" y asume que es un flujo de aprobación de lotes, o el estado `RECHAZADO` de calidad del diagrama. | Está en el objetivo, en la sección de por qué existe el spec y en las decisiones. No se toca `estados_calidad` ni `estado_calidad_id`, y no se agrega ninguna columna de aprobación. |

---

## What is **not** in this spec

- El cierre de lote con resultado bueno: no hay endpoint que cierre un lote, ni agregados, ni `resumen_ia`. `estado = 'cerrado'` y `cerrado_en` se escriben solo al rechazar.
- Separar por `estado` un lote anulado de un lote cerrado con resultado bueno: los dos quedan en `'cerrado'`, y la única señal del rechazo es `motivo_rechazo IS NOT NULL`.
- Diseñar o documentar la tabla `etapas` entera, corregir el literal `etapa_id: 1` de `createLote`, y `GET /catalogos/etapas`.
- Sembrar filas en `etapas`: la fila `RECHAZADO` ya existe.
- Deshacer un rechazo: no hay endpoint de reactivación.
- Rechazo en lote de varios lotes en una llamada.
- Cascada sobre `pesajes`: no se anulan, no se desactivan, no se tocan.
- Cambios a `POST /pesajes`, `PATCH /pesajes/:id/rechazar` y `GET /pesajes/byLote/:loteId`.
- Cambios a `GET /lotes/cliente/:clienteId` y `GET /lotes/cliente/:clienteId/all`, ni agregarle a este último la validación de vínculo que no tiene.
- El estado `RECHAZADO` de calidad del diagrama, y cualquier cambio a `estados_calidad` o a `estado_calidad_id`.
- Sembrar filas en `permisos`: la tabla sigue con las 11 filas de SPEC 08.
- Aplicar permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`.
- Validar el vínculo `cliente_operador`, ni exigir que quien rechaza sea quien creó el lote.
- Un endpoint para listar lotes rechazados, y cualquier query param para incluirlos.
- Devolver `motivo_rechazo`, `rechazado_por` o `rechazado_en` en algún endpoint de lectura.
- Borrado físico de lotes.
- Editar un lote, y `GET /lotes/:id`.
- Un catálogo de motivos de rechazo.
- Una constraint `UNIQUE (cliente_id, nombre_lote)` en MySQL.

Cada uno de estos, si se necesita, va en su propio spec.
