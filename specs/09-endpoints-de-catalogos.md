# SPEC 09 — Endpoints de catálogos

> **Status:** Implemented
> **Depends on:** SPEC 01, SPEC 02
> **Date:** 2026-08-30
> **Objective:** Agregar un módulo `catalogos` con tres endpoints de solo lectura (`GET /catalogos/productos`, `GET /catalogos/usuarios`, `GET /catalogos/unidades-medida`) que devuelven listas planas de `id` y nombre para llenar los selectores de los formularios existentes.

---

## Why this spec exists

Los formularios que ya existen piden ids que el cliente no tiene forma de conocer. `POST /clientes` recibe `producto_id` y un array `usuario_ids`; `POST /lotes` recibe `producto_id` y `unidad_medida_id`. Hoy no hay ningún endpoint que liste esas tres tablas, así que la app móvil o los tiene hardcodeados o los saca de MySQL a mano.

Este spec cierra ese hueco y nada más. No es el CRUD de productos, ni el de usuarios, ni el de unidades: son tres `SELECT` de lectura pensados para poblar un `<select>`.

Hay que ser explícito con dos cosas que este spec **no** resuelve.

La primera: igual que SPEC 06, 07 y 08, **no hay aplicación de permisos**. Los tres endpoints quedan accesibles para cualquier usuario autenticado. A diferencia de SPEC 08, aquí se decidió además **no sembrar ninguna fila en `permisos`**, rompiendo la regla de una fila por endpoint que fijó SPEC 06. La consecuencia se registra en Decisions y Risks.

La segunda: `GET /catalogos/usuarios` devuelve **todos** los usuarios activos, sin filtrar por rol y sin filtrar por vínculo `cliente_operador`. Es el segundo endpoint del proyecto, después de `GET /clientes/all`, que expone datos de toda la tabla a cualquier autenticado. Los campos se recortaron a `id` y `complete_name` precisamente por eso.

---

## Scope

**In:**

- Nuevo módulo `src/modules/catalogos/` con `catalogos.module.ts`, `catalogos.controller.ts`, `catalogos.service.ts` y `repository/catalogos.repository.ts`.
- Registro de `CatalogosModule` en `src/app.module.ts`.
- Tres endpoints nuevos, todos `GET`, todos protegidos únicamente por el `JwtAuthGuard` global (ninguno lleva `@Public()`):
  - `GET /catalogos/productos` → `{ ok, msg, data }`
  - `GET /catalogos/usuarios` → `{ ok, msg, data }`
  - `GET /catalogos/unidades-medida` → `{ ok, msg, data }`
- Los tres endpoints devuelven la misma forma `{ id, nombre }` por elemento y la misma clave de payload `data`.
- Los tres endpoints no aceptan parámetros de ruta, query ni body, y ninguno lee `req.user`.
- `productos`: campos `id` y `nombre`, filtro `isActive = 1`, `ORDER BY nombre ASC`.
- `usuarios`: campos `id` y `nombre` (alias de la columna `complete_name`), filtro `isActive = 1`, `ORDER BY complete_name ASC`. Sin filtro por rol.
- `unidades_medida`: campos `id` y `nombre`, sin filtro (la tabla no tiene columna `isActive`), `ORDER BY nombre ASC`.
- `200` con array vacío cuando la tabla no tiene filas que cumplan el filtro.
- Actualizar `CLAUDE.md`: fila nueva `catalogos` en la tabla de endpoints y nota de que son los primeros endpoints de lectura de `productos`, `usuarios` y `unidades_medida`.

**Out of scope (for future specs):**

