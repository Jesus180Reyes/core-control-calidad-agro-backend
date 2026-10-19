# permisos module

Specs: 06 (table), 07 (`GET /permisos/me`), 14 (catalogue + bridge). One route.

## Nothing is enforced

The permission tables declare what each role is *supposed* to do. Exactly one thing reads them — `GET /permisos/me` — so a client can hide buttons. There is **no `PermissionsGuard`, no `@Permisos()` decorator**, `req.user` is `{ userId, username }`, the JWT payload is `sub`, `user_id`, `username`, and `POST /auth/login` does not return permissions. An `OPERADOR` gets a 201 from `POST /clientes` whatever the table says. Several specs (41, 42, 43) chose on purpose to check the permission **in the front** and accept any authenticated user in the backend. Enforcing permissions is a future spec, and it will have to decide whether to trust codes no spec designed.

## Tables (spec 14)

- **`catalogo_permisos`** — the definitions: one row per `codigo`, with `nombre`, `descripcion`, `isActive` and a **global** `UNIQUE (codigo)`.
- **`permisos`** — the assignment: one row per `(rol_id, permiso_id)`, no text of its own, `UNIQUE (rol_id, permiso_id)`, FKs to `roles(id)` and `catalogo_permisos(id)`. `SELECT codigo FROM permisos` is an error; reading the code means joining.
- The two `isActive` are not redundant: `catalogo_permisos.isActive = 0` retires a permission system-wide, `permisos.isActive = 0` from one role. `GET /permisos/me` requires both.

## What is really in the DB — count the table, do not trust numbers

The codes were seeded **by hand, outside any spec** (no record of who, when or by what criterion), and the counts in old specs are all wrong. The format is `MAYUSCULAS-CON-GUIONES` — exactly what spec 06 rejected — and none of spec 06's `modulo.accion` codes exists. Codes seen during spec 14: `APROBAR-LOTE`, `CREAR-CLIENTE-LOTE-NUEVO`, `CREAR-CLIENTE-NUEVO`, `MODULO-CLIENTES`, `MODULO-CONTROL-CALIDAD`, `RECHAZAR-CLIENTE`, `RECHAZAR-LOTE`, `RECHAZAR-PESAJE-LOTE`, `VER-CLIENTE-LOTES`; at that point `OPERADOR` held both client-creation codes and `ADMIN` held `RECHAZAR-CLIENTE` and `RECHAZAR-PESAJE-LOTE`. Two of them (`MODULO-*`) are screen-access permissions, not endpoint ones. By 2026-09-18 the tables held **16** catalogue rows and **23** assignments, again with no spec recording the additions. Each row's `descripcion` says which endpoint it means. Renaming a code changes what `GET /permisos/me` returns, which is why spec 14 normalised nothing.

Most specs since 07 deliberately seeded **no** row (reference lists, filters, the approver flow, fiscal documents, the AI summary…), on the argument that without a guard a row changes nothing. Do not read a missing row as an oversight.

## Seeding by hand

Two inserts: one row in `catalogo_permisos` for the code, then one in `permisos` per role, resolving both ids by their natural key because ids differ between environments:

```sql
INSERT INTO permisos (rol_id, permiso_id)
SELECT r.id, c.id FROM roles r JOIN catalogo_permisos c ON c.codigo = '<CODIGO>'
WHERE r.nombre = '<ROL>';
```

Role names are **uppercase** (`ADMIN`, `OPERADOR`, `SUPERVISOR`); spec 06's seed SQL says `'Admin'` and matches nothing. Nothing warns you if you forget.

## `GET /permisos/me`

Resolves `rol_id` from the token's `userId`, then `INNER JOIN permisos → catalogo_permisos` on `permiso_id`, selecting `catalogo_permisos.codigo` with both `isActive = 1`. Returns a flat, unordered `string[]` as `{ ok, msg, permisos }`. **404** if the user no longer exists, `[]` if the role has none. It has no permission row of its own — requiring one to read your own permissions would be circular.
