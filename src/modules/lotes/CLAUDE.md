# lotes module

Specs: 02, 12 (rejection), 13 (approval), 18 (filters, still `Draft`), 19 (approver flow), 20 (finalization), 24 (finalized listing), 26 (signature), 27 (AI summary), 43 (origin), 45 (approver notes), 46 (notes to Gemini). Eleven routes, **no query params anywhere** (spec 18 owns `lotes` filters and is still `Draft`).

## Access control

`LotesRepository` validates `cliente_operador` in `getLotesByCliente` and `createLote` only. Every other route skips it, by decision: `GET /lotes/cliente/:clienteId/all` (never had it, and no spec decided that), the approver inbox, `/finalizados`, `PATCH /lotes/:id/rechazar`, `/aprobar`, `/rechazar/byApprover`, `/finalizar/byApprover`, and both `/lotes/:id/resumen`. So an `OPERADOR` with no link can reject, approve or finalize another client's lote and get **200, not 403** — specs 12 and 13 have acceptance criteria asserting exactly that. The argument for the approver routes: the approver and any `ADMIN` hold no `cliente_operador` row, so validating would close the screen to exactly the people who use it. Do not copy `rechazarLote`, `aprobarLote` or `finalizarLote` as the template for a new write.

## `etapas`

The stage of the flow: `EN_PROCESO` = id 1, `CLIENTE_FINAL` = 2, `RECHAZADO` = 3, `FINALIZADO` = 4 **in the current DB**, each with a `codigo` (`EN_PROCESO`) and a `nombre` (`EN PROCESO`). Seeded by hand, no endpoint reads or writes the table, no spec designed it, nothing validates it at startup — a missing row surfaces as a 400 at write time. **Always resolve by `codigo`** (`resolveEtapa(codigo, db)`, which throws `BadRequestException` if missing). Two places hardcode ids anyway, both left in place on purpose: `createLote`'s `etapa_id: 1` and `getAllLotesByClienteForApprover`'s `etapa_id = 2` — if `CLIENTE_FINAL` is not id 2 in an environment, the approver's inbox is **silently** wrong; check that first if it misbehaves.

Writers: `EN_PROCESO` by `createLote`; `RECHAZADO` by `rechazarLote` and `rechazarLoteForApprover`; `CLIENTE_FINAL` by `aprobarLote`; `FINALIZADO` only by `finalizarLote`.

## Reading a lote's state — read this before touching anything that reads `lotes.estado`

`estado = 'cerrado'` means **three different things** and neither it nor `cerrado_en` (written once, by whichever closing operation ran) can tell them apart:

| Signal | Rejected | Approved (in `CLIENTE_FINAL`) | Finalized |
| --- | --- | --- | --- |
| `estado` | `'cerrado'` | `'cerrado'` | `'cerrado'` — **useless as a discriminator** |
| `cerrado_en` | written | written | written, **by the approval** — also useless |
| `motivo_rechazo` | `NOT NULL` | `NULL` | `NULL` — **canonical signal of a rejection** |
| `aprobado_por` / `aprobado_en` | `NULL` | `NOT NULL` | `NOT NULL` — finalizing does not clear them |
| `finalizado_por` / `finalizado_en` | `NULL` | `NULL` | `NOT NULL` — **canonical signal of a finalization** |
| `etapa_id` | `RECHAZADO` row | `CLIENTE_FINAL` row | `FINALIZADO` row — usable, needs an `etapas` lookup, nullable |

Approval and finalization are **sequential, not exclusive**: a finalized lote carries both audit pairs. `PATCH /lotes/:id/rechazar/byApprover` rejects an already approved lote, so that row has `motivo_rechazo` **and** `aprobado_por` — **check `motivo_rechazo` first, always**. A lote waiting on the approver is `aprobado_por IS NOT NULL AND finalizado_por IS NULL`. `'cerrado'` alone says only "no longer open".

Nothing closes or finalizes a lote as a *computation*: every transition is an explicit call, and approving the last weigh-in changes nothing about the lote. Whoever builds computed closing inherits three meanings of `'cerrado'`.

## `lotes` columns

