# SPEC 17 — Filtros de consulta en los GET de clientes

> **Status:** Draft
> **Depends on:** SPEC 01, SPEC 08, SPEC 11, SPEC 16
> **Date:** 2026-09-04
> **Objective:** Agregar cuatro query params opcionales — `nombre`, `producto_id`, `codigo_exportacion` y `rtn` — a `GET /clientes` y a `GET /clientes/all`, siguiendo la convención de filtros que define SPEC 16.

---

## Why this spec exists

Es el segundo de los tres specs de filtros. **La convención completa —nombres de params, coerción, semántica AND, qué pasa con un valor inválido, formato de fecha, `LIKE` parcial— está en `specs/16-filtros-de-pesajes.md` y no se repite aquí.** Este documento solo dice qué filtros recibe cada endpoint de `clientes` y qué consecuencias tiene.

Se implementa **después** de SPEC 16, para que la convención ya esté escrita en código antes de replicarla.

Tres cosas propias de este módulo.

**La primera: los dos endpoints reciben exactamente los mismos cuatro filtros.** `GET /clientes` y `GET /clientes/all` son gemelos: devuelven los mismos seis campos y la única diferencia entre ellos es que el primero une con `cliente_operador` y el segundo no. Decisión explícita del usuario: esa sigue siendo la **única** diferencia después de este spec. Dar filtros a uno solo los convertiría en dos endpoints distintos y haría que el `/all` fuera "el abierto pero tonto".

**La segunda: `?rtn` filtra por una columna que la respuesta no devuelve.** Los seis campos de estos endpoints son `id`, `nombre`, `producto`, `codigo_exportacion`, `telefono` y `direccion_planta`. El `rtn` no está entre ellos y este spec **no lo agrega**. Se puede buscar por RTN pero no se puede leer el RTN. Es raro y es deliberado: quien busca por RTN ya lo tiene, lo que quiere es el cliente. Está en Decisions y en Risks.

**La tercera: `clientes.isActive = 1` sigue clavado en los dos.** No hay ningún param que liste clientes rechazados. Lo que SPEC 11 hizo irreversible sigue siéndolo: un cliente rechazado no aparece en ninguno de estos dos endpoints, con o sin filtros. El único sitio del proyecto donde se ve su nombre sigue siendo `GET /pesajes/historial`.

---

## Scope

**In:**

- Nuevo `src/modules/clientes/dto/filtros-clientes.dto.ts`, con la clase `FiltrosClientesDto`.
- `GET /clientes` acepta cuatro query params opcionales: `nombre`, `producto_id`, `codigo_exportacion`, `rtn`.
- `GET /clientes/all` acepta **los mismos cuatro**, con el mismo comportamiento.
- Un único DTO compartido por los dos handlers, porque los filtros son idénticos.
- `getAllClientesByOperador` pasa a recibir `(usuarioId, filtros)`.
- `getAllClientes` pasa a recibir `(filtros)`.
- Los dos métodos del service (`findAll`, `findAllGlobal`) propagan el objeto de filtros sin tocarlo.
- **Sin DDL**, **sin cambios en `src/database/types/types.ts`**, **sin cambios en los seis campos de la respuesta**.
- Actualizar `CLAUDE.md`: la fila `clientes` de la tabla de endpoints.

**Out of scope (for future specs):**

- Agregar `rtn`, `correo_contacto`, `ubicacionLongitud`, `ubicacionLatitude`, `created_by` o `created_at` a la respuesta. Los seis campos no cambian.
- Un `?isActive=0` o `?incluirRechazados=true` para listar clientes rechazados. `isActive = 1` sigue clavado.
- Un `?usuario_id` en `GET /clientes/all` para ver la cartera de otro operador. Eso es una decisión de permisos, no de filtros.
- Filtros por `telefono`, `direccion_planta` o `correo_contacto`.
- Filtros por rango de fecha de creación (`?desde`, `?hasta`). Estos dos endpoints no ordenan ni exponen `created_at`; agregar el filtro sin el campo confundiría.
- Paginación, `?page`, `?limit`, `?order`, o un `total` en la respuesta.
- Cambiar el orden de las consultas. `GET /clientes` sigue ordenando por `nombre` ASC y `GET /clientes/all` por `created_at` ASC — **son distintos hoy y este spec no los unifica.**
- Un `GET /clientes/:id`. Sigue sin existir; ver Risks antes de agregarlo.
- Filtros en `pesajes` (SPEC 16) y en `lotes` (SPEC 18).
- Cambios a `POST /clientes` y a `PATCH /clientes/:id/rechazar`.
- Sembrar filas en `catalogo_permisos` o en `permisos`, ni aplicar permisos.

