# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**How this documentation is split.** This root file holds only what crosses modules. Each module has its own `CLAUDE.md` next to its code, which Claude Code loads automatically when it reads files in that directory:

| File | Holds |
| --- | --- |
| `src/modules/auth/CLAUDE.md` | login, register, password expiry/reset, supervisor PIN, the only role checks |
| `src/modules/clientes/CLAUDE.md` | clients, `cliente_operador`, uniqueness of `rtn`/`codigo_exportacion`, the edit |
| `src/modules/lotes/CLAUDE.md` | lotes, `etapas`, the stage flow, the approver flow, the `estado = 'cerrado'` discriminator table, `resumen_ia`, origins on lotes |
| `src/modules/pesajes/CLAUDE.md` | weigh-ins, the filter convention (spec 16), `aprobado`, the PIN authorization, `GET /pesajes/:id` |
| `src/modules/documentos-fiscales/CLAUDE.md` | the four fiscal tables, `paises_config`, what spec 25 deferred |
| `src/modules/permisos/CLAUDE.md` | `catalogo_permisos`/`permisos`, the real codes in the DB, how to seed them |
| `src/modules/{catalogos,metricas,origenes,chat,plantas}/CLAUDE.md` | each of those modules |
| `src/ia/CLAUDE.md` | `GeminiService` and the summary prompt |
| `src/filters/CLAUDE.md` | `RegistroErroresFilter` and `log_errores` |
| `src/database/CLAUDE.md` | `types.ts`, the time-zone wiring, the DDL history and constraint counts |

**Keep it that way.** A new fact goes into the `CLAUDE.md` of the module it belongs to; this file only gets a line when the fact crosses modules. Do not record history ("this said X until spec Y") — `specs/` and git already do.

## Commands

```bash
npm run start:dev      # run with watch mode (default for local dev)
npm run start:debug    # watch mode + --inspect
npm run build          # nest build -> dist/
npm run start:prod     # node dist/main (run build first)

npm run lint           # eslint --fix over src/apps/libs/test
npm run format         # prettier --write over src and test

npm run test           # jest unit tests (*.spec.ts, rootDir: src)
npm run test:watch
npm run test:cov
npm run test:e2e       # jest -c ./test/jest-e2e.json
```

Run a single unit test file: `npx jest path/to/file.spec.ts`. Testing infra is configured (jest, ts-jest, supertest) but barely used: there is no `test/` e2e directory.

**Docker**: `docker compose up -d --build` starts the API on host port **4001** and a `mysql:8.0` on **3307** (overridable with `COMPOSE_API_PORT` / `COMPOSE_DB_PORT`), reading the same `.env`. MySQL initialises from `db/schema.sql` + `db/seed.sql` **only when its volume is empty** — after changing either file, `docker compose down -v` to reload. `db/` is a dump of the local DB (structure + catalog tables, **no `productos` and no `usuarios`**), so a fresh database has no users and no products: both are inserted by hand. The image runs `nest build` (not `tsc` — the CLI rewrites the `src/...` imports) and has no real health endpoint: its `HEALTHCHECK` counts any HTTP answer, a 401 included, as alive. `NODE_ENV` from `.env` overrides the image's `production`, so the local stack serves Swagger.

**CI and production**: `.github/workflows/ci.yml` runs `eslint` (no `--fix`), `jest` and `npm run build` on every PR and push; on `main` it also publishes the image to `ghcr.io/jesus180reyes/core-control-calidad-agro-backend` as `latest` and `sha-<commit>`. A lint **error** fails CI — warnings do not. `deploy/` holds the VPS setup (target: Contabo, not yet contracted): `docker-compose.prod.yml` (Caddy → API → MySQL, only 80/443 published, `NODE_ENV=production` forced in the file), `Caddyfile`, `.env.prod.example`, `backup.sh` and a step-by-step `README.md` that is the deploy runbook. `.gitattributes` forces LF on `*.sh`, `*.sql`, `*.yml`, `Dockerfile` and `Caddyfile` because the repo is worked on Windows with `core.autocrlf=true`.

**Time zone**: the database runs on **Honduras time, `-06:00`**, not UTC, and three layers have to agree — MySQL's server default, every connection the API opens, and Node (`TZ=America/Tegucigalpa`). A new pool must spread `opcionesZonaHoraria` and pass `fijarZonaHorariaSesion`, or it reads and writes 6 hours off. Details in `src/database/CLAUDE.md`.