- Sembrar filas en `permisos` para estos tres endpoints. Se decidió explícitamente no hacerlo (ver Decisions). La tabla sigue con las 11 filas de SPEC 08.
- **Aplicar** permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`. Los tres endpoints responden 200 a cualquier usuario autenticado, `Operador` incluido.
- Un endpoint combinado `GET /catalogos` que devuelva los tres arrays en una sola llamada.
- Filtrar `GET /catalogos/usuarios` por rol, por vínculo `cliente_operador` o por cualquier query param.
- Devolver el rol del usuario (`rol_id` o el nombre resuelto por join a `roles`).
- Devolver `username` o `cedula` en el catálogo de usuarios.
- Devolver `codigo_upc` o `descripcion` en el catálogo de productos.
- Devolver `codigo` en el catálogo de unidades de medida.
- Devolver `password`, en ninguna forma y bajo ningún campo.
- Catálogos de las otras tablas de referencia: `roles`, `estados_calidad` y `etapas`.
- CRUD de productos, usuarios o unidades de medida: `POST`, `PUT`, `PATCH`, `DELETE` y `GET /catalogos/productos/:id`.
- Paginación, filtros por query y búsqueda de texto.
- Devolver filas con `isActive = 0`, y devolver la columna `isActive` en la respuesta.
- Caché de las respuestas, en cualquier forma.
- Cualquier DDL: las cuatro tablas involucradas ya existen y no cambian. `src/database/types/types.ts` no se toca.
- Agregar `isActive` a `unidades_medida`.
- Cambios a `POST /clientes` o `POST /lotes`, que siguen validando los ids que reciben exactamente como hoy.
- DTOs: ningún endpoint recibe nada del cliente.

---

## Data model

**Este spec no hace ningún cambio de esquema**: no agrega tablas, columnas ni constraints, y no ejecuta DDL. `src/database/types/types.ts` queda igual — `ProductosTable`, `UsuariosTable` y `UnidadMedidaTable` ya existen.

Tampoco agrega ningún DTO ni carpeta `dto/`: los tres endpoints no reciben body, ni parámetros de ruta, ni query. Es la misma desviación consciente de la estructura de módulo que tomaron SPEC 07 y SPEC 08.

Tampoco cambia la tabla `permisos`: sigue con las **11 filas** de SPEC 08 (siete de `Admin`, cuatro de `Operador`). Este spec no ejecuta ningún `INSERT`.

Recordatorio de `types.ts`: la clave de la interfaz `Database` para unidades es **`unidades_medida`** (plural), aunque la interfaz se llame `UnidadMedidaTable`. En las consultas se usa la forma plural.

### Las tres consultas

```sql
-- GET /catalogos/productos
SELECT id, nombre
FROM productos
WHERE isActive = 1
ORDER BY nombre ASC;

-- GET /catalogos/usuarios
SELECT id, complete_name AS nombre
FROM usuarios
WHERE isActive = 1
ORDER BY complete_name ASC;