---

## Data model

**Este spec no introduce datos nuevos.** No hay DDL y `src/database/types/types.ts` no se toca. `clientes.rtn` y `clientes.producto_id` ya están declaradas y ya se usan en los validadores de `createCliente`.

### El DTO

`src/modules/clientes/dto/filtros-clientes.dto.ts`:

```ts
const filtrosClientesSchema = z.object({
  nombre:             /* texto parcial */,
  producto_id:        /* id numérico */,
  codigo_exportacion: /* texto exacto */,
  rtn:                /* texto exacto */,
});

export class FiltrosClientesDto extends createZodDto(filtrosClientesSchema) { }
```

Las formas exactas de cada tipo están en la tabla de coerción de SPEC 16. Todos llevan `.optional().catch(undefined)`.

### Los cuatro filtros

| Param | Columna | Comparación | Nota |
| --- | --- | --- | --- |
| `nombre` | `clientes.nombre` | `LIKE '%v%'` | Buscador de pantalla. Parcial. |
| `producto_id` | `clientes.producto_id` | `=` | Se filtra por la columna de `clientes`, **no** por `productos.id`, para no depender del `LEFT JOIN`. |
| `codigo_exportacion` | `clientes.codigo_exportacion` | `=` | Exacto. Normalmente devuelve 0 o 1 fila. |
| `rtn` | `clientes.rtn` | `=` | Exacto. **La columna no está en la respuesta.** |

Los dos filtros exactos no se recortan a `LIKE` a propósito: son identificadores, no texto de búsqueda.

### Lo que sigue siempre aplicado

| Endpoint | `WHERE` fijo | Orden fijo |
| --- | --- | --- |
| `GET /clientes` | `cliente_operador.usuario_id = <token>` (por `INNER JOIN`) y `clientes.isActive = 1` | `clientes.nombre` ASC |
| `GET /clientes/all` | `clientes.isActive = 1` | `clientes.created_at` ASC |

**Ningún filtro puede levantar ninguno de los dos.** En particular: no hay forma de que `GET /clientes` devuelva un cliente que no sea de la cartera del llamante, y no hay forma de que ninguno de los dos devuelva un cliente rechazado.

Los dos órdenes son **distintos entre sí** hoy —`nombre` ASC contra `created_at` ASC— y este spec los deja como están. Unificarlos cambiaría la respuesta sin params, que es justo lo que no se toca.

### El duplicado de RTN que SPEC 11 dejó posible

`CLAUDE.md` lo advierte: como los validadores de unicidad filtran `isActive = 1`, rechazar un cliente **libera** su `rtn` y su `codigo_exportacion`, y la tabla puede acabar con dos filas compartiendo un RTN — una activa y una rechazada. La consecuencia para este spec es tranquila: `?rtn=X` filtra además por `isActive = 1`, así que **devuelve como mucho la fila activa**, nunca la rechazada. El duplicado no se ve.

### Peticiones y respuestas

```
GET /clientes?nombre=agro&producto_id=2
GET /clientes/all?rtn=08011985123456
GET /clientes/all?codigo_exportacion=EXP-0042
```

La respuesta mantiene exactamente la forma de siempre:

```json
{ "ok": true, "msg": "Clientes obtenidos correctamente", "clientes": [ /* ... */ ] }
```

| Caso | Respuesta |
| --- | --- |
| Sin header `Authorization` | 401 del `JwtAuthGuard` |
| Cualquier query param inválido, vacío o desconocido | **200**, con ese filtro sin aplicar |
| Ningún resultado tras filtrar | **200 con `[]`** |

**Ningún query param puede producir un 400.** Estos dos endpoints no tenían ningún 400 posible antes de este spec y **siguen sin tenerlo**: no hay `ParseIntPipe` en ninguno de los dos.

---

## Implementation plan

