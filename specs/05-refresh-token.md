# SPEC 05 — Refresh token stateless para renovar la sesión

> **Status:** Approved
> **Depends on:** —
> **Date:** 2026-08-28
> **Objective:** Que `POST /auth/login` devuelva además un refresh token de 30 días y que un nuevo `POST /auth/refresh` lo canjee por un par de tokens nuevo, sin tocar la base de datos.

---

## Why this spec exists

Hoy `POST /auth/login` devuelve un único `accessToken` firmado con `JWT_SECRET` y `expiresIn: '8h'` (ver `JwtModule.registerAsync` en `src/app.module.ts`). Cuando ese token expira, la app móvil no tiene forma de renovar la sesión: el operador tiene que volver a escribir usuario y contraseña, en campo y con la báscula esperando.

Este spec agrega el mecanismo de renovación en su forma más simple posible: **un segundo JWT, firmado con un secreto propio, sin persistencia**. No hay tabla de sesiones, no hay DDL y `POST /auth/refresh` no consulta la base de datos.

La consecuencia de esa simplicidad se asume de forma explícita: **no existe revocación**. Un refresh token filtrado sirve durante 30 días y nada dentro de este spec puede invalidarlo antes. La revocación real (tabla `refresh_tokens`, logout, cierre de sesión en todos los dispositivos) queda fuera de alcance y va en su propio spec.

---

## Scope

**In:**

- Nueva variable de entorno `JWT_REFRESH_SECRET`, distinta de `JWT_SECRET`.
- `POST /auth/login` devuelve `refreshToken` además de `accessToken`. El resto de la respuesta no cambia.
- Nuevo endpoint `POST /auth/refresh`, marcado `@Public()`, que recibe el refresh token en el header `Authorization: Bearer <refreshToken>`.
- `POST /auth/refresh` verifica la firma con `JWT_REFRESH_SECRET` y devuelve un `accessToken` nuevo (8h) y un `refreshToken` nuevo (30d).
- Rotación: cada llamada a `/auth/refresh` emite un refresh token nuevo con 30 días completos (sesión deslizante).
- Payload del refresh token: las mismas claves que el access token (`sub`, `user_id`, `username`), sin `iat` ni `exp` heredados al re-firmar.
- Cualquier fallo de verificación responde `401` con el mismo mensaje genérico.
- Actualizar `CLAUDE.md`: la fila de `auth` en la tabla de endpoints y la lista de variables de entorno requeridas.

**Out of scope (for future specs):**

- Cualquier cambio de esquema en MySQL. Este spec no ejecuta DDL.
- Revocación de refresh tokens, en cualquier forma: tabla `refresh_tokens`, columna `token_version` en `usuarios`, lista negra en memoria o en caché.
- `POST /auth/logout` y `POST /auth/logout-all`.
- Detección de reuso de un refresh token ya rotado y revocación por familia.
- Consultar la base de datos dentro de `/auth/refresh`: un usuario desactivado (`isActive = 0`) o borrado sigue pudiendo renovar su sesión hasta que expire su refresh token.
- Cambiar la duración del access token, que sigue en `'8h'`.
- Tope absoluto de sesión: la sesión deslizante no caduca mientras el operador siga usando la app.
- Refresh token en cookie `httpOnly` y configuración de CORS con credenciales.
- Emitir tokens desde `POST /auth/register`, que sigue devolviendo solo el id del usuario creado.
- Discriminación por rol en cualquier endpoint.

---

## Data model

**Este spec no hace ningún cambio de esquema**: no agrega tablas, columnas ni constraints, y no ejecuta DDL. `src/database/types/types.ts` queda igual. Tampoco agrega un DTO nuevo, porque el token viaja en el header y no en el body.

Variables de entorno (`.env`, no versionado):

- `JWT_REFRESH_SECRET` — **nueva**. Secreto de firma del refresh token. Debe ser distinta de `JWT_SECRET`.

Constantes en `AuthRepository`:

- `REFRESH_TOKEN_EXPIRES_IN = '30d'` — vigencia del refresh token, igual que el `'8h'` del access token vive en `src/app.module.ts`.

Payload del refresh token — reutiliza la interfaz `JwtPayload` ya declarada en `src/strategy/jwt.stategy.ts`:

```ts
{
  sub: number;        // usuarios.id
  user_id: number;    // usuarios.id
  username: string;
  iat?: number;       // los agrega jsonwebtoken al firmar
  exp?: number;
}
```

El refresh token no lleva ningún claim adicional: no hay `type`, porque el secreto separado ya es lo que lo distingue del access token.

