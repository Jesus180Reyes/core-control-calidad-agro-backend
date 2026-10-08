# SPEC 34 — Reset de contraseña por un admin

> **Status:** Implemented
> **Depends on:** SPEC 33 (el reset reusa su flujo de vencimiento y renovación), SPEC 22 (convención de Swagger)
> **Date:** 2026-10-07
> **Objective:** Que un usuario con rol `ADMIN` pueda restablecer la contraseña olvidada de otro usuario con `PATCH /auth/usuarios/:id/reset-password`, que genera una contraseña temporal ya vencida para obligarlo a renovarla en su próximo login.

---

## Why this spec exists

Hoy, si un usuario olvida su contraseña, la única salida es un `UPDATE` a mano en MySQL. El spec 33 dejó fuera la recuperación a propósito, pero también dejó hecha casi toda la parte difícil: una contraseña con `password_vence_en <= NOW()` obliga al usuario a pasar por `POST /auth/renovar-password` en su próximo login.

Este spec se apoya en tres ideas.

**La primera: el admin nunca conoce la contraseña definitiva.** El sistema genera una temporal y la deja vencida. El usuario entra con ella, recibe el 403 `passwordVencida: true` del spec 33 y elige la suya.

**La segunda: es el primer endpoint del proyecto que discrimina por rol.** Los otros veintidós endpoints abiertos aceptan riesgos sobre datos. Este, abierto, dejaría que cualquier operador tome la cuenta de un admin. Por eso la validación de rol no es opcional.

**La tercera: el rol se lee de la base en cada request, no del token.** El JWT no lleva rol (`req.user` sigue siendo `{ userId, username }`), así que el repositorio resuelve el rol de quien llama. Si a alguien le quitan el rol `ADMIN`, pierde el permiso al instante, sin esperar a que venza su token.

---

## Scope

**In:**

- Nuevo `PATCH /auth/usuarios/:id/reset-password`, con token, **sin body y sin DTO**.
- Validación de que quien llama tiene el rol `ADMIN`, resuelto con `usuarios.rol_id` → `roles.nombre`. Si no lo tiene, **403**.
- Un admin puede resetear a cualquier usuario, otros admins incluidos, **menos a sí mismo** (400).
- No se resetea a un usuario inexistente (400) ni a uno inactivo con `isActive = 0` (400).
- Generación de una contraseña temporal de 10 caracteres con `crypto.randomInt` de Node, sin caracteres ambiguos y con al menos una mayúscula y un número.
- Escritura del hash de la temporal y de `password_vence_en = NOW()`.
- La respuesta devuelve la temporal en texto plano **una sola vez**: `{ ok, msg, password_temporal }`.
- Swagger: `@ApiOperation`, `@ApiBearerAuth` y `@ApiParam` del endpoint nuevo.
- `CLAUDE.md` actualizado.

**Out of scope (for future specs):**

- Recuperación por autoservicio ("olvidé mi contraseña" por correo). `usuarios` no tiene correo y el proyecto no tiene infraestructura de envío.
- Columnas de auditoría del reset (`password_reseteada_por` / `password_reseteada_en`). Se descartaron por decisión explícita, ver Decisions.
- Un `PermissionsGuard` o un decorador `@Roles()` genérico. La validación de rol vive en el repositorio de este endpoint y en ningún otro.
- Usar un código de `catalogo_permisos` para autorizar el reset.
- Aplicar la validación de rol a `POST /auth/register` u otro endpoint existente.
- Revocar los access tokens vigentes del usuario reseteado.
- Notificar al usuario del reset (correo, SMS, etc.).
- Que el admin elija la contraseña temporal.
- Validar `isActive` de quien llama, o en el login o en la renovación.
- Un listado de usuarios para administración. El front usa `GET /catalogos/usuarios`, que ya existe.

---

## Data model

Este spec **no aplica DDL**. Reusa las columnas `password` y `password_vence_en` de `usuarios`, y `roles.nombre`. Los conteos de FKs y `UNIQUE` del proyecto no cambian. `src/database/types/types.ts` no cambia.

### Columnas que escribe

| Columna | Valor |
| --- | --- |
| `password` | Hash bcrypt de la temporal, con `SALT_ROUNDS` |
| `password_vence_en` | `sql\`NOW()\``, así que la temporal nace vencida |

**No toca** `password_actualizada_en`, que sigue marcando el último cambio hecho por el propio usuario. Tampoco toca `isActive`, `rol_id`, `updated_at` ni ninguna otra columna.

### Contraseña temporal

