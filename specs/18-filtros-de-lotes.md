# SPEC 18 — Filtros de consulta en los GET de lotes

> **Status:** Draft
> **Depends on:** SPEC 02, SPEC 12, SPEC 13, SPEC 16
> **Date:** 2026-09-04
> **Objective:** Agregar siete query params opcionales — `estado`, `nombre`, `producto_id`, `unidad_medida_id`, `etapa_id`, `desde` y `hasta` — a `GET /lotes/cliente/:clienteId` y a `GET /lotes/cliente/:clienteId/all`, siguiendo la convención de filtros que define SPEC 16.

---

## Why this spec exists

Es el tercero y último de los specs de filtros. **La convención completa —nombres de params, coerción, semántica AND, qué pasa con un valor inválido, formato de fecha, `LIKE` parcial— está en `specs/16-filtros-de-pesajes.md` y no se repite aquí.** Se implementa **después** de SPEC 16 y de SPEC 17.

Y es el que más consecuencias tiene de los tres, porque rompe a propósito la regla que los otros dos respetan.

**`?estado=cerrado` amplía el resultado. Es la única excepción de la serie y hay que leerla con cuidado.** Los dos `GET` de lotes clavan hoy `estado = 'abierto'` en código. Desde SPEC 12 y SPEC 13, un lote rechazado y un lote aprobado son los dos `'cerrado'`, y ninguno de los dos aparece en ningún endpoint del proyecto: quedan inalcanzables por API en cuanto un supervisor los cierra. Este spec los saca a la luz por primera vez, y eso trae cuatro cosas encima.

1. **Sin el param, nada cambia.** El default es `'abierto'` y la respuesta sin params es byte a byte la de hoy. La ampliación es opt-in.
2. **`'cerrado'` no distingue rechazo de aprobación.** Es la ambigüedad que SPEC 13 dejó documentada y este spec no la resuelve: `estado` y `cerrado_en` son inútiles como discriminador. Lo que sí sirve es el campo `etapa`, que la respuesta **ya devuelve** — un lote rechazado trae `RECHAZADO` y uno aprobado `CLIENTE FINAL`. Y `?etapa_id` permite pedir uno de los dos. La respuesta sigue sin traer `motivo_rechazo` ni `aprobado_por`, así que no se puede ver *por qué* ni *quién*, solo *cuál*.
3. **`GET /lotes/cliente/:clienteId/all` no valida `cliente_operador`.** Es una de las nueve rutas que se saltan el vínculo, y desde este spec un operador cualquiera puede además listar los lotes **cerrados** de un cliente que no es suyo. La superficie que ese endpoint abre crece; no se cierra aquí, porque cerrarla es el `PermissionsGuard`.
4. **El nombre del endpoint `/all` deja de ser tan mentira.** `CLAUDE.md` advierte que "pese al nombre no es *todos* los lotes: filtra `estado = 'abierto'` igual que el otro". Con `?estado=cerrado` ya se pueden pedir los otros. Sigue sin haber forma de pedir abiertos y cerrados **a la vez** — no hay `?estado=todos`, por decisión.

Lo demás del spec es rutina: seis filtros más que solo quitan filas.

---

## Scope

**In:**

- Nuevo `src/modules/lotes/dto/filtros-lotes.dto.ts`, con la clase `FiltrosLotesDto`.
- `GET /lotes/cliente/:clienteId` acepta siete query params opcionales: `estado`, `nombre`, `producto_id`, `unidad_medida_id`, `etapa_id`, `desde`, `hasta`.
- `GET /lotes/cliente/:clienteId/all` acepta **los mismos siete**, con el mismo comportamiento.
- Un único DTO compartido por los dos handlers, porque los filtros son idénticos.
- `?estado` acepta exactamente dos literales, `abierto` y `cerrado`, y **su default es `abierto`**. Cualquier otro valor cae al default.
- El `where('lotes.estado', '=', 'abierto')` clavado en las dos consultas pasa a usar el valor del param.
- `getLotesByCliente` pasa a recibir `(clienteId, usuarioId, filtros)` y sigue llamando a `validateVinculoOperador` **antes** de consultar.
- `getAllLotesByCliente` pasa a recibir `(clienteId, filtros)` y sigue **sin** validar el vínculo, como hoy.
- Los dos métodos del service (`findAllByCliente`, `findAllLotesByCliente`) propagan el objeto de filtros sin tocarlo.
- **Sin DDL**, **sin cambios en `src/database/types/types.ts`**, **sin cambios en los diez campos de la respuesta**.
- Actualizar `CLAUDE.md`: la fila `lotes` de la tabla de endpoints, la nota de que los lotes cerrados ya se pueden listar, y la tabla discriminadora de `estado = 'cerrado'`, que gana un uso práctico.

