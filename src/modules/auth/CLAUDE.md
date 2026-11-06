# auth module

Specs: 33 (password expiry), 34 (reset), 37 (admin-only register), 38 (supervisor PIN), 50 (refresh token). Six routes.

## Role checks — the only ones in the project

Exactly three endpoints discriminate by role, all here: `POST /auth/register`, `PATCH /auth/usuarios/:id/reset-password`, `PATCH /auth/usuarios/:id/pin`. Each answers **403** unless the caller's role is `ADMIN` or `SOPORTE` (`ROLES_GESTION_USUARIOS`), with its own message (`No tiene permisos para registrar usuarios` / `No tiene permisos para restablecer contraseñas` / `No tiene permisos para asignar PINs de supervisor`), because `validateCallerEsAdminOSoporte(userId, mensaje, db)` takes the message as a parameter. The two roles are equal here: a `SOPORTE` can create an `ADMIN` and reset an `ADMIN`'s password — by decision, not an oversight.

- **The check lives in `AuthRepository`**, not in a guard or a `@Roles()` decorator — a generic mechanism was deliberately not built.
- **The role is read from the DB on every request** (`usuarios` joined to `roles` by the token's `userId`), because the JWT does not carry it. Removing someone's `ADMIN` takes effect immediately; a token whose user no longer exists also gets 403.
- **It compares `roles.nombre` against the literals `'ADMIN'` and `'SOPORTE'`**, uppercase — not a `catalogo_permisos` code, so permissions are still unenforced (`MODULO-SOPORTE` only tells the front to show the screen).
- It is checked **first**, so a non-admin cannot probe which ids exist.
- Bootstrap: if no `ADMIN` with a known password remains, creating users or resetting passwords needs a manual SQL change.
- `SUPERVISOR` (id 3 in the current DB, seeded by hand) is read in two places and **gates no caller**: the PIN endpoint demands it of the *target* user (`validateUsuarioEsSupervisor`, a 400), and `POST /pesajes/validar-pin` demands it of the PIN's owner. Both compare against the literal `'SUPERVISOR'`; if the row is named differently, no user can receive a PIN and every PIN answers `PIN incorrecto` — it fails closed.
- Role names are uppercase: `OPERADOR` (id 1), `ADMIN` (id 2), `SUPERVISOR` (id 3), `APROBADOR` (4), `CONTADOR` (5), `SOPORTE` (6, in the seed).

## `usuarios` columns of note

- `password_vence_en DATETIME NULL` — `NULL` means the password **never expires** (every user created before spec 33, no backfill).
- `password_actualizada_en DATETIME NULL` — written only by `POST /auth/renovar-password`; `NULL` means the user never chose their own password.
- Both compared and written with MySQL's `NOW()`.
- **`usuarios.username` has no `UNIQUE` in MySQL** (verified 2026-10-10); the register validator is the only barrier.
- `isActive` (`NULL` counts as active) is read by login and refresh, which reject `0` — see Sessions below.
- The PIN does **not** live in `usuarios` (see `pines_supervisor` below), so no query on `usuarios` can drag it along.

`PASSWORD_VIGENCIA_DIAS` (optional, default **90**): days a password stays valid after renewal. Anything not a positive integer falls back to 90 (`resolverVigenciaDias()`), so expiry cannot be switched off by configuration. It must be an integer because it is bound into `DATE_ADD(NOW(), INTERVAL ? DAY)`.

## Sessions (spec 50)

Two JWTs with the same payload (`sub`, `user_id`, `username`; no role, no `type` claim):

- **Access token** — 8h, signed with `JWT_SECRET` by the global `JwtModule` (`src/app.module.ts`). The only one `JwtStrategy` accepts.
- **Refresh token** — 30 days, signed with `JWT_REFRESH_SECRET` (`signTokenPair` in `AuthRepository`). The separate secret is what keeps either token from passing as the other; `resolverSecretoRefresh()` returns `null` when the variable is empty or equals `JWT_SECRET`, and then login hands out `refreshToken: null` and refresh answers 503.
- **No persistence, no DDL.** Each refresh rotates (new pair, 30 full days from that call), but the old refresh token stays valid until its own `exp`: there is no logout and no per-token revocation.

What cuts a session, and when:

| Event | Live access token | Refresh |
| --- | --- | --- |
| `isActive = 0` | keeps working up to 8h (`JwtStrategy` does not read the DB) | next refresh → 401 `El usuario esta inactivo` |
| Password expires (`password_vence_en <= NOW()`) | keeps working | next refresh → 403 `passwordVencida: true` |
| Admin reset (spec 34) | keeps working | next refresh → 403, because the temporary password is born expired |
| User renews own password | keeps working | **keeps working** — nothing ties the token to the password |
| User deleted from `usuarios` | keeps working | next refresh → 401 generic |
| `JWT_REFRESH_SECRET` changed | keeps working | every refresh of the tenant → 401 |

## Routes

**`POST /auth/login`** (`@Public()`). The 200 is `{ ok, msg, user, accessToken, refreshToken, passwordVencida: false }`; `refreshToken` is `null` when there is no usable `JWT_REFRESH_SECRET`. Checks in order: unknown user → 401 `Usuario o contraseña incorrectos`; wrong password → 401 `Usuario o contraseña incorrectas` (note the `-as`: the two texts differ, so the message tells whether a username exists); `isActive = 0` → **401** `El usuario esta inactivo`; `password_vence_en <= NOW()` → **403** `{ statusCode, message: 'La contraseña ha caducado', passwordVencida: true }` with no token and no `error` key. Both the inactive and the expiry checks run **after** `bcrypt.compare`, so they are only revealed to whoever knows the password. The flag is always a literal boolean, never the `0`/`1` of the `password_vencida` column computed in `getUserByUsername`; that column and `isActive` are stripped from `user`.

**`POST /auth/refresh`** (`@Public()`, `@HttpCode(200)`, no `@ApiBearerAuth`). Body `{ refreshToken }` (`RefreshTokenDto`, non-empty string). Responds `{ ok, msg: 'Sesion renovada correctamente', accessToken, refreshToken }`, **no `user`**. `refreshTokens()` in order: **503** `El refresh de sesion no esta disponible` without a secret; **400** from the pipe on a missing/empty body field; `jwtService.verify` with the refresh secret, any failure (bad signature, expired, malformed, an access token) → **401** `Refresh token inválido o expirado`; one `SELECT` on `usuarios` by `user_id ?? sub`, **no transaction** — missing row → the same 401; `isActive = 0` → **401** `El usuario esta inactivo`; expired password → the login's **403** body. Then `signTokenPair` with a payload rebuilt from the row: the `username` comes from the DB (a rename shows up on the next refresh) and `iat`/`exp` are never copied — passing a payload with `exp` plus `expiresIn` makes `jsonwebtoken` throw. Skips `validateVinculoOperador` (no client data).

**`POST /auth/register`** — requires a token (not `@Public()`) and an `ADMIN` one (403 checked first). Body `{ username, complete_name, rol, cedula }`, **no password** (a `password` key is stripped). `username` capped at 20 in the DTO, the column length. Generates the password with `generarPasswordTemporal()` and returns it in plain text **once**: `{ ok, msg, user, password_temporal }`, `user` being the new id. Writes `password_vence_en = NOW()`, so every new user is born expired and renews on first login. Transaction, validators in order: admin (403); **400** if `rol` is not in `roles`; **409** if the `cedula` exists; **400** `El nombre de usuario 'X' ya esta en uso` if the `username` exists (case-insensitive under `utf8mb4_0900_ai_ci`, ignoring `isActive`). The 400/409 split is deliberate. An `ADMIN` may create another `ADMIN`. No permission code.

**`POST /auth/renovar-password`** (`@Public()`, because the expired login issues no token). Body `{ username, password_actual, password_nueva }`; the new one needs 8+ chars, an uppercase letter and a digit (DTO), and must differ from the current one (checked against the hash in the repository). Works on expired and valid passwords. Writes the hash, `password_actualizada_en = NOW()` and `password_vence_en = NOW() + PASSWORD_VIGENCIA_DIAS`. Responds `{ ok, msg }` with **no token** — the client logs in again. Does not cut the user's other sessions: their refresh tokens keep renewing. **401** `Usuario o contraseña incorrectos` for both unknown user and wrong current password; **400** for a DTO rule or a repeated password.

**`PATCH /auth/usuarios/:id/reset-password`** — `ADMIN` resets a forgotten password. No body, no DTO. Generates a 10-character temporary password with `crypto.randomInt` (alphabet without `0 O o 1 l I`, at least one uppercase and one digit), writes its hash and `password_vence_en = NOW()` (born expired), returns it **once**: `{ ok, msg, password_temporal }`. Does **not** touch `password_actualizada_en`. Order: **403** if the caller is not `ADMIN` or no longer exists; **400** if the caller targets themselves (use `renovar-password`); **400** if the target does not exist or has `isActive = 0` (`NULL` counts as active). An `ADMIN` may reset another `ADMIN`. **No audit columns** by decision — who reset a password is not recorded. The target's live access token keeps working; their refresh token stops at its next use (403), because the temporary password is born expired.

**`PATCH /auth/usuarios/:id/pin`** — `ADMIN` gets the PIN of a `SUPERVISOR`. No body, no DTO, `ParseIntPipe` on `:id`. Transaction, in order: **403** (caller not `ADMIN`); **400** if the target does not exist or is inactive (`validateUsuarioActivo`); **400** `El usuario con id 'X' no tiene el rol SUPERVISOR`; **400** `El usuario con id 'X' ya tiene un PIN asignado`. Then generates a 4-digit PIN with `crypto.randomInt(0, 10000)` + `padStart`, checking it against `pines_supervisor` and retrying up to **20** times (**400** `No se pudo generar un PIN unico, intente de nuevo`), inserts `{ usuario_id, pin, created_by }` and returns it **once**: `{ ok, msg, pin }`, **200**. The PIN is **generated, never chosen**, so a "PIN taken" error can never reveal someone else's. Assigned once and forever: nothing regenerates, revokes or reads it over the API; changing one is a manual `DELETE FROM pines_supervisor` and a new call.

## Supervisor PIN tables (spec 38)

- **`pines_supervisor`** — one row per supervisor: `usuario_id`, `pin CHAR(4)` (a string, to keep leading zeros), `created_by`, `created_at`. **Stored in clear**, by decision (hashing deferred), which is what allows the `UNIQUE` and a plain `=` lookup. `uq_pines_supervisor_usuario` (at most one PIN per supervisor) and `uq_pines_supervisor_pin` (two supervisors never share one — which lets the PIN identify its owner). Written only by `PATCH /auth/usuarios/:id/pin`, read only by `POST /pesajes/validar-pin`, returned by no read. Anyone with access to the table or a backup sees every PIN.
- **`autorizaciones_pin`** and `pesajes.aprobado_con_excepcion_por` belong to the weighing side — see `src/modules/pesajes/CLAUDE.md`.