-- GET /catalogos/unidades-medida
SELECT id, nombre
FROM unidades_medida
ORDER BY nombre ASC;
```

Ninguna consulta lleva `JOIN`. La de usuarios es la única con alias: `complete_name` sale como `nombre` para que los tres catálogos tengan la misma forma. El `ORDER BY` usa el nombre real de la columna, no el alias.

`unidades_medida.nombre` es nullable (`string | null` en `types.ts`). MySQL ordena `NULL` primero en `ASC`, así que una unidad sin nombre encabeza la lista y llega como `nombre: null`. Se acepta: la tabla la mantiene el equipo a mano y son pocas filas.

`usuarios.isActive` también es nullable (`number | null`). El filtro es `= 1`, así que una fila con `isActive = NULL` **no** aparece. Mismo criterio en `productos.isActive`.

### Respuestas (200)

```json
{
  "ok": true,
  "msg": "Productos obtenidos correctamente",
  "data": [
    { "id": 1, "nombre": "Camaron" },
    { "id": 2, "nombre": "Tilapia" }
  ]
}
```

```json
{
  "ok": true,
  "msg": "Usuarios obtenidos correctamente",
  "data": [
    { "id": 3, "nombre": "Ana Lopez" },
    { "id": 1, "nombre": "Juan Perez" }
  ]
}
```

```json
{
  "ok": true,
  "msg": "Unidades de medida obtenidas correctamente",
  "data": [
    { "id": 2, "nombre": "Kilogramo" },
    { "id": 1, "nombre": "Libra" }
  ]
}
```

Respuesta (200) cuando no hay filas que cumplan el filtro. La clave es `data` en los tres endpoints; solo cambia el `msg`:

```json
{
  "ok": true,
  "msg": "Productos obtenidos correctamente",
  "data": []
}
```

---

## Implementation plan

1. Crear `src/modules/catalogos/repository/catalogos.repository.ts` con `CatalogosRepository`: inyecta `DatabaseService` y expone el getter `db` (`return this.dbService.client`) siguiendo la forma de `ClientesRepository`. Agregar `getProductos()`: `selectFrom('productos')`, `select(['id', 'nombre'])`, `where('isActive', '=', 1)`, `orderBy('nombre', 'asc')`. Sin parámetros.
2. Agregar `getUsuarios()` al mismo repositorio: `selectFrom('usuarios')`, `select(['id', 'complete_name as nombre'])`, `where('isActive', '=', 1)`, `orderBy('complete_name', 'asc')`. El `orderBy` usa la columna real, no el alias. Sin parámetros y sin join a `roles`.
3. Agregar `getUnidadesMedida()` al mismo repositorio: `selectFrom('unidades_medida')` (clave plural), `select(['id', 'nombre'])`, `orderBy('nombre', 'asc')`. Sin `where`.
4. Crear `src/modules/catalogos/catalogos.service.ts` con `CatalogosService`: tres métodos pass-through al repositorio (`findProductos`, `findUsuarios`, `findUnidadesMedida`), sin parámetros, igual en forma a `ClientesService`.
5. Crear `src/modules/catalogos/catalogos.controller.ts` con `@Controller('catalogos')` y tres handlers: `@Get('productos')`, `@Get('usuarios')` y `@Get('unidades-medida')`. Ninguno recibe `@Req()`, `@Body()`, `@Param()` ni `@Query()`. Ninguno lleva `@Public()`. Responden `{ ok: true, msg: 'Productos obtenidos correctamente', data }`, `{ ok: true, msg: 'Usuarios obtenidos correctamente', data }` y `{ ok: true, msg: 'Unidades de medida obtenidas correctamente', data }` respectivamente: la clave es `data` en los tres y solo cambia el `msg`.
6. Crear `src/modules/catalogos/catalogos.module.ts` con `imports: [DatabaseModule]`, `controllers: [CatalogosController]` y `providers: [CatalogosService, CatalogosRepository]`, siguiendo la forma de `LotesModule`.
7. Registrar `CatalogosModule` en el array `imports` de `src/app.module.ts`.
8. Levantar con `npm run start:dev` y confirmar que compila y que las tres rutas aparecen en el log de rutas de Nest.
9. Verificación manual: login con un `Admin` y llamar los tres endpoints, comparando cada conteo contra su `SELECT COUNT(*)` con el mismo filtro; poner `isActive = 0` en un producto y confirmar que desaparece; llamar los tres sin header `Authorization` y confirmar 401 en cada uno.
10. Verificación manual del comportamiento no aplicado: login con un `Operador` y confirmar que los tres endpoints responden **200**, no 403; llamar `GET /permisos/me` con ese token y confirmar que sigue devolviendo exactamente cuatro códigos, sin ninguno de catálogos.
11. Actualizar `CLAUDE.md`: agregar la fila `catalogos` a la tabla de endpoints implementados con los tres `GET` y sus campos; anotar que son los primeros endpoints de lectura de `productos`, `usuarios` y `unidades_medida`; anotar que **no tienen permiso sembrado**, a diferencia de `GET /clientes/all`, y por qué; y anotar que `GET /catalogos/usuarios` expone el `id` y el nombre completo de todos los usuarios activos a cualquier autenticado.

---

## Acceptance criteria

- [X] El esquema de MySQL no cambió: no se ejecutó ningún DDL en esta implementación.
- [X] `src/database/types/types.ts` no cambió.
- [X] La tabla `permisos` sigue teniendo exactamente las 11 filas de SPEC 08: no se sembró ninguna fila nueva.
- [X] La app arranca sin errores de compilación (`npm run start:dev`).
- [X] Existen los cuatro archivos del módulo bajo `src/modules/catalogos/` y **no** hay carpeta `dto/`.
- [X] `CatalogosModule` está registrado en `src/app.module.ts`.
- [X] Las tres rutas `GET /catalogos/productos`, `GET /catalogos/usuarios` y `GET /catalogos/unidades-medida` aparecen en el log de rutas de Nest al arrancar.
- [X] No se modificó ningún archivo de los módulos `auth`, `clientes`, `lotes`, `pesajes` ni `permisos`.
- [X] Los tres endpoints responden con la forma `{ ok, msg, data }`: la clave del payload es exactamente `data` en los tres.
- [X] Ninguna respuesta usa una clave nombrada por catálogo: no hay `productos`, `usuarios` ni `unidades_medida` como clave de payload.
- [X] Los tres endpoints devuelven elementos con exactamente las mismas dos claves: `id` y `nombre`.
- [X] `GET /catalogos/productos` con un token válido responde 200 y su `msg` es `Productos obtenidos correctamente`.
- [X] La respuesta de productos no incluye `codigo_upc`, `descripcion`, `isActive` ni `created_at`.
- [X] La cantidad de elementos de `data` coincide con `SELECT COUNT(*) FROM productos WHERE isActive = 1`.
- [X] Un producto con `isActive = 0` no aparece; ponerlo en `1` lo hace aparecer.
- [X] Los productos vienen ordenados por `nombre` ascendente.
- [X] `GET /catalogos/usuarios` con un token válido responde 200 y su `msg` es `Usuarios obtenidos correctamente`.
- [X] Cada elemento trae el nombre completo bajo la clave `nombre`, no bajo `complete_name`: es un alias en el `SELECT`.
- [X] La respuesta de usuarios **no incluye `password`** en ninguna forma, ni `username`, `cedula`, `rol_id`, `rol`, `isActive`, `created_at`, `updated_at` ni `created_by`.
- [X] La cantidad de elementos de `data` coincide con `SELECT COUNT(*) FROM usuarios WHERE isActive = 1`.
- [X] Un usuario con `isActive = 0` no aparece en la respuesta.
- [X] La respuesta de usuarios incluye tanto `Admin` como `Operador`: el endpoint no filtra por rol.
- [X] Un `Operador` sin ninguna fila en `cliente_operador` recibe igual la lista completa de usuarios activos.
- [X] Los usuarios vienen ordenados por `complete_name` ascendente, aunque el campo se devuelva como `nombre`.
- [X] `GET /catalogos/unidades-medida` con un token válido responde 200 y su `msg` es `Unidades de medida obtenidas correctamente`.
- [X] La respuesta de unidades no incluye `codigo` ni `created_at`.
- [X] La cantidad de elementos de `data` coincide con `SELECT COUNT(*) FROM unidades_medida`: no hay ningún filtro.
- [X] Una unidad con `nombre = NULL` aparece en la respuesta con `nombre: null` y va primero en el orden.
- [X] Los tres endpoints devuelven 200 con `data: []`, no 404, cuando ninguna fila cumple el filtro.
- [X] Los tres endpoints responden 401 sin header `Authorization`: ninguno es `@Public()`.
- [X] Los tres endpoints responden 401 con un token expirado o firmado con otro secreto.
- [X] Los tres endpoints ignoran cualquier query param: `GET /catalogos/productos?isActive=0` devuelve lo mismo que sin el parámetro.
- [X] Los tres endpoints responden **200 con la lista completa** para el token de un `Operador`, no 403: **este spec no aplica permisos**.
- [X] `GET /permisos/me` responde exactamente igual que antes de este spec: siete códigos para `Admin` y cuatro para `Operador`, ninguno de catálogos.
- [X] No existe la ruta `GET /catalogos` (sin segmento): responde 404.
- [X] `POST /auth/login` y `POST /auth/register` responden exactamente igual que antes de este spec.
- [X] El payload del JWT no cambió y `req.user` sigue siendo `{ userId, username }`.
- [X] `POST /clientes`, `GET /clientes`, `GET /clientes/all` (SPEC 01, SPEC 08), `POST /lotes`, `GET /lotes/cliente/:clienteId` (SPEC 02), `POST /pesajes` (SPEC 03, SPEC 04), `POST /auth/refresh` (SPEC 05) y `GET /permisos/me` (SPEC 07) siguen funcionando igual.
- [X] `CLAUDE.md` lista los tres endpoints de `catalogos` y anota que no tienen permiso sembrado.

---

## Decisions

- **Sí:** un solo módulo `src/modules/catalogos/` con tres endpoints bajo `GET /catalogos/*`. Decisión explícita del usuario. Es un spec, un módulo, y el prefijo dice para qué son: listas de apoyo para formularios, no dominios con vida propia.
- **No:** tres módulos separados (`productos`, `usuarios`, `unidades-medida`) con rutas raíz. Se descarta: serían 12 archivos y tres registros en `app.module.ts` para tres `SELECT` de dos columnas. Se anota la consecuencia asumida: cuando llegue el CRUD real de productos o de usuarios, esos módulos habrá que crearlos y habrá que decidir si el endpoint de catálogo se mueve o se duplica.
- **No:** un módulo `catalogos` con tres controllers de rutas raíz (`GET /productos`, `GET /usuarios`). Se descarta: daría rutas más cortas, pero ocuparía los nombres de ruta que el CRUD futuro va a querer, y esconde que las tres listas son recortes para selectores y no el recurso completo.
- **Sí:** el segmento es `unidades-medida`, en kebab-case. Es la forma habitual en una URL y evita el guion bajo de la tabla.
- **Sí:** la clave del payload es `data` en los tres endpoints. Decisión explícita del usuario, tomada al editar el spec antes de implementarlo. Los tres catálogos devuelven la misma forma, así que el cliente puede tipar un solo envoltorio genérico y reusar un componente de selector. Consecuencia asumida y registrada: **el proyecto queda con dos estilos de respuesta**, porque los cuatro `GET` anteriores (`clientes`, `clientes/all`, `lotes/cliente/:id`, `permisos/me`) usan una clave nombrada. Nadie debe "corregir" esto más adelante creyendo que fue un descuido.
- **No:** una clave nombrada por catálogo (`productos`, `usuarios`, `unidades_medida`), que era lo aprobado originalmente en este spec por consistencia con los cuatro `GET` existentes. Se descarta antes de implementar, por la decisión anterior.
- **No:** `unidades_medida` como clave, con guion bajo, para coincidir con el nombre de la tabla y con la clave de `Database` en `types.ts`. Se descarta por la decisión anterior. Queda anotado que ningún payload del proyecto usa camelCase, por si la clave vuelve a discutirse.
- **Sí:** el nombre completo del usuario se devuelve bajo la clave `nombre`, como alias de `complete_name` en el `SELECT`. Decisión explícita del usuario, tomada al editar el spec antes de implementarlo. Es lo que hace que los tres catálogos tengan la forma idéntica `{ id, nombre }`. El precedente en el proyecto es `productos.nombre as producto` en `ClientesRepository`.
- **No:** devolver la columna con su nombre real `complete_name`, que era lo aprobado originalmente. Se descarta antes de implementar. Consecuencia asumida: la clave de la respuesta ya no dice qué columna es, así que el `ORDER BY` sigue siendo por `complete_name` mientras el campo sale como `nombre`, y eso solo se entiende leyendo el repositorio.
- **Sí:** `GET /catalogos/usuarios` devuelve **todos** los usuarios activos, sin filtrar por rol. Decisión explícita del usuario, tomada después de que se le señalara que el consumidor probable es el selector de `usuario_ids` de `POST /clientes`, que vincula operadores. Deja el endpoint servible para otras pantallas sin cambiar el contrato.
- **No:** filtrar por el rol `Operador` con un join a `roles`. Se descarta pese a ser lo que `POST /clientes` necesita hoy. Consecuencia asumida: la app tiene que saber por su cuenta cuáles de los usuarios de la lista tiene sentido vincular, porque la respuesta no dice el rol de nadie.
- **No:** un filtro opcional `?rol_id=` por query. Se descarta: exigiría el primer DTO Zod de query del proyecto, y ningún `GET` existente recibe parámetros.
- **Sí:** el catálogo de usuarios devuelve solo dos campos, `id` y el nombre completo. Decisión explícita del usuario. Es lo mínimo para un selector y, en una ruta abierta a cualquier autenticado, es lo mínimo que se expone.
- **No:** devolver el rol resuelto por join a `roles`. Se descarta por la decisión anterior. Es la información que más se va a echar de menos, y su ausencia es la contrapartida de no filtrar por rol.
- **No:** devolver `username`. Se descarta: es nullable en el esquema, así que llegaría `null` en parte de las filas, y no aporta nada a un selector que ya muestra el nombre completo.
- **No:** devolver `cedula`. Se descarta: es un dato de identificación personal y esta ruta no tiene ningún control de acceso más allá del JWT.
- **Sí:** el catálogo de productos devuelve solo `id` y `nombre`. Decisión explícita del usuario. Es exactamente lo que `POST /clientes` y `POST /lotes` necesitan para su `producto_id`.
- **No:** devolver `codigo_upc` ni `descripcion`. Se descarta: son nullable y sirven a una pantalla de administración de productos que todavía no existe.
- **Sí:** el catálogo de unidades devuelve solo `id` y `nombre`. Decisión explícita del usuario.
- **No:** devolver `codigo` (`kg`, `lb`). Se descarta pese a que es lo que se muestra junto a un peso. Consecuencia asumida: si la pantalla de pesaje necesita mostrar la abreviatura, hay que agregar el campo, y eso cambia el contrato.
- **Sí:** filtrar `productos.isActive = 1` y `usuarios.isActive = 1`. Decisión explícita del usuario. Es lo que ya hacen `clientes` y `permisos`, y un producto o un usuario dado de baja no debe poder elegirse en un registro nuevo.
- **Sí:** `unidades_medida` va sin filtro. La tabla no tiene columna `isActive` y este spec no ejecuta DDL para agregarla.
- **No:** agregar `isActive` a `unidades_medida`. Se descarta: sería el único DDL del spec, para una tabla de pocas filas fijas que nadie ha pedido dar de baja.
- **Sí:** `ORDER BY nombre ASC` en los tres (`complete_name` en usuarios). Decisión explícita del usuario. Son selectores y ahí el orden alfabético es el que el usuario espera. Consecuencia anotada: `unidades_medida.nombre` es nullable y MySQL pone los `NULL` primero.
- **No:** `ORDER BY id ASC`. Se descarta: es estable, pero el orden de inserción no significa nada para quien elige en una lista.
- **No:** sin `ORDER BY`, como `GET /permisos/me`. Se descarta: allí el consumidor usa `includes` y el orden no importa; aquí el orden es lo que se ve en pantalla.
- **Sí:** tres endpoints separados. Decisión explícita del usuario. Cada pantalla pide la lista que necesita.
- **No:** un endpoint combinado `GET /catalogos` que devuelva los tres arrays. Se descarta: serían dos contratos que mantener sincronizados para el mismo dato. Si la app termina precargando todo al abrir, se agrega en su propio spec.
- **No:** solo el endpoint combinado, sin los individuales. Se descarta: obligaría a traer las tres listas para necesitar una.
- **Sí:** ninguna fila nueva en `permisos`. Decisión explícita del usuario. Se rompe a propósito la regla de SPEC 06 de una fila por endpoint. La justificación registrada: son listas de referencia que todo usuario autenticado necesita para poder usar los formularios que ya tiene permitidos, así que un permiso propio nunca se le negaría a nadie.
- **No:** sembrar `productos.listar`, `usuarios.listar` y `unidades_medida.listar` para `Admin` y `Operador` (seis filas, tabla en 17). Se descarta pese a ser lo que la convención pide. Consecuencia asumida: cuando llegue el `PermissionsGuard`, estos tres endpoints no tendrán código de permiso que exigir, y habrá que decidir ahí si se dejan libres para cualquier autenticado o se siembran las filas en ese momento. Es la segunda excepción a la regla de SPEC 06, después de `GET /permisos/me`, y a diferencia de aquella no es circular: es una decisión de conveniencia.
- **No:** sembrar `usuarios.listar` solo para `Admin`. Se descarta por la decisión anterior.
- **Sí:** los tres endpoints son privados, sin `@Public()`. El `JwtAuthGuard` global los cubre sin escribir nada.
- **Sí:** ningún handler lee `req.user`. Es lo que hace evidente en el código que los endpoints no discriminan por usuario: no hay ningún `userId` a mano con el que filtrar.
- **Sí:** sin DTO ni carpeta `dto/`. Ningún endpoint recibe nada del cliente. Es la misma desviación consciente de SPEC 07 y SPEC 08.
- **Sí:** las tres consultas viven en un solo `CatalogosRepository`. Son `SELECT` sin lógica de dominio, así que aquí el repositorio sí es puro acceso a datos, a diferencia del resto del proyecto.
- **No:** validar nada en el repositorio. No hay nada que validar: no hay entrada.
- **Sí:** 200 con array vacío cuando no hay filas. Es el precedente de SPEC 07 y SPEC 08: una tabla vacía es una respuesta válida, no un error.
- **No:** incluir filas inactivas con su bandera `isActive` y que el cliente filtre. Se descarta: trasladaría al front una decisión ya tomada.
- **Sí:** sin caché. Son tres `SELECT` sin join sobre tablas de pocas filas, y cachear introduciría el problema de invalidar cuando alguien edita las tablas a mano por SQL.
- **No:** catálogos de `roles`, `estados_calidad` y `etapas`. Se descarta: el usuario pidió tres tablas concretas. `roles` haría falta para un CRUD de usuarios, `estados_calidad` dejará de necesitarse en el cliente cuando SPEC 04 derive el estado en el backend, y `etapas` ni siquiera está poblada.
- **No:** cualquier CRUD sobre las tres tablas. Se descarta: cada uno es un spec propio, con validación de unicidad y decisiones de baja lógica que este spec no toca.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| `GET /catalogos/usuarios` expone el `id` y el nombre completo de **todos** los usuarios activos a cualquier autenticado. Un `Operador` puede enumerar la plantilla completa, incluidos los `Admin`. | Parcialmente mitigado por diseño: los campos se recortaron a dos y `password`, `username` y `cedula` quedan fuera. Lo que se expone son nombres de personas y sus ids, no credenciales. La mitigación real es el `PermissionsGuard`. Hay criterios de aceptación que verifican los campos exactos de la respuesta. |
| Es el segundo endpoint del proyecto, después de `GET /clientes/all`, que ignora cualquier filtro por vínculo. La superficie abierta a un `Operador` crece spec a spec. | **Sin mitigar por diseño**, por decisión explícita del usuario. Se anota para que quede el registro acumulado: el spec del `PermissionsGuard` ya era urgente después de SPEC 08 y este lo vuelve más urgente. |
| Al no sembrar filas en `permisos`, el spec del `PermissionsGuard` va a encontrar tres endpoints sin código de permiso y no va a saber si fue decisión o descuido. | Queda registrado aquí, en dos decisiones y en `CLAUDE.md`, con la justificación explícita. El paso 11 del plan lo incluye. |
| Alguien asume que `GET /catalogos/usuarios` devuelve solo operadores, porque el uso que lo motivó es el selector de `usuario_ids` de `POST /clientes`, y vincula un `Admin` por error. | Sin mitigar en el backend: `POST /clientes` valida que el usuario exista, no su rol. Hay un criterio de aceptación que verifica explícitamente que la respuesta incluye ambos roles. |
| Sin paginación, las tres respuestas crecen linealmente con sus tablas. `usuarios` es la que más puede crecer. | Sin mitigar. Son dos columnas cortas por fila y hoy son decenas de filas. La paginación se diseña cuando haya un número real que la justifique, igual que decidió SPEC 08. |
| `unidades_medida.nombre` es nullable: una fila sin nombre llega como `nombre: null` y encabeza la lista, dejando una opción en blanco en el selector. | Sin mitigar en el backend, por decisión de no filtrar. Está en los criterios de aceptación como comportamiento esperado. La tabla se mantiene a mano y son pocas filas. |
| Se agrega una columna útil a `productos` o a `usuarios` y nadie recuerda que el catálogo la recorta a propósito. | Los campos exactos están en Scope, en Decisions y en criterios de aceptación que cuentan las claves de cada elemento. |
| La clave `data` de estos tres endpoints no coincide con la clave nombrada de los cuatro `GET` anteriores, así que el proyecto tiene dos estilos de respuesta y alguien "corrige" uno de los dos. | Registrado como decisión explícita, con la consecuencia escrita y dos criterios de aceptación que fijan que la clave es `data` y que **no** hay claves nombradas. Si algún día se unifica, se unifica en un spec propio y en una sola dirección para los siete endpoints. |

---

## What is **not** in this spec

- Sembrar filas en `permisos`: la tabla sigue con las 11 filas de SPEC 08.
- Aplicar permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`, y los tres endpoints responden 200 a cualquier usuario autenticado, `Operador` incluido.
- Un endpoint combinado `GET /catalogos`.
- Filtrar usuarios por rol, por vínculo `cliente_operador` o por query param.
- Devolver el rol, `username` o `cedula` de los usuarios; `codigo_upc` o `descripcion` de los productos; `codigo` de las unidades.
- Devolver `password` en ninguna forma.
- Catálogos de `roles`, `estados_calidad` y `etapas`.
- CRUD de productos, usuarios o unidades de medida, y endpoints por id.
- Paginación, filtros por query y búsqueda.
- Filas inactivas en la respuesta.
- Caché.
- Cualquier DDL, incluido agregar `isActive` a `unidades_medida`, y cualquier cambio en `src/database/types/types.ts`.
- Cambios a `POST /clientes` o `POST /lotes`.
- DTOs y carpeta `dto/`.

Cada uno de estos, si se necesita, va en su propio spec.