**Out of scope (for future specs):**

- Un `?estado=todos` que mezcle abiertos y cerrados en una respuesta.
- Devolver `motivo_rechazo`, `rechazado_por`, `rechazado_en`, `aprobado_por`, `aprobado_en` o `cerrado_en` en la respuesta. Los diez campos no cambian, así que un lote cerrado se puede listar pero no se puede saber por qué ni quién lo cerró.
- Un `?rechazado=1` o `?aprobado=1` que filtre por `motivo_rechazo IS NOT NULL` / `aprobado_por IS NOT NULL`. Se hace con `?etapa_id`; ver Decisions.
- Un `GET /catalogos/etapas` que dé al frontend los ids de etapa. Ver Risks.
- Filtrar por el código de la etapa (`?etapa=RECHAZADO`) en vez de por su id.
- Un `GET /lotes/:id` para un lote suelto, ni un `GET /lotes` global sin cliente.
- Cerrar el hueco de acceso de `GET /lotes/cliente/:clienteId/all`, que sigue sin validar `cliente_operador`. Eso es el `PermissionsGuard`.
- Filtros por rango de peso (`?peso_min`, `?peso_max`) ni por `variedad_o_talla`.
- Paginación, `?page`, `?limit`, `?order`, `?sort`, ni un `total` en la respuesta. El orden sigue clavado en `created_at` DESC.
- Filtros en `pesajes` (SPEC 16) y en `clientes` (SPEC 17).
- Cambios a `POST /lotes`, `PATCH /lotes/:id/rechazar` y `PATCH /lotes/:id/aprobar`.
- Sembrar filas en `catalogo_permisos` o en `permisos`, ni aplicar permisos.

---

## Data model

**Este spec no introduce datos nuevos.** No hay DDL y `src/database/types/types.ts` no se toca. `lotes.estado`, `lotes.etapa_id`, `lotes.producto_id`, `lotes.unidad_medida_id`, `lotes.nombre_lote` y `lotes.created_at` ya están declaradas y ya se usan en las dos consultas.

### El DTO

`src/modules/lotes/dto/filtros-lotes.dto.ts`:

```ts
const filtrosLotesSchema = z.object({
  estado:           /* enum cerrado: 'abierto' | 'cerrado', default 'abierto' */,
  nombre:           /* texto parcial */,
  producto_id:      /* id numérico */,
  unidad_medida_id: /* id numérico */,
  etapa_id:         /* id numérico */,
  desde:            /* fecha YYYY-MM-DD */,
  hasta:            /* fecha YYYY-MM-DD */,
});

export class FiltrosLotesDto extends createZodDto(filtrosLotesSchema) { }
```

Las formas exactas están en la tabla de coerción de SPEC 16. Los seis últimos llevan `.optional().catch(undefined)`.

**`estado` es el único distinto de toda la serie**: en vez de `.optional().catch(undefined)` lleva `.default('abierto').catch('abierto')`, así que **nunca** es `undefined` y el repositorio siempre lo aplica. Ausente, vacío o inválido, valen todos `'abierto'`.

### Los siete filtros

| Param | Columna | Comparación | Nota |
| --- | --- | --- | --- |
| `estado` | `lotes.estado` | `=` | `'abierto'` o `'cerrado'`. **Default `'abierto'`. Siempre se aplica.** |
| `nombre` | `lotes.nombre_lote` | `LIKE '%v%'` | Buscador de pantalla. Parcial. |
| `producto_id` | `lotes.producto_id` | `=` | Columna de `lotes`, no `productos.id`. |
| `unidad_medida_id` | `lotes.unidad_medida_id` | `=` | Columna de `lotes`, no `unidades_medida.id`. |
| `etapa_id` | `lotes.etapa_id` | `=` | Columna de `lotes`, no `etapas.id`. Es lo que distingue un cerrado-rechazado de un cerrado-aprobado. |
| `desde` | `lotes.created_at` | `>=` | |
| `hasta` | `lotes.created_at` | `<` día siguiente | Inclusivo del día completo. |

### Lo que sigue siempre aplicado

| Endpoint | Fijo | Orden fijo |
| --- | --- | --- |
| `GET /lotes/cliente/:clienteId` | `validateVinculoOperador(clienteId, userId)` **antes** de consultar, y `lotes.cliente_id = :clienteId` | `lotes.created_at` DESC |
| `GET /lotes/cliente/:clienteId/all` | `lotes.cliente_id = :clienteId` — **sin** validar el vínculo, como hoy | `lotes.created_at` DESC |