Respuesta de `POST /auth/login` (200), con `refreshToken` como única clave nueva:

```json
{
  "ok": true,
  "msg": "Usuario logueado correctamente",
  "user": {
    "complete_name": "Juan Pérez",
    "rol": "Operador"
  },
  "accessToken": "<jwt 8h>",
  "refreshToken": "<jwt 30d>"
}
```

Respuesta de `POST /auth/refresh` (200):

```json
{
  "ok": true,
  "msg": "Token renovado correctamente",
  "accessToken": "<jwt 8h>",
  "refreshToken": "<jwt 30d>"
}
```

No devuelve `user`: la app ya lo tiene desde el login.

Respuesta de error de `POST /auth/refresh` (401), idéntica para token ausente, mal formado, expirado o firmado con otro secreto:

```json
{
  "statusCode": 401,
  "message": "Refresh token inválido o expirado",
  "error": "Unauthorized"
}
```

---

## Implementation plan

1. Agregar `JWT_REFRESH_SECRET` al `.env` local con un valor distinto de `JWT_SECRET`. Documentarla en la lista de variables requeridas de `CLAUDE.md`.
2. En `AuthRepository`, inyectar `ConfigService` y agregar el método privado `signTokenPair(payload: JwtPayload)`: firma el access token con `this.jwtService.sign(payload)` (usa la configuración global de `JwtModule`) y el refresh token con `this.jwtService.sign(payload, { secret, expiresIn: REFRESH_TOKEN_EXPIRES_IN })`, leyendo el secreto de `JWT_REFRESH_SECRET`. Devuelve `{ accessToken, refreshToken }`.
3. En `AuthRepository.login`, reemplazar la firma directa del access token por una llamada a `signTokenPair(payload)` y devolver `{ accessToken, refreshToken, currentUser }`. La verificación de contraseña con `bcrypt` no cambia.
4. En `AuthController.login`, agregar `refreshToken` al objeto de respuesta. El resto de la forma `{ ok, msg, user, accessToken }` queda igual.
5. En `AuthRepository`, agregar `refreshTokens(refreshToken: string)`: verifica el token con `this.jwtService.verify<JwtPayload>(refreshToken, { secret })` dentro de un `try/catch`, lanza `UnauthorizedException('Refresh token inválido o expirado')` en el `catch`, descarta `iat` y `exp` del payload verificado y devuelve `signTokenPair({ sub, user_id, username })`. No toca la base de datos.
6. En `AuthService`, agregar `refresh(refreshToken: string)` delegando al repositorio, siguiendo el patrón de pass-through de `login`.
7. En `AuthController`, agregar `POST refresh` con `@Public()` y `@HttpCode(200)`: lee el header con `@Headers('authorization')`, extrae el token del prefijo `Bearer ` (lanzando `UnauthorizedException` con el mismo mensaje genérico si el header falta o no tiene ese prefijo), llama al servicio y responde `{ ok, msg, accessToken, refreshToken }`.
8. Actualizar la fila de `auth` en la tabla de endpoints de `CLAUDE.md`: `POST /auth/refresh` existe y es `@Public()`, y `POST /auth/login` devuelve el par de tokens.
9. Verificación manual: hacer login y guardar ambos tokens; llamar `POST /auth/refresh` con el refresh token en el header y confirmar que devuelve un par nuevo; usar el access token nuevo contra `GET /clientes` y confirmar 200; llamar `POST /auth/refresh` con el access token en el header y confirmar 401; usar el refresh token como `Bearer` contra `GET /clientes` y confirmar 401.

---

## Acceptance criteria

