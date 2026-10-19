# auth module

Specs: 33 (password expiry), 34 (reset), 37 (admin-only register), 38 (supervisor PIN). Five routes.

## Role checks — the only ones in the project

Exactly three endpoints discriminate by role, all here: `POST /auth/register`, `PATCH /auth/usuarios/:id/reset-password`, `PATCH /auth/usuarios/:id/pin`. Each answers **403** unless the caller's role is `ADMIN`, with its own message (`No tiene permisos para registrar usuarios` / `No tiene permisos para restablecer contraseñas` / `No tiene permisos para asignar PINs de supervisor`), because `validateCallerEsAdmin(userId, mensaje, db)` takes the message as a parameter.

- **The check lives in `AuthRepository`**, not in a guard or a `@Roles()` decorator — a generic mechanism was deliberately not built.
- **The role is read from the DB on every request** (`usuarios` joined to `roles` by the token's `userId`), because the JWT does not carry it. Removing someone's `ADMIN` takes effect immediately; a token whose user no longer exists also gets 403.
- **It compares `roles.nombre` against the literal `'ADMIN'`**, uppercase — not a `catalogo_permisos` code, so permissions are still unenforced.
- It is checked **first**, so a non-admin cannot probe which ids exist.
- Bootstrap: if no `ADMIN` with a known password remains, creating users or resetting passwords needs a manual SQL change.
- `SUPERVISOR` (id 3 in the current DB, seeded by hand) is read in two places and **gates no caller**: the PIN endpoint demands it of the *target* user (`validateUsuarioEsSupervisor`, a 400), and `POST /pesajes/validar-pin` demands it of the PIN's owner. Both compare against the literal `'SUPERVISOR'`; if the row is named differently, no user can receive a PIN and every PIN answers `PIN incorrecto` — it fails closed.
- Role names are uppercase: `OPERADOR` (id 1), `ADMIN` (id 2), `SUPERVISOR` (id 3).

## `usuarios` columns of note

- `password_vence_en DATETIME NULL` — `NULL` means the password **never expires** (every user created before spec 33, no backfill).
- `password_actualizada_en DATETIME NULL` — written only by `POST /auth/renovar-password`; `NULL` means the user never chose their own password.
- Both compared and written with MySQL's `NOW()`.
- **`usuarios.username` has no `UNIQUE` in MySQL** (verified 2026-10-10); the register validator is the only barrier.
- Access tokens last 8h and nothing revokes them: not expiry, not renewal, not a reset.
- The PIN does **not** live in `usuarios` (see `pines_supervisor` below), so no query on `usuarios` can drag it along.

`PASSWORD_VIGENCIA_DIAS` (optional, default **90**): days a password stays valid after renewal. Anything not a positive integer falls back to 90 (`resolverVigenciaDias()`), so expiry cannot be switched off by configuration. It must be an integer because it is bound into `DATE_ADD(NOW(), INTERVAL ? DAY)`.

## Routes

**`POST /auth/login`** (`@Public()`). The 200 carries `passwordVencida: false` at the top level next to `accessToken`. A correct password whose `password_vence_en <= NOW()` answers **403** `{ statusCode, message: 'La contraseña ha caducado', passwordVencida: true }` with no token and no `error` key. The expiry check runs **after** `bcrypt.compare`, so a wrong password answers the usual 401 without `passwordVencida` — expiry is only revealed to whoever knows the password. The flag is always a literal boolean, never the `0`/`1` of the `password_vencida` column computed in `getUserByUsername`, which is stripped from `user`.

**`POST /auth/register`** — requires a token (not `@Public()`) and an `ADMIN` one (403 checked first). Body `{ username, complete_name, rol, cedula }`, **no password** (a `password` key is stripped). `username` capped at 20 in the DTO, the column length. Generates the password with `generarPasswordTemporal()` and returns it in plain text **once**: `{ ok, msg, user, password_temporal }`, `user` being the new id. Writes `password_vence_en = NOW()`, so every new user is born expired and renews on first login. Transaction, validators in order: admin (403); **400** if `rol` is not in `roles`; **409** if the `cedula` exists; **400** `El nombre de usuario 'X' ya esta en uso` if the `username` exists (case-insensitive under `utf8mb4_0900_ai_ci`, ignoring `isActive`). The 400/409 split is deliberate. An `ADMIN` may create another `ADMIN`. No permission code.

**`POST /auth/renovar-password`** (`@Public()`, because the expired login issues no token). Body `{ username, password_actual, password_nueva }`; the new one needs 8+ chars, an uppercase letter and a digit (DTO), and must differ from the current one (checked against the hash in the repository). Works on expired and valid passwords. Writes the hash, `password_actualizada_en = NOW()` and `password_vence_en = NOW() + PASSWORD_VIGENCIA_DIAS`. Responds `{ ok, msg }` with **no token** — the client logs in again. **401** `Usuario o contraseña incorrectos` for both unknown user and wrong current password; **400** for a DTO rule or a repeated password.

**`PATCH /auth/usuarios/:id/reset-password`** — `ADMIN` resets a forgotten password. No body, no DTO. Generates a 10-character temporary password with `crypto.randomInt` (alphabet without `0 O o 1 l I`, at least one uppercase and one digit), writes its hash and `password_vence_en = NOW()` (born expired), returns it **once**: `{ ok, msg, password_temporal }`. Does **not** touch `password_actualizada_en`. Order: **403** if the caller is not `ADMIN` or no longer exists; **400** if the caller targets themselves (use `renovar-password`); **400** if the target does not exist or has `isActive = 0` (`NULL` counts as active). An `ADMIN` may reset another `ADMIN`. **No audit columns** by decision — who reset a password is not recorded. Does not revoke the target's live tokens.

**`PATCH /auth/usuarios/:id/pin`** — `ADMIN` gets the PIN of a `SUPERVISOR`. No body, no DTO, `ParseIntPipe` on `:id`. Transaction, in order: **403** (caller not `ADMIN`); **400** if the target does not exist or is inactive (`validateUsuarioActivo`); **400** `El usuario con id 'X' no tiene el rol SUPERVISOR`; **400** `El usuario con id 'X' ya tiene un PIN asignado`. Then generates a 4-digit PIN with `crypto.randomInt(0, 10000)` + `padStart`, checking it against `pines_supervisor` and retrying up to **20** times (**400** `No se pudo generar un PIN unico, intente de nuevo`), inserts `{ usuario_id, pin, created_by }` and returns it **once**: `{ ok, msg, pin }`, **200**. The PIN is **generated, never chosen**, so a "PIN taken" error can never reveal someone else's. Assigned once and forever: nothing regenerates, revokes or reads it over the API; changing one is a manual `DELETE FROM pines_supervisor` and a new call.

## Supervisor PIN tables (spec 38)

- **`pines_supervisor`** — one row per supervisor: `usuario_id`, `pin CHAR(4)` (a string, to keep leading zeros), `created_by`, `created_at`. **Stored in clear**, by decision (hashing deferred), which is what allows the `UNIQUE` and a plain `=` lookup. `uq_pines_supervisor_usuario` (at most one PIN per supervisor) and `uq_pines_supervisor_pin` (two supervisors never share one — which lets the PIN identify its owner). Written only by `PATCH /auth/usuarios/:id/pin`, read only by `POST /pesajes/validar-pin`, returned by no read. Anyone with access to the table or a backup sees every PIN.
- **`autorizaciones_pin`** and `pesajes.aprobado_con_excepcion_por` belong to the weighing side — see `src/modules/pesajes/CLAUDE.md`.