**Ningún filtro puede levantar el `cliente_id` ni la validación del vínculo.** El único `WHERE` fijo que este spec vuelve variable es el `estado`.

### La tabla de estados, y qué se puede saber de un lote cerrado

Es la parte del spec que hay que leer entera antes de tocar nada.

| Lo que se pide | Lo que devuelve |
| --- | --- |
| sin `?estado` | los lotes **abiertos**. Idéntico a hoy. |
| `?estado=abierto` | lo mismo, explícito. |
| `?estado=cerrado` | los lotes **cerrados: rechazados y aprobados mezclados**. Primera vez que la API los lista. |
| `?estado=cerrado&etapa_id=<RECHAZADO>` | solo los **rechazados**. |
| `?estado=cerrado&etapa_id=<CLIENTE_FINAL>` | solo los **aprobados**. |
| `?estado=basura` | los **abiertos**. El valor inválido cae al default. |
| abiertos y cerrados juntos | **imposible.** No hay `?estado=todos`. Hay que hacer dos llamadas. |

De un lote cerrado que aparece en el listado se puede saber, con los diez campos que ya devuelve la respuesta:

| Se puede ver | No se puede ver |
| --- | --- |
| `estado: 'cerrado'` | por qué se cerró (`motivo_rechazo`) |
| `etapa: 'RECHAZADO'` o `'CLIENTE FINAL'` — **el único discriminador visible** | quién lo cerró (`rechazado_por` / `aprobado_por`) |
| su nombre, producto, unidad y los tres pesos | cuándo se cerró (`cerrado_en` / `rechazado_en` / `aprobado_en`) |

Los ids de `etapas` **difieren entre entornos** —`CLAUDE.md` lo advierte y por eso los dos `PATCH` resuelven por `codigo`—, así que `?etapa_id` obliga a saber el id del entorno en el que se está. Es el riesgo principal de este filtro y está en Risks.

### Peticiones y respuestas

```
GET /lotes/cliente/4?nombre=LOTE-00&producto_id=2
GET /lotes/cliente/4?estado=cerrado
GET /lotes/cliente/4?estado=cerrado&etapa_id=3
GET /lotes/cliente/4/all?desde=2026-09-01&hasta=2026-09-04
```

La respuesta mantiene exactamente la forma de siempre:

```json
{ "ok": true, "msg": "Lotes obtenidos correctamente", "lotes": [ /* ... */ ] }
```

| Caso | Respuesta |
| --- | --- |
| Sin header `Authorization` | 401 del `JwtAuthGuard` |
| `:clienteId` no numérico | 400 del `ParseIntPipe` — **ya existía** |
| El llamante no está vinculado al cliente, en `GET /lotes/cliente/:clienteId` | 403 de `validateVinculoOperador` — **ya existía** |
| Cualquier query param inválido, vacío o desconocido | **200**, con ese filtro sin aplicar (o con `estado` en su default) |
| Ningún resultado tras filtrar | **200 con `[]`** |

**Ningún query param puede producir un 400.** Los 400 y 403 posibles de estos endpoints son los que ya tenían.

---

## Implementation plan