Tied to a client + product, with `peso_minimo`/`peso_ideal`/`peso_maximo`, `etapa_id`, and `estado` (`VARCHAR(20)`, `DEFAULT 'abierto'`) / `cerrado_en`. Audit sets, all nullable, each with its FK to `usuarios`:
- rejection trio `motivo_rechazo`/`rechazado_por`/`rechazado_en` — **returned by no endpoint**;
- approval pair `aprobado_por`/`aprobado_en` (spec 13) and finalization pair `finalizado_por`/`finalizado_en` (spec 20) — returned **only** by `/finalizados`, resolved to names.
- `firma_aprobador MEDIUMTEXT NULL` (spec 26) — the approver's signature as a data URL of a base64 PNG; written only by finalization, **returned by no endpoint**; no FK, no index. Not cryptographic proof of anything (no hash, no certificate). The 7 lotes finalized before spec 26 keep `NULL` forever.
- `observaciones_aprobador VARCHAR(1000) NULL` (spec 45) — the approver's closing note; written only by finalization, never edited, **returned by no endpoint**. The reporting service (another repo) reads it straight from MySQL, and since spec 46 it travels to Gemini (summary payload and chat tool `lotes_de_cliente` for finalized lotes), normalized to text or `null`. **"No note" has two forms**: `NULL` and `''`.
- `resumen_ia TEXT NULL` — see the summary routes below.
- `origen_id INT NULL` (spec 43, ordinal 3, FK `fk_lotes_origen` → `origenes`) — written only by `POST /lotes` when the body carries it; nothing changes it afterwards.
- `cerrado_en` sits **last** in a `DESCRIBE`.

**Never `selectAll()` in `LotesRepository`**: `firma_aprobador` alone is hundreds of KB per row.

**Uniqueness of `nombre_lote` per client is application code only** (no MySQL constraint, by decision; race window between `SELECT` and `INSERT`). `validateNombreLoteDisponible` **excludes rejected rows** by filtering **`motivo_rechazo IS NULL`, not `estado`** — a rejection frees the name, while an approved or finalized lote (`'cerrado'` too) keeps it reserved. Do not "simplify" it to `estado <> 'cerrado'`.

## Routes

**Listings.** The four `cliente/...` routes share one query shape and the same **eleven** fields in the same order (product, unit and *etapa* resolved to names; `origen` last — `origenes.nombre` by `LEFT JOIN`, `null` without origin, still the name when the origin was deactivated). None exposes `resumen_ia`, the signature or the notes.
- `GET /lotes/cliente/:clienteId` — `estado = 'abierto'`, `created_at` DESC, **validates `cliente_operador`**.
- `GET /lotes/cliente/:clienteId/all` — the **same query and fields** without the link check. Despite the name it also filters `estado = 'abierto'`.
- `GET /lotes/cliente/:clienteId/all/approver` — the approver's inbox: `estado = 'cerrado'` plus the **hardcoded `etapa_id = 2`**. Entered `main` with no spec; documented by spec 19.
- `GET /lotes/cliente/:clienteId/all/finalizados` (spec 24) — **the only read that shows a finalized lote**. Same eleven fields plus four: `aprobado_por`, `aprobado_en`, `finalizado_por`, `finalizado_en`, the ids resolved to `usuarios.complete_name` by two aliased `LEFT JOIN`s (`aprobador`, `finalizador`) — the raw ids never travel; the rejection trio is absent by design. Stage resolved with `resolveEtapa('FINALIZADO', this.db)` (one extra query; a **400** if the row is missing). Ordered **`finalizado_en` DESC**, deliberately (`NULL` sorts last). Never 404s: an unknown client answers 200 with `[]`.

**`POST /lotes`** — inserts `estado: 'abierto'` and the hardcoded `etapa_id: 1`; validates the link. Optional `origen_id` (spec 43): without it `origen_id = NULL`; with it, `validateOrigen` runs after `validateUnidadMedida` and answers **400** `El origen con id 'X' no existe` / `El origen 'N' no esta activo`. Nothing ties the origin to the client — the catalogue is global.

