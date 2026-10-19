# plantas module

Spec 32. One route: `GET /plantas/en-vivo`, the live board ("Mirador"), meant to be polled every 1–2 minutes; it keeps no state between calls. `{ ok, msg, planta }`.

- Returns, in one read, the active clients with their current lotes and the day's KPIs.
- Each lote carries a board stage derived from `etapas.codigo`: `EN_PROCESO` → `en-pesaje` and `CLIENTE_FINAL` → `por-aprobar` always enter; `FINALIZADO` → `finalizado` enters for 7 days after `finalizado_en`; `RECHAZADO` → `rechazado` enters for 5 minutes after `rechazado_en`. A lote outside its window, with `etapa_id` `NULL`, or of a client with `isActive = 0` is left out, and so is a client with no lotes in the snapshot. No dispatch column; fiscal documents are not read.
- Per lote: `bultos`, `bultos_fuera_rango` and `peso_neto_total` count all its active weigh-ins; `ultimos_pesajes` holds the 10 active ones with the highest id, id DESC.
- KPIs cover every active weigh-in of today (`CURDATE()`) in the plant; `pct_en_rango_hoy` is `null` if there were none.
- Shows the whole plant: no `cliente_operador` filter, no permission row — any authenticated user sees it.

The Swagger description in `plantas.controller.ts` is the contract; keep the two in sync.
