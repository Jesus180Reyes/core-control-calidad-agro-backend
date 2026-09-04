# SPEC 16 — Filtros de consulta en los GET de pesajes

> **Status:** Approved
> **Depends on:** SPEC 03, SPEC 10, SPEC 15
> **Date:** 2026-09-04
> **Objective:** Agregar query params opcionales a `GET /pesajes/byLote/:loteId` y `GET /pesajes/historial`, y con ellos establecer la convención de filtros de consulta del proyecto, que SPEC 17 y SPEC 18 replicarán en `clientes` y `lotes`.

---

## Why this spec exists

**Este es el primer spec que introduce query params en el proyecto.** Los 8 `GET` que existen hoy filtran por un parámetro de ruta (`:loteId`, `:clienteId`), por el token (`historial`, `permisos/me`) o por nada (los tres `catalogos`). Ninguno acepta `?algo=valor`. SPEC 15 lo dejó escrito como una decisión explícita: *"no introduce el primer query param del proyecto"*. Este spec la revierte, a propósito y con la convención sobre la mesa.

Hay cinco cosas que fijar antes de escribir una línea.

**La primera: la convención nace aquí y se replica dos veces.** SPEC 17 (clientes) y SPEC 18 (lotes) dependen de este documento y no vuelven a discutir nombres de params, coerción, semántica de combinación ni manejo de errores. Si algo de eso cambia, se cambia aquí y los otros dos se corrigen. El orden de implementación es 16 → 17 → 18.

**La segunda: ningún filtro puede provocar un 400.** Un query param mal formado —`?producto_id=abc`, `?desde=2026-13-99`, `?fuera_de_rango=quizás`— **se ignora**, y la consulta corre como si no lo hubieran mandado. Decisión explícita del usuario. La consecuencia a asumir está en Risks: un typo del frontend no falla ruidosamente, devuelve una lista que parece correcta pero no está filtrada como creía quien la pidió. Se acepta porque un listado que revienta con 400 rompe una pantalla entera, y un listado sin filtrar solo la ensucia.

**La tercera: los filtros no amplían nada de lo que ya se puede ver.** Ni `GET /pesajes/byLote/:loteId` ni `GET /pesajes/historial` ganan una sola fila que hoy no devuelvan. Un filtro solo puede **quitar** filas del resultado, nunca agregarlas. Es una propiedad que hay que preservar en los tres specs de esta serie, y en SPEC 18 se rompe a propósito con `?estado=cerrado` — ahí sí se amplía, y ese spec lo argumenta.

**La cuarta: `historial` no recibe `?usuario_id`, y eso no es un olvido.** La garantía central de SPEC 15 es que ese endpoint **no tiene dónde escribir el id de otro usuario**. Agregarle un `?usuario_id` la destruiría en una línea. El filtro por usuario existe solo en `byLote/:loteId`, donde todos los pesajes de todos los operadores del lote ya son visibles hoy, así que filtrar por uno no descubre nada.

**La quinta: no se siembra fila de permiso, y van siete specs seguidos.** Mismo criterio que SPEC 09 a 15: estos endpoints ya son accesibles para cualquier autenticado y un filtro no cambia quién puede llamarlos. Y sigue sin haber `PermissionsGuard` que aplique nada.

---

## La convención de filtros del proyecto

Esta sección es la que SPEC 17 y SPEC 18 citan. Todo lo de aquí aplica a los tres specs.

### Reglas

1. **Transporte:** query params en la URL. Nunca body en un `GET`, nunca headers.
2. **Nombres:** `snake_case`, iguales a la columna que filtran cuando la columna existe (`usuario_id`, `producto_id`, `estado_calidad_id`). Las excepciones son `nombre` (búsqueda de texto), `desde` y `hasta` (rango sobre `created_at`).
3. **Todos son opcionales.** Sin ningún param, la respuesta es **byte a byte la misma** que antes de este spec. Ese es el criterio de no regresión de los tres specs.
4. **Se combinan con `AND`.** No hay `OR` entre filtros distintos y no hay operadores (`?peso_gt=`, `?nombre_ne=`). Cada param añade un `.where()` más.
5. **Un param ausente, vacío (`?nombre=`) o inválido no se aplica.** No es un 400, no es un 404, no es un 500. La consulta corre sin ese filtro.
6. **Un param desconocido se descarta en silencio.** `?foo=bar` no hace nada; el schema de Zod no lo declara y Zod elimina las claves que no conoce.
7. **Filtrar nunca amplía el resultado.** Un filtro solo quita filas. La única excepción de la serie es `?estado` en SPEC 18, que ese spec justifica aparte.
8. **La respuesta no cambia de forma.** Sigue siendo `{ ok, msg, <clave nombrada> }` con los mismos campos por fila. No se agrega `total`, ni `filtros_aplicados`, ni metadatos de ningún tipo.
9. **Una lista vacía es 200 con `[]`.** Un filtro que no encuentra nada no es un 404.
10. **Sin paginación, sin `?page`, sin `?limit`, sin `?order`.** Fuera de alcance en los tres specs.

### Tipos de param y cómo se coercionan

| Tipo | Forma en Zod | Ejemplo | Qué pasa si es inválido |
| --- | --- | --- | --- |
| Id numérico | `z.coerce.number().int().positive().optional().catch(undefined)` | `?usuario_id=3` | `?usuario_id=abc` → `undefined` → sin filtro |
| Booleano | `z.enum(['true','false']).transform(v => v === 'true' ? 1 : 0).optional().catch(undefined)` | `?fuera_de_rango=true` | `?fuera_de_rango=1` → `undefined` → sin filtro |
| Texto parcial | `z.string().trim().min(1).optional().catch(undefined)` | `?nombre=LOTE` | `?nombre=` → `undefined` → sin filtro |
| Texto exacto | igual que el parcial, pero se compara con `=` y no con `LIKE` | `?rtn=08011985...` | igual |
| Fecha | `z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined)` | `?desde=2026-09-01` | `?desde=ayer` → `undefined` → sin filtro |
| Enum cerrado | `z.enum([...]).optional().catch(undefined)` | `?estado=cerrado` (SPEC 18) | valor fuera del enum → `undefined` → default del endpoint |