- [ ] El esquema de MySQL no cambió: no se ejecutó ningún DDL en esta implementación.
- [ ] La app arranca sin errores de compilación (`npm run start:dev`).
- [ ] `.env` tiene `JWT_REFRESH_SECRET` con un valor distinto de `JWT_SECRET`.
- [ ] `POST /auth/login` responde 200 con `accessToken` y `refreshToken`, ambos strings no vacíos.
- [ ] Los dos tokens del login son distintos entre sí.
- [ ] El `accessToken` devuelto por el login sigue expirando en 8 horas y el `refreshToken` en 30 días (verificable decodificando el claim `exp`).
- [ ] El `accessToken` devuelto por el login sigue autenticando `GET /clientes` igual que antes de este spec.
- [ ] `POST /auth/refresh` con un refresh token válido en `Authorization: Bearer` responde 200 con un `accessToken` y un `refreshToken` nuevos.
- [ ] El `accessToken` devuelto por `/auth/refresh` autentica `GET /clientes` correctamente.
- [ ] El `refreshToken` devuelto por `/auth/refresh` sirve para una segunda llamada a `/auth/refresh`, que también responde 200.
- [ ] El `refreshToken` devuelto por `/auth/refresh` expira 30 días después de esa llamada, no 30 días después del login original.
- [ ] El payload del `accessToken` emitido por `/auth/refresh` tiene el mismo `sub`, `user_id` y `username` que el emitido por el login del mismo usuario.
- [ ] El `accessToken` emitido por `/auth/refresh` no arrastra el `exp` del refresh token: su vigencia es de 8 horas.
- [ ] `POST /auth/refresh` sin header `Authorization` responde 401 con `msg` `Refresh token inválido o expirado`.
- [ ] `POST /auth/refresh` con un header `Authorization` sin el prefijo `Bearer ` responde 401 con el mismo mensaje.
- [ ] `POST /auth/refresh` con un string arbitrario que no es un JWT responde 401 con el mismo mensaje.
- [ ] `POST /auth/refresh` enviando un **access token** en el header responde 401: el secreto separado impide que sirva como refresh.
- [ ] `GET /clientes` enviando un **refresh token** como `Bearer` responde 401: el `JwtStrategy` verifica con `JWT_SECRET` y no lo acepta.
- [ ] Ningún fallo de `/auth/refresh` distingue en el mensaje entre token expirado, mal formado y firmado con otro secreto.
- [ ] `POST /auth/refresh` no ejecuta ninguna consulta a MySQL (verificable por log de queries o por inspección del código).
- [ ] `POST /auth/register` sigue respondiendo `{ ok, msg, user }` con el id del usuario, sin tokens.
- [ ] `POST /clientes`, `GET /clientes` (SPEC 01), `POST /lotes`, `GET /lotes/cliente/:clienteId` (SPEC 02) y `POST /pesajes` (SPEC 03, SPEC 04) siguen funcionando igual.

---

## Decisions

