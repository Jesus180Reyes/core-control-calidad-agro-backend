# SPEC 39 — Catálogo de usuarios con rol OPERADOR

> **Status:** Approved
> **Depends on:** SPEC 09 (módulo `catalogos` y su forma de respuesta), SPEC 22 (convención de Swagger)
> **Date:** 2026-10-10
> **Objective:** Agregar `GET /catalogos/operadores`, que devuelve `{ id, nombre }` de los usuarios activos con rol `OPERADOR`, con la misma forma que `GET /catalogos/usuarios`.

---

## Why this spec exists

`GET /catalogos/usuarios` (spec 09) devuelve **todos** los usuarios activos, sin filtro de rol. El front lo usa para el selector de `usuario_ids` de `POST /clientes`, y ahí aparecen también las cuentas `ADMIN` y `SUPERVISOR`, que no son operadores de báscula. El front también necesita un selector de operadores para filtros por usuario, como el `?usuario_id` de `GET /metricas/calidad` y de `GET /pesajes/byLote/:loteId`.

Este spec agrega una ruta nueva en lugar de cambiar la existente. Así `GET /catalogos/usuarios` sigue respondiendo exactamente lo mismo.

---

## Scope

**In:**

- Nueva ruta `GET /catalogos/operadores` en `CatalogosController`.
- Respuesta `{ ok, msg, data }`, donde cada elemento de `data` es exactamente `{ id, nombre }`, igual que `GET /catalogos/usuarios`.
- Filtra los usuarios con `isActive = 1` cuyo rol es `OPERADOR`, comparando `roles.nombre` con el literal `'OPERADOR'`.
- Ordena por `complete_name` ASC.
- Abierta a cualquier usuario autenticado.
- Swagger: `@ApiOperation` con summary y descripción.
- `CLAUDE.md` actualizado.

**Out of scope (for future specs):**

- Cambiar `GET /catalogos/usuarios`. Sigue devolviendo todos los usuarios activos.
- Un query param `?rol=` genérico en `GET /catalogos/usuarios`.
- Catálogos de otros roles (`SUPERVISOR`, `ADMIN`).
- Que `POST /clientes` valide que los `usuario_ids` tengan rol `OPERADOR`.
- Restringir la ruta a `ADMIN`.
- Una fila en `catalogo_permisos`/`permisos`.
- Paginación, filtros o búsqueda por nombre.
- Devolver `username`, `cedula` u otros campos.

---

## Data model

Este spec **no aplica DDL** y no cambia `src/database/types/types.ts`. Reusa `usuarios` y `roles`.

### Consulta

```ts
// CatalogosRepository.getOperadores()
selectFrom('usuarios')
  .innerJoin('roles', 'roles.id', 'usuarios.rol_id')
  .select(['usuarios.id', 'usuarios.complete_name as nombre'])
  .where('usuarios.isActive', '=', 1)
  .where('roles.nombre', '=', 'OPERADOR')
  .orderBy('usuarios.complete_name', 'asc')
```

- El rol se resuelve por `roles.nombre`, no por un id fijo. Es la misma forma en que el proyecto compara `'ADMIN'` (spec 34) y `'SUPERVISOR'` (spec 38).
- `isActive = 1` estricto, igual que `GET /catalogos/usuarios`. Un usuario con `isActive = NULL` no aparece en ninguno de los dos catálogos.
- Sin filtro de `cliente_operador`.

### Respuesta

`GET /catalogos/operadores` (**200**):

```json
{
  "ok": true,
  "msg": "Operadores obtenidos correctamente",
  "data": [
    { "id": 4, "nombre": "Juan Pérez" },
    { "id": 7, "nombre": "María López" }
  ]
}
```

Sin operadores activos responde **200** con `data: []`. No hay 400 ni 404: la ruta no recibe parámetros.

### Conteo de rutas

| | Antes | Después |
| --- | --- | --- |
| Rutas de `catalogos` | 3 | **4** |
| Rutas que mapea Nest | 42 | **43** |
| Operaciones en `/docs-json` | 41 | **42** |
| Claves de `paths` | 38 | **39** |

### Archivos

| Archivo | Cambio |
| --- | --- |
| `src/modules/catalogos/repository/catalogos.repository.ts` | Nuevo método `getOperadores()`. |
| `src/modules/catalogos/catalogos.service.ts` | Nuevo pass-through `findOperadores()`. |
| `src/modules/catalogos/catalogos.controller.ts` | Nuevo handler `@Get('operadores')` con su `@ApiOperation`. |
| `CLAUDE.md` | Fila de `catalogos`, conteos de rutas y lista de endpoints que no validan `cliente_operador` ni tienen fila de permiso. |

---

## Implementation plan