El `.catch(undefined)` es la pieza clave: convierte cualquier error de parseo de **ese campo** en `undefined` sin abortar la validación del objeto entero. Por eso el `ZodValidationPipe` global nunca lanza sobre un DTO de filtros.

### Params booleanos

**El cliente manda un booleano y el backend lo convierte a `tinyint`.** Es la regla de esta serie para cualquier filtro sobre una columna `TINYINT(1)` de MySQL, y hoy el único es `?fuera_de_rango`.

- **Lo que se acepta son exactamente dos literales: `true` y `false`.** Nada más.
- `?fuera_de_rango=true` → el DTO entrega `1` → `WHERE pesajes.fuera_de_rango = 1`.
- `?fuera_de_rango=false` → el DTO entrega `0` → `WHERE pesajes.fuera_de_rango = 0`.
- **`?fuera_de_rango=1` y `?fuera_de_rango=0` NO son válidos** y se ignoran como cualquier otro valor mal formado: la respuesta es 200 sin ese filtro. El `0`/`1` es la representación en la base, no el contrato de la API.
- Cualquier otro valor —`si`, `TRUE` en mayúsculas, `yes`, `on`, `2`, o el param vacío `?fuera_de_rango=`— se ignora igual.
- **El param a secas, sin `=`, también se ignora**: HTTP lo entrega como cadena vacía, no como `true`. Hay que escribir `?fuera_de_rango=true`.
- La conversión vive **en el DTO**, en el `.transform()` de Zod, no en el repositorio. El repositorio recibe ya un `0` o un `1` y lo mete en el `.where()` sin volver a mirarlo.

La razón de convertir en el DTO y no en el repositorio es la misma por la que las fechas se validan ahí: el repositorio no debe saber cómo viaja el valor por HTTP, solo con qué se compara la columna.

### Búsqueda de texto (`?nombre`)

- Es siempre **parcial**: `LIKE '%valor%'`.
- Es **una sola columna por endpoint**, nunca un `OR` entre varias. Cuál columna, lo dice cada spec.
- El valor se recorta con `.trim()` antes de comparar.
- La sensibilidad a mayúsculas la decide la *collation* de MySQL, no la aplicación. Con las collations `_ci` habituales la búsqueda es insensible; **no se fuerza con `LOWER()`**, porque eso impediría usar cualquier índice sobre la columna.
- El valor **no se escapa**: un `%` o un `_` dentro del texto buscado funcionan como comodines. Anotado en Risks; no se mitiga en esta serie.

### Rango de fechas (`?desde` / `?hasta`)

- Formato `YYYY-MM-DD`. Nada más se acepta.
- `?desde=2026-09-01` → `created_at >= '2026-09-01 00:00:00'`.
- `?hasta=2026-09-04` → `created_at < DATE_ADD('2026-09-04', INTERVAL 1 DAY)`, es decir **el día 4 completo entra**. Es el límite superior *inclusivo* que se decidió.
- No se convierte de zona horaria: la fecha se interpreta en la zona del servidor MySQL, la misma en la que `NOW()` escribe `created_at`.
- Se comparan contra la columna, **nunca** contra `DATE(created_at)`, para no invalidar un futuro índice.
- Los dos son independientes: se puede mandar solo uno.
- Un rango invertido (`?desde=2026-09-10&hasta=2026-09-01`) **no es un error**: devuelve `[]`.

### Dónde vive el código

- **Un DTO de filtros por endpoint**, en la carpeta `dto/` de su módulo, con `createZodDto` igual que los DTO de body.
- El controller lo recibe con `@Query() filtros: XDto` y lo pasa al service; el service lo pasa al repositorio.
- **El repositorio arma el `WHERE` condicionalmente**, reasignando el query builder de Kysely:

```ts
let query = this.db.selectFrom('pesajes')/* ...joins y select... */;
if (filtros.usuario_id !== undefined) {
  query = query.where('pesajes.usuario_id', '=', filtros.usuario_id);
}
// ... un if por filtro ...
const pesajes = await query.orderBy('pesajes.created_at', 'desc').execute();
```

- **No se crea ningún helper compartido** entre módulos: ni `src/common/`, ni una función `aplicarFiltros()`, ni un schema base de Zod reutilizado. Cada DTO repite sus tres o cuatro líneas de Zod. Es el mismo criterio con el que SPEC 15 no factorizó un select común: tres repeticiones cortas cuestan menos que un helper que después hay que parametrizar. Está en Decisions.

---

## Scope

**In:**

- Nuevo `src/modules/pesajes/dto/filtros-pesajes-lote.dto.ts`, con la clase `FiltrosPesajesLoteDto`.
- Nuevo `src/modules/pesajes/dto/filtros-historial.dto.ts`, con la clase `FiltrosHistorialDto`.
- `GET /pesajes/byLote/:loteId` acepta **seis** query params opcionales: `usuario_id`, `estado_calidad_id`, `fuera_de_rango`, `nombre`, `desde`, `hasta`.
- `GET /pesajes/historial` acepta **siete** query params opcionales: `lote_id`, `cliente_id`, `estado_calidad_id`, `fuera_de_rango`, `nombre`, `desde`, `hasta`.
- `getPesajesByLote` pasa a recibir `(loteId, filtros)` y `getHistorialByUsuario` pasa a recibir `(userId, filtros)`.
- Los dos métodos del service (`findAllByLote`, `findHistorial`) propagan el objeto de filtros sin tocarlo.
- Los dos handlers del controller reciben `@Query()` con su DTO.
- **Sin DDL**: ninguna columna, tabla, índice ni FK.
- **Sin cambios en `src/database/types/types.ts`**.
- **Sin cambios en la forma ni en los campos de la respuesta**: `byLote` sigue devolviendo sus 12 campos y `historial` sus 14.
- Actualizar `CLAUDE.md`: la fila `pesajes` de la tabla de endpoints y una nota nueva de que el proyecto ya tiene query params y cuál es su convención.

**Out of scope (for future specs):**

