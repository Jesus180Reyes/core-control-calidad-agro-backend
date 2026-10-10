# SPEC 37 — Registro de usuarios solo por un admin, con contraseña generada

> **Status:** Implemented
> **Depends on:** SPEC 33 (la contraseña nace vencida y se renueva con su flujo), SPEC 34 (reusa `validateCallerEsAdmin` y `generarPasswordTemporal`), SPEC 22 (convención de Swagger)
> **Date:** 2026-10-10
> **Objective:** Que `POST /auth/register` solo lo pueda usar un usuario con rol `ADMIN`, y que la contraseña del usuario nuevo la genere el sistema y se devuelva una sola vez, igual que en el reset del spec 34.

---

## Why this spec exists

El spec 34 dejó anotado un riesgo real: su protección vale tanto como la de `POST /auth/register`. Hoy cualquier usuario autenticado, un `OPERADOR` incluido, puede crear una cuenta con `rol: 2` (`ADMIN`) y con una contraseña que él mismo elige. Después entra con esa cuenta y resetea a quien quiera. El único endpoint del proyecto que discrimina por rol se puede saltar con la ruta de al lado.

Este spec cierra ese hueco con tres ideas.

**La primera: registrar es una acción de admin.** Se usa la misma validación del spec 34, que lee el rol de la base en cada request y compara con el literal `'ADMIN'`.

**La segunda: el admin nunca conoce la contraseña definitiva.** El sistema genera una temporal con `generarPasswordTemporal()`, y esa temporal ya nace vencida. Ya nacía vencida desde el spec 33 (`password_vence_en = NOW()`). Lo que cambia es que el admin deja de elegirla. El usuario entra, recibe el 403 `passwordVencida: true` y elige la suya con `POST /auth/renovar-password`. Es exactamente el flujo del reset.

**La tercera: el registro deja de terminar en 500 por datos que se pueden validar.** Se verificó en MySQL el 2026-10-10:

- `usuarios.username` **no tiene `UNIQUE`**. Hoy dos usuarios con el mismo username entran sin error. El login filtra por `username` con `executeTakeFirst`, así que el segundo no podría iniciar sesión nunca.
- `usuarios.rol_id` tiene FK a `roles(id)`. Un `rol` inexistente revienta el `INSERT` con `ER_NO_REFERENCED_ROW_2`, que sale como 500 y, desde el spec 36, queda escrito en `log_errores`.
- `usuarios.username` es `VARCHAR(20)` y la base corre `STRICT_TRANS_TABLES`. El DTO no tiene máximo, así que un username de 21 caracteres también sale como 500.

El front todavía no usa `POST /auth/register`. Por eso el cambio de contrato (quitar `password` del body) no rompe a ningún consumidor.

---

## Scope

**In:**

- `POST /auth/register` exige rol `ADMIN` en quien llama. Si no lo tiene, o si su usuario ya no existe, responde **403** `No tiene permisos para registrar usuarios`.
- `validateCallerEsAdmin` recibe el mensaje del 403 como parámetro. El reset del spec 34 sigue respondiendo exactamente su mensaje de hoy.
- El body deja de aceptar `password`. La contraseña la genera `generarPasswordTemporal()` y nace vencida (`password_vence_en = NOW()`).
- La respuesta 201 agrega `password_temporal`: `{ ok, msg, user, password_temporal }`. `user` sigue siendo el id del usuario creado.
- Nueva validación: un `username` ya usado por otro usuario responde **400**.
- Nueva validación: un `rol` que no existe en `roles` responde **400**.
- `username` con máximo de **20** caracteres en el DTO, que es el largo de la columna.
- `registerUser` pasa a la forma de escritura del proyecto: una transacción con los validadores dentro, que reciben el `trx`.
- Swagger: se actualiza la descripción de `POST /auth/register`.
- `CLAUDE.md` actualizado.

**Out of scope (for future specs):**

- Un `PermissionsGuard`, un decorador `@Roles()` o cualquier mecanismo genérico. Con dos endpoints que lo usan, la validación sigue viviendo en `AuthRepository`.
- Usar un código de `catalogo_permisos` para autorizar el registro.
- Restringir qué roles puede asignar un admin. Un admin puede crear otro admin.
- Un `UNIQUE` en MySQL sobre `usuarios.username` o `usuarios.cedula`.
- Validar `isActive` de quien llama.
- Columnas de auditoría nuevas. `created_by` ya registra quién creó al usuario.
- Editar, desactivar o listar usuarios para administración.
- Revocar tokens o notificar al usuario creado.
- Que el admin elija la contraseña inicial.
- Validar el formato de `cedula`.

---

## Data model

Este spec **no aplica DDL**. Los conteos de FKs y `UNIQUE` del proyecto no cambian. `src/database/types/types.ts` no cambia. El número de rutas no cambia: `auth` sigue con **4**, y el proyecto con **40**.