- Largo: **10** caracteres.
- Alfabeto: `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789`. Excluye `0`, `O`, `o`, `1`, `l` e `I`, para que se pueda dictar sin confusiones.
- Garantiza al menos una mayúscula y al menos un número. Así cumple las reglas del spec 33, aunque no es obligatorio porque se reemplaza en el primer login.
- Se genera con `crypto.randomInt` (módulo `crypto` de Node), nunca con `Math.random`. No agrega dependencias.
- Vive en un método privado `generarPasswordTemporal()` de `AuthRepository`.

### Autorización

El rol de quien llama se resuelve por `userId` del token, con un `INNER JOIN` de `usuarios` a `roles`, y se compara con el literal `'ADMIN'` **en mayúsculas**, que es como está en la base (ver la nota del spec 14 en `CLAUDE.md`). Un `userId` que ya no existe en `usuarios` también responde 403.

### Respuestas

`PATCH /auth/usuarios/:id/reset-password` (**200**):

```json
{
  "ok": true,
  "msg": "Contraseña restablecida correctamente",
  "password_temporal": "Kp7mWx3qRa"
}
```

La clave `password_temporal` no lleva el nombre del recurso: igual que `documento_id` en `POST /documentos-fiscales`, el valor es lo que importa de la llamada. Es la única respuesta del proyecto que devuelve una contraseña.

Errores, en el orden en que se validan:

| Caso | Código | Mensaje |
| --- | --- | --- |
| `:id` no es un entero | 400 | El de `ParseIntPipe` |
| Quien llama no es `ADMIN` o ya no existe | 403 | `No tiene permisos para restablecer contraseñas` |
| `:id` es el mismo usuario que llama | 400 | `No puede restablecer su propia contraseña. Use POST /auth/renovar-password` |
| El usuario `:id` no existe | 400 | `El usuario con id 'X' no existe` |
| El usuario `:id` tiene `isActive = 0` | 400 | `El usuario con id 'X' esta inactivo` |

La autorización va **primero**. Así quien no es admin no puede usar el endpoint para averiguar qué ids existen o están inactivos. Un usuario con `isActive = NULL` se considera activo: la comparación es `=== 0`, igual que `validatePesajeActivo`.

### Archivos

| Archivo | Cambio |
| --- | --- |
| `src/modules/auth/repository/auth.repository.ts` | Método `resetearPassword(id, userId)`, tres validadores privados y `generarPasswordTemporal()`. |
| `src/modules/auth/auth.service.ts` | Pass-through `resetearPassword`. |
| `src/modules/auth/auth.controller.ts` | `@Patch('usuarios/:id/reset-password')`. |
| `CLAUDE.md` | Fila de `auth`, conteo de rutas y las notas que dicen que ningún endpoint discrimina por rol. |

---

## Implementation plan

1. En `AuthRepository`, agregar `generarPasswordTemporal()` con el alfabeto y las garantías de la sección anterior. Primero toma una mayúscula y un número, después completa hasta 10 con el alfabeto entero, y al final mezcla las posiciones con Fisher-Yates usando `crypto.randomInt`. Todavía nadie lo llama, y la app compila igual.
2. Agregar los validadores privados, cada uno recibiendo `db: Kysely<Database>` según la convención de escritura:
   1. `validateCallerEsAdmin(userId, db)`: `usuarios` `INNER JOIN` `roles`, filtrado por `usuarios.id`. Lanza `ForbiddenException` si no hay fila o si `roles.nombre !== 'ADMIN'`.
   2. `validateNoEsMismoUsuario(id, userId)`: lanza `BadRequestException` si son iguales. No consulta la base.
   3. `validateUsuarioActivo(id, db)`: selecciona `id` e `isActive`. Lanza `BadRequestException` si no existe o si `isActive === 0`.
3. Agregar `resetearPassword(id, userId)` con la forma de escritura del proyecto. Dentro de `this.db.transaction().execute(async (trx) => ...)`, corre los tres validadores en ese orden con `trx`, genera la temporal, la hashea y hace el `UPDATE` de `password` y `password_vence_en = sql\`NOW()\`` filtrado por `id`. Devuelve la temporal en texto plano, no `true`. El hash se calcula dentro de la transacción, después de validar, para no gastar bcrypt en una llamada que va a fallar.
4. `AuthService.resetearPassword` como pass-through.
5. En `AuthController`, agregar `@Patch('usuarios/:id/reset-password')` con `@HttpCode(200)`, `@ApiBearerAuth()`, `@ApiParam` para `id` y `@ApiOperation`. Lee `userId` de `req.user` y recibe `id` con `ParseIntPipe`. Responde `{ ok, msg, password_temporal }`. La descripción dice cuatro cosas: que exige rol `ADMIN` y es el único endpoint que lo exige, que la temporal se devuelve una sola vez y nace vencida, que el usuario debe renovarla con `POST /auth/renovar-password`, y que no revoca los tokens vigentes del usuario. Prueba manual: con un token de `ADMIN`, la llamada responde 200. Con la temporal, el login responde 403 `passwordVencida: true`.
6. Actualizar `CLAUDE.md`:
   - La fila de `auth` en la tabla de endpoints.
   - El conteo de rutas: `auth` **4**, **36** rutas en total, **35** operaciones OpenAPI bajo **32** `paths`.
   - La nota "no endpoint discriminates by role yet" en la sección de auth, que deja de ser cierta.
   - La nota de los endpoints sin `@ApiBearerAuth` a nivel de clase en `AuthController`, si cambia.