- Un `?usuario_id` en `GET /pesajes/historial`. Se descarta explícitamente: rompería la garantía de SPEC 15.
- Un `GET /pesajes/usuario/:usuarioId` o cualquier otra forma de leer el historial ajeno. Sigue diferido desde SPEC 15.
- Un `GET /pesajes` global sin lote ni usuario.
- Paginación, `?page`, `?limit`, `?offset`, `?order` o `?sort`. El orden sigue clavado en `created_at` DESC.
- Un `total` o un conteo en la respuesta.
- Filtros por rango de peso (`?peso_min`, `?peso_max`).
- Filtros por `dispositivo_identificador` o `secuencia_dispositivo`.
- Un `?incluirRechazados=true`: el filtro `isActive = 1` sigue clavado en los dos endpoints y los pesajes rechazados siguen sin listarse en ninguna parte.
- Filtrar por `?estado_calidad=IDEAL` con el código de texto. Se usa el id.
- Búsqueda de texto multi-columna (un `OR` entre `nombre_lote` y `nombre` de cliente).
- Escapar `%` y `_` en el valor de `?nombre`.
- Aceptar `?fuera_de_rango=1` o `=0`. El contrato del filtro es booleano; ver Decisions.
- Cambiar el `fuera_de_rango` de la **respuesta** de `0`/`1` a booleano para que coincida con el del filtro. Eso cambiaría los campos, que es lo que esta serie no toca.
- Índices en MySQL sobre las columnas filtradas. Ver Risks.
- Cambios a `POST /pesajes` y a `PATCH /pesajes/:id/rechazar`.
- Cambios a los módulos `auth`, `permisos` y `catalogos`.
- Filtros en `clientes` (SPEC 17) y en `lotes` (SPEC 18).
- Sembrar filas en `catalogo_permisos` o en `permisos`.
- Aplicar permisos: sigue sin haber `PermissionsGuard`.

---

## Data model

**Este spec no introduce datos nuevos.** No hay DDL, no hay tabla ni columna nueva, y `src/database/types/types.ts` no se toca. Todas las columnas que los filtros consultan ya están declaradas y ya se usan en las dos consultas.

### Los dos DTO

`src/modules/pesajes/dto/filtros-pesajes-lote.dto.ts`:

```ts
const filtrosPesajesLoteSchema = z.object({
  usuario_id:        /* id numérico */,
  estado_calidad_id: /* id numérico */,
  fuera_de_rango:    /* booleano true|false -> tinyint 1|0 */,
  nombre:            /* texto parcial */,
  desde:             /* fecha YYYY-MM-DD */,
  hasta:             /* fecha YYYY-MM-DD */,
});

export class FiltrosPesajesLoteDto extends createZodDto(filtrosPesajesLoteSchema) { }
```

`src/modules/pesajes/dto/filtros-historial.dto.ts`:

```ts
const filtrosHistorialSchema = z.object({
  lote_id:           /* id numérico */,
  cliente_id:        /* id numérico */,
  estado_calidad_id: /* id numérico */,
  fuera_de_rango:    /* booleano true|false -> tinyint 1|0 */,
  nombre:            /* texto parcial */,
  desde:             /* fecha YYYY-MM-DD */,
  hasta:             /* fecha YYYY-MM-DD */,
});

export class FiltrosHistorialDto extends createZodDto(filtrosHistorialSchema) { }
```

Las formas exactas de cada tipo están en la tabla de coerción de la convención. Todos llevan `.optional().catch(undefined)`.

### `GET /pesajes/byLote/:loteId` — los seis filtros

| Param | Columna | Comparación | Nota |
| --- | --- | --- | --- |
| `usuario_id` | `pesajes.usuario_id` | `=` | Quién registró el pesaje. |
| `estado_calidad_id` | `pesajes.estado_calidad_id` | `=` | Se filtra por la columna de `pesajes`, **no** por `estados_calidad.id`, para no depender del join. |
| `fuera_de_rango` | `pesajes.fuera_de_rango` | `=` (tinyint 1 o 0) | Columna directa. Se recibe `true`/`false` y el DTO lo convierte. |
| `nombre` | `usuarios.complete_name` | `LIKE '%v%'` | Es la única columna de texto con nombre en esta consulta. El lote es uno solo y viene por la ruta. |
| `desde` | `pesajes.created_at` | `>=` | |
| `hasta` | `pesajes.created_at` | `<` día siguiente | |

Los filtros **no** reemplazan a los dos `WHERE` que ya existen: `pesajes.lote_id = :loteId` y `pesajes.isActive = 1` siguen siempre aplicados.

### `GET /pesajes/historial` — los siete filtros

| Param | Columna | Comparación | Nota |
| --- | --- | --- | --- |
| `lote_id` | `pesajes.lote_id` | `=` | Columna de `pesajes`, sin pasar por el join. |
| `cliente_id` | `lotes.cliente_id` | `=` | Sale del `LEFT JOIN lotes` que ya existe. |
| `estado_calidad_id` | `pesajes.estado_calidad_id` | `=` | |
| `fuera_de_rango` | `pesajes.fuera_de_rango` | `=` (tinyint 1 o 0) | Se recibe `true`/`false` y el DTO lo convierte. |
| `nombre` | `lotes.nombre_lote` | `LIKE '%v%'` | Es lo que pidió el usuario: buscar por nombre de lote. **No** busca en `clientes.nombre`. |
| `desde` | `pesajes.created_at` | `>=` | |
| `hasta` | `pesajes.created_at` | `<` día siguiente | |

Los dos `WHERE` de SPEC 15 —`pesajes.usuario_id = <token>` y `pesajes.isActive = 1`— siguen siempre aplicados. **No hay ningún filtro que los pueda levantar.**

Lo que este endpoint **sigue sin filtrar**, igual que después de SPEC 15: `lotes.estado`, `clientes.isActive` y `cliente_operador`. Un lote cerrado y un cliente rechazado siguen apareciendo en el historial, con o sin filtros.

### El efecto colateral de filtrar sobre una tabla unida con `LEFT JOIN`

Hay que decirlo porque cambia el resultado y no es obvio:

| Filtro | Tabla unida | Efecto |
| --- | --- | --- |
| `?nombre` en `byLote` | `usuarios` (`LEFT JOIN`) | Un pesaje cuyo `usuario_id` no resuelva desaparece del resultado: el `WHERE` sobre `usuarios.complete_name` convierte el `LEFT` en `INNER` de hecho. |
| `?nombre` y `?cliente_id` en `historial` | `lotes` / `clientes` (`LEFT JOIN`) | Un pesaje con `lote_id` en `NULL` desaparece del resultado. Sin esos params **sigue apareciendo** con `nombre_lote: null` y `cliente: null`, exactamente como lo dejó SPEC 15. |