1. Confirmar que SPEC 16 y SPEC 17 ya están implementados y que sus criterios de aceptación pasan.
2. Confirmar contra MySQL que hay datos para probar los dos estados: `SELECT id, cliente_id, nombre_lote, estado, etapa_id, motivo_rechazo, aprobado_por FROM lotes ORDER BY cliente_id;`. Hace falta un cliente con al menos un lote abierto, uno **rechazado** y uno **aprobado**. Si no los hay, crearlos con `POST /lotes` y cerrarlos con `PATCH /lotes/:id/rechazar` y `PATCH /lotes/:id/aprobar`.
3. Anotar los ids de etapa del entorno: `SELECT id, codigo, nombre FROM etapas;`. Se necesitan el de `RECHAZADO` y el de `CLIENTE_FINAL` para probar `?etapa_id`.
4. Anotar la respuesta actual de los dos endpoints **sin params**, para compararlas al final.
5. Crear `src/modules/lotes/dto/filtros-lotes.dto.ts` con sus siete campos. Los seis con `.optional().catch(undefined)`; `estado` con `.default('abierto').catch('abierto')`. Confirmar que compila (`npm run build`).
6. Cambiar la firma de `getLotesByCliente` a `(clienteId: number, usuarioId: number, filtros: FiltrosLotesDto)`. Dejar la llamada a `validateVinculoOperador` **como primera línea del método**, antes de tocar la consulta. Reescribir el cuerpo con `let query = ...`, un `if` por filtro opcional y el `estado` siempre aplicado, dejando `cliente_id` y el `orderBy` fijos.
7. Cambiar la firma de `getAllLotesByCliente` a `(clienteId: number, filtros: FiltrosLotesDto)` y hacer lo mismo. **No** agregarle la validación del vínculo: este spec no cambia el acceso de esa ruta.
8. Propagar el parámetro en `LotesService`: `findAllByCliente(clienteId, userId, filtros)` y `findAllLotesByCliente(clienteId, filtros)`.
9. Agregar `@Query() filtros: FiltrosLotesDto` a los dos handlers. **No cambiar el orden de declaración**: `cliente/:clienteId` y `cliente/:clienteId/all` siguen antes que los `@Patch(':id/...')`.
10. Levantar con `npm run start:dev` y confirmar que las cinco rutas de `lotes` siguen apareciendo en el log de Nest, sin rutas nuevas.
11. Verificación de no regresión, la más importante de este spec: llamar a los dos endpoints **sin ningún query param** y confirmar que la respuesta es idéntica a la del paso 4 — mismos diez campos, mismas filas, orden `created_at` DESC, **y ningún lote cerrado en la lista**.
12. Verificación de `?estado=abierto`: idéntico al paso 11.
13. Verificación de `?estado=cerrado`: confirmar que aparecen el lote rechazado y el aprobado, que **ninguno** de los abiertos aparece, y que cada uno trae `estado: 'cerrado'` con su `etapa` distinta (`RECHAZADO` contra `CLIENTE FINAL`). Repetir en los dos endpoints.
14. Verificación de `?estado=cerrado&etapa_id=<RECHAZADO>`: solo el rechazado. Con `<CLIENTE_FINAL>`: solo el aprobado. Las dos cuentas suman la del paso 13.
15. Verificación de que la respuesta **no** filtró información de cierre: confirmar que los lotes cerrados siguen sin traer `motivo_rechazo`, `aprobado_por`, `cerrado_en` ni ninguna columna de auditoría. Solo diez campos.
16. Verificación de `?estado` inválido: `?estado=basura`, `?estado=todos`, `?estado=CERRADO` (mayúsculas), `?estado=` y `?estado=1` devuelven **los abiertos**, con 200 y sin error. Es el default, no un fallo.
17. Verificación de `?nombre`: con un fragmento compartido por dos lotes del cliente, confirmar coincidencia parcial e insensible a mayúsculas. Confirmar que combinado con `?estado=cerrado` busca solo entre los cerrados.
18. Verificación de `?producto_id` y `?unidad_medida_id`: cada uno acota, y los campos `producto` y `unidad_medida` de la respuesta lo confirman.
19. Verificación de fechas: `?desde` con la fecha del lote más antiguo devuelve todo; `?hasta` con la del más reciente lo incluye (límite inclusivo); un `?hasta` un día antes lo excluye; un rango invertido devuelve `[]` sin error.
20. Verificación de la combinación: cuatro filtros a la vez devuelven la intersección.
21. Verificación de los inválidos: confirmar **200 y sin filtrar** en `?producto_id=abc`, `?etapa_id=-1`, `?unidad_medida_id=`, `?nombre=`, `?desde=ayer`, `?hasta=01/09/2026` y `?foo=bar`. **Ninguno puede responder 400.**
22. Verificación de que el vínculo sigue siendo la frontera de `GET /lotes/cliente/:clienteId`: con el token de un operador **no vinculado** al cliente, confirmar **403**, con y sin filtros, y en particular con `?estado=cerrado`. Ningún param debe convertir ese 403 en un 200.
23. Verificación de que `GET /lotes/cliente/:clienteId/all` sigue **sin** validar el vínculo: con ese mismo token no vinculado, confirmar **200**, tanto sin params como con `?estado=cerrado`. Este spec **no** cierra ese hueco y esa es la ampliación que asume.
24. Verificación de que nada más cambió: `POST /lotes`, `PATCH /lotes/:id/rechazar`, `PATCH /lotes/:id/aprobar`, los dos `GET /pesajes*` con sus filtros, los dos `GET /clientes*` (con filtros el `/all`, sin ninguno el otro), `GET /permisos/me` y los tres `GET /catalogos/*` responden igual.
25. Confirmar que `permisos` sigue con **14 filas** y `catalogo_permisos` con **9**.
26. Actualizar `CLAUDE.md`: agregar los siete query params a los dos `GET` de la fila `lotes`; corregir la nota que dice que el `/all` "pese al nombre filtra `estado = 'abierto'` igual que el otro", que deja de ser cierta con `?estado=cerrado`; anotar que **los lotes cerrados ya se pueden listar por API por primera vez desde SPEC 12 y SPEC 13**, que `etapa` es el único discriminador visible entre rechazado y aprobado, y que la respuesta sigue sin traer las columnas de auditoría del cierre; y anotar que sigue sin haber `GET /catalogos/etapas`, así que `?etapa_id` obliga a conocer los ids del entorno.

