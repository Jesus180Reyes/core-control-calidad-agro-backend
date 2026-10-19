# origenes module

Spec 43. One route. The read lives in `catalogos` (`GET /catalogos/origenes`); the link to lotes in `lotes` (`lotes.origen_id`).

## `origenes`

Where a lote's product came from — a farm or a supplier: `nombre`, `direccion` and `telefono` (both nullable), `isActive`, `created_at`/`created_by` (FK `fk_origenes_created_by` → `usuarios`).
- **Global, not per client**: there is deliberately **no `cliente_id`**, because one farm sells to several clients and a per-client catalogue would duplicate it with no link between copies. A client and an origin are related only through their lotes. Consequence: every user sees every client's suppliers in the selector — accepted, mitigated only by returning `{ id, nombre }`.
- **No `updated_at`/`actualizado_por`**, and no edit, deactivate or list route. Correcting or retiring an origin is a manual `UPDATE`; the edition spec adds those columns with its own `ALTER TABLE`. This module exists so that edition has a place to land.
- Deactivating an origin removes it from the selector and makes `POST /lotes` reject it, but **every lote that already uses it keeps showing its name** (the listings `LEFT JOIN` without filtering `isActive`).
- **Uniqueness of `nombre` is application code only** (no `UNIQUE` in MySQL — a duplicate origin is not a fine — so the usual race window applies), global across the catalogue, checked by `validateNombreOrigenDisponible`. It **counts inactive rows**, so re-activating one by hand never leaves two with one name, and compares under `utf8mb4_0900_ai_ci`: `Finca X`, `FINCA X` and `Fínca X` are one name.

## `POST /origenes`

Body `{ nombre, direccion?, telefono? }`, trimmed and capped at the column lengths (150 / 255 / 20); the optional fields accept no `null` and no empty string (if unknown, do not send them); a `cliente_id` in the body is stripped. Transaction: **400** `El origen 'N' ya esta registrado`, then insert with `created_by` from the token. **201** `{ ok, msg, origen_id }`, so the front can preselect it. Open to any authenticated user — the permission is checked in the front, as in specs 41 and 42 — no `cliente_operador` check, no permission row.