Se acepta: es el comportamiento estándar de SQL y filtrar por un nombre que la fila no tiene debe excluirla. Los joins **se dejan como `LEFT`**; no se convierten en `INNER`.

### Peticiones y respuestas

```
GET /pesajes/byLote/9?usuario_id=3&fuera_de_rango=true&desde=2026-09-01&hasta=2026-09-04
GET /pesajes/historial?cliente_id=2&nombre=LOTE-00&estado_calidad_id=1
```

La respuesta mantiene exactamente la forma de siempre:

```json
{ "ok": true, "msg": "Pesajes obtenidos correctamente", "pesajes": [ /* ... */ ] }
```

Sin resultados:

```json
{ "ok": true, "msg": "Pesajes obtenidos correctamente", "pesajes": [] }
```

| Caso | Respuesta |
| --- | --- |
| Sin header `Authorization` | 401 del `JwtAuthGuard` |
| `:loteId` no numérico en `byLote` | 400 del `ParseIntPipe` — **ya existía**, no lo agrega este spec |
| Cualquier query param inválido, vacío o desconocido | **200**, con ese filtro sin aplicar |
| Ningún resultado tras filtrar | **200 con `[]`** |

**Ningún query param puede producir un 400.** El único 400 posible en estos dos endpoints sigue siendo el `ParseIntPipe` del parámetro de ruta de `byLote`, que ya estaba.

---

## Implementation plan

1. Confirmar contra MySQL que hay datos variados para probar: un lote con pesajes de **dos** usuarios distintos, al menos uno con `fuera_de_rango = 1`, y pesajes en al menos dos fechas distintas (`SELECT lote_id, usuario_id, fuera_de_rango, DATE(created_at), COUNT(*) FROM pesajes WHERE isActive = 1 GROUP BY 1,2,3,4;`). Si no los hay, crearlos con `POST /pesajes` antes de seguir.
2. Anotar la respuesta actual de `GET /pesajes/byLote/:loteId` y de `GET /pesajes/historial` **sin params**, para compararlas al final. Es la línea base de no regresión.
3. Crear `src/modules/pesajes/dto/filtros-pesajes-lote.dto.ts` con sus seis campos, todos `.optional().catch(undefined)`. Confirmar que compila (`npm run build`).
4. Crear `src/modules/pesajes/dto/filtros-historial.dto.ts` con sus siete campos, igual. Confirmar que compila.
5. Cambiar la firma de `getPesajesByLote` a `(loteId: number, filtros: FiltrosPesajesLoteDto)` y reescribir el cuerpo con `let query = ...` más un `if` por filtro, dejando `lote_id`, `isActive = 1` y el `orderBy` siempre aplicados. Sin transacción y sin validadores, igual que hoy.
6. Cambiar la firma de `getHistorialByUsuario` a `(userId: number, filtros: FiltrosHistorialDto)` y hacer lo mismo, dejando `usuario_id`, `isActive = 1` y el `orderBy` siempre aplicados.
7. Propagar el parámetro en `PesajesService`: `findAllByLote(loteId, filtros)` y `findHistorial(userId, filtros)`. Siguen siendo pass-through de una línea.
8. Agregar `@Query() filtros: FiltrosPesajesLoteDto` al handler `findAllByLote` y `@Query() filtros: FiltrosHistorialDto` al handler `findHistorial`. **No cambiar el orden de declaración de los handlers**: `@Get('historial')` sigue primero.
9. Levantar con `npm run start:dev` y confirmar que las cuatro rutas de `pesajes` siguen apareciendo en el log de Nest, sin rutas nuevas.
10. Verificación de no regresión: llamar a los dos endpoints **sin ningún query param** y confirmar que la respuesta es idéntica a la anotada en el paso 2 — mismos campos, mismas filas, mismo orden.
11. Verificación de `?usuario_id` en `byLote`: con el id de uno de los dos usuarios, confirmar que solo vienen sus filas; con el del otro, las suyas; la suma de las dos llamadas es igual a la llamada sin filtro.
12. Verificación de `?fuera_de_rango`: `=true` devuelve solo los de fuera de rango, `=false` solo los de dentro, y las dos cuentas suman el total. Confirmar además que el valor llega a la consulta como `tinyint` —`1` y `0`, no `'true'` ni `'false'`— y que la conversión ocurre en el DTO, no en el repositorio. Repetir en los dos endpoints.
13. Verificación de `?estado_calidad_id`: con el id de `IDEAL` (obtenido con `SELECT id, codigo FROM estados_calidad;`), confirmar que solo vienen filas con ese `estado_calidad_codigo`. Repetir en los dos endpoints.
14. Verificación de fechas: `?desde` con la fecha del pesaje más antiguo devuelve todo; `?hasta` con la fecha del pesaje **más reciente** devuelve todo también, incluidos los de ese mismo día — es el límite inclusivo. Un `?hasta` un día antes del más reciente lo excluye. Un rango invertido devuelve `[]` sin error.
15. Verificación de `?nombre`: en `historial`, con un fragmento del `nombre_lote` confirmar que solo vienen los pesajes de los lotes que lo contienen; en `byLote`, con un fragmento del nombre de un usuario confirmar lo mismo. Confirmar que la búsqueda es parcial y que un fragmento en minúscula encuentra un nombre en mayúscula.
16. Verificación de `?lote_id` y `?cliente_id` en `historial`: cada uno acota el resultado y los dos juntos se combinan con AND.
17. Verificación de la combinación: mandar cuatro filtros a la vez en `historial` y confirmar que el resultado es la intersección, no la unión.
18. Verificación de los inválidos, que es el corazón de este spec. Confirmar **200 y sin filtrar** en todos estos casos: `?usuario_id=abc`, `?usuario_id=-1`, `?usuario_id=`, `?fuera_de_rango=si`, `?fuera_de_rango=1`, `?fuera_de_rango=0`, `?fuera_de_rango=TRUE`, `?fuera_de_rango=`, `?fuera_de_rango` (sin `=`), `?estado_calidad_id=0`, `?desde=ayer`, `?desde=2026-13-99`, `?hasta=01/09/2026`, `?nombre=` y `?foo=bar`. **Ninguno puede responder 400.** Los tres casos de `fuera_de_rango` con `1`, `0` y `TRUE` son los que confirman que el contrato es booleano y no numérico.
19. Verificación de que `historial` sigue siendo intocable: confirmar que `GET /pesajes/historial?usuario_id=<otro>` devuelve **los pesajes del token, no los del otro usuario** — el param no existe en el schema y Zod lo descarta.
20. Verificación del pesaje huérfano: si existe alguna fila con `lote_id IS NULL` para el usuario de prueba, confirmar que aparece sin params y que **desaparece** al mandar `?nombre` o `?cliente_id`. Si no existe ninguna, anotarlo y saltarlo.
21. Verificación de que nada más cambió: `POST /pesajes`, `PATCH /pesajes/:id/rechazar`, `GET /permisos/me`, los tres `GET /catalogos/*`, los dos `GET /clientes*` y los dos `GET /lotes/cliente/*` responden igual que antes.
22. Confirmar que `permisos` sigue con **14 filas** y `catalogo_permisos` con **9**.
23. Actualizar `CLAUDE.md`: agregar los query params a la fila `pesajes`; agregar una nota nueva que diga que el proyecto ya tiene query params, que la convención está en `specs/16-filtros-de-pesajes.md`, que **ningún filtro produce 400** y que `GET /pesajes/historial` **no** acepta `?usuario_id` por diseño; anotar que los params booleanos se mandan como `true`/`false` y el backend los convierte a `tinyint`, y que **`?fuera_de_rango=1` no filtra** pese a que la respuesta devuelva `0`/`1`; y anotar que es la séptima excepción consecutiva a la regla de sembrar permisos.

