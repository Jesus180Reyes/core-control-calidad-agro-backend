# chat module

Spec 28 (plus the chat-improvement specs after it; `docs/chat/` holds the question catalogue). Two routes. The prompt and the tool declarations live in `src/ia/prompts/chat.prompt.ts`; the dispatcher and every query in `repository/chat.repository.ts`. Read the class comment there before touching it.

## Access — open by decision

Neither route validates `cliente_operador`: any authenticated user can ask about any client's lotes and weigh-ins. Filtering by cartera was considered and discarded (approvers and `ADMIN` have no `cliente_operador` rows, so they would see nothing). No permission row.

**`mis_clientes` is the one place the chat reads the role.** `contextoDe` joins `roles` in the same user query (from the DB on every turn, like `validateCallerEsAdmin`) and sets `ContextoChat.esAdmin`; for an `ADMIN` the tool returns every active client (`todosLosClientes`, capped at `MAX_FILAS_MODELO` with `total`/`mostrados`) instead of the cartera. Every other role, approvers included, still gets its `cliente_operador` rows.

## `POST /chat`

One conversation turn. `@HttpCode(200)` (a turn creates no resource). `{ ok, msg, respuesta, sugerencias }`, `respuesta` being **raw markdown** with real `\n`, like `resumen` — the front must not enable raw-HTML mode. `sugerencias` (spec 48) is a `string[]` that is **always present**: `[]` on every turn except the one where the chat did not understand, where it holds 2–3 plain-text questions and `respuesta` is exactly `FRASE_SUGERENCIAS`.
- **The model never queries the database.** It chooses among **read-only** functions declared in `chat.prompt.ts` — currently thirteen: `buscar_persona`, `mis_clientes`, `lotes_de_cliente`, `metricas_de_lote`, `pesajes_de_lote`, `pesajes_de_usuario`, `resumen_del_lote`, `detalle_de_pesaje`, `lotes_aprobados`, `pesajes_de_cliente`, `lotes_finalizados`, `lotes_pendientes`, `rechazos_por_destino` — and the backend decides whether to run them. **The dispatcher knows no write function**, so a hallucinated `rechazar_lote` has nothing behind it; that is the second barrier, the first being the prompt. The controller's Swagger description names the count; update it when adding a tool.
- **Cross-lote tools exist so the model never walks lotes one by one** (that is what exhausted `MAX_VUELTAS` in `chat_log`): `pesajes_de_cliente` lists every operator's weigh-ins across a client's lotes plus a `por_lote` breakdown (count, net weight, out-of-range) — per lote, never one client total, because units differ between lotes; `lotes_finalizados` filters by `finalizado_en` with `finalizado_por IS NOT NULL`, the twin of `lotes_aprobados` (`aprobado_en`). Both of the lote-window tools default to `hoy`. `lotes_pendientes` is the approver's queue across all **active** clients (same `estado = 'cerrado'` + `CLIENTE_FINAL` filter as `lotes_de_cliente`'s `pendiente_aprobacion`, plus `clientes.isActive = 1`), oldest first, with no period.
- **`observaciones_aprobador` travels in three tools**: `lotes_de_cliente` (finalized), `lotes_finalizados`, and `metricas_de_lote` inside a `cierre` block that only appears on finalized lotes — the last one is what answers "the approver's note on lote X" in two calls. `resumen_del_lote` does not carry it.
- **The destination of an approver rejection** (`pesajes.destino_id`, spec 47) travels as the catalog name only — `motivo_rechazo` does not. `pesajes_de_lote` and `detalle_de_pesaje` add `destino_del_rechazo` to each row: `null` unless `aprobado = 0`, and `'Sin destino registrado'` for rejections older than spec 47 (never `null`, so it cannot be confused with an unrejected row). `pesajes_de_usuario` and `pesajes_de_cliente` do not carry it. `rechazos_por_destino` aggregates approver rejections (`aprobado = 0 AND isActive = 1`) by destination **and** unit (count, net weight, distinct lotes), optionally by `cliente_id` or `lote_id`; the window is on `pesajes.rechazado_en`, defaults to `hoy` **except when `lote_id` is given** (then no window).
- **Suggested questions (spec 48).** A fourteenth declaration, `sugerir_preguntas({ preguntas })`, is the only one that queries nothing: it is how the model says "this fits several tools, pick one". `responder` intercepts it before `despachar` (which only answers `{ error }` if it ever gets there):
  - alone and valid → the turn ends with no further Gemini call, `respuesta = FRASE_SUGERENCIAS`, `sugerencias` = the questions;
  - validation, in order: strings only, `trim`, newlines to spaces, drop empty / over 150 chars / HTML tag (`/<[a-z!/]/i`), dedupe, keep the first 3, fewer than 2 is invalid;
  - alone but invalid, or sent alongside other calls → it gets an `{ error }` functionResponse (the protocol needs one per call in `partes`), the other calls run, and the loop goes on — data wins;
  - it never enters `usadas`, so a turn that only suggested logs `herramientas = NULL`;
  - the closing call (`mode: 'NONE'`) cannot produce suggestions.
  The prompt's `PREGUNTAS SUGERIDAS:` section covers intent ambiguity only; name ambiguity (2–4 matches) is still listed in text by `SUPUESTOS Y REPREGUNTAS`. The front is meant to render one button per suggestion and send its text verbatim as the next `mensaje`.
