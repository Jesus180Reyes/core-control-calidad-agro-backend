# src/database

`DatabaseMiddleware` (one-connection pool per request on `req['db']`), the request-scoped `DatabaseService`, the time-zone wiring and the hand-written Kysely schema. The request-scoped pattern is described in the root `CLAUDE.md`.

## `types/types.ts` — the schema, by hand

`Database` and the `*Table` interfaces are the Kysely schema, **written by hand** (no codegen). When a table or column changes in MySQL, update this file. The `Database` key for units is `unidades_medida` (plural) even though the interface is `UnidadMedidaTable`; use the plural in queries. `pesajes.aprobado` is typed `boolean | null` but arrives as `0`/`1`.

## Time zone — `zona-horaria.ts`

The database runs on **Honduras time, `-06:00`**, not UTC. Three layers, all set:
1. MySQL's server default: `--default-time-zone=-06:00` in both compose files.
2. **Every connection the API opens**: mysql2 `timezone: '-06:00'` (`opcionesZonaHoraria`) plus a `SET time_zone` on each new session through Kysely's `onCreateConnection` (`fijarZonaHorariaSesion`), so the API is right even against a MySQL still on UTC. **A new pool must spread `opcionesZonaHoraria` and pass `fijarZonaHorariaSesion`**, or it reads and writes 6 hours off. Today two places open pools: `DatabaseMiddleware` and `RegistroErroresFilter` — both also read `DB_PORT`.
3. Node: `TZ=America/Tegucigalpa` in the `Dockerfile`, because `fechaEnLetra`/`fechaHora` format with `getDate()`/`getHours()`.

It is an **offset**, not `America/Tegucigalpa`, because the MySQL time-zone tables are not loaded. JSON still carries ISO instants with `Z`, so the front shows them in the browser's zone. `dateStrings: ['DATE']` makes `DATE` columns (`documentos_fiscales.fecha_emision`) travel as `'YYYY-MM-DD'` instead of an ISO midnight. **`DATETIME` rows written before the switch (2026-10-12) were not migrated**, by decision, and show 6 hours later than they happened; `TIMESTAMP` columns (most `created_at`) are stored in UTC by MySQL and came out right on their own. A per-tenant time zone is pending until a tenant in another zone arrives.

## DDL — how schema changes land

There is **no migration tooling**. DDL is applied **by hand in MySQL**, in every environment, production included, **before** the code that uses it — otherwise the routes reading the new column answer 500. A spec that needs schema declares its DDL up front, transcribes it into `db/schema.sql` in the same change (so a fresh Docker volume gets it; an existing volume needs the `ALTER TABLE` by hand or `docker compose down -v`), and updates `types.ts`.

When schema lands before its spec (it happened with the `aprobado` trio on `pesajes`, added by hand on 2026-09-08 and adopted by spec 19): transcribe what is in MySQL, verify it with `DESCRIBE` and `SHOW CREATE TABLE` before writing code, and let the database win.

Conventions worth copying:
- Audit columns are nullable and named identically on every table: `motivo_rechazo VARCHAR(255)`, `rechazado_por INT`, `rechazado_en DATETIME` (on `pesajes`, `clientes`, `lotes`), `aprobado_por`/`aprobado_en`, `finalizado_por`/`finalizado_en`, `actualizado_por`. Each `*_por` carries a real FK to `usuarios(id)`, argued as an audit column that would be worthless pointing at a missing user.
- Text columns get the same cap in their DTO as in the DDL (`VARCHAR(500)` ↔ `.max(500)`), because the database runs `STRICT_TRANS_TABLES` and an oversized value is a MySQL 500 instead of a readable 400. Use `MEDIUMTEXT` when a value can pass 64 KB (`firma_aprobador`).
- A destructive change (spec 14) goes in this order: create the new unique index, drop the old one, drop the columns, add the FK — and only *after* the code stopped reading those columns.
- Create a referenced table before the column that points at it (`origenes` before `lotes.origen_id`; `destinos` before `pesajes.destino_id`; `pines_supervisor`, then `pesajes.aprobado_con_excepcion_por`, then `autorizaciones_pin`). Match the FK type to the referenced id: `usuarios.id` is `INT`, `pesajes.id` is `BIGINT`.
- Column order to know before reading a `DESCRIBE`: on `lotes`, `cerrado_en` sits **last**, after the audit pairs, `firma_aprobador` and `observaciones_aprobador`; `origen_id` is at ordinal 3, after `cliente_id`. On `pesajes`, `destino_id` sits right after `rechazado_en`, before the `aprobado` trio.

## Constraints — count the database, not the docs

- **Uniqueness is application code by default.** Real `UNIQUE`s exist on: `clientes.rtn` (added by nobody's spec), `catalogo_permisos.codigo`, `permisos (rol_id, permiso_id)`, `documentos_fiscales (pais_id, numero_completo)` and the other fiscal-table uniques of spec 25, `cliente_operador (cliente_id, usuario_id)`, `pines_supervisor.usuario_id` and `.pin`, `autorizaciones_pin.token` and `.pesaje_id`. Not unique in MySQL: `clientes.codigo_exportacion` (its `UNIQUE` was dropped on 2026-10-24), `lotes.nombre_lote` per client, `origenes.nombre`, `usuarios.username`.
- **FKs**: the specs' running count reached 26 after spec 43, but `information_schema.REFERENTIAL_CONSTRAINTS` held **41** on 2026-10-18 — some FKs (the `*_ibfk_*` of the original tables, among others) were never in any spec's count. Count the table rather than trust any number.
- Deliberately without FK: `log_errores.usuario_id` (a log must survive its user), `lotes.firma_aprobador`, `clientes.constancia_exonerado` (they point at nothing).

## Hand-maintained tables

No CRUD and nothing validates them at startup; a missing row surfaces as a 400 at request time: `etapas`, `estados_calidad`, `roles`, `catalogo_permisos`/`permisos`, `paises_config`, `destinos` (spec 47; `db/seed.sql` seeds two rows, and with no active row every approver rejection of a weigh-in answers 400), plus `productos` and `usuarios`, which `db/seed.sql` does not include.
