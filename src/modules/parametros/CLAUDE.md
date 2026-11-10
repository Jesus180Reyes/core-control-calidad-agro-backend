# parametros module

Specs 51 and 52. Two routes, both read-only: `GET /parametros` (JWT) and the public `GET /info`. The tenant's own company data, as key-value rows: with one database per tenant, this table is what tells one company from another without any tenant logic in `src/`.

## `parametros`

`clave VARCHAR(100)` with a real **`UNIQUE`** (`uq_parametros_clave`), `valor VARCHAR(500)` nullable, `descripcion VARCHAR(255)` (for whoever runs the `UPDATE`, never returned), `isActive`, `created_at`, `updated_at` (`ON UPDATE CURRENT_TIMESTAMP`).

- **Key-value on purpose**: a new piece of data is an `INSERT` in each tenant database, not an `ALTER TABLE`. The cost is that `valor` is always text — no type, no format check per key (a malformed RTN or e-mail goes through). The code interprets no key.
- **Written only by hand** (`UPDATE` in MySQL), like `paises_config`. No CRUD, no startup validation. The API sees a change on the next request.
- `db/seed.sql` seeds eight keys with `valor` `NULL`: `EMPRESA_NOMBRE_COMERCIAL`, `EMPRESA_RAZON_SOCIAL`, `EMPRESA_RTN`, `EMPRESA_DIRECCION`, `EMPRESA_TELEFONO`, `EMPRESA_CORREO`, `EMPRESA_SITIO_WEB` and `APP_NOMBRE` (the product name, `'metrika360'`, filled by hand per tenant like the rest — there is no fallback in code). Keys are UPPER_SNAKE with a prefix, like catalog `codigo`s. `nuevo-tenant.sh` takes no company arguments; the values are filled in afterwards (`deploy/README.md`, sections 7 and 9).
- **Never store a secret here**: any authenticated user reads any key, and two of them are readable without a token (`GET /info`). Secrets stay in `.env`.
- Retiring a key is `isActive = 0` (the route then answers 404), never a `DELETE`.

## `GET /parametros?nombre=<CLAVE>`

`ObtenerParametroDto`: `nombre` trimmed, 1–100 — **mandatory**, so a missing or empty `nombre` is a **400**. It is the identifier of what is asked for, not a filter, so it does not follow spec 16's ignore-invalid convention. One `SELECT clave, valor` with `isActive = 1`, no transaction. The `utf8mb4_0900_ai_ci` collation makes the lookup case- and accent-insensitive (`empresa_rtn` finds `EMPRESA_RTN`).

- **200** `{ ok, msg, parametro: { clave, valor } }`. `valor: null` means the key exists and nobody filled it in.
- **404** `Parametro no encontrado` if the key does not exist or is inactive — so the front tells a typo from an empty value.
- No `id`, `descripcion`, `isActive` or timestamps in the response.
- Requires a JWT; **no `cliente_operador` check, no role, no permission row** — these are tenant data, not a client's.

## `GET /info` — public

`InfoController` (`info.controller.ts`), in this module, `@Public()`, reusing `ParametrosRepository.obtenerInfoPublica()`. Meant for the front's login screen, before there is a session.

- One `SELECT clave, valor ... WHERE clave IN ('APP_NOMBRE', 'EMPRESA_NOMBRE_COMERCIAL') AND isActive = 1`, no transaction. The two keys are module constants (`CLAVE_APP`, `CLAVE_EMPRESA`) in the repository.
- **200** with exactly `{ app, empresa }` — **no `{ ok, msg }` envelope**. Each field is a string or `null`: `null` when the key is empty, inactive or missing. It never answers 404 (unlike `GET /parametros`, where the caller picks the key).
- Takes no input; any query string is ignored, so no other key can be asked for.
- **Adding a key to those constants makes it public** to anyone who reaches the domain. Exposing another key is its own spec.
- **Not a health check**: no `status`, no 503. A MySQL failure is a generic 500. The `Dockerfile` `HEALTHCHECK` still calls `GET /`; `/health` is left free for a real one.
- Rows are matched back by exact `clave`, so a key stored in lowercase by hand would come out `null` even though the `ai_ci` collation finds it.

## Deferred

A real `/health` endpoint; any other key on `/info`; a code fallback to `'metrika360'`; version or commit in `/info`; rate limiting of the public route (spec 23, Draft). A write route (`PATCH /parametros`, ADMIN/SOPORTE); listing every key in one call; a logo, colours or front branding; a `categoria` column; moving `.env` behaviour settings (`PASSWORD_VIGENCIA_DIAS`, `CHAT_LIMITE_DIARIO`, `GEMINI_MODEL`) or the per-tenant time zone here; any consumer inside the API — the chat prompt, the AI summary and the fiscal documents do not read this table (putting the company name in a Gemini prompt would send it to Google, which is its own spec).
