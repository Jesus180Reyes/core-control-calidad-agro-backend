# catalogos module

Specs: 09, 39, 40, 43, 47. Seven read-only selector lists. `CatalogosRepository` is plain `SELECT`s: no validation, no transaction, no input.

- **Response shape:** `{ ok, msg, data }`, every element exactly `{ id, nombre }`. `data` instead of a named key is a recorded decision so all seven share one shape — if it is ever unified with the rest of the API, unify every `GET` in one spec.
- **Access:** open to any authenticated user, no `cliente_operador` filter, no params, no pagination, no permission row — on purpose: every user needs these lists to fill the forms they are already allowed to use.

| Route | Filter / order | Notes |
| --- | --- | --- |
| `GET /catalogos/productos` | `isActive = 1`, `nombre` ASC | |
| `GET /catalogos/usuarios` | `isActive = 1`, `complete_name` ASC | `complete_name as nombre`; **every** active user, `ADMIN` accounts included, no role filter. Left unchanged by spec 39 on purpose |
| `GET /catalogos/unidades-medida` | unfiltered (no `isActive` column), `nombre` ASC | table key in `Database` is `unidades_medida` (plural) |
| `GET /catalogos/operadores` (spec 39) | same as `usuarios` plus `INNER JOIN roles` with `roles.nombre = 'OPERADOR'` (literal) | for selectors like `usuario_ids` of `POST /clientes` and `?usuario_id` filters. If the role row is named differently, answers `data: []` — fails closed. `POST /clientes` still does not validate the role of its `usuario_ids`. `GET /clientes/:id/operadores` uses the same filter |
| `GET /catalogos/estados-calidad` (spec 40) | every row (no `isActive`), **`id` ASC** | `codigo` is not returned, by decision. Same order as `por_estado_calidad` in `GET /metricas/calidad`. Feeds the `?estado_calidad_id` filters so the front stops hardcoding ids |
| `GET /catalogos/origenes` (spec 43) | `isActive = 1`, `nombre` ASC | the selector of `origen_id` in `POST /lotes`. Global catalogue, so it lists every client's suppliers; `direccion`/`telefono` are returned by no read |
| `GET /catalogos/destinos` (spec 47) | `isActive = 1`, `nombre` ASC | the selector of the mandatory `destino_id` in `PATCH /pesajes/:id/rechazar/byApprover`. No active rows → `data: []`, and the approver cannot reject anything |

There is no CRUD on any catalog table (`productos`, `unidades_medida`, `estados_calidad`, `destinos`); they are maintained by hand. `origenes` is the exception, with `POST /origenes`.
