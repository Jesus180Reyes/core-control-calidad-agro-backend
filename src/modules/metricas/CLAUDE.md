# metricas module

Spec 35. One route: `GET /metricas/calidad`, the first read that returns **aggregates** rather than rows, and the widest read in the project — every weigh-in of a period, every client, every operator, broken down by client. Computed on the fly in SQL: **no DDL, no snapshot table**, four queries (the period, the summary, the states — the base as a derived table in a `LEFT JOIN` so zero rows survive — and the clients), no transaction.

## Access

No `cliente_operador` check and no permission row; restricting it to `ADMIN` with `validateCallerEsAdmin` was offered and declined.

## Filters — they answer 400, on purpose

`FiltrosMetricasCalidadDto` breaks the spec 16 rule deliberately: its four params carry no `.catch(undefined)`, because a dashboard that silently shows "everything" after dropping a mistyped id is worse than a visible error. `?desde` after `?hasta` is also a 400; an unknown param is still stripped.
- `desde`, `hasta` — `hasta` inclusive of the whole day (`DATE_ADD(hasta, INTERVAL 1 DAY)`).
- `cliente_id` — on `lotes.cliente_id`.
- `usuario_id` — on `pesajes.usuario_id`. **This does not contradict spec 16**: `historial` keeps out `?usuario_id` because its guarantee is "only yours"; this route never promised that, so the param exposes nothing a caller could not see by leaving it out.
- **The period uses MySQL's clock**: no params means `CURDATE() - 29 days` to `CURDATE()`; one bound alone is completed to 30 days; the response always carries the period applied.
- An unknown id answers 200 with zeros; there is no 404.

## Response

`{ ok, msg, metricas }`, `metricas = { periodo, filtros, resumen, por_estado_calidad, por_cliente }`.
- `periodo` — the range applied, `YYYY-MM-DD`. `filtros` — echoes `cliente_id`/`usuario_id` or `null`.
- `resumen` — eleven fields: `total_pesajes`, `fuera_de_rango`, `porcentaje_fuera_de_rango`, `desviacion_promedio_pct` and `desviacion_estandar_pct` (signed, `(peso_neto - peso_ideal) / peso_ideal × 100`, only rows with `peso_neto` and `peso_ideal > 0`), `aprobados_por_aprobador`, `rechazados_por_aprobador`, `sin_revisar` (`aprobado IS NULL` — includes lotes that never reached `CLIENTE_FINAL`, so it is **not** the approver's backlog), `porcentaje_rechazo_aprobador` (over reviewed only), `anulados`, `porcentaje_anulacion` (over active + annulled).
- Percentages computed in the backend with 2 decimals and **`null`, not `0`, when the denominator is 0**; every count is a `number`.
- `por_estado_calidad` — **every** row of `estados_calidad`, zeros included, ordered by id.
- `por_cliente` — one element per client with at least one active or annulled weigh-in in the period, the same eleven fields plus `cliente_id`/`cliente`, ordered `total_pesajes` DESC then `cliente_id` ASC, **rejected clients included**, no pagination; sums exactly to `resumen`.

## Population

`pesajes INNER JOIN lotes` — so `lote_id NULL` counts nowhere — with `created_at` in the period; `isActive = 1` for the indicators and `isActive = 0` for `anulados` (annulments placed in the period by `created_at`, not `rechazado_en`); **no** filter on the lote's or the client's state, by decision. The deviation is relative to each lote's `peso_ideal`, so a lote whose range was loaded in another unit distorts it badly — in the current DB, client 9 has lotes with `peso_ideal` 2.00 and weigh-ins of 88.44. `pesajes.observaciones` is not used.