---

## Acceptance criteria

- [ ] No se ejecutó ningún DDL: `DESCRIBE pesajes;` muestra exactamente las mismas columnas que antes.
- [ ] `src/database/types/types.ts` **no cambió**.
- [ ] No se creó ningún módulo, controller, service ni repositorio nuevo: solo se modificaron `pesajes.controller.ts`, `pesajes.service.ts` y `repository/pesajes.repository.ts`.
- [ ] `src/modules/pesajes/dto/` tiene exactamente cuatro archivos: `create-pesaje.dto.ts`, `rechazar-pesaje.dto.ts`, `filtros-pesajes-lote.dto.ts` y `filtros-historial.dto.ts`.
- [ ] No se creó ningún archivo fuera de `src/modules/pesajes/`: no hay `src/common/`, ni helper de filtros compartido, ni schema de Zod reutilizado entre módulos.
- [ ] `src/app.module.ts` no cambió.
- [ ] La app arranca sin errores de compilación (`npm run start:dev`).
- [ ] El log de rutas de Nest muestra las mismas cuatro rutas de `pesajes` que antes: **ninguna ruta nueva**.
- [ ] `@Get('historial')` sigue declarado **antes** que `@Get('byLote/:loteId')`.
- [ ] `GET /pesajes/byLote/:loteId` **sin ningún query param** devuelve exactamente la misma respuesta que antes de este spec: mismos 12 campos, mismas filas, mismo orden `created_at` DESC.
- [ ] `GET /pesajes/historial` **sin ningún query param** devuelve exactamente la misma respuesta que antes: mismos 14 campos, mismas filas, mismo orden.
- [ ] La respuesta sigue siendo `{ ok, msg, pesajes }` con la clave nombrada: **no** se agregó `total`, ni `filtros`, ni `data`, ni metadato alguno.
- [ ] `GET /pesajes/byLote/:loteId` acepta exactamente seis params: `usuario_id`, `estado_calidad_id`, `fuera_de_rango`, `nombre`, `desde`, `hasta`.
- [ ] `GET /pesajes/historial` acepta exactamente siete params: `lote_id`, `cliente_id`, `estado_calidad_id`, `fuera_de_rango`, `nombre`, `desde`, `hasta`.
- [ ] `?usuario_id=N` en `byLote` devuelve solo los pesajes de ese usuario, y la unión de las llamadas por cada usuario del lote iguala la llamada sin filtro.
- [ ] `?fuera_de_rango=true` y `?fuera_de_rango=false` particionan el resultado: sus cuentas suman exactamente la cuenta sin filtro. Verificado en los dos endpoints.
- [ ] El DTO convierte el booleano a **`tinyint`**: el repositorio recibe `1` o `0` numéricos, no las cadenas `'true'` / `'false'`, y la conversión está en el `.transform()` de Zod, no en el repositorio ni en el controller.
- [ ] **`?fuera_de_rango=1` y `?fuera_de_rango=0` NO filtran**: responden 200 con el resultado sin filtrar, igual que cualquier valor inválido. El contrato de la API es booleano, no numérico.
- [ ] `?fuera_de_rango=TRUE`, `?fuera_de_rango=si`, `?fuera_de_rango=`, `?fuera_de_rango` (sin `=`) y `?fuera_de_rango=2` responden 200 sin filtrar.
- [ ] Los únicos dos valores que `?fuera_de_rango` acepta son exactamente `true` y `false`, en minúsculas.
- [ ] `?estado_calidad_id=N` devuelve solo filas cuyo `estado_calidad_codigo` corresponde a ese id. Verificado en los dos endpoints.
- [ ] `?desde=YYYY-MM-DD` excluye los pesajes anteriores a las 00:00 de ese día e incluye los de ese día.
- [ ] `?hasta=YYYY-MM-DD` **incluye los pesajes de ese mismo día completo**, hasta las 23:59:59. Es el límite inclusivo.
- [ ] `?desde` y `?hasta` juntos delimitan el rango, y un rango invertido devuelve `[]` con 200, no un error.
- [ ] `?nombre=<fragmento>` en `historial` filtra por `lotes.nombre_lote` con coincidencia **parcial**, no exacta.
- [ ] `?nombre=<fragmento>` en `byLote` filtra por `usuarios.complete_name` con coincidencia parcial.
- [ ] `?nombre` **no** busca en `clientes.nombre` en ningún endpoint: no hay `OR` entre columnas.
- [ ] `?lote_id=N` y `?cliente_id=N` en `historial` acotan el resultado y no lo amplían.
- [ ] Varios filtros a la vez se combinan con **AND**: el resultado de cuatro filtros es la intersección de los cuatro por separado.
- [ ] `?usuario_id=abc` responde **200** y devuelve el resultado sin filtrar. **No** responde 400.
- [ ] `?usuario_id=-1`, `?usuario_id=0` y `?estado_calidad_id=0` responden 200 sin filtrar: no son ids positivos.
- [ ] `?usuario_id=` y `?nombre=` (vacíos) responden 200 sin filtrar.
- [ ] `?desde=ayer`, `?desde=2026-13-99` y `?hasta=01/09/2026` responden 200 sin filtrar.
- [ ] `?foo=bar` responde 200 y no afecta al resultado.
- [ ] **Ningún query param, con ningún valor, produce un 400** en estos dos endpoints. El único 400 posible sigue siendo el `ParseIntPipe` de `:loteId`.
- [ ] `GET /pesajes/historial?usuario_id=<id de otro usuario>` devuelve **los pesajes del usuario del token**, no los del otro: el param no existe en `FiltrosHistorialDto` y Zod lo descarta. **La garantía de SPEC 15 sigue intacta.**
- [ ] No existe ningún param, en ningún endpoint de este spec, que permita ver los pesajes de otro usuario.
- [ ] `?estado_calidad_id=N` con un id que no existe en `estados_calidad` devuelve `[]` con 200, no un 400 ni un 404.
- [ ] `?cliente_id=N` con un cliente al que el usuario no está vinculado devuelve `[]` o sus propias filas, nunca las de otro usuario.
- [ ] Ningún filtro puede hacer que aparezca una fila que la llamada sin filtros no devolvía.
- [ ] `pesajes.isActive = 1` sigue siempre aplicado en los dos endpoints: no hay ningún param que liste los rechazados.
- [ ] `pesajes.lote_id = :loteId` sigue siempre aplicado en `byLote`, y `pesajes.usuario_id = <token>` en `historial`.
- [ ] `historial` sigue **sin** filtrar `lotes.estado`, `clientes.isActive` ni `cliente_operador`: un lote cerrado y un cliente rechazado siguen apareciendo.
- [ ] Los joins siguen siendo `LEFT` en las dos consultas: ninguno se convirtió en `INNER`.
- [ ] Un pesaje con `lote_id` en `NULL`, si existe, sigue apareciendo en `historial` sin params y desaparece al mandar `?nombre` o `?cliente_id`. Es el comportamiento esperado.
- [ ] Ninguna de las dos consultas abre transacción ni llama a un validador: siguen siendo un único `SELECT`.
- [ ] Los seis validadores privados de `PesajesRepository` no se modificaron, y `getHistorialByUsuario` sigue sin llamar a `validateVinculoOperador`.
- [ ] `createPesaje` y `rechazarPesaje` no cambiaron.
- [ ] No hay `?page`, `?limit`, `?offset`, `?order` ni `?sort` en ninguno de los dos endpoints.
- [ ] El orden sigue siendo `pesajes.created_at` DESC, no configurable.
- [ ] `permisos` sigue con exactamente **14 filas** y `catalogo_permisos` con **9**.
- [ ] `GET /permisos/me` devuelve exactamente los mismos códigos que antes para los dos roles.
- [ ] El payload del JWT no cambió y `req.user` sigue siendo `{ userId, username }`.
- [ ] `POST /pesajes`, `PATCH /pesajes/:id/rechazar`, los dos `GET /clientes*`, los dos `GET /lotes/cliente/*`, los cuatro `PATCH` de rechazo/aprobación, `POST /auth/login`, `POST /auth/register`, `GET /permisos/me` y los tres `GET /catalogos/*` siguen funcionando igual.
- [ ] `CLAUDE.md` documenta los seis y los siete params, dice que **ningún filtro produce 400**, anota que `historial` no acepta `?usuario_id` por diseño, y anota que los params booleanos se mandan como `true`/`false` (nunca `1`/`0`) y el backend los convierte a `tinyint`.
- [ ] `CLAUDE.md` apunta a `specs/16-filtros-de-pesajes.md` como la convención de filtros que siguen SPEC 17 y SPEC 18.