1. Confirmar que SPEC 16 ya está implementado y que sus criterios de aceptación pasan. Este spec replica su convención; si aquella cambió, esta debe cambiar igual.
2. Confirmar contra MySQL que hay datos variados: al menos tres clientes activos, de al menos dos productos distintos, con nombres que compartan un fragmento (`SELECT id, nombre, producto_id, codigo_exportacion, rtn, isActive FROM clientes;`). Anotar además un cliente rechazado (`isActive = 0`) para las pruebas negativas.
3. Anotar la respuesta actual de `GET /clientes` y de `GET /clientes/all` **sin params**, para compararlas al final.
4. Crear `src/modules/clientes/dto/filtros-clientes.dto.ts` con sus cuatro campos, todos `.optional().catch(undefined)`, copiando las formas de Zod de los DTO de SPEC 16. Confirmar que compila (`npm run build`).
5. Cambiar la firma de `getAllClientesByOperador` a `(usuarioId: number, filtros: FiltrosClientesDto)` y reescribir el cuerpo con `let query = ...` más un `if` por filtro, dejando el `INNER JOIN` con `cliente_operador`, el `isActive = 1` y el `orderBy` siempre aplicados.
6. Cambiar la firma de `getAllClientes` a `(filtros: FiltrosClientesDto)` y hacer lo mismo, dejando el `isActive = 1` y su `orderBy` por `created_at` siempre aplicados.
7. Propagar el parámetro en `ClientesService`: `findAll(userId, filtros)` y `findAllGlobal(filtros)`. Siguen siendo pass-through de una línea.
8. Agregar `@Query() filtros: FiltrosClientesDto` a los dos handlers. **No cambiar el orden de declaración**: `@Get('all')` sigue declarado antes que `@Get()`.
9. Levantar con `npm run start:dev` y confirmar que las cuatro rutas de `clientes` siguen apareciendo en el log de Nest, sin rutas nuevas.
10. Verificación de no regresión: llamar a los dos endpoints **sin ningún query param** y confirmar que la respuesta es idéntica a la anotada en el paso 3 — mismos seis campos, mismas filas, y **cada uno con su propio orden**: `nombre` ASC en `/clientes`, `created_at` ASC en `/clientes/all`.
11. Verificación de `?nombre`: con un fragmento compartido por dos clientes, confirmar que vienen los dos y no los demás; que la coincidencia es parcial; y que un fragmento en minúscula encuentra un nombre en mayúscula. Repetir en los dos endpoints.
12. Verificación de `?producto_id`: con el id de un producto, confirmar que solo vienen los clientes de ese producto y que el campo `producto` de la respuesta lo confirma. Repetir en los dos.
13. Verificación de `?codigo_exportacion` y `?rtn`: con un valor exacto, confirmar que viene exactamente esa fila; con un fragmento del valor, confirmar que **no** viene nada, porque la comparación es exacta y no `LIKE`.
14. Verificación de que `?rtn` no filtra un cliente rechazado: con el RTN del cliente `isActive = 0` anotado en el paso 2, confirmar que la respuesta es `[]` en los dos endpoints.
15. Verificación de la combinación: `?nombre=<frag>&producto_id=<id>` devuelve la intersección, no la unión.
16. Verificación de los inválidos: confirmar **200 y sin filtrar** en `?producto_id=abc`, `?producto_id=-1`, `?producto_id=`, `?nombre=`, `?rtn=` y `?foo=bar`. **Ninguno puede responder 400.**
17. Verificación de que la cartera sigue siendo la frontera de `GET /clientes`: con el token de un operador, confirmar que ningún filtro consigue traer un cliente que no esté en su `cliente_operador`. Probar con el `?rtn` exacto de un cliente ajeno y confirmar `[]`.
18. Verificación de que `GET /clientes/all` sigue devolviendo lo de siempre a cualquier autenticado: con el token de un `OPERADOR`, confirmar 200 con todos los clientes activos. Este spec **no** cierra ese hueco de SPEC 08.
19. Verificación de que nada más cambió: `POST /clientes`, `PATCH /clientes/:id/rechazar`, los dos `GET /pesajes*` con y sin filtros, los dos `GET /lotes/cliente/*`, `GET /permisos/me` y los tres `GET /catalogos/*` responden igual.
20. Confirmar que `permisos` sigue con **14 filas** y `catalogo_permisos` con **9**.
21. Actualizar `CLAUDE.md`: agregar los cuatro query params a los dos `GET` de la fila `clientes`, anotar que son idénticos en los dos y que la única diferencia entre el par sigue siendo `cliente_operador`, y anotar que `?rtn` filtra por una columna que la respuesta no devuelve.

---

## Acceptance criteria

