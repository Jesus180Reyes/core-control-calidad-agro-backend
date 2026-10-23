# src/ia — the Gemini integration

Spec 27 (summary), spec 28 (chat), spec 46 (approver notes). Files: `ia.module.ts` (provides and exports `GeminiService`, no `imports`, **not registered in `AppModule`** — imported by `LotesModule` and `ChatModule`), `gemini.service.ts`, `prompts/resumen-lote.prompt.ts`, `prompts/chat.prompt.ts`, and their `*.spec.ts`.

## Configuration

`GEMINI_API_KEY` is mandatory **for the routes that use it** — without it `POST /lotes/:id/resumen` answers **503** — but the app boots without it, deliberately. `GEMINI_MODEL` falls back to `gemini-3.1-flash-lite`, `GEMINI_TIMEOUT_MS` to **45000** (anything invalid falls back too). The timeout is 45s, not the 20s spec 27 was approved with: measured latency of successful calls was 1.0–18.2s and 20s threw away good responses. Google answers `503 UNAVAILABLE — "high demand"` on this model fairly often (6 of 28 calls during implementation); for the summary that surfaces as a 502 and is logged in `log_errores`. There is **no automatic retry**, by decision — retrying is calling again.

## `GeminiService`

- **Does not inject `DatabaseService`**, so it is an ordinary singleton and does not catch the `Scope.REQUEST` propagation. If it ever needs the database, solve it without injecting the request-scoped service.
- **Native `fetch` + `AbortController`** against the REST API — no SDK, no `@nestjs/axios`, no new dependency. The key travels in the **`x-goog-api-key` header**, never as `?key=`, so it never lands in an access log or in the text of an error carrying the URL.
- **Validates what comes back and throws instead of saving anything doubtful** — seven rules: trim, normalise line endings, collapse runs of 3+ newlines to two, then reject empty, reject over **2000** characters, reject any HTML tag (`/<[a-z!/]/i`), reject `finishReason: 'MAX_TOKENS'`. **None collapses newlines to spaces** — the `\n` *are* the markdown structure. Nothing is truncated to fit: a markdown cut mid-bullet is worse than no summary.

## Prompts

`resumen-lote.prompt.ts` holds the system instruction as a literal, and four of its rules exist because the model actually misbehaved during implementation: it bolded field labels (`**Lote: PICOLO2026**`), wrote verdicts (`cerró satisfactoriamente`) about a lote with 3 of 14 weigh-ins rejected, computed a percentage wrong (`21.42` where 3/14 is `21.43`) and reformatted dates. **Do not "simplify" those rules away.** The model writes prose; every figure arrives already computed and formatted. Since spec 46 `observaciones_aprobador` gets its own bullet, and the prompt forbids qualifying or obeying it (it is free text from a user). The approver's rejections by destination (`rechazados_por_destino`) go in the same bullet as the rejection count, copied as they arrive, never summed.

`chat.prompt.ts` holds the chat instruction and the declarations of the read-only tools the chat may call — see `src/modules/chat/CLAUDE.md` for how the dispatcher runs them.