---

## Acceptance criteria

- [ ] SPEC 16 y SPEC 17 están implementados antes que este spec.
- [ ] No se ejecutó ningún DDL: `DESCRIBE lotes;` muestra exactamente las mismas columnas que antes.
- [ ] `src/database/types/types.ts` **no cambió**.
- [ ] No se creó ningún módulo, controller, service ni repositorio nuevo: solo se modificaron `lotes.controller.ts`, `lotes.service.ts` y `repository/lotes.repository.ts`.
- [ ] `src/modules/lotes/dto/` tiene exactamente tres archivos: `create-lote.dto.ts`, `rechazar-lote.dto.ts` y `filtros-lotes.dto.ts`.
- [ ] Hay **un solo** DTO de filtros, compartido por los dos handlers.
- [ ] No se creó ningún helper de filtros compartido entre módulos.
- [ ] `src/app.module.ts` no cambió y la app arranca sin errores de compilación.
- [ ] El log de rutas de Nest muestra las mismas cinco rutas de `lotes` que antes: **ninguna ruta nueva**.
- [ ] Los dos endpoints aceptan exactamente los **mismos siete** params: `estado`, `nombre`, `producto_id`, `unidad_medida_id`, `etapa_id`, `desde`, `hasta`.
- [ ] `GET /lotes/cliente/:clienteId` **sin ningún query param** devuelve exactamente la misma respuesta que antes: mismos diez campos, mismas filas, orden `created_at` DESC, y **ningún lote cerrado**.
- [ ] `GET /lotes/cliente/:clienteId/all` **sin ningún query param** devuelve exactamente la misma respuesta que antes, también sin ningún lote cerrado.
- [ ] La respuesta sigue siendo `{ ok, msg, lotes }`: no se agregó `total`, ni `filtros`, ni `data`.
- [ ] `?estado=abierto` devuelve exactamente lo mismo que no mandar el param.
- [ ] `?estado=cerrado` devuelve los lotes **rechazados y aprobados** del cliente, y **ningún abierto**. Verificado en los dos endpoints. **Es el comportamiento esperado de este spec, y es la primera vez que la API lista un lote cerrado.**
- [ ] Un lote rechazado devuelto por `?estado=cerrado` trae `estado: 'cerrado'` y `etapa: 'RECHAZADO'`.
- [ ] Un lote aprobado devuelto por `?estado=cerrado` trae `estado: 'cerrado'` y `etapa: 'CLIENTE FINAL'`.
- [ ] `?estado=cerrado&etapa_id=<id de RECHAZADO>` devuelve **solo** los rechazados, y con `<id de CLIENTE_FINAL>` **solo** los aprobados. Las dos cuentas suman la de `?estado=cerrado` a secas.
- [ ] La respuesta de un lote cerrado **no** incluye `motivo_rechazo`, `rechazado_por`, `rechazado_en`, `aprobado_por`, `aprobado_en` ni `cerrado_en`: siguen siendo diez campos.
- [ ] No existe forma de pedir abiertos y cerrados en una sola respuesta: `?estado=todos` devuelve los abiertos.
- [ ] `?estado=basura`, `?estado=CERRADO`, `?estado=1` y `?estado=` devuelven **los abiertos**, con 200: el valor inválido cae al default.
- [ ] `?nombre=<fragmento>` filtra por `lotes.nombre_lote` con coincidencia **parcial**, en los dos endpoints, y se combina con `?estado`.
- [ ] `?producto_id=N` y `?unidad_medida_id=N` acotan el resultado, y los campos `producto` y `unidad_medida` de cada fila lo confirman.
- [ ] `?etapa_id=N` acota el resultado y el campo `etapa` de cada fila lo confirma.
- [ ] `?desde=YYYY-MM-DD` excluye los lotes creados antes de ese día.
- [ ] `?hasta=YYYY-MM-DD` **incluye los lotes creados ese mismo día completo**. Es el límite inclusivo.
- [ ] Un rango de fechas invertido devuelve `[]` con 200, no un error.
- [ ] Varios filtros a la vez se combinan con **AND**.
- [ ] `?producto_id=abc`, `?etapa_id=-1`, `?unidad_medida_id=0`, `?unidad_medida_id=`, `?nombre=`, `?desde=ayer`, `?hasta=01/09/2026` y `?foo=bar` responden **200** sin filtrar por ese param.
- [ ] **Ningún query param, con ningún valor, produce un 400.** Los únicos 400 y 403 siguen siendo los que ya existían: el `ParseIntPipe` de `:clienteId` y el `validateVinculoOperador`.
- [ ] `GET /lotes/cliente/:clienteId` con el token de un operador **no vinculado** responde **403**, con params y sin ellos, y en particular con `?estado=cerrado`. **Ningún filtro convierte ese 403 en un 200.**
- [ ] `validateVinculoOperador` sigue siendo la primera línea de `getLotesByCliente`, antes de armar la consulta.
- [ ] `GET /lotes/cliente/:clienteId/all` sigue **sin** validar el vínculo: con ese mismo token no vinculado responde 200, también con `?estado=cerrado`. Este spec **no** cierra ese hueco y la ampliación está asumida.
- [ ] `lotes.cliente_id = :clienteId` sigue siempre aplicado en los dos: ningún filtro trae lotes de otro cliente.
- [ ] Ninguna de las dos consultas abre transacción: siguen siendo un único `SELECT` (más la validación del vínculo en la primera).
- [ ] Los joins siguen siendo `LEFT` en las dos consultas: ninguno se convirtió en `INNER`.
- [ ] Los siete validadores privados de `LotesRepository`, `resolveEtapa` y `resolveEtapaRechazado` no se modificaron.
- [ ] `createLote`, `rechazarLote` y `aprobarLote` no cambiaron. En particular, `createLote` sigue insertando `estado: 'abierto'` y su `etapa_id: 1` literal.
- [ ] No hay `?page`, `?limit`, `?offset`, `?order` ni `?sort`, y el orden sigue siendo `lotes.created_at` DESC.
- [ ] `permisos` sigue con exactamente **14 filas** y `catalogo_permisos` con **9**.
- [ ] `GET /permisos/me` devuelve los mismos códigos que antes y el payload del JWT no cambió.
- [ ] Los dos `GET /pesajes*` con sus filtros de SPEC 16, `GET /clientes/all` con los suyos de SPEC 17, `GET /clientes` sin ninguno, los cuatro `PATCH`, `POST /lotes`, `POST /clientes`, `POST /pesajes`, `POST /auth/login`, `POST /auth/register` y los tres `GET /catalogos/*` siguen funcionando igual.
- [ ] Los params se comportan **igual que en SPEC 16 y SPEC 17**: mismo `.catch()`, mismo `LIKE '%v%'` parcial, misma semántica AND, mismo 200 ante un valor inválido, mismo formato y semántica de fechas.
- [ ] `CLAUDE.md` documenta los siete params, dice que los lotes cerrados ya se pueden listar, que `etapa` es el único discriminador visible entre rechazado y aprobado, y corrige la nota sobre el nombre de `/all`.