**`PATCH /lotes/:id/rechazar`** (spec 12) — logical annulment. Writes six columns: `estado = 'cerrado'`, `etapa_id` = `RECHAZADO` (by `codigo`), `cerrado_en = NOW()`, plus the rejection trio. Body one required `motivo`, 5–255; `{ ok, msg }`. 400 if the lote does not exist, is not open (`estado != 'abierto'` or `cerrado_en != NULL` — also how "already rejected" is caught, no dedicated message) or the `RECHAZADO` row is missing. Irreversible. **No cascade**: pesajes stay active and visible in `GET /pesajes/byLote/:loteId`, while `POST /pesajes` and `PATCH /pesajes/:id/rechazar` start answering 400, so those pesajes can never be annulled. Frees the `nombre_lote`.

**`PATCH /lotes/:id/aprobar`** (spec 13) — the supervisor signs the lote off to `CLIENTE_FINAL`. Writes five columns: `estado = 'cerrado'`, `etapa_id` = `CLIENTE_FINAL` (by `codigo`), `cerrado_en = NOW()`, `aprobado_por`/`aprobado_en`. **No body, no DTO.** `{ ok, msg }`. 400 if the lote does not exist, is not open, its `etapa_id` is not `EN_PROCESO`, it has **no pesaje with `isActive = 1`**, or a needed `etapas` row is missing. Irreversible, no cascade, does not free the `nombre_lote`. **Closing costs weighing**: `POST /pesajes` answers 400 from then on, so no weighing is possible at `CLIENTE_FINAL` although `diagram.jpeg` puts the supervisor-PIN flow there — spec 13's decision; unblocking it means deciding whether approval stops closing the lote or `validateLoteAbierto` changes.

**The approver flow runs on *closed* lotes**, inverting the rule every other write follows: the rest of the project calls `validateLoteAbierto`, these call `validateLoteEnClienteFinal` (`estado = 'cerrado'`, etapa `CLIENTE_FINAL`, `motivo_rechazo IS NULL`). Weigh-in reviews (`PATCH /pesajes/:id/{aprobar,rechazar}/byApprover`) are in `src/modules/pesajes/CLAUDE.md`.

**`PATCH /lotes/:id/rechazar/byApprover`** — the approver annuls a lote already in `CLIENTE_FINAL`. Writes **four** columns: `etapa_id` = `RECHAZADO` plus the rejection trio; does **not** write `estado` or `cerrado_en` (already written by the approval). Body `motivo`, 5–255; `{ ok, msg }`. 400 if the lote does not exist, was already rejected (`motivo_rechazo IS NOT NULL`), is not `'cerrado'` or not in `CLIENTE_FINAL`.

**`PATCH /lotes/:id/finalizar/byApprover`** (spec 20; body since 26 and 45) — the approver signs the whole lote off and the flow ends. Writes **five** columns: `etapa_id` = `FINALIZADO` (by `codigo`), `finalizado_por`/`finalizado_en`, `firma_aprobador`, `observaciones_aprobador`. Does not write `estado`/`cerrado_en` and does not touch `aprobado_por`/`aprobado_en`. Body:
- **`firma_aprobador`, required**: `data:image/png;base64,...`, at most 500.000 characters, PNG only — the only DTO whose validation is about a payload's format. A call with no body is a 400.
- **`observaciones_aprobador`, optional**: trimmed **before** its length is measured, capped at **1000** (**400** `Las observaciones del aprobador no pueden superar los 1000 caracteres`); a non-string, `null` included, is a 400 (`Las observaciones del aprobador deben ser texto`). Absent → `NULL`; `""`/`"   "` → empty string (the DTO converts nothing).

Five validations, in order: the lote exists; it **was not already finalized** (its own message, `ya fue finalizado`, at the cost of a second `SELECT` — that is why `validateLoteNoFinalizado` runs before `validateLoteEnClienteFinal`); it is not rejected, is `'cerrado'` and in `CLIENTE_FINAL`; it has at least one pesaje with `isActive = 1`; and **no active pesaje has `aprobado IS NULL`** (`validatePesajesRevisados` — the first `lotes` write that reads `pesajes` for more than existence). It demands every active weigh-in be **reviewed**, not approved: a lote whose weigh-ins were all rejected (`aprobado = 0`) finalizes fine, and an annulled one (`isActive = 0`) never blocks it. `{ ok, msg }`. Irreversible and it **freezes the lote**: the three other approver endpoints require `CLIENTE_FINAL`, so they start answering 400. No cascade; does not free the `nombre_lote`. Afterwards the lote appears only in `/finalizados`; its pesajes stay visible through `byLote` and `historial`.