### Body de `POST /auth/register`

```ts
// src/modules/auth/dto/register.dto.ts
{
  username: string,       // min 2, max 20 (nuevo)
  complete_name: string,  // min 2, max 100, trim — sin cambios
  rol: number,            // sin cambios en el DTO; la existencia se valida en el repositorio
  cedula: string,         // sin cambios
}
```

`password` **sale del schema**. Si alguien la manda, Zod la descarta y la llamada sigue, igual que cualquier otra clave desconocida en el proyecto. La contraseña que se guarda es siempre la generada.

### Columnas que escribe el `INSERT`

| Columna | Valor |
| --- | --- |
| `username`, `complete_name`, `cedula` | Del body |
| `rol_id` | `rol` del body, ya validado contra `roles` |
| `password` | Hash bcrypt de la temporal, con `SALT_ROUNDS` |
| `password_vence_en` | `sql\`NOW()\``, igual que hoy |
| `created_by` | `userId` del token, igual que hoy |

No escribe `password_actualizada_en`, que queda en `NULL` hasta que el usuario renueve, igual que hoy.

### Contraseña temporal

La misma de spec 34, generada por el mismo `generarPasswordTemporal()`, sin cambios en ese método. Tiene 10 caracteres, sin `0 O o 1 l I`, con al menos una mayúscula y un número, y se genera con `crypto.randomInt`.

### Respuesta

`POST /auth/register` (**201**):

```json
{
  "ok": true,
  "msg": "Usuario registrado correctamente",
  "user": 23,
  "password_temporal": "Kp7mWx3qRa"
}
```

`user` mantiene su nombre y su valor (el id). `password_temporal` usa la misma clave que el reset. Pasa a haber **dos** respuestas en el proyecto que devuelven una contraseña.

### Errores, en el orden en que se validan

| Caso | Código | Mensaje |
| --- | --- | --- |
| Sin token | 401 | El de `JwtAuthGuard` |
| Body inválido (incluye `username` de más de 20) | 400 | El de Zod |
| Quien llama no es `ADMIN` o ya no existe | 403 | `No tiene permisos para registrar usuarios` |
| `rol` no existe en `roles` | 400 | `El rol con id 'X' no existe` |
| `cedula` ya registrada | 409 | `El usuario con 'X' ya existe registrado` (sin cambios) |
| `username` ya registrado | 400 | `El nombre de usuario 'X' ya esta en uso` |

La autorización va **primero**, igual que en el spec 34. Así quien no es admin no puede usar el endpoint para averiguar qué cédulas, usernames o roles existen.

La comparación de `username` la hace MySQL con `=`. La collation de la tabla es `utf8mb4_0900_ai_ci`, así que `SDAVILA` y `sdavila` cuentan como el mismo username. Eso es coherente con el login, que filtra igual.

### Validación de rol en `AuthRepository`

```ts
validateCallerEsAdmin(userId: number, mensaje: string, db: Kysely<Database>)
```

- `resetearPassword` la llama con `'No tiene permisos para restablecer contraseñas'`.
- `registerUser` la llama con `'No tiene permisos para registrar usuarios'`.

### Archivos

| Archivo | Cambio |
| --- | --- |
| `src/modules/auth/dto/register.dto.ts` | Quita `password` y agrega `.max(20)` a `username`. |
| `src/modules/auth/repository/auth.repository.ts` | `validateCallerEsAdmin` recibe el mensaje. `registerUser` pasa a una transacción con cuatro validadores y devuelve `{ id, passwordTemporal }`. Hay dos validadores privados nuevos: `validateRolExiste` y `validateUsernameDisponible`. |
| `src/modules/auth/auth.service.ts` | Sin cambios de firma. Sigue siendo un pass-through. |
| `src/modules/auth/auth.controller.ts` | Agrega `password_temporal` a la respuesta y reescribe el `@ApiOperation` de `register`. |
| `CLAUDE.md` | Fila de `auth`, nota de roles en la sección de auth y el riesgo de `register` que deja de existir. |

---

## Implementation plan

1. En `AuthRepository`, cambiar la firma a `validateCallerEsAdmin(userId, mensaje, db)` y actualizar la llamada de `resetearPassword` con su mensaje actual. Prueba manual: el reset con un token de `OPERADOR` sigue respondiendo 403 con `No tiene permisos para restablecer contraseñas`.
2. Agregar dos validadores privados que reciben `db: Kysely<Database>`:
   1. `validateRolExiste(rolId, db)`: `SELECT id FROM roles WHERE id = ?`. Si no hay fila, lanza `BadRequestException('El rol con id 'X' no existe')`.
   2. `validateUsernameDisponible(username, db)`: `SELECT id FROM usuarios WHERE username = ?`, sin filtrar `isActive`, porque el login tampoco lo filtra. Si hay fila, lanza `BadRequestException('El nombre de usuario 'X' ya esta en uso')`.
   Todavía nadie los llama, y la app compila igual.