---

## Decisions

- **Sí:** los filtros van en query params. Decisión implícita en pedir "filtros para los GET": es la única forma estándar de filtrar un `GET`. Es el primer query param del proyecto y revierte a propósito lo que SPEC 15 difirió.
- **No:** filtros en el body de un `GET`. Se descarta: es no estándar, muchos clientes HTTP no lo permiten y ningún proxy lo cachea.
- **No:** un `POST /pesajes/buscar` con el filtro en el body. Se descarta: convertiría una lectura en una escritura aparente y rompería la convención `GET` = leer.
- **Sí:** todos los params son opcionales y sin ninguno la respuesta es idéntica a la de hoy. Es el criterio de no regresión y hay dos criterios de aceptación que lo fijan.
- **Sí:** los filtros se combinan con `AND`. Es lo que espera cualquiera que use una pantalla de listado con varios selectores.
- **No:** `OR` entre filtros, operadores tipo `?peso_gt=`, o un lenguaje de query. Se descarta por complejidad desproporcionada para un CRUD de listados.
- **Sí:** un param inválido se ignora y la consulta corre sin él. **Decisión explícita del usuario.** Ningún filtro produce 400. Riesgo asumido y anotado.
- **No:** 400 con el mensaje de Zod ante un param mal formado, que es lo que hacen todos los DTO de body del proyecto. Se descarta pese a la inconsistencia: un 400 en un listado rompe la pantalla entera, y aquí el peor caso de ignorar es devolver de más.
- **No:** parsear los params a mano en el controller con `Number()` e `isNaN`. Se descarta: dejaría el único input del proyecto que no pasa por Zod y sin schema que lo documente.
- **Sí:** un DTO de filtros por endpoint, con `createZodDto`, en la carpeta `dto/` de su módulo. Sigue la convención de DTO que ya existe.
- **Sí:** `.optional().catch(undefined)` campo por campo. Es la pieza que hace que el `ZodValidationPipe` global nunca lance sobre un DTO de filtros, sin tener que desactivarlo ni sobrescribirlo en estos handlers.
- **No:** un helper compartido de filtros en `src/common/`, ni un schema base de Zod reutilizado por los tres módulos. Se descarta: mismo criterio con el que SPEC 15 no factorizó un select común. Tres repeticiones de tres líneas cuestan menos que un helper que después hay que parametrizar por tabla y por alias.
- **Sí:** el `WHERE` se arma en el repositorio, con un `if` por filtro reasignando el query builder. Es donde vive la lógica en este proyecto y donde ya viven los validadores.
- **No:** armar el `WHERE` en el service o en el controller. Se descarta: los services son pass-through por convención y los controllers son delgados.
- **Sí:** `historial` **no** acepta `?usuario_id`. Es la decisión más importante del spec. SPEC 15 construyó ese endpoint sobre la garantía de que no hay dónde escribir el id de otro; un query param la destruiría en una línea, y sin `PermissionsGuard` no habría nada que la reemplazara.
- **Sí:** `byLote` **sí** acepta `?usuario_id`. No amplía nada: ese endpoint ya devuelve los pesajes de todos los operadores del lote a cualquier autenticado. Filtrar por uno solo quita filas.
- **Sí:** `?estado_calidad_id` con el id numérico, no `?estado_calidad=IDEAL`. **Decisión explícita del usuario.** Simetría con los otros filtros, que todos son ids, y se filtra por `pesajes.estado_calidad_id` sin depender del join. Contra asumido: no hay endpoint de catálogo para `estados_calidad`, así que el frontend tendrá que clavar los ids o pedirlos por otra vía.
- **No:** `?estado_calidad=IDEAL` por código, que es el criterio que `CLAUDE.md` pide para `etapas`. Se descarta por la simetría, aunque sería más portable entre entornos. Anotado en Risks.
- **Sí:** `?fuera_de_rango` recibe un **booleano** (`true` o `false`) y el **backend lo convierte a `tinyint`** (`1` o `0`) antes de comparar. **Decisión explícita del usuario.** El cliente habla en booleanos, que es lo que el campo significa; el `0`/`1` es un detalle de cómo MySQL guarda un `TINYINT(1)` y no tiene por qué asomar en la URL.
- **Sí:** la conversión vive en el `.transform()` del DTO de Zod, no en el repositorio. El repositorio recibe ya el `1` o el `0`. Es coherente con que las fechas también se validan en el DTO: la capa de datos no debe saber cómo viajó el valor por HTTP.
- **No:** aceptar además `0` y `1` como sinónimos de `false` y `true`. Se descarta: dos representaciones del mismo filtro es justo la ambigüedad que se quiere evitar, y aceptar el `1` filtraría la representación interna hacia la API. Consecuencia asumida y con criterio de aceptación propio: **`?fuera_de_rango=1` no filtra**, devuelve 200 sin aplicar el filtro, como cualquier otro valor inválido.
- **No:** aceptar `TRUE`, `yes`, `on` o el param a secas sin `=`. Se descarta: dos literales exactos en minúscula es un contrato que no admite discusión, y `?fuera_de_rango` sin valor llega como cadena vacía, no como `true`.
- **No:** que el repositorio reciba el booleano de JavaScript y haga el `Number(bool)` ahí. Se descarta: dejaría la conversión repartida entre dos capas y el `.where()` dependería del tipo que le llegue.
- **Sí:** `?nombre` busca **una sola columna por endpoint**. **Decisión explícita del usuario.** En `historial` es `lotes.nombre_lote`, que es lo que se pidió; en `byLote` es `usuarios.complete_name`, la única columna de texto con nombre que esa consulta tiene.
- **No:** `?nombre` buscando en `nombre_lote` OR `clientes.nombre` en `historial`. Se descarta: un `OR` sobre dos `LEFT JOIN` es más caro y no se puede indexar bien después.
- **No:** params separados `?nombre_lote`, `?nombre_cliente`, `?nombre_usuario`. Se descarta: `?nombre` único es más simple y cada endpoint documenta qué columna busca.
- **Sí:** la búsqueda es parcial, `LIKE '%valor%'`. Es lo que espera un buscador de pantalla.
- **No:** búsqueda exacta o `LIKE 'valor%'`. Se descarta: obligaría al usuario a saber cómo empieza el nombre.
- **No:** forzar la insensibilidad a mayúsculas con `LOWER()`. Se descarta: la collation `_ci` de MySQL ya lo hace y un `LOWER()` impediría usar cualquier índice sobre la columna.
- **No:** escapar `%` y `_` en el valor buscado. Se descarta en esta serie: son comodines útiles más que un problema, y nadie los escribe por accidente en un nombre de lote. Anotado en Risks.
- **Sí:** fechas en `YYYY-MM-DD` y `?hasta` **inclusivo** del día completo. **Decisión explícita del usuario.** Es lo que espera quien pone "hasta el 4" en un selector de fechas.
- **No:** ISO 8601 con hora y zona. Se descarta: obligaría al frontend a construir la fecha y abriría la conversión UTC ↔ hora del servidor, que hoy el proyecto no hace en ninguna parte.
- **No:** `?hasta` exclusivo. Se descarta: es más literal pero sorprende a todo el mundo.
- **Sí:** se compara contra `pesajes.created_at`, nunca contra `DATE(pesajes.created_at)`. Envolver la columna en una función impediría usar un futuro índice.
- **Sí:** un rango invertido devuelve `[]` con 200. No es un error, es un rango vacío.
- **Sí:** los joins siguen siendo `LEFT` y se asume que filtrar por una columna de la tabla unida excluye las filas huérfanas. Es SQL estándar y es lo correcto: si buscas por nombre de lote, un pesaje sin lote no debe aparecer.
- **No:** convertir los joins en `INNER` ahora que hay filtros. Se descarta: cambiaría el resultado de la llamada **sin** params, que es justo lo que este spec promete no tocar.
- **Sí:** sin paginación, sin `?limit`, sin `?order`. **Decisión explícita del usuario.** Se mantiene lo que SPEC 15 difirió. Un filtro reduce el volumen pero no le pone techo.
- **No:** aprovechar que ya hay query params para meter `?page` y `?limit` "ya que estamos". Se descarta: la forma de la respuesta paginada es una decisión que afecta a los diez `GET` del proyecto y merece su propio spec.
- **Sí:** la respuesta no cambia de forma ni gana metadatos. Sin `total`, sin `filtros_aplicados`. Cualquiera de los dos convertiría este spec en el que define la respuesta paginada.
- **Sí:** ninguna fila nueva en `catalogo_permisos` ni en `permisos`. Séptima excepción consecutiva a la regla de SPEC 06. Estos endpoints ya eran accesibles para cualquier autenticado; un filtro no cambia quién puede llamarlos.
- **No:** índices en MySQL sobre `pesajes.usuario_id`, `pesajes.estado_calidad_id` ni `pesajes.created_at`. Se descarta en este spec por la regla de no aplicar DDL que no haga falta todavía. Anotado en Risks.
- **Sí:** el orden de implementación es SPEC 16 → 17 → 18, y los otros dos citan esta convención en vez de repetirla. **Decisión explícita del usuario.**

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **Un param inválido se ignora en silencio.** Un `?producto_id=abc` por un typo del frontend devuelve una lista que parece filtrada y no lo está, y nadie se entera. Es el riesgo principal del spec y lo hereda toda la serie. | **Sin mitigar por decisión explícita del usuario.** Se acepta porque el peor caso es devolver de más en un listado, contra romper una pantalla entera con un 400. Hay diez criterios de aceptación que fijan el 200 como esperado para que nadie lo lea como un bug. |
| Alguien agrega después un `?usuario_id` a `FiltrosHistorialDto` "por simetría con `byLote`" y rompe la garantía central de SPEC 15 sin darse cuenta. | Mitigado con tres criterios de aceptación explícitos, una decisión razonada y una nota en `CLAUDE.md`. Es la línea que no se cruza en este módulo. |
| **Ningún filtro tiene índice detrás.** `?nombre` hace `LIKE '%v%'`, que no puede usar índice ni aunque existiera, y los demás escanean. Con la tabla creciendo, filtrar es más caro que no filtrar. | Sin mitigar: no se aplica DDL. Anotado que `CREATE INDEX` sobre `pesajes.usuario_id`, `pesajes.estado_calidad_id` y `pesajes.created_at` es la primera medida si se pone lento, y que no cambia una línea de código. El `LIKE '%v%'` no tiene arreglo por índice: eso sería *full-text search*, otro spec. |
| **La respuesta devuelve `fuera_de_rango` como `0` / `1`, pero el filtro solo acepta `true` / `false`.** Quien lea una fila y copie el valor a la URL escribirá `?fuera_de_rango=1`, que se ignora en silencio y devuelve la lista entera pareciendo filtrada. Es el caso más probable de tropiezo del spec. | Asumido por decisión explícita: la alternativa era aceptar los cuatro literales y filtrar la representación interna hacia la API. Mitigado con cuatro criterios de aceptación que fijan el `1` como no válido, una subsección propia en la convención y el paso 23, que lo escribe en `CLAUDE.md`. Unificar el tipo de la respuesta a booleano es otro spec: cambiaría los campos, que es lo que esta serie no toca. |
| `%` y `_` en el valor de `?nombre` funcionan como comodines. Buscar `LOTE_1` encuentra `LOTE-1`. | Sin mitigar por decisión. No es una inyección —Kysely parametriza el valor— solo un comodín inesperado. Escaparlos es una línea si algún día molesta. |
| `?estado_calidad_id` usa ids que difieren entre entornos, que es justo el criterio que `CLAUDE.md` pide evitar para `etapas`. Un frontend que clave `1 = IDEAL` se rompe en otro entorno. | Asumido por la simetría con los otros filtros. Anotado que no hay `GET /catalogos/estados-calidad` y que agregarlo sería el arreglo natural — es un spec de una línea de scope, no este. |
| **Sin paginación**, un filtro amplio sobre un historial grande sigue devolviendo todo. Este spec reduce el problema de SPEC 15 pero no lo resuelve. | Sin mitigar por decisión. Un filtro es una mitigación *parcial*: quien tenga miles de pesajes puede acotar por fecha, pero nada le obliga a hacerlo. |
| Filtrar por una columna de una tabla unida con `LEFT JOIN` excluye las filas huérfanas, y eso hace que `?cliente_id` y `?nombre` cambien el conjunto base de `historial` de una forma que no es evidente leyendo el código. | Documentado en una tabla propia del modelo de datos, con dos criterios de aceptación. Es comportamiento estándar de SQL, no un caso especial. |
| SPEC 17 y SPEC 18 dependen de este documento. Si se implementan primero, o si alguien cambia la convención aquí después de implementarlos, los tres divergen. | El orden 16 → 17 → 18 está en Decisions y en el `Depends on` de los otros dos. Un criterio de aceptación de cada uno verifica que los params se comportan igual en los tres módulos. |
| Séptima excepción consecutiva a la regla de sembrar permisos. El futuro `PermissionsGuard` encuentra otro endpoint sin código que exigir. | Queda registrado. Aquí el argumento es el más débil de las siete: no es que el permiso no se le negaría a nadie, es que el endpoint filtrado ya era accesible sin filtrar. Si algún día se exige un permiso, se exige al endpoint entero, no al param. |

