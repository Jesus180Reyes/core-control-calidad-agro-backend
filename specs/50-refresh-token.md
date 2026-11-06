# SPEC 50 — Refresh token que revisa al usuario en cada renovación

> **Status:** Implemented
> **Depends on:** SPEC 33 (vencimiento de contraseña), SPEC 34 (reset por admin), SPEC 37 (registro solo por admin)
> **Date:** 2026-11-06
> **Objective:** Que `POST /auth/login` devuelva además un refresh token de 30 días y que un nuevo `POST /auth/refresh` lo canjee por un par nuevo solo si el usuario sigue existiendo, activo y con la contraseña vigente.

---

## Why this spec exists

Hoy `POST /auth/login` entrega un único `accessToken` de 8 horas (`JwtModule.registerAsync` en `src/app.module.ts`). Cuando expira, la app obliga a escribir usuario y contraseña otra vez, en campo y con la báscula esperando.

El SPEC 05 resolvía esto con un refresh token stateless que no consultaba la base. Se aprobó el 2026-08-28, nunca se implementó y se borró al abrir este spec, porque los specs posteriores lo dejaron inservible:

- **SPEC 33** hace vencer las contraseñas. Un refresh que no lee `usuarios` deja que una sesión extendida con cada uso no pase nunca por la renovación de contraseña.
- **SPEC 34** permite a un ADMIN resetear una contraseña. Sin consulta, un usuario dado de baja o desactivado sigue renovando su sesión.
- **El montaje multi-tenant** (`deploy/`) hace que cada variable de entorno nueva haya que propagarla a `nuevo-tenant.sh`, a la plantilla del tenant y a mano en cada `.env` existente.

Este spec mantiene la idea del refresh token. Agrega una sola consulta a `usuarios` en cada renovación y no requiere DDL. La revocación por token sigue fuera.

## Scope

**In:**

- Nueva variable de entorno opcional `JWT_REFRESH_SECRET`, distinta de `JWT_SECRET`.
- `POST /auth/login` devuelve `refreshToken` además de `accessToken`.
- `POST /auth/login` rechaza a un usuario con `isActive = 0` con un 401 `El usuario esta inactivo`.
- Nuevo `POST /auth/refresh`, `@Public()`, con body `{ refreshToken }` validado por un DTO Zod.
- `POST /auth/refresh` verifica la firma con `JWT_REFRESH_SECRET` y consulta `usuarios` por el id del token. Rechaza un usuario que no existe, está inactivo o tiene la contraseña vencida.
- Rotación: cada refresh exitoso emite un `accessToken` nuevo (8h) y un `refreshToken` nuevo con 30 días completos (sesión deslizante).
- Sin `JWT_REFRESH_SECRET`, o con el mismo valor que `JWT_SECRET`, el login sigue funcionando con `refreshToken: null` y `/auth/refresh` responde 503.
- Propagar la variable a `.env.example`, `deploy/tenant/.env.example`, `deploy/plataforma/nuevo-tenant.sh` y el runbook `deploy/README.md`.
- `@ApiOperation` para la ruta nueva y la descripción de `POST /auth/login` actualizada.

**Out of scope (for future specs):**

- Revocación por token: tabla `refresh_tokens`, logout, cierre de sesión en todos los dispositivos, detección de reuso de un refresh rotado.
- Cortar las sesiones vivas al cambiar la contraseña. Con este spec, el reset de un ADMIN (SPEC 34) sí corta el refresh en su siguiente uso (403), porque la contraseña temporal nace vencida, pero el access token sigue valiendo sus 8 horas. Que el usuario renueve su propia contraseña no corta nada.
- Revisar `isActive` en `POST /auth/renovar-password` o en el `JwtStrategy`. Un access token ya emitido sigue valiendo sus 8 horas aunque el usuario se desactive.
- Rate limiting de `/auth/refresh` y `/auth/login` (SPEC 23, no implementado).
- Refresh token en cookie `httpOnly` y CORS con credenciales.
- Unificar los literales de respaldo de `JWT_SECRET` (`'SUPER_SECRET_KEY'` en `src/app.module.ts` y `'SUPER_SECRET_KEY_PROD'` en `src/strategy/jwt.stategy.ts`).
- El interceptor del front que llama a `/auth/refresh` (otro repo).

## Data model

No hay DDL. Se leen columnas que ya existen en `usuarios`: `id`, `username`, `isActive` (`NULL` cuenta como activo, igual que en `validateUsuarioActivo`) y `password_vence_en`.

Variable de entorno:

- `JWT_REFRESH_SECRET`: **nueva, opcional para arrancar**. Firma y verifica el refresh token. Se trata como ausente si está vacía o es igual a `JWT_SECRET`.