- [ ] SPEC 16 está implementado antes que este spec.
- [ ] No se ejecutó ningún DDL: `DESCRIBE clientes;` muestra exactamente las mismas columnas que antes.
- [ ] `src/database/types/types.ts` **no cambió**.
- [ ] No se creó ningún módulo, controller, service ni repositorio nuevo: solo se modificaron `clientes.controller.ts`, `clientes.service.ts` y `repository/clientes.repository.ts`.
- [ ] `src/modules/clientes/dto/` tiene exactamente tres archivos: `create-cliente.dto.ts`, `rechazar-cliente.dto.ts` y `filtros-clientes.dto.ts`.
- [ ] Hay **un solo** DTO de filtros, compartido por los dos handlers: no se crearon dos.
- [ ] No se creó ningún helper de filtros compartido entre módulos.
- [ ] `src/app.module.ts` no cambió y la app arranca sin errores de compilación.
- [ ] El log de rutas de Nest muestra las mismas cuatro rutas de `clientes` que antes: **ninguna ruta nueva**.
- [ ] `@Get('all')` sigue declarado **antes** que `@Get()`.
- [ ] `GET /clientes` **sin ningún query param** devuelve exactamente la misma respuesta que antes: mismos seis campos, mismas filas, orden `nombre` ASC.
- [ ] `GET /clientes/all` **sin ningún query param** devuelve exactamente la misma respuesta que antes: mismos seis campos, mismas filas, orden `created_at` ASC.
- [ ] Los dos órdenes siguen siendo **distintos entre sí**: este spec no los unificó.
- [ ] La respuesta sigue siendo `{ ok, msg, clientes }`: no se agregó `total`, ni `filtros`, ni `data`.
- [ ] Los dos endpoints aceptan exactamente los **mismos cuatro** params: `nombre`, `producto_id`, `codigo_exportacion`, `rtn`.
- [ ] `?nombre=<fragmento>` filtra por `clientes.nombre` con coincidencia **parcial**, en los dos endpoints.
- [ ] `?producto_id=N` devuelve solo clientes de ese producto, y el campo `producto` de cada fila lo confirma.
- [ ] `?codigo_exportacion=<valor>` compara de forma **exacta**: un fragmento del valor devuelve `[]`.
- [ ] `?rtn=<valor>` compara de forma **exacta**: un fragmento del valor devuelve `[]`.
- [ ] `?rtn` con el RTN de un cliente rechazado (`isActive = 0`) devuelve `[]` en los dos endpoints: el filtro no levanta el `isActive = 1`.
- [ ] La respuesta **sigue sin incluir** `rtn`: se puede filtrar por él pero no leerlo.
- [ ] Varios filtros a la vez se combinan con **AND**.
- [ ] `?producto_id=abc`, `?producto_id=-1`, `?producto_id=0`, `?producto_id=`, `?nombre=`, `?rtn=`, `?codigo_exportacion=` y `?foo=bar` responden **200** sin filtrar por ese param.
- [ ] **Ningún query param, con ningún valor, produce un 400** en estos dos endpoints. Siguen sin tener ningún 400 posible.
- [ ] Ningún filtro puede hacer que aparezca un cliente que la llamada sin filtros no devolvía.
- [ ] `clientes.isActive = 1` sigue siempre aplicado en los dos: **no hay ningún param que liste clientes rechazados.**
- [ ] En `GET /clientes`, ningún filtro consigue traer un cliente fuera de la cartera del llamante: el `INNER JOIN` con `cliente_operador` sigue siempre aplicado. Verificado con el `?rtn` exacto de un cliente ajeno, que devuelve `[]`.
- [ ] `GET /clientes/all` sigue devolviendo todos los clientes activos a cualquier autenticado, `OPERADOR` incluido: este spec **no** cierra el hueco de SPEC 08 ni pretende hacerlo.
- [ ] Ninguna de las dos consultas abre transacción ni llama a un validador: siguen siendo un único `SELECT`.
- [ ] Los cinco validadores privados de `ClientesRepository` no se modificaron, y `linkOperadores` tampoco.
- [ ] `createCliente` y `rechazarCliente` no cambiaron.
- [ ] No hay `?page`, `?limit`, `?offset`, `?order`, `?sort`, `?desde` ni `?hasta` en ninguno de los dos endpoints.
- [ ] `permisos` sigue con exactamente **14 filas** y `catalogo_permisos` con **9**.
- [ ] `GET /permisos/me` devuelve los mismos códigos que antes y el payload del JWT no cambió.
- [ ] Los dos `GET /pesajes*` con y sin sus filtros de SPEC 16, los dos `GET /lotes/cliente/*`, los cuatro `PATCH`, `POST /clientes`, `POST /lotes`, `POST /pesajes`, `POST /auth/login`, `POST /auth/register` y los tres `GET /catalogos/*` siguen funcionando igual.
- [ ] Los params se comportan **igual que en SPEC 16**: mismo `.catch(undefined)`, mismo `LIKE '%v%'` parcial, misma semántica AND, mismo 200 ante un valor inválido.
- [ ] `CLAUDE.md` documenta los cuatro params en los dos `GET`, anota que son idénticos en el par y que `?rtn` filtra por una columna que la respuesta no devuelve.