---

## Acceptance criteria

- [X] El route log muestra exactamente una ruta más que antes de este spec: `PATCH /auth/usuarios/:id/reset-password`.
- [X] Sin header `Authorization`, responde 401.
- [X] Con el token de un `OPERADOR`, responde 403 `No tiene permisos para restablecer contraseñas` y no modifica ninguna fila.
- [X] Con el token de un `OPERADOR` y un `:id` inexistente, responde 403, no 400.
- [X] Con el token de un `ADMIN` y un `:id` de un operador activo, responde 200 `{ ok: true, msg: 'Contraseña restablecida correctamente', password_temporal }`.
- [X] `password_temporal` tiene exactamente 10 caracteres, al menos una mayúscula y al menos un número, y no contiene ninguno de `0 O o 1 l I`.
- [X] Dos resets seguidos del mismo usuario devuelven temporales distintas.
- [X] Después del reset, `password_vence_en` del usuario es la hora de MySQL del reset y `password_actualizada_en` no cambió.
- [X] Después del reset, el login con la contraseña vieja responde 401.
- [X] Después del reset, el login con la temporal responde 403 con `passwordVencida: true`.
- [X] `POST /auth/renovar-password` con la temporal como `password_actual` responde 200, y el login posterior con la contraseña nueva responde 200.
- [X] Un `ADMIN` puede resetear a otro `ADMIN`.
- [X] Un `ADMIN` que se resetea a sí mismo recibe 400 `No puede restablecer su propia contraseña. Use POST /auth/renovar-password`, y su contraseña no cambia.
- [X] Un `:id` inexistente responde 400 `El usuario con id 'X' no existe`.
- [X] Un usuario con `isActive = 0` responde 400 `El usuario con id 'X' esta inactivo` y su fila no cambia.
- [X] Un usuario con `isActive = NULL` se resetea con 200.
- [X] `:id` no numérico responde 400 desde `ParseIntPipe`.
- [X] El endpoint acepta la llamada sin body. Un body enviado se ignora.
- [X] Ningún error modifica la fila de `usuarios`.
- [X] La temporal en texto plano no se guarda en ninguna columna ni se escribe en ningún log del backend.
- [X] `/docs` muestra el endpoint con su descripción, el candado de bearer y el parámetro `id`.
- [X] No se agregó ninguna fila a `catalogo_permisos` ni a `permisos`, y no se aplicó DDL.

---

## Decisions