3. Reescribir `registerUser(data, createdBy)` dentro de `this.db.transaction().execute(async (trx) => ...)`. Corre en este orden, con `trx`:
   1. `validateCallerEsAdmin(createdBy, 'No tiene permisos para registrar usuarios', trx)`.
   2. `validateRolExiste`.
   3. La verificación de cédula que ya existe, con el mismo 409 y el mismo mensaje, pero sobre `trx` en lugar de `this.db`.
   4. `validateUsernameDisponible`.

   Después genera la temporal, la hashea (el hash se calcula **después** de validar, no antes como hoy) e inserta. Devuelve `{ id: Number(result.insertId), passwordTemporal }`. En el mismo paso, quitar `password` del DTO y agregar `.max(20, 'El nombre de usuario no puede exceder 20 caracteres')` a `username`, porque `registerUser` ya no lee `data.password`.
4. En `AuthController.register`, desestructurar `{ id, passwordTemporal }` y responder `{ ok, msg, user: id, password_temporal: passwordTemporal }`. Reescribir el `@ApiOperation` para que diga:
   - que exige rol `ADMIN`, leído de la base;
   - que el body no lleva contraseña;
   - que la temporal se devuelve una sola vez y nace vencida, y que el usuario debe renovarla con `POST /auth/renovar-password`;
   - los cuatro errores de validación.

   Prueba manual: con un token de `ADMIN` responde 201 con `password_temporal`. El login con la temporal responde 403 `passwordVencida: true`.
5. Actualizar `CLAUDE.md`:
   - La descripción de `POST /auth/register` en la fila de `auth`.
   - La nota de roles en la sección de auth: pasan a ser **dos** endpoints que discriminan por rol.
   - El riesgo de que cualquier autenticado crea un `ADMIN`, que deja de ser cierto.
   - La frase de que `POST /auth/register` no tiene fila en `permisos`, que sigue siendo cierta pero ahora está protegido por rol.

---

## Acceptance criteria

- [X] El route log muestra las mismas 40 rutas que antes de este spec.
- [X] Sin header `Authorization`, `POST /auth/register` responde 401.
- [X] Con el token de un `OPERADOR`, responde 403 `No tiene permisos para registrar usuarios` y no inserta ninguna fila.
- [X] Con el token de un `OPERADOR` y un `rol` inexistente, responde 403, no 400.
- [X] Con el token de un `ADMIN` y un body válido, responde 201 `{ ok: true, msg: 'Usuario registrado correctamente', user, password_temporal }`, y `user` es el id de la fila insertada.
- [X] `password_temporal` tiene exactamente 10 caracteres, al menos una mayúscula y al menos un número, y no contiene ninguno de `0 O o 1 l I`.
- [X] La fila insertada tiene `created_by` igual al `userId` del admin, `password_vence_en` igual a la hora de MySQL del registro y `password_actualizada_en` en `NULL`.
- [X] El login con la temporal responde 403 con `passwordVencida: true`.
- [X] `POST /auth/renovar-password` con la temporal como `password_actual` responde 200, y el login posterior con la contraseña nueva responde 200.
- [X] Un body que incluye `password` responde 201, y la contraseña guardada es la temporal, no la enviada: el login con la enviada responde 401.
- [X] Un admin puede crear un usuario con `rol` = id de `ADMIN`.
- [X] Un `rol` que no existe en `roles` responde 400 `El rol con id 'X' no existe`, no 500, y no agrega ninguna fila a `log_errores`.
- [X] Una `cedula` ya registrada responde 409 con el mismo mensaje de antes de este spec.
- [X] Un `username` ya registrado responde 400 `El nombre de usuario 'X' ya esta en uso`, aunque difiera solo en mayúsculas y minúsculas.
- [X] Un `username` de 21 caracteres responde 400 desde Zod, no 500.
- [X] Ningún error inserta una fila en `usuarios`.
- [X] `PATCH /auth/usuarios/:id/reset-password` con un token de `OPERADOR` sigue respondiendo 403 `No tiene permisos para restablecer contraseñas`.
- [X] La temporal en texto plano no se guarda en ninguna columna ni se escribe en ningún log del backend.
- [X] `/docs` muestra `POST /auth/register` sin `password` en el schema del body y con la descripción nueva.
- [X] No se agregó ninguna fila a `catalogo_permisos` ni a `permisos`, y no se aplicó DDL.

---

## Decisions

