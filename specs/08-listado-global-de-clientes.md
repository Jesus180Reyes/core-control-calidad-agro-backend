# SPEC 08 — Listado global de clientes

> **Status:** Approved
> **Depends on:** SPEC 01, SPEC 06
> **Date:** 2026-08-29
> **Objective:** Agregar `GET /clientes/all`, que devuelve todos los clientes activos sin el filtro de `cliente_operador`, y sembrar el permiso `clientes.listar_todos` para `Admin`.

---

## Why this spec exists

SPEC 01 creó `cliente_operador` y dejó `GET /clientes` devolviendo únicamente los clientes vinculados al usuario que llama. En ese mismo spec quedó anotado, como fuera de alcance, "ver todos los clientes sin filtro" (`01-vinculacion-cliente-operador.md`, línea 23). Este spec es ese trabajo diferido.

Hay que ser explícito con lo que este spec **no** resuelve, porque es lo primero que se malinterpreta. El pedido original fue "que cualquier usuario **con permiso** pueda ver todos los clientes". Ese "con permiso" hoy no existe como mecanismo: SPEC 06 sembró la tabla `permisos` y SPEC 07 la expuso en `GET /permisos/me`, pero no hay `PermissionsGuard`, no hay decorador `@Permisos()`, `req.user` sigue siendo `{ userId, username }` y ningún endpoint del proyecto devuelve 403 por falta de permiso.

La decisión tomada es construir el endpoint ahora y dejar la aplicación del permiso para el spec del guard. La consecuencia hay que escribirla sin adornos: **`GET /clientes/all` queda accesible para cualquier usuario autenticado, incluido un `Operador`**. El permiso `clientes.listar_todos` se siembra solo para `Admin`, pero nada lo lee en el camino de la petición. Un `Operador` que llame la ruta recibe 200 con todos los clientes.

Eso no es solo "un permiso más que todavía no se aplica", como en SPEC 06 y 07. Es la primera vez que un endpoint **abre datos que hoy están cerrados**: el filtro por vínculo de SPEC 01 deja de ser la única forma de leer `clientes`. Mientras no llegue el guard, el filtro de `GET /clientes` es evitable llamando a la ruta de al lado. Se asume conscientemente y se registra en Risks.

---

## Scope

**In:**

- Nuevo método `getAllClientes()` en `src/modules/clientes/repository/clientes.repository.ts`, sin el `innerJoin` a `cliente_operador`.
- Nuevo método `findAllGlobal()` en `src/modules/clientes/clientes.service.ts`, pass-through al repositorio.
- Nuevo handler `@Get('all')` en `src/modules/clientes/clientes.controller.ts`.
- Nuevo endpoint `GET /clientes/all`, protegido únicamente por el `JwtAuthGuard` global (no lleva `@Public()`).
- El endpoint no acepta parámetros de ruta, query ni body, y no lee `req.user`.
- Los mismos seis campos que devuelve `GET /clientes`: `id`, `nombre`, `producto`, `codigo_exportacion`, `telefono`, `direccion_planta`.
- Filtro `clientes.isActive = 1` y `ORDER BY clientes.created_at ASC`: orden de antigüedad, los clientes registrados primero arriba.
- Respuesta en la forma `{ ok, msg, clientes }`, con `clientes: []` cuando no hay ninguno activo.
- Siembra a mano en SQL de una fila en `permisos`: `clientes.listar_todos` para el rol `Admin`.
- Actualizar `CLAUDE.md`: fila nueva en la tabla de endpoints, la nota de la sección de auth y el conteo de filas de `permisos`.

**Out of scope (for future specs):**