Constantes en `AuthRepository`:

- `REFRESH_TOKEN_EXPIRES_IN = '30d'`. El `'8h'` del access token sigue en `src/app.module.ts`.

Payload del refresh token: la interfaz `JwtPayload` de `src/strategy/jwt.stategy.ts`, sin claims nuevos.

```ts
{ sub: number; user_id: number; username: string }
```

No hay claim `type`: el secreto separado es lo que distingue al refresh del access.

DTO `src/modules/auth/dto/refresh-token.dto.ts`:

```ts
z.object({ refreshToken: z.string().min(1) })
```

Respuesta de `POST /auth/login` (200), con `refreshToken` como única clave nueva:

```json
{
  "ok": true,
  "msg": "Usuario logueado correctamente",
  "user": { "...": "sin cambios" },
  "accessToken": "<jwt 8h>",
  "refreshToken": "<jwt 30d> | null",
  "passwordVencida": false
}
```

Respuesta de `POST /auth/refresh` (200):

```json
{
  "ok": true,
  "msg": "Sesion renovada correctamente",
  "accessToken": "<jwt 8h>",
  "refreshToken": "<jwt 30d>"
}
```

Errores de `POST /auth/refresh`, en este orden:

| Caso | Respuesta |
| --- | --- |
| `JWT_REFRESH_SECRET` ausente o igual a `JWT_SECRET` | **503** `El refresh de sesion no esta disponible` |
| Body sin `refreshToken` o vacío | **400** (pipe Zod) |
| Firma inválida, token expirado, mal formado o un access token | **401** `Refresh token inválido o expirado` |
| El usuario del token no existe | **401** `Refresh token inválido o expirado` |
| El usuario del token tiene `isActive = 0` | **401** `El usuario esta inactivo`, igual que el login |
| `password_vence_en <= NOW()` | **403** `{ statusCode: 403, message: 'La contraseña ha caducado', passwordVencida: true }`, igual que el login |

## Implementation plan

1. Agregar `JWT_REFRESH_SECRET` a `.env.example` y al `.env` local, con un valor distinto de `JWT_SECRET`.
2. En `AuthRepository`, agregar el método privado `resolverSecretoRefresh()`: lee `JWT_REFRESH_SECRET` con `ConfigService` y devuelve `null` si está vacía o es igual a `JWT_SECRET`. Mismo patrón que `resolverVigenciaDias()`.
3. En `AuthRepository`, agregar el método privado `signTokenPair(payload)`. El access se firma con `this.jwtService.sign(payload)` (configuración global). El refresh se firma con `{ secret, expiresIn: REFRESH_TOKEN_EXPIRES_IN }`, o queda en `null` si no hay secreto.
4. En `AuthRepository.login`: agregar `usuarios.isActive` al `select` de `getUserByUsername` y rechazar `isActive === 0` con `UnauthorizedException('El usuario esta inactivo')`. El chequeo va **después** de `bcrypt.compare` y **antes** del de vencimiento. Quitar `isActive` de `currentUser` y reemplazar la firma directa por `signTokenPair`.
5. En `AuthController.login`, agregar `refreshToken` a la respuesta y actualizar la descripción de `@ApiOperation`: el par de tokens, `refreshToken` puede ser `null` y el 401 por usuario inactivo.
6. Crear `src/modules/auth/dto/refresh-token.dto.ts` con `RefreshTokenDto` (`createZodDto`).
7. En `AuthRepository`, agregar `refreshTokens(refreshToken)`, en este orden:
   - Sin secreto, lanzar `ServiceUnavailableException`.
   - Hacer `jwtService.verify<JwtPayload>` con el secreto de refresh dentro de un `try/catch`. El `catch` lanza el 401 genérico.
   - Leer de `usuarios` por `user_id ?? sub`: `id`, `username`, `isActive` y el mismo `password_vencida` calculado que usa `getUserByUsername`. Es una sola lectura, sin transacción.
   - Si el usuario no existe, lanzar el 401 genérico.
   - Si tiene `isActive === 0`, lanzar el 401 `El usuario esta inactivo` del login.
   - Si `password_vencida`, lanzar el 403 del login.
   - Devolver `signTokenPair({ sub: id, user_id: id, username })` con el `username` **leído de la base**, no copiado del token. Así no se arrastran ni `iat` ni `exp`.
