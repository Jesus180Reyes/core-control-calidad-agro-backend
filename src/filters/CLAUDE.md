# src/filters — error logging

Spec 36. The project's only `ExceptionFilter`: `RegistroErroresFilter` (`registro-errores.filter.ts`), `@Catch()` with no arguments, `extends BaseExceptionFilter`. It adds no route.

It does exactly one thing: when the status is **>= 500** (`getStatus()` for an `HttpException`, 500 for anything else) it writes a row to `log_errores`. It **never changes a response** — it calls `super.catch` first, so every status and body is byte-identical, and Nest still prints unhandled errors to the console. 4xx are never written.

1. **Registered once, as `APP_FILTER` in `AppModule`.** Do not add `app.useGlobalFilters(...)` to `main.ts`: registered twice, it writes every error twice.
2. **It does not write through `req['db']`.** It opens its own one-connection `Kysely` (reading `DB_PORT` like `DatabaseMiddleware`, and the time-zone options), inserts, and destroys it in a `finally` — because `DatabaseMiddleware` destroys the request's pool on `finish`, and because when the 5xx was MySQL failing, that connection is the one that failed. It does not inject `DatabaseService`, so it stays a singleton.
3. **Fire-and-forget** (`void this.registrar(...)`): the `INSERT` never delays the response, and **logging an error can never raise one** — any failure ends in a `Logger.error` and is swallowed. When MySQL is down, the error that matters most is the one that cannot be stored; it stays in the console.
4. **Truncates before writing** (`metodo` 10, `ruta` 500, `mensaje` 1000, `stack` 15000, `entorno` 20 characters) because of `STRICT_TRANS_TABLES`. `stack` is 15000 and not 65535 because `TEXT` counts bytes and a `utf8mb4` character can take four.

**Never stored**, by decision: the request body (passwords, the 500 KB signature), the IP, the `User-Agent`, the exception's class name.

## `log_errores`

`status`, `metodo`, `ruta` (`req.originalUrl`, **query string included**), `mensaje`, `stack` (`NULL` when what was thrown is not an `Error`), `usuario_id` (from `req.user.userId`; `NULL` on a `@Public()` route or before the guard ran), `entorno` (`NODE_ENV`, `NULL` if undefined — the column tells apart rows from environments sharing one database), `created_at` (MySQL's default, never sent).
- The first table written by something that is not a repository, and the first **no endpoint reads**: errors are queried in MySQL, because a stack trace exposes internals.
- `usuario_id` has **no FK**, on purpose: a log must survive its user, and a broken FK would fail precisely the `INSERT` recording a failure.
- No index beyond the PK, **no retention, no deduplication**: it grows until someone deletes by hand.
- Expect most rows to be `POST /lotes/:id/resumen` answering 502 (Google's frequent `503 UNAVAILABLE`).
- Its DDL (in `specs/36-registro-de-errores-del-api.md`) must be applied in every environment; until it is, every 5xx there ends in a `Logger.error` instead of a row, and the API answers as before.
- Front-end errors are not stored here (offered and declined).