- **Aplicar** el permiso: no hay `PermissionsGuard` ni decorador `@Permisos('clientes.listar_todos')`. `GET /clientes/all` responde 200 a cualquier usuario autenticado, incluido un `Operador`.
- Verificar el permiso a mano dentro del repositorio, al estilo de los `validateX` existentes. Se consideró y se descartó (ver Decisions).
- Cambios al payload del JWT o a `req.user`, que sigue siendo `{ userId, username }`.
- Cualquier cambio a `GET /clientes`: mantiene su filtro por `cliente_operador`, su firma y su respuesta.
- Sembrar `clientes.listar_todos` para el rol `Operador`.
- Paginación, filtros por query (`?nombre=`, `?producto_id=`) o búsqueda de texto.
- Devolver clientes con `isActive = 0`, y devolver la columna `isActive` en la respuesta.
- Devolver campos que hoy ningún endpoint expone: `rtn`, `correo_contacto`, `ubicacionLongitud`, `ubicacionLatitude`, `created_by`.
- Devolver los operadores vinculados a cada cliente.
- `GET /clientes/:id`, `PUT`, `PATCH` y `DELETE` sobre clientes.
- Endpoints para gestionar los vínculos `cliente_operador` después de crear el cliente.
- Cualquier DDL: la tabla `permisos` y `PermisosTable` ya existen desde SPEC 06 y no cambian. `src/database/types/types.ts` no se toca.
- Módulo, controller, service o DTO nuevos: todo va en el módulo `clientes` que ya existe.
- Validar `usuarios.isActive`.
- Caché de la respuesta, en cualquier forma.

---

## Data model

**Este spec no hace ningún cambio de esquema**: no agrega tablas, columnas ni constraints, y no ejecuta DDL. `src/database/types/types.ts` queda igual.

Tampoco agrega ningún DTO: el endpoint no recibe body, ni parámetros de ruta, ni query. No se crea ningún archivo bajo `src/modules/clientes/dto/`.

El único cambio de datos es **una fila** en `permisos`, insertada a mano, igual que la semilla de SPEC 06.

### Semilla del permiso (ejecutar a mano en MySQL)

El `rol_id` se resuelve por nombre, no por id fijo, porque los ids de `roles` no están garantizados entre ambientes:

```sql
INSERT INTO permisos (rol_id, codigo, nombre, descripcion)
SELECT r.id,
       'clientes.listar_todos',
       'Listar todos los clientes',
       'Ver todos los clientes registrados, sin filtro por vinculo'
FROM roles r
WHERE r.nombre = 'Admin';
```

Después de ejecutarlo la tabla tiene **11 filas**: siete de `Admin` y cuatro de `Operador`. El rol `Operador` no recibe ninguna fila nueva.

Si el nombre real del rol en la base no es exactamente `Admin`, se ajusta el literal antes de ejecutar. Es lo primero a verificar con `SELECT id, nombre FROM roles;`.

### Consulta del endpoint

Es la misma que `getAllClientesByOperador` sin el `innerJoin` a `cliente_operador`, sin el filtro por `usuario_id` y con otro `ORDER BY`:

```sql
SELECT c.id,
       c.nombre,
       p.nombre AS producto,
       c.codigo_exportacion,
       c.telefono,
       c.direccion_planta
FROM clientes c
LEFT JOIN productos p ON p.id = c.producto_id
WHERE c.isActive = 1
ORDER BY c.created_at ASC;
```

El `leftJoin` a `productos` se mantiene: un cliente cuyo `producto_id` apunta a un producto inexistente sigue apareciendo, con `producto: null`.

`clientes.created_at` es nullable (`Generated<Date | string | null>` en `types.ts`). MySQL ordena `NULL` primero en `ASC`, así que cualquier fila sin fecha aparece al principio de la lista. Hoy la columna tiene `DEFAULT CURRENT_TIMESTAMP`, así que solo afectaría a filas insertadas antes de que existiera ese default.

### Respuesta de `GET /clientes/all` (200)

```json
{
  "ok": true,
  "msg": "Clientes obtenidos correctamente",
  "clientes": [
    {
      "id": 1,
      "nombre": "Agroexportadora del Valle",
      "producto": "Camaron",
      "codigo_exportacion": "EXP-001",
      "telefono": "99887766",
      "direccion_planta": "Choluteca"
    }
  ]
}
```

Respuesta (200) cuando no hay clientes activos:

```json
{
  "ok": true,
  "msg": "Clientes obtenidos correctamente",
  "clientes": []
}
```

---

## Implementation plan