8. En `AuthService`, agregar `refresh(refreshToken)` como pass-through.
9. En `AuthController`, agregar `POST refresh` con `@Public()`, `@HttpCode(200)` y `@Body() RefreshTokenDto`. Responde `{ ok, msg, accessToken, refreshToken }`, y su `@ApiOperation` describe la tabla de errores de arriba y la rotación. No lleva `@ApiBearerAuth`.
10. Deploy:
    - `deploy/tenant/.env.example`: agregar `JWT_REFRESH_SECRET=`.
    - `deploy/plataforma/nuevo-tenant.sh`: generar `JWT_REFRESH_SECRET=$(openssl rand -hex 48)` y sustituirlo con el mismo `sed` que `JWT_SECRET`.
    - `deploy/README.md`: el paso manual para los tenants existentes (agregar la línea al `.env` de `/opt/<slug>` y `docker compose up -d api`).
11. Actualizar la documentación:
    - `src/modules/auth/CLAUDE.md`: la ruta nueva, el login con `isActive` y `refreshToken`, quitar "nothing revokes them" y dejar qué corta y qué no corta una sesión.
    - `CLAUDE.md` raíz: `JWT_REFRESH_SECRET` en las variables opcionales, `POST /auth/refresh` en la lista de rutas `@Public()`, y el conteo de rutas (52 rutas, `auth` 6; 51 operaciones bajo 47 `paths`).

## Acceptance criteria

- [X] `POST /auth/login` con credenciales válidas responde 200 con `accessToken` y `refreshToken`, ambos strings no vacíos.
- [X] El `accessToken` del login expira a las 8 horas y el `refreshToken` a los 30 días (claim `exp`).
- [X] `POST /auth/login` de un usuario con `isActive = 0` y contraseña correcta responde 401 `El usuario esta inactivo`.
- [X] `POST /auth/login` de un usuario con `isActive = 0` y contraseña incorrecta responde el 401 de credenciales incorrectas, sin mencionar que está inactivo.
- [X] `POST /auth/login` de un usuario con `isActive = NULL` responde 200.
- [X] `POST /auth/refresh` con `{ refreshToken }` válido responde 200 con un `accessToken` y un `refreshToken` nuevos.
- [X] El `accessToken` emitido por `/auth/refresh` autentica `GET /clientes` y expira a las 8 horas, no a los 30 días.
- [X] El `refreshToken` emitido por `/auth/refresh` sirve para un segundo refresh y expira 30 días después de esa llamada.
- [X] `POST /auth/refresh` con un **access token** en `refreshToken` responde 401.
- [X] `GET /clientes` con un **refresh token** como `Bearer` responde 401.
- [X] `POST /auth/refresh` con un string que no es JWT responde 401 `Refresh token inválido o expirado`.
- [X] `POST /auth/refresh` sin body o con `refreshToken: ""` responde 400.
- [X] Tras poner `isActive = 0` a un usuario, su refresh token responde 401 `El usuario esta inactivo`.
- [X] Tras poner `password_vence_en = NOW()` a un usuario, su refresh token responde 403 con `passwordVencida: true`.
- [X] Tras cambiar el `username` de un usuario en la base, el `accessToken` emitido por `/auth/refresh` lleva el nombre nuevo.
- [X] Sin `JWT_REFRESH_SECRET` en el `.env`, la app arranca, el login responde 200 con `refreshToken: null` y `/auth/refresh` responde 503.
- [X] Con `JWT_REFRESH_SECRET` igual a `JWT_SECRET`, el comportamiento es el mismo que sin la variable.
- [X] `nuevo-tenant.sh` deja en el `.env` del tenant un `JWT_REFRESH_SECRET` generado y distinto de `JWT_SECRET`.
- [X] Swagger (`/docs`) muestra `POST /auth/refresh` sin candado, con su descripción y el DTO del body.
- [X] `npm run lint` no da errores.

## Decisions