- **A tool never throws**: an unknown id, a bad argument or an empty result returns `{ error }` or `{ aviso }` for the model to explain. Throwing would be a 500 on a chat screen.
- **Always 200 while the token is valid**: if Gemini fails, the turn does not converge or the daily limit ran out, it answers 200 with a text explaining it (`TEXTO_DISCULPA`, `TEXTO_NO_CONVERGE`), never a 502/503.
- **Loop budget**: `MAX_VUELTAS = 3` Gemini calls that may request data, plus a separate closing call (`redactarConLoQueHay`) that drafts with what was already fetched. They count calls, not tool rounds — raising the cap to four was rejected because it only moves the wall.
- **Row caps**: `LIMITE_POR_DEFECTO = 10`, `LIMITE_MAXIMO = 50` per query, `MAX_FILAS_MODELO = 20` rows ever sent to the model (the result then carries the total, so the answer can say "20 of 137"), `MAX_COINCIDENCIAS = 10` for `buscar_persona`.
- **Relative periods** (`hoy`, `ayer`, `esta_semana`, `semana_pasada`, `ultimos_7_dias`, `este_mes`, `mes_pasado`) are resolved **in MySQL with `CURDATE()`**, never in Node or by the model.
- **Lote states in the chat's vocabulary** are `abierto`, `pendiente_aprobacion` and `finalizado`, by stage — not the `estado` column, which cannot tell them apart (see the discriminator table in `src/modules/lotes/CLAUDE.md`).
- Only the last 10 history messages are resent, and never the tool results of earlier turns.
- **Nothing runs inside a transaction** (one-connection pool + Google latency).
- **Queries are duplicated on purpose** from `LotesRepository`/`PesajesRepository` rather than injecting them, to avoid coupling modules; the accepted cost is that a fix in one place silently leaves the other behind. `ChatRepository` also keeps its own copies of the queries spec 29 paginated.
- What travels to Google: client and lote names, products, weights, dates and, since spec 46, `observaciones_aprobador` of finalized lotes (via `lotes_de_cliente`), and the destination name of approver rejections. **`pesajes.observaciones` does not travel**, by decision.

## Limits and logging

- **`CHAT_LIMITE_DIARIO`** (optional, default **20** turns per user per day). A non-numeric, zero or negative value falls back to the default, so **the cap cannot be switched off by configuration** — deliberately, because it protects the bill. It is a billing cap, not abuse protection (IP rate limiting is spec 23, a different axis).
- **`chat_log`**: one row per turn, written at the end; a failure to write it is logged and never brings the turn down. It is what the daily limit counts and what the `edith` agent reviews for real failures. There is no column for suggestions: `respuesta` stores `textoConSugerencias(respuesta, sugerencias)` — the phrase, a blank line, one `- pregunta` line each — so those rows start with `FRASE_SUGERENCIAS`. The exported helper is also the format the front should put in `historial` for that assistant turn, so a typed "la segunda" resolves. A suggestions turn counts against the daily limit like any other.

## `GET /chat/sugerencias`

Four example questions for the empty chat screen, built from **one query** on the caller's cartera and **no AI** — opening the chat costs no Gemini call and does not count against the limit. With a cartera the examples name the caller's real clients; with an empty one (the normal case for an approver or `ADMIN`) it returns four generic ones. Always four, never 404 or `[]`. `{ ok, msg, sugerencias }`.

There is no bare `@Get(':id')` in this controller; if one is ever added, it goes after `sugerencias`.
