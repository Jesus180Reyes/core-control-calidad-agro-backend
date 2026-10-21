# chat module

Spec 28 (plus the chat-improvement specs after it; `docs/chat/` holds the question catalogue). Two routes. The prompt and the tool declarations live in `src/ia/prompts/chat.prompt.ts`; the dispatcher and every query in `repository/chat.repository.ts`. Read the class comment there before touching it.

## Access — open by decision

Neither route validates `cliente_operador`: any authenticated user can ask about any client's lotes and weigh-ins. Filtering by cartera was considered and discarded (approvers and `ADMIN` have no `cliente_operador` rows, so they would see nothing). No permission row.

## `POST /chat`

One conversation turn. `@HttpCode(200)` (a turn creates no resource). `{ ok, msg, respuesta }`, `respuesta` being **raw markdown** with real `\n`, like `resumen` — the front must not enable raw-HTML mode.
- **The model never queries the database.** It chooses among **read-only** functions declared in `chat.prompt.ts` — currently eleven: `buscar_persona`, `mis_clientes`, `lotes_de_cliente`, `metricas_de_lote`, `pesajes_de_lote`, `pesajes_de_usuario`, `resumen_del_lote`, `detalle_de_pesaje`, `lotes_aprobados`, `pesajes_de_cliente`, `lotes_finalizados` — and the backend decides whether to run them. **The dispatcher knows no write function**, so a hallucinated `rechazar_lote` has nothing behind it; that is the second barrier, the first being the prompt. The controller's Swagger description names the count; update it when adding a tool.
- **Cross-lote tools exist so the model never walks lotes one by one** (that is what exhausted `MAX_VUELTAS` in `chat_log`): `pesajes_de_cliente` lists every operator's weigh-ins across a client's lotes plus a `por_lote` breakdown (count, net weight, out-of-range) — per lote, never one client total, because units differ between lotes; `lotes_finalizados` filters by `finalizado_en` with `finalizado_por IS NOT NULL`, the twin of `lotes_aprobados` (`aprobado_en`). Both of the lote-window tools default to `hoy`.
- **A tool never throws**: an unknown id, a bad argument or an empty result returns `{ error }` or `{ aviso }` for the model to explain. Throwing would be a 500 on a chat screen.
- **Always 200 while the token is valid**: if Gemini fails, the turn does not converge or the daily limit ran out, it answers 200 with a text explaining it (`TEXTO_DISCULPA`, `TEXTO_NO_CONVERGE`), never a 502/503.
- **Loop budget**: `MAX_VUELTAS = 3` Gemini calls that may request data, plus a separate closing call (`redactarConLoQueHay`) that drafts with what was already fetched. They count calls, not tool rounds — raising the cap to four was rejected because it only moves the wall.
- **Row caps**: `LIMITE_POR_DEFECTO = 10`, `LIMITE_MAXIMO = 50` per query, `MAX_FILAS_MODELO = 20` rows ever sent to the model (the result then carries the total, so the answer can say "20 of 137"), `MAX_COINCIDENCIAS = 10` for `buscar_persona`.
- **Relative periods** (`hoy`, `ayer`, `esta_semana`, `semana_pasada`, `ultimos_7_dias`, `este_mes`, `mes_pasado`) are resolved **in MySQL with `CURDATE()`**, never in Node or by the model.
- **Lote states in the chat's vocabulary** are `abierto`, `pendiente_aprobacion` and `finalizado`, by stage — not the `estado` column, which cannot tell them apart (see the discriminator table in `src/modules/lotes/CLAUDE.md`).
- Only the last 10 history messages are resent, and never the tool results of earlier turns.
- **Nothing runs inside a transaction** (one-connection pool + Google latency).
- **Queries are duplicated on purpose** from `LotesRepository`/`PesajesRepository` rather than injecting them, to avoid coupling modules; the accepted cost is that a fix in one place silently leaves the other behind. `ChatRepository` also keeps its own copies of the queries spec 29 paginated.
- What travels to Google: client and lote names, products, weights, dates and, since spec 46, `observaciones_aprobador` of finalized lotes (via `lotes_de_cliente`). **`pesajes.observaciones` does not travel**, by decision.

## Limits and logging

- **`CHAT_LIMITE_DIARIO`** (optional, default **20** turns per user per day). A non-numeric, zero or negative value falls back to the default, so **the cap cannot be switched off by configuration** — deliberately, because it protects the bill. It is a billing cap, not abuse protection (IP rate limiting is spec 23, a different axis).
- **`chat_log`**: one row per turn, written at the end; a failure to write it is logged and never brings the turn down. It is what the daily limit counts and what the `edith` agent reviews for real failures.

## `GET /chat/sugerencias`

Four example questions for the empty chat screen, built from **one query** on the caller's cartera and **no AI** — opening the chat costs no Gemini call and does not count against the limit. With a cartera the examples name the caller's real clients; with an empty one (the normal case for an approver or `ADMIN`) it returns four generic ones. Always four, never 404 or `[]`. `{ ok, msg, sugerencias }`.

There is no bare `@Get(':id')` in this controller; if one is ever added, it goes after `sugerencias`.