- **Sí:** reset hecho por un admin. Decisión del usuario. Es lo más barato: no necesita correo, ni tokens de un solo uso, ni DDL.
- **No:** autoservicio por correo. `usuarios` no tiene columna de correo y el proyecto no tiene cómo enviarlo. Si hace falta, va en su propio spec y no rompe este.
- **Sí:** la temporal la genera el sistema. Decisión del usuario. El admin no puede poner una débil o repetida, y el endpoint no necesita body.
- **No:** que el admin escriba la temporal. Abre la puerta a temporales como `Temporal1` repetidas en todos los resets.
- **Sí:** la temporal nace vencida (`password_vence_en = NOW()`). Así el usuario la reemplaza en su primer login con el flujo del spec 33, y el admin nunca conoce la contraseña definitiva. Mismo criterio que `POST /auth/register`.
- **Sí:** 10 caracteres sin ambiguos. Decisión del usuario. Se puede dictar por teléfono, y aun así es suficiente para una contraseña que dura hasta el primer login.
- **No:** 12 caracteres con símbolos. Más difícil de dictar y de escribir en la terminal de una báscula.
- **Sí:** `crypto.randomInt`, no `Math.random`. `Math.random` no es criptográficamente seguro, y `crypto` es nativo, así que no agrega dependencias.
- **Sí:** rol `ADMIN` resuelto por nombre en el repositorio. Decisión del usuario. Es el cambio mínimo que cierra la toma de cuentas.
- **No:** un código de `catalogo_permisos`. Haría de este endpoint el primero que hace cumplir la tabla de permisos, con códigos que ningún spec diseñó (ver la nota del spec 14). Esa decisión le corresponde al `PermissionsGuard`.
- **No:** un `@Roles()` o un guard genérico. Con un solo endpoint que lo usa, sería diseño sin segundo caso.
- **Sí:** el rol se lee de la base en cada request, no del JWT. El token no lleva rol, y así quitarle el rol a alguien surte efecto al instante.
- **Sí:** se compara con `'ADMIN'` en mayúsculas, que es como está en la base. El `'Admin'` del spec 06 no matchea nada.
- **Sí:** un admin puede resetear a otro admin. Decisión del usuario. Si no, el día que el único otro admin olvide su contraseña haría falta un `UPDATE` a mano.
- **Sí:** un admin no puede resetearse a sí mismo. Decisión del usuario. Para eso está `POST /auth/renovar-password`, que exige la contraseña actual.
- **Sí:** un usuario inactivo (`isActive = 0`) no se resetea. Decisión del usuario. El login no mira `isActive`, así que resetearlo le devolvería el acceso.
- **Sí:** `isActive = NULL` cuenta como activo. Es el mismo criterio `=== 0` del resto del proyecto.
- **Sí:** el reset no toca `password_actualizada_en`. Decisión del usuario. La columna sigue marcando el último cambio hecho por el propio usuario, y se actualiza sola cuando renueva la temporal.
- **No:** columnas de auditoría del reset. Decisión del usuario. El reset no deja rastro de quién lo hizo. Ver Risks.
- **Sí:** `PATCH /auth/usuarios/:id/reset-password`, por id. Decisión del usuario. El front saca el id de `GET /catalogos/usuarios`, y la ruta sigue la forma `PATCH /<recurso>/:id/<acción>` del proyecto.
- **No:** identificar al usuario por `username` en el body. Habría que escribirlo a mano, y el catálogo ya resuelve el selector.
- **Sí:** 400 para un usuario que no existe, como los `PATCH` del proyecto. El 404 de escritura del spec 27 es la excepción, no la regla.
- **Sí:** la autorización se valida antes que la existencia. Quien no es admin no puede usar el endpoint para averiguar qué ids existen.
- **Sí:** la respuesta devuelve la temporal con la clave `password_temporal`. Es lo único útil de la llamada, igual que `documento_id` en `POST /documentos-fiscales`.
- **Sí:** 200 y no 201 o 204. No crea un recurso, y sí devuelve cuerpo.
- **Sí:** sin fila en `catalogo_permisos`/`permisos`. La autorización es por rol y una fila no se leería.
- **No:** revocar los tokens vigentes del usuario reseteado. El `JwtStrategy` no consulta la base, igual que en el spec 33. Va en su propio spec.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| El reset no deja rastro de qué admin lo hizo ni cuándo | **Aceptado por decisión explícita.** Solo queda `password_vence_en` con la hora del reset, que el próximo login o renovación pisa. Si hace falta auditar, dos columnas en un spec aparte. |
| Un admin malicioso resetea a otro usuario y entra como él con la temporal | Es un abuso del rol, no una vulnerabilidad. Igual queda limitado: la temporal nace vencida, así que para entrar tiene que renovarla, y la víctima se entera porque su contraseña deja de funcionar. Sin auditoría no hay cómo probar quién fue. |
| Los tokens vigentes del usuario reseteado siguen valiendo hasta 8h | **Aceptado**, igual que en el spec 33. Si el reset se hace porque la cuenta fue comprometida, el atacante conserva el acceso hasta que venza su token. |
| La temporal viaja en texto plano en la respuesta | Viaja una sola vez y no se guarda. Depende de HTTPS en el despliegue y de que el front no la deje en logs ni en el almacenamiento del navegador. |
| `roles.nombre` cambia de `ADMIN` a otro valor en algún entorno | El endpoint responde 403 a todos, y falla cerrado, no abierto. Hay que renombrar en la base o actualizar el literal. |
| Si el último admin olvida su contraseña, nadie puede resetearlo | Sigue haciendo falta un `UPDATE` a mano, como hoy. Es el mismo caso que un admin que no puede resetearse a sí mismo. |
| `POST /auth/register` sigue abierto a cualquier autenticado, así que un operador puede crearse una cuenta con rol `ADMIN` y después resetear a quien quiera | **Riesgo real, fuera de alcance.** La protección de este spec vale tanto como la de `register`, que no discrimina por rol. Cerrar `register` es el siguiente spec natural. |

---

## What is **not** in this spec

- Recuperación por correo o autoservicio.
- Columnas de auditoría del reset.
- `PermissionsGuard`, `@Roles()` o cualquier validación de rol fuera de este endpoint.
- Validación de rol en `POST /auth/register`.
- Revocación de tokens.
- Notificación al usuario reseteado.
- Contraseña temporal elegida por el admin.
- Validación de `isActive` en login, renovación o de quien llama.

Cada uno de estos, si se necesita, va en su propio spec.
