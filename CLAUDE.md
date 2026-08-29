# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

Run a single unit test file: `npx jest path/to/file.spec.ts`. There are currently no `*.spec.ts` files or `test/` e2e directory in the repo — testing infra is configured (jest, ts-jest, supertest) but unused so far.

Server listens on `process.env.PORT` (default 4000). No global route prefix is set (the `app.setGlobalPrefix('api/v1')` line in `src/main.ts` is commented out).

Required env vars (see `.env`, not committed): `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `PORT`.

## Spec-driven workflow

This repo is developed spec-first via two local skills in `.agents/skills/` (mirrored in `.claude/skills/`):

- `/spec` — designs a spec interactively and saves it to `specs/NN-nombre.md` (template at `.agents/skills/spec/template.md`). No code is written in this phase.
- `/spec-impl <NN-spec-name>` — implements an already-approved spec, creating a git branch named after it.

`specs/` holds the source of truth for what was decided and, just as importantly, what was **deliberately deferred** (each spec has `Out of scope`, `Decisions`, `Risks` and `What is not in this spec` sections). Before adding a feature, check whether an existing spec already ruled it out and why — new work goes in a new spec rather than silently expanding an old one. Specs are written in Spanish; the codebase and this file are in English.

Existing specs (all marked `Implemented`): `01-vinculacion-cliente-operador.md`, `02-modulo-lotes.md`, `03-guardado-de-pesajes.md`.

## Architecture

NestJS API (Express platform) backed by MySQL via Kysely (no ORM, no migrations tooling checked into the repo — the DB schema is assumed to pre-exist and is only mirrored in TypeScript types).

**Request-scoped DB connection pattern** — this is the key non-obvious mechanism:
- `DatabaseMiddleware` (`src/database/middlewares/database.middleware.ts`) runs on every route (`forRoutes('*')`, wired in `DatabaseModule`), opens a new `Kysely` instance with a 1-connection `mysql2` pool per request, and stashes it on `req['db']`. The pool is destroyed when the response finishes (`res.on('finish', ...)`).
- `DatabaseService` (`src/database/database.service.ts`) is `Scope.REQUEST`-scoped and just pulls `request['db']` in its constructor via `@Inject(REQUEST)`.
- Any provider that injects `DatabaseService` becomes request-scoped too (Nest scope propagation), and repositories access the query builder through `this.dbService.client`.
- `Database` and the `*Table` interfaces in `src/database/types/types.ts` are the hand-written Kysely schema — when adding a table/column in MySQL, update this file by hand (no codegen). Note the `Database` key for units is `unidades_medida` (plural) even though the interface is `UnidadMedidaTable`; use the plural form in queries.

**Auth/guard flow:**
- `JwtAuthGuard` (`src/guards/jwt-auth.guard.ts`) is registered globally both via `APP_GUARD` in `AppModule` and again manually in `main.ts` (`app.useGlobalGuards(new JwtAuthGuard(reflector))`), so every route requires a valid JWT by default.
- Use `@Public()` (`src/decorators/public.decorator.ts`) to opt a specific route out — only `AuthController.login` and `AuthController.register` are marked `@Public()`.
- `JwtStrategy` (`src/strategy/jwt.stategy.ts`) validates the bearer token and returns `{ userId, username }`, which becomes `req.user`. Controllers read it as `const { userId } = req.user as { userId: number }`.
- Global pipes: `ZodValidationPipe` from `nestjs-zod` is registered both as `APP_PIPE` in `AppModule` and again manually in `main.ts` — DTOs are Zod schemas wrapped with `createZodDto()` (see `src/modules/*/dto/*.dto.ts`), not `class-validator`.
- Roles exist in the DB (`roles`, `usuarios.rol_id`) but **no endpoint discriminates by role yet** — every authenticated user has the same permissions.
- The `permisos` table (spec 06) declares what each role is *supposed* to be able to do, but **nothing reads it**: there is no `PermissionsGuard` and no `@Permisos()` decorator, `req.user` is still `{ userId, username }`, the JWT payload is unchanged (`sub`, `user_id`, `username`) and `POST /auth/login` does not return permissions. An `OPERADOR` still gets a 201 from `POST /clientes` even though the table says they lack `clientes.crear`. Reading and enforcing it is a future spec.

**Module layout convention:** each feature module is `*.module.ts` → `*.controller.ts` → `*.service.ts` → `repository/*.repository.ts` → `dto/*.dto.ts` (Zod schemas), with `imports: [DatabaseModule]` in the module and the module registered in `src/app.module.ts`.

- Controllers stay thin and always respond with the shape `{ ok, msg, <payload> }`.
- Services are pure pass-throughs to the repository.
- **The repository is where business logic lives**, not just data access: `AuthRepository` hashes passwords with `bcrypt` and signs the JWT via `JwtService`; `ClientesRepository`/`LotesRepository`/`PesajesRepository` hold all domain validation and derived-value computation (e.g. `peso_neto`, `fuera_de_rango`). Don't assume repositories are pure data-access when extending this pattern.
- **Write path convention:** every create opens `this.db.transaction().execute(async (trx) => ...)`, runs a series of `private async validateX(..., db: Kysely<Database>)` helpers **inside** the transaction (they take the `trx` so validation and insert share a connection), then inserts and returns `Number(result.insertId)`. Validators throw `BadRequestException` for missing/inactive rows and duplicates, `ForbiddenException` for authorization. Copy this shape for new modules.
- **Access control convention:** any operation touching a client's data must first call a `validateVinculoOperador(clienteId, usuarioId, db)`-style check against `cliente_operador`. For `pesajes` the `cliente_id` is resolved from the lote first. Without this, the `GET /clientes` filter would be cosmetic.
- Uniqueness (`clientes.rtn`, `clientes.codigo_exportacion`, `lotes.nombre_lote` per client) is enforced **in application code only** — there are no matching MySQL constraints, by explicit decision. This leaves a known race window between the validating `SELECT` and the `INSERT`.

Import path convention: absolute imports from `src/...` are used throughout (e.g. `src/decorators/public.decorator`) rather than relative `../../` paths, even for same-module files in some cases — follow existing files' style per-file rather than assuming one rule.

## Implemented endpoints

| Module | Endpoints |
| --- | --- |
| `auth` | `POST /auth/login`, `POST /auth/register` (both `@Public()`) |
| `clientes` | `POST /clientes` (optional `usuario_ids` links operators), `GET /clientes` (only clients linked to the caller via `cliente_operador`) |
| `lotes` | `POST /lotes` (inserts `estado: 'abierto'`), `GET /lotes/cliente/:clienteId` (product and unit resolved to names by join; never exposes `resumen_ia`) |
| `pesajes` | `POST /pesajes` (one weigh-in per request; backend computes `peso_neto = peso_bruto - tara`, `fuera_de_rango` and `estado_calidad_id` — the body accepts none of the three) |

No read, update or delete endpoints exist beyond the two `GET`s above — no `GET /clientes/:id`, no `GET /lotes/:id`, no `GET /pesajes/*`, no `PUT`/`PATCH`/`DELETE` anywhere.

## Domain

This is a quality-control system for agricultural export batches. Core tables (see `src/database/types/types.ts`): `clientes` (clients/companies), `cliente_operador` (many-to-many between clients and operator users), `lotes` (batches tied to a client + product, with `peso_minimo`/`peso_ideal`/`peso_maximo` tolerance range and an `estado`/`cerrado_en` lifecycle), `pesajes` (individual weigh-ins against a lote, with `peso_bruto`/`tara`/`peso_neto` and `fuera_de_rango`), `estados_calidad` (quality states applied to a pesaje), `productos`, `unidad_medida`, and `roles`/`usuarios` for auth, plus `permisos` (one row per `(rol_id, codigo)`, where `codigo` is `modulo.accion` — declared, **not enforced anywhere**; see the auth/guard notes above).

`diagram.jpeg` in the repo root is the intended end-to-end weighing flow and is the best reference for where the product is going. The backend currently implements only its happy path (capture weight → in range → save). **Not yet built, and needed by the diagram:** the *Etapa* concept (`EN PROCESO` vs `CLIENTE FINAL`, absent from the schema entirely), automatic derivation of the quality state (`APROBADO` / `APROBADO CON EXCEPCIÓN` / `RECHAZADO` — today `estado_calidad_id` comes from the request body and is only checked for existence), alert severity (today only a `fuera_de_rango` boolean, no yellow/red distinction), and supervisor PIN authorization for out-of-range weigh-ins at the final-client stage.

Also deferred by the existing specs, and worth knowing before proposing work: closing a lote (nothing can set `cerrado_en` yet, even though `POST /pesajes` already rejects closed lotes), per-lote aggregates (total weight, counts by quality state), `resumen_ia` generation, batch/offline weigh-in sync and device idempotency by `(dispositivo_identificador, secuencia_dispositivo)`, and endpoints to manage `cliente_operador` links after a client is created.

MySQL decimal columns (`peso_*`) come back from the driver as `string | number`, and `pesajes.id` is a `BIGINT` typed as `Generated<string | number>` — coerce with `Number()` before comparing or returning.

## Caveats

- Any DDL is applied **by hand in MySQL**; there is no migration tooling and no `.sql` files in the repo. When a change needs schema work, document the DDL in the spec and update `src/database/types/types.ts` to match. (Specs 02 and 03 state "no DDL" as a decision — note that `pesajes.fuera_de_rango` was in fact added during spec 03, so that spec's acceptance criterion is inaccurate.)
- `permisos` is seeded and maintained **by hand in SQL** — there is no CRUD endpoint and nothing validates it at startup. Adding an endpoint means inserting its permission by hand, one row per role that should have it (`INSERT ... SELECT r.id, ... FROM roles r WHERE r.nombre = '<ROL>'`, resolving `rol_id` by name because role ids differ between environments). Nothing will warn you if you forget. Note also that `permisos` is the one place where uniqueness is enforced by real MySQL constraints (`UNIQUE (rol_id, codigo)` and a FK to `roles`), a deliberate exception to the application-code-only rule above, precisely because no application code touches this table.
- `README.md` is still the stock NestJS boilerplate; there is no Swagger/OpenAPI setup, so `specs/` plus this file are the API documentation.
- `dist/` is present in the working tree.