1. Verificar el nombre real del rol con `SELECT id, nombre FROM roles;` y ajustar el literal `'Admin'` si difiere. Ejecutar a mano el `INSERT` de la semilla y confirmar con `SELECT rol_id, COUNT(*) FROM permisos GROUP BY rol_id;` que `Admin` tiene siete filas y `Operador` sigue con cuatro.
2. Agregar `getAllClientes()` a `ClientesRepository`. Copiar `getAllClientesByOperador` quitando el `innerJoin` a `cliente_operador` y el `.where('cliente_operador.usuario_id', ...)`. Conservar el `leftJoin` a `productos`, los seis `select` y el `.where('clientes.isActive', '=', 1)`. Ordenar con `.orderBy('clientes.created_at', 'asc')`, que es donde se aparta del método que copia. No recibe parámetros.
3. Agregar `findAllGlobal()` a `ClientesService` como pass-through a `getAllClientes()`, sin parámetros, igual en forma a `findAll`.
4. Agregar el handler `@Get('all')` a `ClientesController` con el método `findAllGlobal()`. No lleva `@Req()` ni lee `req.user`. Responde `{ ok: true, msg: 'Clientes obtenidos correctamente', clientes }`. Sin `@Public()`.
5. Levantar con `npm run start:dev` y confirmar que compila y que `GET /clientes/all` aparece en el log de rutas de Nest, junto a `GET /clientes` y `POST /clientes`.
6. Verificación manual: login con un `Admin`, llamar `GET /clientes/all` y comparar el conteo contra `SELECT COUNT(*) FROM clientes WHERE isActive = 1`; llamar `GET /clientes` con el mismo token y confirmar que sigue devolviendo solo los vinculados; llamar `GET /clientes/all` sin header `Authorization` y confirmar 401; llamar `GET /permisos/me` con el token del `Admin` y confirmar que ahora devuelve siete códigos incluyendo `clientes.listar_todos`.
7. Verificación manual del comportamiento no aplicado: login con un `Operador`, llamar `GET /clientes/all` y confirmar que responde **200 con todos los clientes**, no 403. Es el resultado esperado de este spec y el criterio que documenta que el permiso todavía no se aplica.
8. Actualizar `CLAUDE.md`: agregar `GET /clientes/all` a la fila `clientes` de la tabla de endpoints; corregir la frase de la sección de auth que dice que `GET /permisos/me` es lo único que lee `permisos` (sigue siéndolo, pero ahora hay un permiso sembrado que ningún endpoint aplica, y conviene nombrarlo); actualizar el conteo de filas de `permisos` de 10 a 11 si aparece; y anotar que `GET /clientes/all` deja el filtro de `cliente_operador` de `GET /clientes` sin valor real de seguridad hasta que llegue el guard.

---

## Acceptance criteria

