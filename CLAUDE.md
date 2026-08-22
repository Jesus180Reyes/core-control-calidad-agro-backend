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

## Architecture

NestJS API (Express platform) backed by MySQL via Kysely (no ORM, no migrations tooling checked into the repo — the DB schema is assumed to pre-exist and is only mirrored in TypeScript types).

**Request-scoped DB connection pattern** — this is the key non-obvious mechanism:
- `DatabaseMiddleware` (`src/database/middlewares/database.middleware.ts`) runs on every route (`forRoutes('*')`, wired in `DatabaseModule`), opens a new `Kysely` instance with a 1-connection `mysql2` pool per request, and stashes it on `req['db']`. The pool is destroyed when the response finishes (`res.on('finish', ...)`).
- `DatabaseService` (`src/database/database.service.ts`) is `Scope.REQUEST`-scoped and just pulls `request['db']` in its constructor via `@Inject(REQUEST)`.
- Any provider that injects `DatabaseService` becomes request-scoped too (Nest scope propagation), and repositories access the query builder through `this.dbService.client`.
- `Database` and the `*Table` interfaces in `src/database/types/types.ts` are the hand-written Kysely schema — when adding a table/column in MySQL, update this file by hand (no codegen).

**Auth/guard flow:**
- `JwtAuthGuard` (`src/guards/jwt-auth.guard.ts`) is registered globally both via `APP_GUARD` in `AppModule` and again manually in `main.ts` (`app.useGlobalGuards(new JwtAuthGuard(reflector))`), so every route requires a valid JWT by default.
- Use `@Public()` (`src/decorators/public.decorator.ts`) to opt a specific route out — both `AuthController.login` and `AuthController.register` are marked `@Public()`.
- `JwtStrategy` (`src/strategy/jwt.stategy.ts`) validates the bearer token and returns `{ userId, username }`, which becomes `req.user`.
- Global pipes: `ZodValidationPipe` from `nestjs-zod` is registered both as `APP_PIPE` in `AppModule` and again manually in `main.ts` — DTOs are Zod schemas wrapped with `createZodDto()` (see `src/modules/auth/dto/*.dto.ts`), not `class-validator`.

**Module layout convention** (established by `src/modules/auth`): each feature module has `*.controller.ts` → `*.service.ts` → `repository/*.repository.ts` (does the actual Kysely queries) → `dto/*.dto.ts` (Zod schemas). Controllers stay thin; services currently just pass through to repositories. `src/modules/pesajes` exists as an empty stub for a not-yet-implemented module — follow the auth module's file layout when building it out.

Import path convention: absolute imports from `src/...` are used throughout (e.g. `src/decorators/public.decorator`) rather than relative `../../` paths, even for same-module files in some cases — follow existing files' style per-file rather than assuming one rule.

**Domain** (inferred from `src/database/types/types.ts`, not written down elsewhere): this is a quality-control system for agricultural export batches. Core tables are `clientes` (clients), `lotes` (product batches tied to a client/product), `pesajes` (individual weigh-ins against a lote, with `peso_bruto`/`peso_neto`/`tara`), `estados_calidad` (quality states applied to a pesaje), `productos`, `unidad_medida`, and `roles`/`usuarios` for auth.