1. En `CatalogosRepository`, agregar `getOperadores()` con la consulta del modelo de datos. Todavía nadie la llama y la app compila igual.
2. En `CatalogosService`, agregar `findOperadores()` como pass-through al repositorio.
3. En `CatalogosController`, agregar `@Get('operadores')` que responde `{ ok: true, msg: 'Operadores obtenidos correctamente', data }`. El `@ApiOperation` dice:
   - que cada elemento es `{ id, nombre }`, con `complete_name` aliasado a `nombre`;
   - que la clave del payload es `data`;
   - que filtra `isActive = 1` y rol `OPERADOR` por nombre, y ordena por nombre;
   - que está abierta a cualquier usuario autenticado, sin filtro por `cliente_operador`.

   Prueba manual: con cualquier token responde 200 y solo trae usuarios con rol `OPERADOR`.
4. Actualizar `CLAUDE.md`:
   - La fila de `catalogos` en la tabla de endpoints: pasan a ser **cuatro** endpoints con `data`.
   - Los conteos de rutas de la sección de Commands (43 rutas, 42 operaciones, 39 `paths`).
   - La frase de que los `GET` con clave `data` son tres.
   - La lista de endpoints que no validan `cliente_operador` y no tienen fila de permiso.

---

## Acceptance criteria

- [X] El route log muestra **43** rutas, con `GET /catalogos/operadores` entre ellas.
- [X] Sin header `Authorization`, `GET /catalogos/operadores` responde 401.
- [X] Con el token de un `OPERADOR`, responde 200.
- [X] Con el token de un `ADMIN`, responde 200 con el mismo contenido.
- [X] La respuesta es `{ ok: true, msg: 'Operadores obtenidos correctamente', data }`.
- [X] Cada elemento de `data` tiene exactamente las claves `id` y `nombre`.
- [X] `data` contiene a todos los usuarios con `isActive = 1` y rol `OPERADOR`, y a ningún otro, comparado contra una consulta directa en MySQL.
- [X] Ningún usuario con rol `ADMIN` o `SUPERVISOR` aparece en `data`.
- [X] Un operador con `isActive = 0` no aparece en `data`.
- [X] `data` viene ordenado por `nombre` ascendente.
- [X] `GET /catalogos/usuarios` responde exactamente lo mismo que antes de este spec.
- [X] `/docs` muestra `GET /catalogos/operadores` bajo el tag `catalogos`, con su descripción.
- [X] No se agregó ninguna fila a `catalogo_permisos` ni a `permisos`, y no se aplicó DDL.

---

## Decisions

- **Sí:** ruta nueva `GET /catalogos/operadores`. Decisión del usuario. No cambia una respuesta publicada.
- **No:** `?rol=` en `GET /catalogos/usuarios`. Abriría la convención de filtros en `catalogos` y la duda de si un rol inválido responde 400 o se ignora.
- **No:** cambiar `GET /catalogos/usuarios` para que devuelva solo operadores. Rompería a cualquier consumidor que espera todos los usuarios.
- **Sí:** `{ id, nombre }` con clave `data`. Decisión del usuario: la misma forma que `GET /catalogos/usuarios`, así el front reusa el mismo componente de selector.
- **Sí:** abierta a cualquier autenticado. Decisión del usuario. Expone menos que `GET /catalogos/usuarios`, que ya está abierta y devuelve a todos.
- **No:** solo `ADMIN`. Habría sido el primer endpoint de lectura que discrimina por rol, sin un dato sensible que proteger.
- **Sí:** el rol se compara contra el literal `'OPERADOR'` en `roles.nombre`. Los ids de `roles` cambian entre entornos, y el proyecto ya compara `'ADMIN'` y `'SUPERVISOR'` así.
- **Sí:** `isActive = 1` estricto. Es lo que hace `GET /catalogos/usuarios`, y los dos catálogos deben coincidir.
- **Sí:** sirve tanto al selector de `POST /clientes` como a los filtros por usuario. Decisión del usuario. Un mismo catálogo para las dos pantallas.
- **No:** que `POST /clientes` valide el rol de los `usuario_ids`. Cambia una escritura existente y va en su propio spec.
- **Sí:** sin fila en `catalogo_permisos`/`permisos`. Mismo argumento que el spec 09: una lista de referencia que todos necesitan no se le negaría a nadie.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| `roles.nombre` no es exactamente `OPERADOR` en algún entorno | La ruta responde `data: []`, sin error. Falla cerrada, no abierta. Se revisa la tabla `roles` de ese entorno. |
| El front sigue usando `GET /catalogos/usuarios` en el selector de `POST /clientes` | Se puede vincular un `ADMIN` a un cliente, igual que hoy. El backend no lo impide; validarlo es otro spec. |
| Un usuario con `isActive = NULL` no aparece | Es el mismo comportamiento de `GET /catalogos/usuarios`. Se corrige el dato en MySQL. |

---

## What is **not** in this spec

- Cambios a `GET /catalogos/usuarios` o un `?rol=` genérico.
- Catálogos de `SUPERVISOR` o `ADMIN`.
- Validar el rol de los `usuario_ids` en `POST /clientes`.
- Restringir la ruta por rol o sembrar una fila de permiso.
- Paginación, filtros o campos adicionales.
- DDL.

Cada uno de estos, si se necesita, va en su propio spec.