---

## What is **not** in this spec

- Un `?usuario_id` en `GET /pesajes/historial`, ni ninguna otra forma de leer el historial ajeno.
- Un `GET /pesajes/usuario/:usuarioId` ni un `GET /pesajes` global.
- Paginación, `?page`, `?limit`, `?offset`, `?order`, `?sort`, ni un `total` en la respuesta.
- Filtros por rango de peso, por dispositivo o por secuencia de dispositivo.
- Un `?incluirRechazados`: `isActive = 1` sigue clavado y los pesajes rechazados siguen sin listarse en ninguna parte.
- Filtrar el estado de calidad por su código de texto.
- Búsqueda multi-columna, búsqueda exacta, o escapar los comodines de `LIKE`.
- Aceptar `?fuera_de_rango=1` / `=0`, ni cambiar el `fuera_de_rango` de la respuesta a booleano.
- Cualquier DDL: ni columnas, ni tablas, ni índices, ni FK.
- Cambios a `src/database/types/types.ts`.
- Cambios a los campos o a la forma de la respuesta de los dos endpoints.
- Cambios a `POST /pesajes` y a `PATCH /pesajes/:id/rechazar`.
- Filtros en `clientes` (SPEC 17) y en `lotes` (SPEC 18).
- Un helper de filtros compartido entre módulos.
- Sembrar filas en `catalogo_permisos` o en `permisos`, ni aplicar permisos.
- Un `GET /catalogos/estados-calidad`.

Cada uno de estos, si se necesita, va en su propio spec.