---

## Decisions

- **Sí:** `?estado` con dos literales, `abierto` y `cerrado`, y default `abierto`. **Decisión explícita del usuario.** Sin el param, la respuesta es la de hoy; con `?estado=cerrado` los lotes cerrados se listan por primera vez desde SPEC 12 y SPEC 13.
- **No:** dejar `estado = 'abierto'` clavado y no dar ningún `?estado`. Se descarta: es la opción que no amplía nada, pero dejaría los lotes rechazados y aprobados permanentemente inalcanzables por API, que es un agujero que las dos specs de cierre ya dejaron anotado.
- **No:** un `?estado=todos` que mezcle abiertos y cerrados. Se descarta: `'cerrado'` no distingue rechazo de aprobación, así que una lista mezclada de tres cosas distintas bajo dos valores de `estado` confunde más de lo que sirve. Quien necesite las dos, hace dos llamadas.
- **Sí:** un valor inválido de `?estado` cae al default `'abierto'`. **Decisión explícita del usuario.** Es la opción segura: un typo del frontend nunca destapa lotes cerrados sin querer.
- **No:** un valor inválido que quite el filtro de estado y devuelva todo. Se descarta por lo mismo: un typo no debe ampliar la respuesta.
- **Sí:** `estado` es el único campo de los tres specs que lleva `.default(...).catch(...)` en vez de `.optional().catch(undefined)`. Es lo que hace que **siempre** se aplique un filtro de estado y nunca haya una respuesta mezclada.
- **Sí:** distinguir rechazado de aprobado se hace con `?etapa_id`. Es el discriminador que la respuesta **ya devuelve** en su campo `etapa`, así que filtro y resultado son coherentes sin agregar campos.
- **No:** un `?rechazado=1` / `?aprobado=1` que filtre por `motivo_rechazo IS NOT NULL` y `aprobado_por IS NOT NULL`, que son los discriminadores canónicos según `CLAUDE.md`. Se descarta pese a ser más robusto que la etapa: obligaría a devolver esas columnas para que el resultado se pudiera verificar, y eso cambia la respuesta. `?etapa_id` filtra por algo que el usuario ya ve.
- **No:** devolver `motivo_rechazo`, `aprobado_por` o `cerrado_en` junto a los lotes cerrados. Se descarta: cambiaría los diez campos de la respuesta, que es lo único que los tres specs prometen no tocar. Es un spec de campos, no de filtros. La consecuencia asumida es que se puede listar un lote cerrado sin poder saber por qué ni quién lo cerró.
- **Sí:** `?etapa_id` con el id numérico, por simetría con los demás filtros. Contra asumido y anotado en Risks: los ids de `etapas` **difieren entre entornos**, que es justo el criterio que `CLAUDE.md` pide evitar, y no hay `GET /catalogos/etapas` que los dé.
- **No:** `?etapa=RECHAZADO` por código, que sería más portable y coherente con cómo los dos `PATCH` resuelven la etapa. Se descarta por la simetría con SPEC 16, que ya eligió el id para `?estado_calidad_id`. Los dos specs eligen igual; si algún día se cambia, se cambian los dos.
- **No:** un `GET /catalogos/etapas`. Se descarta de este spec: es un endpoint nuevo, no un filtro, y va con el de `estados_calidad` que SPEC 16 también dejó pendiente. Anotado en Risks porque sin él `?etapa_id` es incómodo de usar.
- **Sí:** los dos endpoints reciben **los mismos siete filtros**. **Decisión explícita del usuario.** La única diferencia entre el par sigue siendo `validateVinculoOperador`. Nótese que aquí el par **no** se resuelve como en SPEC 17: allí el usuario decidió darle filtros solo a `GET /clientes/all` y dejar `GET /clientes` sin ninguno. Los dos módulos deciden distinto a propósito; si algún día se unifica el criterio, es un spec propio.
- **Sí:** `getAllLotesByCliente` sigue **sin** validar el vínculo. Se deja como está: cambiar el acceso de esa ruta no es lo que se pidió y sería un cambio de comportamiento escondido en un spec de filtros. La consecuencia —que un operador cualquiera pueda listar los lotes cerrados de un cliente ajeno— está asumida y en Risks.
- **No:** aprovechar este spec para agregarle `validateVinculoOperador` al `/all`. Se descarta pese a ser tentador: rompería a los clientes de la API que hoy dependen de que sea abierto, y la decisión de cerrarlo pertenece al `PermissionsGuard`.
- **Sí:** `?desde` y `?hasta` sobre `lotes.created_at`, aunque `created_at` **no** sea uno de los diez campos de la respuesta. A diferencia de SPEC 17, aquí el filtro sí es coherente con lo visible: la lista **ya está ordenada** por `created_at` DESC, así que el usuario ve el eje aunque no vea el valor.
- **Sí:** `?nombre` con `LIKE '%v%'` parcial sobre `lotes.nombre_lote`. **Decisión explícita del usuario**, y es el caso que dio origen a la petición ("si es lotes, que busque por nombre de lote").
- **Sí:** `?producto_id`, `?unidad_medida_id` y `?etapa_id` filtran las columnas de `lotes`, no las de las tablas unidas. No dependen de los `LEFT JOIN` y no cambian el conjunto base.
- **No:** filtros por rango de peso ni por `variedad_o_talla`. Se descarta: nadie los pidió y los tres pesos son una tolerancia del lote, no un criterio de búsqueda.
- **Sí:** sin paginación y con el orden clavado en `created_at` DESC. Igual que en los otros dos specs.
- **Sí:** ninguna fila nueva en `catalogo_permisos` ni en `permisos`. Novena excepción consecutiva. Mismo argumento que SPEC 16 y SPEC 17, con la salvedad de que aquí el spec **sí** amplía lo visible — y la ampliación llega a una ruta que ya era abierta, así que un permiso tampoco la habría contenido.
- **No:** índices en MySQL sobre `lotes.estado`, `lotes.etapa_id`, `lotes.producto_id` ni `lotes.created_at`. Se descarta por la regla de no aplicar DDL que no haga falta.
- **Sí:** este spec se implementa **el último** de los tres y cita la convención de SPEC 16 en vez de repetirla. **Decisión explícita del usuario.**

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **`?estado=cerrado` amplía lo que la API muestra: los lotes rechazados y aprobados se pueden listar por primera vez.** SPEC 12 y SPEC 13 los declararon irreversibles y sin endpoint que los liste, y este spec destapa parte de eso. | Asumido por decisión explícita del usuario. Acotado en tres sentidos: es opt-in (el default no cambia nada), se limita a los diez campos de siempre —sin motivo, sin quién, sin cuándo—, y no permite mezclarlos con los abiertos. Hay ocho criterios de aceptación que lo fijan como comportamiento esperado. |
| **La ampliación llega también a `GET /lotes/cliente/:clienteId/all`, que no valida `cliente_operador`.** Un operador cualquiera puede listar los lotes cerrados de un cliente que no es suyo. La superficie de la novena ruta que se salta el vínculo crece. | Asumido: cerrar esa ruta es el `PermissionsGuard`, no un spec de filtros, y hacerlo aquí rompería a quien ya dependa de que sea abierta. Hay un criterio de aceptación que verifica que la ruta gemela **sí** sigue devolviendo 403, así que el hueco no se ensancha más allá de lo que ya era. |
| **`?etapa_id` usa ids que difieren entre entornos**, que es justo lo que `CLAUDE.md` prohíbe hardcodear, y no hay `GET /catalogos/etapas` que los entregue. Un frontend que clave `3 = RECHAZADO` se rompe en producción. | Anotado, no mitigado. El paso 26 lo escribe en `CLAUDE.md`. El arreglo natural es un `GET /catalogos/etapas` —el mismo spec que le hace falta a `estados_calidad` desde SPEC 16—, no cambiar este filtro. Mientras tanto, `?etapa_id` es opcional: `?estado=cerrado` a secas funciona sin conocer ningún id. |
| Un lote cerrado se puede listar pero no se puede saber **por qué** ni **quién** lo cerró: `estado: 'cerrado'` y la `etapa` son todo lo que se ve. Alguien puede leer la lista como incompleta. | Documentado en una tabla propia del modelo de datos y en Decisions, con un criterio de aceptación que fija los diez campos. Devolver la auditoría del cierre es un spec de campos. |
| Un param inválido se ignora en silencio y devuelve una lista que parece filtrada. | **Sin mitigar por decisión explícita del usuario.** Riesgo heredado de SPEC 16. Aquí es un poco menos grave para `?estado`, cuyo valor inválido cae al default seguro (`abierto`) en vez de a "sin filtro". |
| `?nombre` hace `LIKE '%v%'`, que no puede usar índice, y ninguna de las columnas filtradas tiene uno. | Sin mitigar: no se aplica DDL. Ver el riesgo equivalente en SPEC 16. |
| `CLAUDE.md` afirma hoy que `GET /lotes/cliente/:clienteId/all` "pese al nombre no es *todos* los lotes: filtra `estado = 'abierto'` igual que el otro". Después de este spec eso deja de ser cierto y la documentación queda mintiendo. | El paso 26 la corrige explícitamente y hay un criterio de aceptación que lo verifica. |
| La tabla discriminadora de `estado = 'cerrado'` de `CLAUDE.md` dice que el discriminador canónico es `motivo_rechazo` / `aprobado_por`, pero este spec usa `etapa_id`. Dos criterios distintos para lo mismo. | Documentado en Decisions con su razón: `etapa_id` es el discriminador **visible**, el único coherente con lo que la respuesta devuelve. `CLAUDE.md` seguirá diciendo que el canónico para leer la base es el otro; los dos son correctos en su contexto. |