- **Sí:** refresh token stateless, sin persistencia ni DDL. Decisión explícita del usuario. Es el camino más corto para que la app deje de pedir relogin, y no obliga a tocar la base de datos a mano.
- **No:** tabla `refresh_tokens` con tokens hasheados. Se descarta en este spec pese a ser lo que permite revocar. Entra en el spec de logout, cuando la revocación sea un requisito real.
- **No:** columna `token_version` en `usuarios` como revocación mínima. Se descarta: requiere DDL y limita a una sesión por usuario, porque refrescar en un dispositivo invalidaría la sesión del otro.
- **Sí:** rotación en cada refresh, con 30 días completos para el token nuevo. Decisión explícita del usuario. El operador que usa la app a diario no vuelve a loguearse nunca.
- **No:** revocar el refresh anterior al rotar. **Imposible sin persistencia**, y se acepta a conciencia: tras rotar, el refresh viejo sigue siendo válido hasta su propia expiración. La rotación aquí no aporta seguridad, solo extiende la sesión.
- **No:** tope absoluto de sesión vía un claim con la fecha del login original. Se descarta: obligaría a relogin a los 30 días aunque el operador esté activo, que es justo lo que este spec busca evitar.
- **Sí:** secreto propio `JWT_REFRESH_SECRET`. Es lo que impide que un refresh token pase como `Bearer` en las rutas protegidas: el `JwtStrategy` verifica con `JWT_SECRET` y la firma no cuadra.
- **No:** mismo secreto con un claim `type: 'refresh'`. Se descarta porque depende de que el `JwtStrategy` no olvide el chequeo; el secreto separado lo hace estructuralmente imposible.
- **Sí:** el refresh token viaja en `Authorization: Bearer`. Decisión explícita del usuario. Consecuencia asumida: el endpoint es `@Public()`, así que el guard no toca ese header y el controller lo parsea a mano.
- **No:** el refresh token en el body (`{ refreshToken }` con un DTO Zod). Se descarta por la decisión anterior; habría evitado el parseo manual del header, pero el usuario prefiere el header.
- **No:** cookie `httpOnly`. Se descarta: el cliente principal es una app móvil y obligaría a configurar CORS con credenciales.
- **Sí:** `/auth/refresh` es `@Public()`. Se llama justo cuando el access token ya expiró, así que no puede exigir uno válido.
- **Sí:** `/auth/refresh` no consulta la base de datos. Decisión explícita del usuario. Cero queries por renovación, a cambio de que un usuario desactivado siga renovando (ver Riesgos).
- **No:** verificar `usuarios.isActive` antes de emitir el par. Se descarta en este spec; entra junto con la revocación.
- **Sí:** el access token nuevo se firma con los claims copiados del refresh token. Sin consulta a la base de datos, el refresh es la única fuente del `username`.
- **Sí:** descartar `iat` y `exp` del payload verificado antes de re-firmar. Sin esto, `jsonwebtoken` arrastraría la expiración del refresh al access token y el access viviría 30 días.
- **Sí:** access token en 8h, sin cambio. Decisión explícita del usuario. Se anota la consecuencia: con un access de 8h el beneficio de seguridad del refresh es marginal; el valor real de este spec es la comodidad de no reloguear.
- **No:** bajar el access token a 15m. Se descarta: multiplicaría las llamadas a `/auth/refresh` desde campo, donde la conectividad no es confiable.
- **Sí:** `/auth/login` devuelve el par completo. Es la única forma de que la app obtenga su primer refresh token, y es un cambio aditivo que no rompe a los clientes que solo leen `accessToken`.
- **No:** un endpoint aparte para pedir el refresh token. Añadiría un round-trip sin ganar nada.
- **Sí:** 401 con un mensaje genérico para todos los fallos de refresh. La app actúa igual en todos los casos: mandar al login.
- **No:** mensajes distintos según la causa. Se descarta: no cambia el comportamiento del cliente y le dice a un atacante en qué falló.
- **Sí:** `'30d'` como constante en `AuthRepository`, no como variable de entorno. Mismo criterio que el `'8h'` que ya está literal en `src/app.module.ts`.
- **Sí:** `/auth/refresh` no devuelve `user`. La app ya lo tiene del login, y evita un join extra contra `roles` en cada renovación.
- **No:** `POST /auth/logout` en este spec. Sin persistencia, un logout no podría hacer nada más que responder 200 mientras el token sigue vivo; sería mentirle al cliente.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Un refresh token filtrado da acceso durante 30 días y no hay forma de invalidarlo | **Sin mitigar por decisión explícita.** Es la contrapartida directa del diseño stateless. La única respuesta hoy es rotar `JWT_REFRESH_SECRET`, que cierra la sesión de **todos** los usuarios a la vez. La mitigación real (revocación por token) va en el spec de logout. |
| Un usuario dado de baja (`isActive = 0`) o borrado de `usuarios` sigue renovando su sesión hasta 30 días | **Sin mitigar por decisión explícita.** `/auth/refresh` no consulta la base de datos. Con la sesión deslizante, un usuario que siga usando la app nunca queda fuera. |
| La sesión deslizante no caduca nunca: un dispositivo robado que siga refrescando mantiene el acceso indefinidamente | **Sin mitigar por decisión explícita**, al descartarse el tope absoluto de sesión. |
| `JWT_REFRESH_SECRET` falta en un ambiente y el código cae a un literal por defecto, dejando el refresh firmado con un secreto público | Se sigue el patrón ya existente en `src/strategy/jwt.stategy.ts` y `src/app.module.ts`, que usan un literal de respaldo. **Riesgo aceptado y heredado del proyecto**, no introducido aquí. Desplegar sin la variable es un error de ambiente. |
| Alguien configura `JWT_REFRESH_SECRET` igual a `JWT_SECRET` y se pierde la separación entre los dos tipos de token | El código no lo detecta. Queda como criterio de aceptación verificable a mano y como nota en `CLAUDE.md`. |
| El re-firmado arrastra `iat` / `exp` del refresh y emite un access token de 30 días | El paso 5 del plan descarta ambos claims explícitamente, y hay un criterio de aceptación que lo verifica decodificando el `exp` del access token emitido por `/auth/refresh`. |
| `/auth/refresh` es `@Public()`, así que no hay ningún límite de intentos contra él | Sin rate limiting en el proyecto. Un atacante solo puede probar firmas, que es inviable contra un secreto fuerte. El rate limiting es un tema propio, para toda la API y no solo este endpoint. |

---

## What is **not** in this spec

- Cambios de esquema en MySQL.
- Revocación de refresh tokens: tabla `refresh_tokens`, columna `token_version`, lista negra.
- `POST /auth/logout` y `POST /auth/logout-all`.
- Detección de reuso de un refresh token rotado.
- Validación de `usuarios.isActive` al renovar.
- Cambiar la duración del access token.
- Tope absoluto de sesión.
- Refresh token en cookie `httpOnly` y CORS con credenciales.
- Emitir tokens desde `POST /auth/register`.
- Rate limiting de los endpoints públicos de `auth`.
- Discriminación por rol en los endpoints.

Cada uno de estos, si se necesita, va en su propio spec.