---

## Decisions

- **Sí:** los dos endpoints reciben **los mismos cuatro filtros**. **Decisión explícita del usuario.** `GET /clientes` y `GET /clientes/all` son gemelos y la única diferencia entre ellos sigue siendo el `cliente_operador`, como hoy.
- **No:** dar filtros solo a `GET /clientes` y dejar `/all` como está. Se descarta: el par dejaría de ser gemelo en dos dimensiones y el `/all` quedaría como "la ruta abierta pero tonta", lo que empuja a la gente a usar la abierta *y* a pedir después que también filtre.
- **Sí:** un solo DTO, `FiltrosClientesDto`, compartido por los dos handlers. Los filtros son idénticos, así que dos archivos serían dos copias que divergen.
- **Sí:** `?nombre` con `LIKE '%v%'` parcial sobre `clientes.nombre`. **Decisión explícita del usuario.** Es el buscador de la pantalla de listado.
- **Sí:** `?producto_id` filtra `clientes.producto_id`, la columna de la propia tabla, no `productos.id`. No depende del `LEFT JOIN` y no cambia el conjunto base si un producto se borra.
- **Sí:** `?codigo_exportacion` y `?rtn` son **exactos**, con `=` y no con `LIKE`. Son identificadores: quien los busca los tiene completos, y un `LIKE` sobre un RTN devolvería coincidencias parciales sin sentido.
- **Sí:** `?rtn` existe aunque `rtn` **no** sea uno de los seis campos de la respuesta. **Decisión explícita del usuario.** Quien busca por RTN ya lo tiene; lo que quiere es el cliente. Anotado en Risks.
- **No:** agregar `rtn` a la respuesta "ya que se puede filtrar por él". Se descarta: cambiaría la respuesta sin params, que es lo único que estos tres specs prometen no tocar. Si hace falta, es un spec de un campo.
- **No:** un `?isActive=0` o `?incluirRechazados=true`. Se descarta: SPEC 11 dejó el rechazo de clientes explícitamente irreversible y sin endpoint que los liste; revertir eso con un query param sería colarlo por la puerta de atrás.
- **No:** un `?usuario_id` en `GET /clientes/all` para ver la cartera de otro operador. Se descarta: es una decisión de permisos, y depende del `PermissionsGuard` que no existe.
- **No:** filtros por `telefono`, `direccion_planta` o `correo_contacto`. Se descarta: nadie los pidió y `correo_contacto` ni siquiera está en la respuesta.
- **No:** `?desde` y `?hasta` sobre `clientes.created_at`. Se descarta pese a que SPEC 16 y SPEC 18 sí los tienen: estos dos endpoints no devuelven `created_at`, así que el usuario filtraría por un campo que no puede ver ni verificar. Es distinto del caso de `?rtn`, donde el valor buscado es un identificador que quien busca ya conoce.
- **Sí:** los dos órdenes siguen siendo distintos, `nombre` ASC contra `created_at` ASC. Se deja la inconsistencia: unificarla cambiaría la respuesta sin params. Si se unifica algún día, es un spec propio que decida cuál gana.
- **No:** un `?order` que permita elegir. Se descarta con el resto de la paginación.
- **Sí:** ninguna fila nueva en `catalogo_permisos` ni en `permisos`. Octava excepción consecutiva. Mismo argumento que SPEC 16: un filtro no cambia quién puede llamar al endpoint.
- **No:** índices en MySQL sobre `clientes.nombre`, `clientes.producto_id`, `clientes.rtn` ni `clientes.codigo_exportacion`. Se descarta por la regla de no aplicar DDL que no haga falta. Anotado en Risks.
- **Sí:** este spec se implementa **después** de SPEC 16 y cita su convención en vez de repetirla. **Decisión explícita del usuario.**

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **`?rtn` filtra por una columna invisible en la respuesta.** Alguien busca por RTN, recibe un cliente y no puede confirmar que el RTN sea el que pidió. Es la rareza principal de este spec. | Asumido por decisión explícita. Acotado: la comparación es exacta, así que si vuelve una fila, su RTN **es** el buscado. Hay dos criterios de aceptación que lo fijan y el paso 21 lo escribe en `CLAUDE.md`. |
| Un param inválido se ignora en silencio y devuelve una lista que parece filtrada. | **Sin mitigar por decisión explícita del usuario.** Es el riesgo heredado de SPEC 16 y aplica igual aquí. Hay ocho criterios de aceptación que fijan el 200 como esperado. |
| **`GET /clientes/all` gana filtros y se vuelve más cómodo de usar que `GET /clientes`.** Hoy el filtro por `cliente_operador` de `GET /clientes` ya es cosmético —`CLAUDE.md` lo dice— y hacer el `/all` igual de potente empuja a los clientes de la API a usar siempre el abierto. | Asumido: la alternativa era dejar el `/all` sin filtros, lo que no cierra el hueco de SPEC 08 y solo lo hace incómodo. El hueco se cierra con el `PermissionsGuard`, no aquí. Hay un criterio de aceptación que verifica que este spec **no lo agrava**: `/all` sigue devolviendo exactamente los mismos clientes que antes. |
| `?nombre` hace `LIKE '%v%'`, que no puede usar índice. Con muchos clientes, cada búsqueda escanea la tabla. | Sin mitigar: no se aplica DDL. Un índice ayudaría a `?producto_id`, `?rtn` y `?codigo_exportacion`, no al `LIKE`. Ver el riesgo equivalente en SPEC 16. |
| Los dos endpoints ordenan distinto (`nombre` ASC contra `created_at` ASC) y ahora que los dos filtran igual, la diferencia se nota más: la misma búsqueda devuelve las mismas filas en distinto orden según la ruta. | Asumido por decisión: unificar el orden cambiaría la respuesta sin params. Hay un criterio de aceptación que fija los dos órdenes como están, para que nadie lo lea como un bug de este spec. |
| Después de SPEC 11 la tabla puede tener dos clientes con el mismo RTN, uno activo y uno rechazado. Alguien podría esperar que `?rtn` devuelva dos filas. | No es un riesgo real: el `isActive = 1` fijo deja como mucho la fila activa. Documentado en el modelo de datos y verificado por un criterio de aceptación. |
| Si algún día se agrega `GET /clientes/:id`, hay que declararlo **después** de `@Get('all')` o se traga `/clientes/all`. Es la trampa que `CLAUDE.md` ya advierte. | Este spec no agrega ninguna ruta, así que no la activa. Queda anotado porque tocar este controller es la ocasión en la que alguien lo hará. |

