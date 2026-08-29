# SPEC 07 — Consultar los permisos del usuario autenticado

> **Status:** Implemented
> **Depends on:** SPEC 06
> **Date:** 2026-08-29
> **Objective:** Agregar `GET /permisos/me`, que resuelve el rol del usuario del JWT y devuelve un array plano con los `codigo` de sus permisos activos.

---

## Why this spec exists

SPEC 06 creó la tabla `permisos` y la sembró, pero dejó escrito que **nada la lee**: no hay módulo, no hay endpoint y ningún repositorio la consulta. Hoy la única forma de saber qué permisos tiene un rol es abrir MySQL.

Este spec es el primero que la lee. Su consumidor es la app móvil: con el array de códigos en mano puede ocultar el botón "Crear cliente" para un `Operador` en vez de dejar que el usuario lo presione y reciba un error.

Es importante lo que este spec **no** hace: no aplica los permisos. Devolverle a la app la lista de lo que puede hacer no impide que llame igual a `POST /clientes` con curl y reciba un 201. La aplicación real (un `PermissionsGuard` con un decorador `@Permisos()`) sigue siendo un spec futuro. Este solo expone el dato, y la seguridad sigue dependiendo de que ese spec llegue.

---

## Scope

**In:**

- Nuevo módulo `src/modules/permisos/` con `permisos.module.ts`, `permisos.controller.ts`, `permisos.service.ts` y `repository/permisos.repository.ts`.
- Registro de `PermisosModule` en `src/app.module.ts`.
- Nuevo endpoint `GET /permisos/me`, protegido por el `JwtAuthGuard` global (no lleva `@Public()`).
- El `userId` sale exclusivamente de `req.user`; el endpoint no acepta parámetros de ruta, query ni body.
- Resolución en dos consultas: `usuarios` para obtener el `rol_id`, y `permisos` para obtener los códigos.
- Filtro por `permisos.isActive = 1`.
- Respuesta con un array plano de strings (`permisos: string[]`), en la forma `{ ok, msg, permisos }`.
- `404` cuando el `userId` del token no existe en `usuarios`.
- `200` con `permisos: []` cuando el rol existe pero no tiene filas activas en `permisos`.
- Actualizar `CLAUDE.md`: nueva fila `permisos` en la tabla de endpoints y corregir la nota de la sección de auth que hoy afirma que nada lee la tabla.

**Out of scope (for future specs):**

- **Aplicar** los permisos: no hay `PermissionsGuard` ni decorador `@Permisos('clientes.crear')`. Todos los endpoints existentes siguen accesibles para cualquier usuario autenticado.
- Cambios al payload del JWT o a `req.user`, que sigue siendo `{ userId, username }`.
- Devolver `permisos` en la respuesta de `POST /auth/login` o de `POST /auth/refresh`.
- Cualquier otro endpoint del módulo: no hay `GET /permisos` (todos los del sistema), ni `GET /permisos/rol/:rolId`, ni `GET /usuarios/:id/permisos`.
- CRUD de permisos: siguen administrándose por SQL a mano, como decidió SPEC 06.
- CRUD de roles.
- Sembrar un permiso nuevo en la tabla para este endpoint.
- Cualquier DDL: la tabla `permisos` y `PermisosTable` ya existen desde SPEC 06 y no cambian.
- Validar `usuarios.isActive`.
- Caché de la respuesta, en cualquier forma.
- Devolver `nombre`, `descripcion` o el rol del usuario junto con los códigos.

---

## Data model

**Este spec no hace ningún cambio de esquema**: no agrega tablas, columnas ni constraints, y no ejecuta DDL. `src/database/types/types.ts` queda igual — `PermisosTable` y la clave `permisos` en la interfaz `Database` ya existen desde SPEC 06.

Tampoco agrega ningún DTO: el endpoint no recibe body, ni parámetros de ruta, ni query. Por eso no hay carpeta `dto/` en el módulo, a diferencia de los otros módulos del proyecto.

Respuesta de `GET /permisos/me` (200) para un usuario con rol `Operador`:

```json
{
  "ok": true,
  "msg": "Permisos obtenidos correctamente",
  "permisos": [
    "clientes.listar",
    "lotes.crear",
    "lotes.listar",
    "pesajes.crear"
  ]
}
```

Respuesta (200) para un rol sin permisos activos:

```json
{
  "ok": true,
  "msg": "Permisos obtenidos correctamente",
  "permisos": []
}
```

Respuesta de error (404) cuando el `userId` del token no existe en `usuarios`:

```json
{
  "statusCode": 404,
  "message": "Usuario no encontrado",
  "error": "Not Found"
}
```

Las dos consultas del repositorio, en orden:

```sql
-- 1. Resolver el rol. Si no hay fila -> 404.
SELECT rol_id FROM usuarios WHERE id = ?;

-- 2. Códigos activos de ese rol. Si no hay filas -> [].
SELECT codigo FROM permisos WHERE rol_id = ? AND isActive = 1;
```

El array se arma con `rows.map((r) => r.codigo)`, sin `ORDER BY`.

---

## Implementation plan

1. Crear `src/modules/permisos/repository/permisos.repository.ts` con `PermisosRepository`: inyecta `DatabaseService`, expone el getter `db` siguiendo el patrón de los otros repositorios, y agrega `getPermisosByUsuarioId(usuarioId: number): Promise<string[]>`. Primero consulta `usuarios` por `id` seleccionando `rol_id`; si no hay fila, lanza `NotFoundException('Usuario no encontrado')`. Luego consulta `permisos` filtrando por `rol_id` e `isActive = 1`, y devuelve el `map` de `codigo`.
2. Crear `src/modules/permisos/permisos.service.ts` con `PermisosService` como pass-through al repositorio, igual que `ClientesService`.
3. Crear `src/modules/permisos/permisos.controller.ts` con `@Controller('permisos')` y `GET me`: lee `const { userId } = req.user as { userId: number }`, llama al servicio y responde `{ ok: true, msg: 'Permisos obtenidos correctamente', permisos }`. Sin `@Public()`.
4. Crear `src/modules/permisos/permisos.module.ts` con `imports: [DatabaseModule]`, el controller y el service más el repository como providers, siguiendo la forma de `LotesModule`.
5. Registrar `PermisosModule` en el array `imports` de `src/app.module.ts`.
6. Levantar con `npm run start:dev` y confirmar que compila y que la ruta aparece en el log de rutas de Nest.
7. Verificación manual: hacer login con un `Admin` y llamar `GET /permisos/me` con su token, esperando los seis códigos; repetir con un `Operador`, esperando los cuatro de SPEC 06; llamar sin header `Authorization` y confirmar 401.
8. Actualizar `CLAUDE.md`: agregar la fila `permisos` a la tabla de endpoints implementados y corregir la nota de la sección de auth, que hoy dice que **nada** lee la tabla `permisos` — a partir de este spec la lee `GET /permisos/me`, pero sigue sin aplicarse en ningún guard.

---

## Acceptance criteria

- [X] El esquema de MySQL no cambió: no se ejecutó ningún DDL en esta implementación.
- [X] `src/database/types/types.ts` no cambió.
- [X] La tabla `permisos` sigue teniendo las mismas 10 filas de SPEC 06: no se sembró ninguna fila nueva.
- [X] La app arranca sin errores de compilación (`npm run start:dev`).
- [X] Existen los cuatro archivos del módulo bajo `src/modules/permisos/` y no hay carpeta `dto/`.
- [X] `PermisosModule` está registrado en `src/app.module.ts`.
- [X] `GET /permisos/me` con el token de un `Admin` responde 200 con un array de exactamente seis strings.
- [X] Ese array contiene `clientes.crear`, `clientes.listar`, `lotes.crear`, `lotes.listar`, `pesajes.crear` y `usuarios.crear`.
- [X] `GET /permisos/me` con el token de un `Operador` responde 200 con un array de exactamente cuatro strings: `clientes.listar`, `lotes.crear`, `lotes.listar` y `pesajes.crear`.
- [X] El array del `Operador` **no** contiene `clientes.crear` ni `usuarios.crear`.
- [X] Los elementos del array son strings planos, no objetos: `permisos[0]` es `"clientes.listar"` y no `{ codigo: "clientes.listar" }`.
- [X] Poner `isActive = 0` en una fila de `permisos` hace que su `codigo` desaparezca de la respuesta del rol correspondiente, y devolverlo a `1` lo hace reaparecer.
- [X] Un usuario cuyo rol no tiene ninguna fila activa en `permisos` recibe 200 con `permisos: []`, no un 404.
- [X] Un token válido cuyo `user_id` no existe en `usuarios` recibe 404 con el mensaje `Usuario no encontrado`.
- [X] `GET /permisos/me` sin header `Authorization` responde 401: el endpoint no es `@Public()`.
- [X] `GET /permisos/me` con un token expirado o firmado con otro secreto responde 401.
- [X] La respuesta no incluye `nombre`, `descripcion`, `id` ni datos del rol.
- [X] El endpoint no acepta un `userId` por ruta, query ni body: `GET /permisos/me?userId=1` devuelve los permisos del usuario del token, ignorando el parámetro.
- [X] `POST /clientes` sigue respondiendo 201 para un usuario con rol `Operador`: **este spec no bloquea nada**.
- [X] `POST /auth/login` responde exactamente igual que antes de este spec, sin clave `permisos`.
- [X] El payload del JWT no cambió: sigue siendo `sub`, `user_id` y `username`.
- [X] `req.user` sigue siendo `{ userId, username }`.
- [X] `POST /clientes`, `GET /clientes` (SPEC 01), `POST /lotes`, `GET /lotes/cliente/:clienteId` (SPEC 02), `POST /pesajes` (SPEC 03, SPEC 04) y `POST /auth/refresh` (SPEC 05) siguen funcionando igual.
- [X] `CLAUDE.md` lista `GET /permisos/me` en la tabla de endpoints y ya no afirma que nada lee la tabla `permisos`.