Server listens on `process.env.PORT` (default 4000). No global route prefix (the `app.setGlobalPrefix('api/v1')` line in `src/main.ts` is commented out).

**Environment variables.** Required (`.env`, not committed; `.env.example` is the committed template): `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `PORT`, `NODE_ENV`. `DB_PORT` is optional (default 3306, anything non-numeric falls back to it) and is read in the two places that open a MySQL pool — `DatabaseMiddleware` and `RegistroErroresFilter`; a third place that opens one must read it too. Optional, not required to boot:

- `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.1-flash-lite`), `GEMINI_TIMEOUT_MS` (default **45000**) — see `src/ia/CLAUDE.md`. Without the key, the routes that call Gemini answer 503 but the app starts.
- `CHAT_LIMITE_DIARIO` — see `src/modules/chat/CLAUDE.md`.
- `PASSWORD_VIGENCIA_DIAS` (default **90**) — see `src/modules/auth/CLAUDE.md`.

**Swagger**: UI at `/docs`, OpenAPI JSON at `/docs-json`, mounted in `src/main.ts` **only when `NODE_ENV === 'development'`**. Three things to know. **First: the UI is express middleware, not a Nest route**, so the global `JwtAuthGuard` never sees it — `/docs` is open to anyone who reaches the port, which is the whole reason for the condition. **Second: `patchNestJsSwagger()` does not exist in `nestjs-zod@5`** and importing it breaks the build; in v5 `createZodDto` documents the DTOs on its own, and the only wiring is `cleanupOpenApiDoc()` around `SwaggerModule.createDocument`. **Third: `@nestjs/swagger` is pinned to `^11`** because 12.x requires `@nestjs/common@^12`; a plain `npm install @nestjs/swagger` fails with `ERESOLVE`. Controllers carry `@ApiTags` and `@ApiBearerAuth` per class, `@ApiOperation` (summary + description) per endpoint and `@ApiParam` on route params. **There are no response schemas and no `@ApiResponse` anywhere**, by decision (spec 22): `specs/` and these `CLAUDE.md` files are the only documentation of response shapes. The endpoint descriptions are where the access-control truth lives — every route that skips `validateVinculoOperador` says so in its own description. `AppController` carries `@ApiExcludeController()`: `GET /` stays mapped and still requires a token. Nothing validates the descriptions, so a new endpoint without `@ApiOperation` leaves the UI silently incomplete.

**Route count** (trust the route log over this): Nest maps **50** routes — `auth` 5, `catalogos` 7, `origenes` 1, `clientes` 7, `lotes` 11, `permisos` 1, `pesajes` 8, `documentos-fiscales` 5, `chat` 2, `plantas` 1, `metricas` 1, plus `GET /`. The OpenAPI document holds **49** operations under **45** `paths` keys (`/clientes`, `/documentos-fiscales`, `/lotes/{id}/resumen` and `/clientes/{id}/operadores` each group two verbs). Update these numbers when adding a route.

## Spec-driven workflow

This repo is developed spec-first via two local skills in `.agents/skills/` (mirrored into `.claude/skills/` by directory junctions):

- `/spec` — designs a spec interactively and saves it to `specs/NN-nombre.md` (template at `.agents/skills/spec/template.md`). No code is written in this phase.
- `/spec-impl <NN-spec-name>` — implements an already-approved spec, creating a git branch named after it.

`specs/` holds the source of truth for what was decided and, just as importantly, what was **deliberately deferred** (each spec has `Out of scope`, `Decisions`, `Risks` and `What is not in this spec` sections). Before adding a feature, check whether an existing spec already ruled it out and why — new work goes in a new spec rather than silently expanding an old one. Specs are written in Spanish; the codebase and the `CLAUDE.md` files are in English.

Existing specs run from `01-vinculacion-cliente-operador.md` to `48-preguntas-sugeridas-en-el-chat.md`; `18-filtros-de-lotes.md` is still `Draft`, which is why `lotes` has no query params.

## Architecture

NestJS API (Express platform) backed by MySQL via Kysely (no ORM, no migration tooling — the schema pre-exists and is mirrored by hand in TypeScript types; see `src/database/CLAUDE.md`).

**Request-scoped DB connection pattern** — the key non-obvious mechanism:
- `DatabaseMiddleware` (`src/database/middlewares/database.middleware.ts`) runs on every route (`forRoutes('*')`, wired in `DatabaseModule`), opens a new `Kysely` instance with a **1-connection** `mysql2` pool per request and stashes it on `req['db']`. The pool is destroyed on `res.on('finish', ...)`.
- `DatabaseService` (`src/database/database.service.ts`) is `Scope.REQUEST` and pulls `request['db']` in its constructor via `@Inject(REQUEST)`.
- Any provider that injects `DatabaseService` becomes request-scoped too (Nest scope propagation); repositories use `this.dbService.client`.
- Two singletons deliberately do **not** inject it: `GeminiService` (`src/ia/`) and `RegistroErroresFilter` (`src/filters/`).
- Because the pool has one connection, **never make a network call inside a transaction** — it holds the request's only connection for the length of a third party's latency (see `POST /lotes/:id/resumen` in `src/modules/lotes/CLAUDE.md`).

**Auth/guard flow:**
- `JwtAuthGuard` (`src/guards/jwt-auth.guard.ts`) is registered globally via `APP_GUARD` in `AppModule`, so every route requires a valid JWT by default. `@Public()` (`src/decorators/public.decorator.ts`) opts out — only `POST /auth/login` and `POST /auth/renovar-password` use it.
- `JwtStrategy` (`src/strategy/jwt.stategy.ts`) returns `{ userId, username }` as `req.user`. Controllers read it as `const { userId } = req.user as { userId: number }`. The JWT does not carry the role.
- `ZodValidationPipe` from `nestjs-zod` is registered as `APP_PIPE` in `AppModule`. DTOs are Zod schemas wrapped with `createZodDto()`, not `class-validator`.
- **The pipe and the guard are registered only in `AppModule`. Do not add `useGlobalPipes`/`useGlobalGuards` to `main.ts` "for symmetry"**: until 2026-10-10 both were registered twice, every DTO was validated twice, and any `.transform()` that changed the type broke silently. Several DTO comments still mention "the pipe registered twice" — they describe the old state. Same for the filter: `RegistroErroresFilter` is `APP_FILTER` only; registering it twice would log every error twice.
- `RegistroErroresFilter` (`src/filters/`) writes every 5xx to `log_errores` and never changes a response — see `src/filters/CLAUDE.md`.

**Access control — read this before writing any route.**
- **Role checks: exactly three endpoints discriminate by role** — `POST /auth/register`, `PATCH /auth/usuarios/:id/reset-password` and `PATCH /auth/usuarios/:id/pin`, all `ADMIN` only, checked in the repository by `validateCallerEsAdmin` reading the role from the DB on each request. There is no `@Roles()` decorator and no roles guard. Every other route gives every authenticated user the same permissions. Details in `src/modules/auth/CLAUDE.md`.
- **Permissions are not enforced.** `catalogo_permisos`/`permisos` declare what each role should do, `GET /permisos/me` hands the caller its codes so the **front** can hide buttons, and nothing on the request path reads them: no `PermissionsGuard`, no `@Permisos()`. Several specs (41, 42, 43) chose this split on purpose — the front checks the permission, the backend accepts any authenticated user. See `src/modules/permisos/CLAUDE.md` for the real codes in the DB.
- **`cliente_operador` is the convention, not a rule the codebase holds to.** Most operations on a client's data call a `validateVinculoOperador(clienteId, usuarioId, db)`-style check (for `pesajes`, the `cliente_id` is resolved from the lote). About **thirty** routes deliberately skip it — every approver route, every reject/approve/finalize write, every catalog, the whole `documentos-fiscales` module, the edits of `clientes`, metrics, chat and the plant board. Each module's `CLAUDE.md` lists which of its routes skip it, and every such route says so in its Swagger description. The pattern to remember: **the method that guards is the one that creates, not the one that ends the row's life** — `createPesaje` and `createLote` validate the link, their `rechazar*`/`aprobar*`/`finalizar*` siblings do not, and nothing in `clientes` validates it on any write. Consequence: the `cliente_operador` filters on `GET /clientes` and `GET /lotes/cliente/:clienteId` are cosmetic for anyone who knows the sibling routes, and `PATCH /clientes/:id/operadores` lets any authenticated user link themselves to any client. **Do not copy a `rechazar*`, `aprobar*` or `finalizar*` method as the template for a new write.** `GET /pesajes/historial` is the counter-example: it filters by the caller's own `usuario_id` and has nothing to authorize.
- These were explicit decisions recorded in their specs, not oversights. Do not "fix" one in passing; a change of access policy is its own spec.

## Conventions

**Module layout:** `*.module.ts` → `*.controller.ts` → `*.service.ts` → `repository/*.repository.ts` → `dto/*.dto.ts` (Zod), with `imports: [DatabaseModule]` and the module registered in `src/app.module.ts`.

- Controllers stay thin and respond `{ ok, msg, <payload> }`, the payload key named after the resource (`clientes`, `lotes`, `permisos`). Exceptions, all deliberate: the seven `catalogos` reads use `data`; reads of one row use a singular key (`pesaje`, `documento`, `resumen`); `POST /documentos-fiscales` and `POST /origenes` answer the new id alone (`documento_id`, `origen_id`). If this is ever unified, unify all of it in one spec.
- Services are pure pass-throughs to the repository.
- **The repository is where business logic lives**, not just data access: hashing, JWT signing, domain validation, derived values (`peso_neto`, `fuera_de_rango`, `estado_calidad_id`). `CatalogosRepository` is the exception in the other direction (plain `SELECT`s).

**Write path:** every create opens `this.db.transaction().execute(async (trx) => ...)`, runs `private async validateX(..., db: Kysely<Database>)` helpers **inside** it (they take the `trx` so validation and write share a connection), then inserts and returns `Number(result.insertId)`. `UPDATE`s keep the same shape and return `true`. Validators throw `BadRequestException` for missing/inactive rows and duplicates, `ForbiddenException` for authorization. Copy this shape for new modules.
- Timestamps are written with `sql\`NOW()\``, never a Node `new Date()`, so they share MySQL's clock with `created_at`.
- **Resolve catalog rows by `codigo`, never by a hardcoded id** (`resolveEtapa('FINALIZADO', trx)`, `resolveEstadoCalidad`) — ids differ between environments. The two known counter-examples (`createLote`'s `etapa_id: 1`, `getAllLotesByClienteForApprover`'s `etapa_id = 2`) were left in place on purpose; do not copy them.
- **Deletion of a domain row is always logical** (`isActive = 0`, or `estado = 'cerrado'` on `lotes`) with an audit trio `motivo_rechazo`/`rechazado_por`/`rechazado_en` (or `motivo_anulacion`/`anulado_por`/`anulado_en` on fiscal documents). The only physical `DELETE FROM` in the project is on the `cliente_operador` bridge table (spec 42).
- Exceptions to the write convention are documented where they live: `POST /lotes/:id/resumen` validates outside the transaction (network call), `editarCliente` is a partial update, `editarOperadoresCliente` deletes and inserts.

**Never `selectAll()` on `clientes` or `lotes`.** `clientes.constancia_exonerado` and `lotes.firma_aprobador` (hundreds of KB), `resumen_ia` and `observaciones_aprobador` are returned by no listing; `selectAll()` leaks them.

**Uniqueness is enforced in application code by default** (with the usual race window between the validating `SELECT` and the `INSERT`), except where MySQL holds a real `UNIQUE`: `clientes.rtn`, `clientes.codigo_exportacion`, `documentos_fiscales (pais_id, numero_completo)`, the permission tables and the PIN tables. Where a `UNIQUE` exists, the validator must ignore `isActive` exactly as the constraint does, or the `INSERT` dies on `ER_DUP_ENTRY` with a 500.

**The `:id`-swallows-its-siblings trap.** Nest matches by declaration order, so a bare `@Get(':id')` declared above a sibling literal route answers that route instead, with a `ParseIntPipe` 400 — and everything still compiles. `PesajesController` and `DocumentosFiscalesController` each declare `@Get(':id')` **last in the class**, and that position is load-bearing. If `GET /clientes/:id` is ever added it goes after `@Get('all')`; a `GET /lotes/:id` must go after the four `cliente/...` routes. A path with a literal segment after the param (`@Get(':id/resumen')`) or a different verb (`@Patch(':id')`) is **not** the trap.

**Filters and pagination.** Spec 16 defines the filter convention (`src/modules/pesajes/CLAUDE.md`): a filter never widens a result, booleans travel as `true`/`false`, ids filter the base-table column, and an invalid value is ignored (`.optional().catch(undefined)`) rather than a 400 — except `FiltrosClientesDto`, which drifted, and spec 35's metrics, which answer 400 on purpose. Spec 29 paginates only `GET /clientes/all`, `GET /clientes` and `GET /pesajes/historial`: opt-in via `?pagina`/`?limite` (defaults 1/20, `limite` capped at 100, neither ever a 400), adding a sibling `paginacion: { pagina, limite, total, total_paginas }`; without them the response is byte-identical. Helpers in `src/schemas/paginacion.schema.ts` (`paginacionShape`, `resolverPaginacion()`, `construirPaginacion()`); the repository builds a base query (`JOIN` + `WHERE`) and derives both the `COUNT` and the rows from it. There is no `id` tie-breaker, so tied rows can swap pages.

**Shared Zod schemas** live in `src/schemas/`: `paginacion.schema.ts` and `fecha.schema.ts` (`fechaISO(campo?)`, a `'YYYY-MM-DD'` schema that also rejects non-existent days). `fechaISO` returns the base with no `.optional()`/`.catch()`, so each DTO decides its policy.

**Import paths:** absolute imports from `src/...` are used throughout (e.g. `src/decorators/public.decorator`) rather than relative `../../`, even for same-module files in some cases — follow each file's existing style.

**Driver types:** MySQL decimals (`peso_*`) come back as `string | number`, and `pesajes.id` is a `BIGINT` typed `Generated<string | number>` — coerce with `Number()` before comparing or returning. `TINYINT` flags come back as `0`/`1`: compare by truthiness or against `null`, never with `=== false`.

**Markdown fields.** `resumen` (`/lotes/:id/resumen`) and `respuesta` (`POST /chat`) are **raw markdown** with real `\n`; the backend never renders them and the front must not enable its markdown package's raw-HTML mode. Swagger descriptions are the only place that tells a consumer.

**Data leaving the company.** `POST /lotes/:id/resumen` and `POST /chat` send client names, products, weights, dates, the approver's notes and the destination names of rejected weigh-ins to Google. `pesajes.observaciones` deliberately does not travel. If a contract forbids sending data to a third party, those features should not be enabled.

## Domain

A quality-control system for agricultural export batches, which since spec 25 also **records** (does not emit) the fiscal documents of an export. Core tables, all mirrored in `src/database/types/types.ts`: `clientes`, `cliente_operador`, `lotes`, `etapas`, `pesajes`, `estados_calidad`, `productos`, `unidades_medida`, `origenes`, `destinos`, `roles`/`usuarios`, `catalogo_permisos`/`permisos`, the fiscal tables (`paises_config`, `documentos_fiscales`, `documento_fiscal_impuesto`, `documento_fiscal_lote`), the PIN tables (`pines_supervisor`, `autorizaciones_pin`), `log_errores` and `chat_log`. Each is described in the `CLAUDE.md` of the module that owns it.

**The flow**, end to end: an operator creates a lote (`EN_PROCESO`) and weighs it (`POST /pesajes`, with a supervisor PIN for weights over `peso_maximo`); a supervisor approves it (`CLIENTE_FINAL`, the lote closes); the approver reviews each weigh-in and finalizes the lote with a signature (`FINALIZADO`); `RECHAZADO` is reachable from both ends; then an AI summary can be generated and fiscal documents linked to finalized lotes. Each transition is an explicit call — nothing closes or finalizes a lote by computing its numbers. **`estado = 'cerrado'` means three different things**; use `motivo_rechazo IS NOT NULL` for a rejection and `finalizado_por IS NOT NULL` for a finalization (the discriminator table is in `src/modules/lotes/CLAUDE.md`).

`diagram.jpeg` in the repo root is the intended end-to-end weighing flow and the best reference for where the product is going. Still not built: weighing at the `CLIENTE_FINAL` stage (approval closes the lote, so `POST /pesajes` answers 400 — spec 13's decision), a PIN for weights under `peso_minimo`, an `APROBADO CON EXCEPCIÓN` quality state, and alert severity beyond the `fuera_de_rango` boolean.

## Caveats

- **Any DDL is applied by hand in MySQL**: there is no migration tooling. A spec that needs schema work declares its DDL, transcribes it into `db/schema.sql` in the same change, and updates `src/database/types/types.ts`. Every existing environment, production included, needs the `ALTER TABLE` by hand **before** the code ships. The full history and the constraint counts live in `src/database/CLAUDE.md`.
- When schema lands in MySQL before its spec, transcribe what is there (`DESCRIBE`, `SHOW CREATE TABLE`) and let the database win.
- The database runs `STRICT_TRANS_TABLES`: an oversized value is a MySQL 500, not a silent truncation, so DTOs cap strings at their column length.
- Hand-maintained tables with no CRUD and no startup validation: `etapas`, `estados_calidad`, `paises_config`, `catalogo_permisos`/`permisos`, `roles`, `destinos`. A missing row surfaces as a 400 at request time.
- `README.md` is still the stock NestJS boilerplate.
- `dist/` is present in the working tree.