- **Sí:** solo un `ADMIN` registra usuarios. Es lo que cierra el riesgo que dejó anotado el spec 34.
- **Sí:** se reusa `validateCallerEsAdmin`, con el mensaje como parámetro. Decisión del usuario. Cada endpoint dice qué permiso le falta, y el 403 del reset no cambia.
- **No:** un mensaje de 403 genérico. Habría cambiado el texto publicado del spec 34 sin necesidad.
- **No:** un `@Roles()` o un guard. Con dos endpoints, en el mismo repositorio, sigue sin justificarse un mecanismo genérico. Esa decisión le corresponde al `PermissionsGuard`.
- **Sí:** la contraseña la genera el sistema, con el mismo `generarPasswordTemporal()` del reset. Decisión del usuario. El admin no puede poner una débil ni repetirla en todas las altas, y nunca conoce la definitiva.
- **Sí:** `password` sale del DTO y, si llega, se descarta en silencio. El front no usa este endpoint todavía, así que no hay consumidor que romper. Además es el comportamiento de cualquier clave desconocida en el proyecto.
- **No:** `.strict()` para rechazar `password` con un 400. Sería el único DTO estricto del proyecto, y sin un consumidor que proteger.
- **Sí:** la respuesta es `{ ok, msg, user, password_temporal }`. Decisión del usuario. Mantiene la clave `user` de hoy y usa la misma clave del reset para la contraseña.
- **No:** renombrar `user` a `usuario_id`. Describe mejor el valor, pero cambia una respuesta publicada solo por estética.
- **Sí:** un admin puede crear otro admin. Si no, el día que haga falta un segundo admin habría que hacer un `UPDATE` a mano.
- **Sí:** se valida que `username` no esté en uso. Decisión del usuario. No hay `UNIQUE` en MySQL, y un username repetido deja al segundo usuario sin poder iniciar sesión nunca.
- **Sí:** el username duplicado responde **400**. Decisión del usuario. Es el código que el proyecto usa para duplicados en sus validadores. La cédula duplicada conserva su **409** de hoy, para no cambiar una respuesta existente. La divergencia entre los dos códigos es consciente.
- **No:** un `UNIQUE` en `usuarios.username`. Este spec no aplica DDL. La ventana de carrera entre el `SELECT` y el `INSERT` es la misma que ya acepta `lotes.nombre_lote`, y aquí solo escriben admins.
- **Sí:** se valida que `rol` exista en `roles`. Decisión del usuario. Convierte un 500 de FK, que además ensucia `log_errores`, en un 400 legible.
- **Sí:** `username` con `.max(20)` en el DTO. La columna es `VARCHAR(20)` y la base corre `STRICT_TRANS_TABLES`, así que sin el máximo un username largo sale como 500. Es parte de validar el username, no un cambio aparte.
- **Sí:** la autorización va antes que cualquier otra validación de base. Así quien no es admin no puede averiguar qué cédulas, usernames o roles existen.
- **Sí:** `registerUser` pasa a una transacción con los validadores dentro. Es la convención de escritura del proyecto, y hoy `registerUser` era la excepción.
- **Sí:** el hash se calcula después de validar. Hoy se calcula antes de la verificación de cédula, y se gasta bcrypt en llamadas que van a fallar.
- **No:** validar `isActive` de quien llama. Igual que en el spec 34, queda fuera.
- **Sí:** sin fila en `catalogo_permisos`/`permisos`. La autorización es por rol, y una fila no se leería.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Si no queda ningún admin activo con contraseña conocida, nadie puede crear usuarios | Hace falta un `UPDATE` o un `INSERT` a mano en MySQL, como para resetear al último admin en el spec 34. |
| Dos admins registran el mismo username a la vez | Los dos pasan la validación y entran dos filas, porque no hay `UNIQUE`. Es poco probable, porque solo escriben admins. Si pasa, se corrige a mano. El `UNIQUE` va en otro spec. |
| La temporal viaja en texto plano en la respuesta | Viaja una sola vez y no se guarda, igual que en el reset. Depende de HTTPS y de que el front no la deje en logs ni en el almacenamiento del navegador. |
| `roles.nombre` cambia de `ADMIN` en algún entorno | Los dos endpoints responden 403 a todos, así que fallan cerrados, no abiertos. |
| Se pasa por alto que `password` ya no se acepta y se integra el front mandándola | El 201 trae `password_temporal` y la descripción de Swagger lo dice. El login con la contraseña enviada responde 401, lo cual delata el error en la primera prueba. |

---

## What is **not** in this spec

- `PermissionsGuard`, `@Roles()` o un código de `catalogo_permisos` para el registro.
- Restringir qué roles puede asignar un admin.
- `UNIQUE` en MySQL para `username` o `cedula`, o cualquier otro DDL.
- Validar `isActive` de quien llama.
- Editar, desactivar o listar usuarios.
- Revocar tokens o notificar al usuario creado.
- Contraseña inicial elegida por el admin.

Cada uno de estos, si se necesita, va en su propio spec.