---

## Decisions

- **Sí:** módulo propio `src/modules/permisos/`. Decisión explícita del usuario. `permisos` es un dominio distinto de `auth`, y el módulo deja lugar donde crecer cuando lleguen `GET /permisos/rol/:rolId` o el CRUD.
- **No:** meterlo en `AuthController` como `GET /auth/permisos`. Se descarta: ahorraría cuatro archivos, pero pondría consultas a `permisos` dentro de un repositorio que hoy solo toca `usuarios`.
- **No:** `GET /permisos` a secas. Se descarta: esa ruta significa "todos los permisos del sistema" y hay que dejarla libre para cuando se necesite. El sufijo `/me` dice exactamente lo que hace.
- **Sí:** el `userId` sale solo del JWT. Decisión explícita del usuario. Es lo que hace innecesario cualquier chequeo de autorización: nadie puede pedir los permisos de otro porque no hay forma de nombrarlo.
- **No:** aceptar un `userId` por ruta o query. Se descarta: obligaría a validar quién puede consultar a quién, que es justo la complejidad que este spec evita.
- **Sí:** array plano de strings. Decisión explícita del usuario. Es lo que la app necesita para decidir si muestra un botón, y se consulta con un `includes('clientes.crear')`.
- **No:** array de objetos `{ id, codigo, nombre, descripcion }`. Se descarta pese a servir para una pantalla legible de permisos. Se anota la consecuencia: si esa pantalla se necesita, hay que cambiar el contrato o agregar otro endpoint.
- **No:** devolver también `rol: { id, nombre }`. Se descarta: `POST /auth/login` ya devuelve `user.rol`, así que la app lo tiene desde el inicio de la sesión.
- **Sí:** filtrar por `isActive = 1`. Es para lo que SPEC 06 creó la columna: retirar un permiso sin borrar la fila. Un permiso inactivo no aparece y la app deja de mostrar la acción.
- **No:** devolver los inactivos con su bandera y que el cliente filtre. Se descarta: trasladaría al front una decisión que ya está tomada en la base.
- **Sí:** dos consultas, `usuarios` y luego `permisos`. Decisión explícita del usuario. Es la única forma legible de distinguir "el usuario no existe" de "el rol no tiene permisos", que en un join son ambos cero filas.
- **No:** una sola consulta con `LEFT JOIN`. Se descarta: ahorra un viaje a la base, pero obliga a distinguir los casos leyendo si `codigo` viene nulo, y este endpoint no está en ningún camino crítico de rendimiento.
- **Sí:** 404 `Usuario no encontrado` cuando el `userId` del token no existe. El token es válido pero el usuario ya no está; es un error real y no una lista vacía.
- **No:** 401 en ese caso. Se descarta: mezclaría el significado de 401, que en este proyecto es siempre un problema del token, con el de un usuario borrado.
- **Sí:** 200 con `[]` cuando el rol no tiene permisos activos. Es una respuesta válida: el rol existe y no puede hacer nada.
- **Sí:** el endpoint queda abierto a cualquier usuario autenticado, sin sembrar un permiso propio. Decisión explícita del usuario. Exigir `permisos.listar` para poder consultar los permisos propios sería circular.
- **No:** sembrar `permisos.listar` para Admin y Operador. Se descarta pese a que SPEC 06 dejó la regla de una fila por endpoint. La excepción se anota aquí para que no parezca un olvido: `/permisos/me` es auto-consulta, como leer el perfil propio.
- **Sí:** el endpoint es privado, sin `@Public()`. El `JwtAuthGuard` global lo cubre sin escribir nada, y sin token no hay `userId` que consultar.
- **No:** validar `usuarios.isActive`. Se descarta por consistencia: ningún endpoint del proyecto lo valida hoy, y SPEC 05 tomó la misma decisión explícita para `/auth/refresh`. Cuando se aplique, se aplica en todos a la vez.
- **Sí:** sin `ORDER BY`. Decisión explícita del usuario. El consumidor usa `includes`, así que el orden no significa nada. Se anota la consecuencia: el orden no está garantizado y puede diferir entre ambientes, así que ninguna prueba debe comparar el array posicionalmente.
- **No:** `ORDER BY codigo ASC`. Se descarta por la decisión anterior.
- **Sí:** sin DTO ni carpeta `dto/`. El endpoint no recibe nada del cliente, así que no hay esquema Zod que escribir. Es una desviación consciente de la estructura de módulo del proyecto.
- **No:** aplicar los permisos con un guard en este spec. Se mantiene la decisión de SPEC 06: el guard toca los cuatro módulos existentes y va en su propio spec.
- **No:** devolver los permisos en `POST /auth/login`. Se descarta, igual que en SPEC 06: cambiaría un contrato que SPEC 05 acaba de modificar, y obligaría a reloguear para refrescar los permisos.
- **Sí:** sin caché. La consulta son dos `SELECT` sobre tablas de decenas de filas, y cachear introduciría el problema de invalidar cuando un permiso cambia a mano por SQL.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| La app oculta los botones según la respuesta y alguien asume que eso **es** el control de acceso | **Sin mitigar por diseño.** El endpoint informa, no aplica: `POST /clientes` sigue devolviendo 201 a un `Operador`. Se documenta en `CLAUDE.md` y hay un criterio de aceptación que lo verifica explícitamente. La mitigación real es el spec del `PermissionsGuard`. |
| Los permisos se consultan una vez al abrir la app y quedan cacheados en el cliente; un cambio por SQL no se refleja hasta reabrirla | Sin mitigar en el backend. El endpoint siempre devuelve el estado actual; cada cuánto lo consulta la app es decisión del cliente. |
| Un endpoint nuevo se agrega y nadie inserta su permiso, así que `/permisos/me` lo omite y la app esconde una acción que sí existe | Sin mitigación automática, es el mismo riesgo que ya anotó SPEC 06. La tabla se mantiene a mano y nada avisa. |
| El rol se lee de `usuarios.rol_id` en cada llamada, así que cambiar el rol de un usuario por SQL cambia sus permisos sin reloguear | Es el comportamiento buscado, no un defecto: se anota porque contrasta con `user.rol` del login, que sí queda congelado en el cliente hasta el próximo login. |
| La respuesta expone la lista completa de códigos del rol, incluidos los de endpoints que no existen todavía | Hoy no aplica: SPEC 06 sembró solo permisos de endpoints implementados. Deja de ser cierto si alguien siembra permisos de funcionalidad futura, cosa que SPEC 06 ya descartó. |

---

## What is **not** in this spec

- Aplicar los permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`, y ningún endpoint devuelve 403 por falta de permiso.
- Cambios al payload del JWT ni a `req.user`.
- Devolver `permisos` desde `POST /auth/login` o `POST /auth/refresh`.
- `GET /permisos` (todos los del sistema), `GET /permisos/rol/:rolId` y `GET /usuarios/:id/permisos`.
- CRUD de permisos y CRUD de roles.
- Sembrar filas nuevas en `permisos`.
- Cualquier DDL o cambio en `src/database/types/types.ts`.
- Validación de `usuarios.isActive`.
- Caché de permisos en el backend.
- Devolver `nombre`, `descripcion` o el rol junto con los códigos.

Cada uno de estos, si se necesita, va en su propio spec.