---

## What is **not** in this spec

- Un `?estado=todos` que mezcle abiertos y cerrados en una respuesta.
- Devolver `motivo_rechazo`, `rechazado_por`, `rechazado_en`, `aprobado_por`, `aprobado_en` o `cerrado_en`. Los diez campos no cambian.
- Un `?rechazado=1` o `?aprobado=1` que filtre por las columnas de auditoría.
- Un `GET /catalogos/etapas`, ni filtrar la etapa por su código de texto.
- Un `GET /lotes/:id` ni un `GET /lotes` global sin cliente.
- Cerrar el hueco de acceso de `GET /lotes/cliente/:clienteId/all`. Eso es el `PermissionsGuard`.
- Filtros por rango de peso ni por `variedad_o_talla`.
- Paginación, `?page`, `?limit`, `?order`, `?sort`, ni un `total` en la respuesta.
- Cualquier DDL: ni columnas, ni tablas, ni índices, ni FK.
- Cambios a `src/database/types/types.ts`.
- Cambios a `POST /lotes`, `PATCH /lotes/:id/rechazar` y `PATCH /lotes/:id/aprobar`.
- Filtros en `pesajes` (SPEC 16) y en `clientes` (SPEC 17).
- Un helper de filtros compartido entre módulos.
- Sembrar filas en `catalogo_permisos` o en `permisos`, ni aplicar permisos.

Cada uno de estos, si se necesita, va en su propio spec.