- [X] El esquema de MySQL no cambió: no se ejecutó ningún DDL en esta implementación.
- [X] `src/database/types/types.ts` no cambió.
- [X] La tabla `permisos` tiene exactamente 11 filas: siete de `Admin` y cuatro de `Operador`.
- [X] Existe exactamente una fila con `codigo = 'clientes.listar_todos'`, y su `rol_id` es el de `Admin`.
- [X] El rol `Operador` **no** tiene ninguna fila con `codigo = 'clientes.listar_todos'`.
- [X] La fila sembrada tiene `isActive = 1`.
- [X] La app arranca sin errores de compilación (`npm run start:dev`).
- [X] No se creó ningún archivo nuevo bajo `src/modules/`: solo se modificaron `clientes.controller.ts`, `clientes.service.ts` y `repository/clientes.repository.ts`.
- [X] `src/app.module.ts` no cambió.
- [X] No existe ninguna carpeta ni archivo nuevo bajo `src/modules/clientes/dto/`.
- [X] `GET /clientes/all` aparece en el log de rutas de Nest al arrancar.
- [X] `GET /clientes/all` con el token de un `Admin` responde 200 con la forma `{ ok, msg, clientes }`.
- [X] La cantidad de elementos de `clientes` coincide exactamente con `SELECT COUNT(*) FROM clientes WHERE isActive = 1`.
- [X] Cada elemento tiene exactamente seis claves: `id`, `nombre`, `producto`, `codigo_exportacion`, `telefono`, `direccion_planta`.
- [X] La respuesta no incluye `rtn`, `correo_contacto`, `ubicacionLongitud`, `ubicacionLatitude`, `created_by` ni `isActive`.
- [X] Un cliente con `isActive = 0` no aparece en la respuesta; ponerlo en `1` lo hace aparecer.
- [X] Los elementos vienen ordenados por `created_at` ascendente: el cliente registrado hace más tiempo aparece primero.
- [X] Un cliente cuyo `producto_id` no resuelve a ninguna fila de `productos` aparece igual, con `producto: null`.
- [X] Un `Admin` sin ninguna fila en `cliente_operador` recibe igual todos los clientes: el endpoint ignora el vínculo por completo.
- [X] Si no hay clientes activos, la respuesta es 200 con `clientes: []`, no un 404.
- [X] `GET /clientes/all` sin header `Authorization` responde 401: el endpoint no es `@Public()`.
- [X] `GET /clientes/all` con un token expirado o firmado con otro secreto responde 401.
- [X] El endpoint ignora cualquier query param: `GET /clientes/all?usuario_id=5` devuelve lo mismo que `GET /clientes/all`.
- [X] `GET /clientes/all` con el token de un `Operador` responde **200 con todos los clientes**, no 403: **este spec no aplica el permiso**.
- [X] `GET /clientes` sigue devolviendo únicamente los clientes vinculados al usuario del token, sin cambios respecto a SPEC 01.
- [X] `GET /permisos/me` con el token de un `Admin` responde 200 con un array de exactamente siete strings, que incluye `clientes.listar_todos`.
- [X] `GET /permisos/me` con el token de un `Operador` sigue respondiendo con exactamente cuatro strings y **no** incluye `clientes.listar_todos`.
- [X] `POST /auth/login` responde exactamente igual que antes de este spec, sin clave `permisos`.
- [X] El payload del JWT no cambió: sigue siendo `sub`, `user_id` y `username`.
- [X] `req.user` sigue siendo `{ userId, username }`.
- [X] `POST /clientes` (SPEC 01), `POST /lotes`, `GET /lotes/cliente/:clienteId` (SPEC 02), `POST /pesajes` (SPEC 03, SPEC 04), `POST /auth/refresh` (SPEC 05) y `GET /permisos/me` (SPEC 07) siguen funcionando igual.
- [X] `CLAUDE.md` lista `GET /clientes/all` en la tabla de endpoints y anota que el permiso `clientes.listar_todos` está sembrado pero no se aplica.

---

## Decisions