---

## What is **not** in this spec

- Agregar `rtn`, `correo_contacto`, las coordenadas, `created_by` o `created_at` a la respuesta. Los seis campos no cambian.
- Un `?isActive=0` o `?incluirRechazados`: los clientes rechazados siguen sin listarse en ninguna parte salvo por su nombre en `GET /pesajes/historial`.
- Un `?usuario_id` en `GET /clientes/all`.
- Filtros por `telefono`, `direccion_planta` o `correo_contacto`.
- Filtros por rango de fecha de creación.
- Paginación, `?page`, `?limit`, `?order`, `?sort`, ni un `total` en la respuesta.
- Unificar el orden de los dos endpoints.
- Un `GET /clientes/:id`.
- Cerrar el hueco de acceso de `GET /clientes/all` que dejó SPEC 08. Eso es el `PermissionsGuard`.
- Cualquier DDL: ni columnas, ni tablas, ni índices, ni FK.
- Cambios a `src/database/types/types.ts`.
- Cambios a `POST /clientes` y a `PATCH /clientes/:id/rechazar`.
- Filtros en `pesajes` (SPEC 16) y en `lotes` (SPEC 18).
- Un helper de filtros compartido entre módulos.
- Sembrar filas en `catalogo_permisos` o en `permisos`, ni aplicar permisos.

Cada uno de estos, si se necesita, va en su propio spec.