## AI summary — `POST` and `GET /lotes/:id/resumen` (spec 27)

`resumen_ia` holds **raw markdown**, a closed subset: an opening paragraph, a blank line, 3 to 5 bullets starting with `- `, and `**` bold. The backend never renders it; the front must not enable raw-HTML mode. It is read by exactly one endpoint, the `GET`. Capped in code (2.000 characters by `GeminiService`), not by the `TEXT` column. **No audit** (`resumen_ia_modelo`, `_en`, `_por`) by decision, so there is no way to tell which model wrote which summary. Correcting one is a manual `UPDATE`.

**`POST /lotes/:id/resumen`** — builds the lote's metrics in SQL, sends them to Gemini (`src/ia/`) and saves the markdown. No body, no DTO; `@HttpCode(200)`; `{ ok, msg, resumen }`. **Idempotent** (amendment of 2026-09-18): a lote that already has a summary answers **200 with the stored markdown**, without calling Gemini — so a repeated request never spends money, which is the whole mitigation for "any authenticated user can spend our balance". The existence check runs **before** the state validators, so a non-finalized lote with a hand-filled summary also answers 200. The generation path demands `finalizado_por IS NOT NULL` (not an `etapas` lookup) and at least one active weigh-in. `msg` is always `Resumen generado correctamente`, even when nothing was generated.
- **Order: validate → aggregate → `fetch` → transaction.** The validators run **outside** the transaction because the HTTP call sits between them and the write and must not hold the request's single pooled connection. The transaction only re-reads `resumen_ia` with the `trx` and runs a one-column `UPDATE`. That second read closes the race: of two simultaneous requests, the loser returns the winner's summary and **discards the markdown it just paid for**.
- **The model writes prose, it does not compute**: two fixed aggregate queries (`getMetricasLote`, `getEstadosCalidadLote`) produce every figure already resolved, including `porcentaje_fuera_de_rango` and dates pre-formatted in Spanish. They exist only to fill the prompt; no endpoint returns them and nothing decides anything with them.
- Payload is exactly `ResumenLotePayload`: client name, product, variety, weights, dates and, since spec 46, `observaciones_aprobador` (trimmed, `null` when `NULL`/`''`/blank; the prompt forbids qualifying or obeying it). No RTN, address, phone or fiscal data. Summaries written before spec 46 are not regenerated.
- Codes: **404** if the lote does not exist (a 404 on a write — 404 means "not there", 400 means "its state does not serve"); **400** if not finalized or no active weigh-ins (generation path only); **503** without `GEMINI_API_KEY`; **502** if Gemini times out, errors or returns something that fails validation. On every failure no column changes.
- Writes **one** column, no timestamp, no `userId`. Do not copy it as the template for anything that does not call a network.

**`GET /lotes/:id/resumen`** — one query, one column, no joins. **404** `El lote con id 'X' no existe` (same message as the `POST`), otherwise **200** — with `resumen: null` when there is none. **Does not validate the lote's state.** The cheap read that can never spend a Gemini call.

`@Get(':id/resumen')` is **not** the `:id` trap: the literal segment after the param makes it disjoint from `'cliente/:clienteId'`, so its position is not load-bearing. `LotesController` still has **no** bare `@Get(':id')`; if `GET /lotes/:id` is ever added, it must go after the four `cliente/...` routes.

## Deferred

`GET /lotes/:id` (declined by specs 21 and 24 — fields and filters undecided), `lotes` filters (spec 18), closing a lote as a computed result, exposing per-lote aggregates as fields, regenerating/correcting/deleting a summary, generating it automatically on finalization, summaries for other entities (`src/ia/` is reusable), reading the signature or the notes over the API, undoing a finalization or reopening a lote, batch/offline weigh-in sync.