- **Yes:** una consulta a `usuarios` en cada refresh. Tapa el vencimiento del SPEC 33 y a los usuarios desactivados, sin DDL.
- **No:** refresh stateless sin consulta (SPEC 05). Una sesión que se extiende con cada uso nunca pasaría por la renovación de contraseña.
- **No:** tabla `refresh_tokens`. Requiere DDL aplicado a mano en cada tenant. Va en el spec de logout y revocación.
- **No:** cortar las sesiones por reset (refresh emitido antes del último cambio de contraseña). Exige que el reset escriba una marca que hoy no escribe. Se deja fuera para no tocar el SPEC 34.
- **Yes:** revisar `isActive` en el login y en el refresh a la vez. El SPEC 07 dejó dicho que se aplique en todos a la vez, y revisarlo solo en el refresh lo haría cosmético.
- **Yes:** el usuario inactivo recibe un 401 con mensaje propio, `El usuario esta inactivo`, en el login y en el refresh. El chequeo va después de `bcrypt.compare`, así que solo lo ve quien sabe la contraseña, como el vencimiento. Decidido durante la implementación: el usuario necesita saber por qué no entra.
- **No:** el mismo mensaje que credenciales incorrectas. Era la idea original. Ocultaba el motivo sin ganar nada, porque quien llega a ese chequeo ya sabe la contraseña.
- **No:** un 403 para el inactivo, como el de contraseña vencida. Se mantiene 401, y el front lo distingue por el mensaje.
- **Yes:** el 403 por contraseña vencida en el refresh es idéntico al del login. El front reutiliza el manejo que ya tiene y manda a `/auth/renovar-password`.
- **Yes:** `JWT_REFRESH_SECRET` aparte. Hace estructuralmente imposible que un refresh pase como `Bearer`, porque el `JwtStrategy` verifica con `JWT_SECRET`.
- **No:** el mismo secreto con un claim `type: 'refresh'`. Depende de que el `JwtStrategy` nunca pierda ese chequeo.
- **Yes:** la variable es opcional para arrancar. Sin ella, el login da `refreshToken: null` y el refresh da 503, igual que las rutas de Gemini sin `GEMINI_API_KEY`. Un tenant al que se le olvide la línea sigue funcionando como hoy, en vez de quedar caído al hacer `pull` de la imagen nueva.
- **No:** un literal de respaldo como el de `JWT_SECRET`. Un secreto público para el refresh sería peor que no tener refresh.
- **Yes:** tratar `JWT_REFRESH_SECRET === JWT_SECRET` como ausente. Con el mismo secreto se perdería la separación entre tokens y el código lo detecta gratis.
- **Yes:** el token viaja en el body (`{ refreshToken }`). El pipe Zod lo valida, Swagger lo documenta solo y no se confunde con el `Bearer` de las demás rutas.
- **No:** el header `Authorization: Bearer`. Con una ruta `@Public()` obliga a parsear el header a mano en el controller.
- **Yes:** access 8h y refresh 30d deslizante. Pocas llamadas desde campo, donde la conectividad es mala.
- **No:** acortar el access token. Multiplicaría los refresh sin un beneficio real mientras no exista revocación.
- **Yes:** el `username` del token nuevo sale de la base, no del token viejo. Ya se lee la fila, y así no se arrastran `iat` ni `exp`.
- **Yes:** `/auth/refresh` no devuelve `user`. La app lo tiene del login, y así se evita el `JOIN` con `roles`.
- **Yes:** la lectura del refresh va sin transacción. Es un solo `SELECT` sin escritura. La convención de transacciones es del camino de escritura.

## Risks

| Risk | Mitigation |
| --- | --- |
| Un refresh token filtrado sirve hasta 30 días, y rotar no invalida el anterior | **Aceptado.** Desactivar al usuario (`isActive = 0`) lo corta en el siguiente refresh. Cambiar `JWT_REFRESH_SECRET` en el tenant corta todas las sesiones de ese tenant. La revocación por token va en su propio spec. |
| Un ADMIN resetea la contraseña de una cuenta comprometida y la sesión robada sigue viva | **Mitigado en parte.** La contraseña temporal nace vencida, así que el siguiente refresh de esa sesión responde 403. El access token vivo sigue valiendo hasta 8 horas. |
| El usuario renueva su propia contraseña sospechando de una filtración y la sesión robada sigue renovando | **Aceptado.** Nada liga el token a la contraseña. Se corta desactivando al usuario o con el spec de revocación. |
| Un access token ya emitido sigue valiendo hasta 8 horas tras desactivar al usuario | **Aceptado.** El `JwtStrategy` no consulta la base. Lo que cambia es que esa sesión ya no se renueva. |
| Un tenant existente no recibe `JWT_REFRESH_SECRET` | Funciona como hoy (`refreshToken: null`, relogin a las 8h). El paso queda en `deploy/README.md`. |
| Cambia el login: un usuario con `isActive = 0` que hoy entra deja de entrar | Es el objetivo. Antes de desplegar, revisar quién tiene `isActive = 0` en cada tenant (`SELECT id, username FROM usuarios WHERE isActive = 0`). |
| `/auth/refresh` es `@Public()` y no hay rate limiting | Solo permite probar firmas, inviable contra un secreto de 48 bytes. El rate limiting es del SPEC 23, para toda la API. |
| La consulta añade una query por renovación | Una lectura por clave primaria cada 8 horas por usuario. Despreciable. |

## What is **not** in this spec

- Tabla `refresh_tokens`, logout, revocación por token o por familia, detección de reuso.
- Cortar las sesiones vivas al resetear una contraseña.
- `isActive` en `renovar-password` y en el `JwtStrategy`.
- Rate limiting.
- Cookie `httpOnly`.
- Unificar los literales de respaldo de `JWT_SECRET`.
- El interceptor del front.

Cada uno de esos, si llega, va en su propio spec.