- **Sí:** una ruta nueva `GET /clientes/all`, separada de `GET /clientes`. Decisión explícita del usuario. Cada ruta tiene un contrato fijo: una filtra por vínculo, la otra no, y ninguna cambia de comportamiento según quién llame.
- **No:** `GET /clientes?todos=true`. Se descarta: pondría dos comportamientos y dos permisos en la misma ruta, y obligaría al guard futuro a leer el query para decidir qué permiso exigir.
- **No:** que `GET /clientes` devuelva todo cuando el usuario tenga el permiso y filtre cuando no. Se descarta: rompería el contrato que SPEC 01 fijó, haciendo que la misma llamada devuelva cosas distintas según el rol. Un cliente que consume la API no podría razonar sobre la respuesta sin conocer el rol.
- **Sí:** el segmento de ruta es `all`, en inglés, aunque el `codigo` del permiso sea `clientes.listar_todos`, en español. Decisión explícita del usuario, tomada después de que se le señalara la inconsistencia. Se registra aquí para que nadie lo "corrija" más adelante creyendo que fue un descuido. El precedente en el proyecto es `GET /permisos/me`, que también usa un segmento en inglés.
- **No:** `GET /clientes/todos` para alinear la ruta con el `codigo`. Se descarta por la decisión anterior.
- **Sí:** el permiso se llama `clientes.listar_todos`. Decisión explícita del usuario. Respeta la convención `modulo.accion` de SPEC 06 y se distingue con claridad de `clientes.listar`, que ya existe y significa el listado filtrado.
- **No:** `clientes.listar_global`. Se descarta: describe el alcance en vez del resultado, y `_todos` lee mejor junto a `clientes.listar`.
- **Sí:** el permiso se siembra solo para `Admin`. Decisión explícita del usuario. Es la razón de ser del endpoint y es coherente con que el `Operador` ya esté limitado a sus clientes vinculados por SPEC 01.
- **No:** sembrarlo también para `Operador`. Se descarta: dejaría a `GET /clientes` sin propósito real, porque el `Operador` tendría una ruta de al lado que devuelve todo.
- **Sí:** la semilla va en este spec, no en el del guard. Decisión explícita del usuario. Mantiene la regla de SPEC 06 de una fila por endpoint, y hace que `GET /permisos/me` devuelva el código nuevo desde el día uno, que es lo que la app necesita para decidir si muestra la pantalla.
- **Sí:** resolver el `rol_id` por nombre en el `INSERT`. Se mantiene la decisión de SPEC 06: los ids de `roles` no están garantizados entre ambientes.
- **Sí:** el endpoint queda accesible para cualquier usuario autenticado, sin aplicar el permiso. Decisión explícita del usuario, tomada después de que se le presentara la alternativa y su consecuencia. Mantiene este spec del tamaño de un endpoint y deja el guard, que toca `JwtStrategy`, el payload del JWT y los cuatro módulos existentes, en el spec propio que SPEC 06 y SPEC 07 ya le reservaron.
- **No:** verificar `clientes.listar_todos` dentro del repositorio con un `validatePermiso(...)` al estilo de los `validateX` existentes, lanzando 403. Se descarta pese a que habría cumplido literalmente el pedido original ("cualquier usuario **con permiso**") sin construir el guard. Se anota la consecuencia asumida: hasta que llegue el guard, un `Operador` puede ver todos los clientes llamando esta ruta, y el filtro por vínculo de `GET /clientes` deja de ser una barrera real. Es la diferencia con SPEC 06 y 07, que no abrían ningún dato.
- **No:** construir el `PermissionsGuard` completo dentro de este spec. Se mantiene la decisión de SPEC 06 (línea 189) y SPEC 07 (línea 172): son cinco áreas del sistema en un solo documento.
- **Sí:** los mismos seis campos que `GET /clientes`. Decisión explícita del usuario. La app reutiliza el modelo que ya tiene y no hay un tipo nuevo que mantener en el cliente.
- **No:** devolver todos los campos de `clientes` (`rtn`, `correo_contacto`, ubicación, `created_by`). Se descarta: serviría para una pantalla de administración, pero expondría datos que hoy no devuelve ningún endpoint, y en una ruta que además está abierta a cualquier autenticado.
- **No:** devolver los operadores vinculados a cada cliente. Se descarta: cambia la consulta a un agregado y es información de una pantalla que todavía no existe.
- **Sí:** filtrar por `clientes.isActive = 1`. Es lo que ya hace `getAllClientesByOperador`, y el listado sirve para operar, no para auditar.
- **No:** incluir los clientes inactivos con su bandera `isActive`. Se descarta: sería el primer endpoint del proyecto en exponer registros dados de baja, y es una decisión que merece su propio spec junto con el resto de la administración de clientes.
- **Sí:** `ORDER BY clientes.created_at ASC`. Decisión explícita del usuario, tomada durante la implementación. El listado global es una vista de administración, y ahí interesa el orden en que se dieron de alta los clientes más que el alfabético. Se anota la consecuencia: `created_at` es nullable, y MySQL pone los `NULL` primero en `ASC`, así que una fila sin fecha encabezaría la lista.
- **No:** `ORDER BY clientes.nombre ASC`, que era lo aprobado originalmente en este spec por ser idéntico a `getAllClientesByOperador`. Se descarta al implementar. Consecuencia asumida: los dos listados de clientes ya no comparten orden, así que la misma lista se ve distinta según la ruta que la pida.
- **No:** `ORDER BY clientes.created_at DESC` (los más nuevos arriba). Se descarta: se planteó al detectar el cambio y el usuario confirmó `ASC`.
- **No:** dejarlo sin `ORDER BY` como hace `GET /permisos/me`. Se descarta: allí el consumidor usa `includes` y el orden no significa nada; aquí sí.
- **No:** paginación con `?page` y `?limit`. Se descarta: ningún endpoint del proyecto pagina hoy, y agregarla implicaría un DTO de query con Zod, un conteo total y una forma de respuesta distinta a la de los otros listados. Se anota el riesgo de la respuesta sin límite en Risks.
- **Sí:** todo va en el módulo `clientes` existente. Es el mismo dominio y la misma tabla; un módulo nuevo no tendría qué contener.
- **Sí:** el handler no recibe `@Req()` ni lee `req.user`. Es lo que hace evidente en el código que el endpoint no discrimina por usuario: no hay ningún `userId` a mano con el que filtrar.
- **Sí:** sin DTO. El endpoint no recibe nada del cliente, así que no hay esquema Zod que escribir. Es la misma desviación consciente que tomó SPEC 07.
- **Sí:** el endpoint es privado, sin `@Public()`. El `JwtAuthGuard` global lo cubre sin escribir nada.
- **No:** validar `usuarios.isActive`. Se descarta por consistencia: ningún endpoint del proyecto lo valida hoy, y SPEC 05 y SPEC 07 tomaron la misma decisión explícita. Cuando se aplique, se aplica en todos a la vez.
- **Sí:** sin caché. Es un solo `SELECT` con un `LEFT JOIN`, y cachear introduciría el problema de invalidar cuando se crea un cliente.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **Un `Operador` puede ver todos los clientes llamando `GET /clientes/all`**, que es justo lo que el filtro de SPEC 01 evita. El filtro de `GET /clientes` queda evitable por la ruta de al lado. | **Sin mitigar por diseño**, por decisión explícita del usuario. Es el riesgo principal de este spec y la diferencia real con SPEC 06 y 07, que no abrían datos. Hay dos criterios de aceptación que lo verifican y lo dejan registrado como comportamiento esperado. La mitigación real es el spec del `PermissionsGuard`, que este spec vuelve más urgente de lo que era. |
| Alguien ve la fila `clientes.listar_todos` sembrada solo para `Admin` y asume que el endpoint está restringido a `Admin` | Se documenta en `CLAUDE.md` y hay un criterio de aceptación que verifica explícitamente que un `Operador` recibe 200 y no 403. |
| La app oculta la pantalla según `GET /permisos/me` y alguien asume que eso **es** el control de acceso | Mismo riesgo que ya anotó SPEC 07, ahora con consecuencia real: la respuesta de `GET /clientes/all` contiene datos de otros clientes, no solo un botón que no debería verse. |
| Sin paginación, la respuesta crece linealmente con la tabla `clientes` y en algún momento se vuelve pesada | Sin mitigar. Hoy la tabla tiene decenas de filas y los seis campos son cortos. Se anota para que la paginación se diseñe cuando haya un número real que la justifique, y no antes. |
| Si en el futuro se agrega `GET /clientes/:id`, Nest podría resolver `/clientes/all` contra ese handler según el orden de declaración | El spec de ese endpoint debe declarar `@Get('all')` **antes** que `@Get(':id')` en el controller. Se anota aquí porque el problema no existe todavía y es fácil de introducir sin notarlo. |
| El nombre real del rol en la base no es exactamente `Admin`, y el `INSERT` inserta cero filas en silencio | El paso 1 del plan verifica `SELECT id, nombre FROM roles;` antes de ejecutar, y el paso siguiente confirma el conteo por rol. Es el mismo riesgo y la misma mitigación de SPEC 06. |
| Se agrega un endpoint nuevo más adelante y nadie inserta su permiso | Sin mitigación automática: no hay migraciones ni validación en arranque. Es el riesgo heredado de SPEC 06 y sigue vigente. |

---

## What is **not** in this spec

- Aplicar el permiso: no hay `PermissionsGuard` ni decorador `@Permisos()`, y `GET /clientes/all` responde 200 a cualquier usuario autenticado, incluido un `Operador`.
- Verificar el permiso a mano dentro del repositorio.
- Cambios al payload del JWT ni a `req.user`.
- Cambios a `GET /clientes`, que mantiene su filtro por `cliente_operador`.
- Sembrar `clientes.listar_todos` para el rol `Operador`.
- Paginación, filtros por query y búsqueda.
- Clientes inactivos en la respuesta.
- Campos de `clientes` que hoy no expone ningún endpoint, y los operadores vinculados a cada cliente.
- `GET /clientes/:id`, `PUT`, `PATCH` y `DELETE` sobre clientes.
- Endpoints para gestionar los vínculos `cliente_operador` después de crear el cliente.
- Cualquier DDL o cambio en `src/database/types/types.ts`.
- Módulo, controller, service o DTO nuevos.
- Validación de `usuarios.isActive`.
- Caché de la respuesta.

Cada uno de estos, si se necesita, va en su propio spec.
