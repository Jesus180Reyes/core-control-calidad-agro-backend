# SPEC 40 — Catálogo de estados de calidad

> **Status:** Approved
> **Depends on:** SPEC 09 (módulo `catalogos` y su forma de respuesta), SPEC 16 (filtro `?estado_calidad_id`), SPEC 22 (convención de Swagger), SPEC 39 (último catálogo agregado)
> **Date:** 2026-10-14
> **Objective:** Agregar `GET /catalogos/estados-calidad`, que devuelve `{ id, nombre }` de todas las filas de `estados_calidad` ordenadas por `id`, para alimentar el selector del filtro `?estado_calidad_id`.

---

## Why this spec exists

El spec 16 dio a `GET /pesajes/byLote/:loteId` y a `GET /pesajes/historial` un filtro `?estado_calidad_id`. Ningún endpoint devuelve la lista de estados de calidad, así que el front no tiene de dónde sacar las opciones de ese selector sin escribir los ids a mano. Los ids de `estados_calidad` pueden cambiar entre entornos, y escribirlos en el front es exactamente el error que el proyecto evita en el backend.

---

## Scope

**In:**

- Nueva ruta `GET /catalogos/estados-calidad` en `CatalogosController`.
- Respuesta `{ ok, msg, data }`, donde cada elemento de `data` es exactamente `{ id, nombre }`, igual que los otros cuatro catálogos.
- Devuelve **todas** las filas de `estados_calidad`, sin filtro. La tabla no tiene `isActive`.
- Ordena por `id` ASC.
- Abierta a cualquier usuario autenticado.
- Swagger: `@ApiOperation` con summary y descripción.
- `CLAUDE.md` actualizado.

**Out of scope (for future specs):**

- Devolver `codigo` o `created_at`.
- Agregar `isActive` a `estados_calidad`.
- Un estado `APROBADO CON EXCEPCIÓN` o cualquier fila nueva en la tabla.
- CRUD de `estados_calidad`.
- Restringir la ruta por rol o sembrar una fila de permiso.
- Paginación, filtros o búsqueda.
- Cambiar los filtros `?estado_calidad_id` existentes o `GET /metricas/calidad`.

---

## Data model

Este spec **no aplica DDL** y no cambia `src/database/types/types.ts`. Reusa `estados_calidad` (`EstadosCalidadTable`: `id`, `codigo`, `nombre`, `created_at`).

### Consulta

```ts
// CatalogosRepository.getEstadosCalidad()
selectFrom('estados_calidad')
  .select(['id', 'nombre'])
  .orderBy('id', 'asc')
```

- Sin `where`: la tabla no tiene `isActive`, igual que `unidades_medida` en el spec 09.
- Orden por `id`, no por `nombre`. Es el mismo orden que `por_estado_calidad` de `GET /metricas/calidad` (spec 35), así el selector y el dashboard listan los estados igual.

### Respuesta

`GET /catalogos/estados-calidad` (**200**), con los datos actuales de la base:

```json
{
  "ok": true,
  "msg": "Estados de calidad obtenidos correctamente",
  "data": [
    { "id": 1, "nombre": "PESO IDEAL" },
    { "id": 2, "nombre": "PESO MAXIMO" },
    { "id": 3, "nombre": "PESO MINIMO" }
  ]
}
```

Con la tabla vacía responde **200** con `data: []`. No hay 400 ni 404: la ruta no recibe parámetros.

### Conteo de rutas

| | Antes | Después |
| --- | --- | --- |
| Rutas de `catalogos` | 4 | **5** |
| Rutas que mapea Nest | 43 | **44** |
| Operaciones en `/docs-json` | 42 | **43** |
| Claves de `paths` | 39 | **40** |

### Archivos

| Archivo | Cambio |
| --- | --- |
| `src/modules/catalogos/repository/catalogos.repository.ts` | Nuevo método `getEstadosCalidad()`. |
| `src/modules/catalogos/catalogos.service.ts` | Nuevo pass-through `findEstadosCalidad()`. |
| `src/modules/catalogos/catalogos.controller.ts` | Nuevo handler `@Get('estados-calidad')` con su `@ApiOperation`. |
| `CLAUDE.md` | Fila de `catalogos`, conteos de rutas, conteo de `GET`s con clave `data` y lista de endpoints que no validan `cliente_operador`. |

---

## Implementation plan

1. En `CatalogosRepository`, agregar `getEstadosCalidad()` con la consulta del modelo de datos. Todavía nadie la llama y la app compila igual.
2. En `CatalogosService`, agregar `findEstadosCalidad()` como pass-through al repositorio.
3. En `CatalogosController`, agregar `@Get('estados-calidad')` que responde `{ ok: true, msg: 'Estados de calidad obtenidos correctamente', data }`. El `@ApiOperation` dice:
   - que cada elemento es `{ id, nombre }`;
   - que la clave del payload es `data`;
   - que devuelve todas las filas, sin filtro, ordenadas por `id`;
   - que sirve para el selector de `?estado_calidad_id` de `GET /pesajes/byLote/:loteId` y `GET /pesajes/historial`;
   - que está abierta a cualquier usuario autenticado, sin filtro por `cliente_operador`.

   Prueba manual: con cualquier token responde 200 con las tres filas en orden `IDEAL`, `MAXIMO`, `MINIMO`.
4. Actualizar `CLAUDE.md`:
   - La fila de `catalogos` en la tabla de endpoints: pasan a ser **cinco** endpoints con `data`.
   - Los conteos de rutas de la sección de Commands (44 rutas, 43 operaciones, 40 `paths`, `catalogos` 5).
   - La frase de que los `GET` con clave `data` son cuatro, y el total de `GET`s que unificar.
   - La lista de endpoints que no validan `cliente_operador` y no tienen fila de permiso.

---

## Acceptance criteria

- [ ] El route log muestra **44** rutas, con `GET /catalogos/estados-calidad` entre ellas.
- [ ] Sin header `Authorization`, `GET /catalogos/estados-calidad` responde 401.
- [ ] Con el token de un `OPERADOR`, responde 200.
- [ ] Con el token de un `ADMIN`, responde 200 con el mismo contenido.
- [ ] La respuesta es `{ ok: true, msg: 'Estados de calidad obtenidos correctamente', data }`.
- [ ] Cada elemento de `data` tiene exactamente las claves `id` y `nombre`.
- [ ] `data` contiene todas las filas de `estados_calidad`, comparado contra `SELECT id, nombre FROM estados_calidad` en MySQL.
- [ ] `data` viene ordenado por `id` ascendente.
- [ ] Cada `id` de `data` usado como `?estado_calidad_id` en `GET /pesajes/historial` filtra los pesajes de ese estado.
- [ ] Los otros cuatro endpoints de `catalogos` responden exactamente lo mismo que antes de este spec.
- [ ] `/docs` muestra `GET /catalogos/estados-calidad` bajo el tag `catalogos`, con su descripción.
- [ ] No se agregó ninguna fila a `catalogo_permisos` ni a `permisos`, y no se aplicó DDL.

---

## Decisions

- **Sí:** ruta `/catalogos/estados-calidad`. Decisión del usuario. Kebab-case corto, como `/catalogos/unidades-medida`.
- **No:** `/catalogos/estados-de-calidad`. Rompe el patrón corto del módulo.
- **Sí:** `{ id, nombre }` exacto, con clave `data`. Decisión del usuario. El front reusa el mismo componente de selector que los otros cuatro catálogos.
- **No:** devolver `codigo`. Se consideró para que el front pinte colores sin depender del id. Se descartó porque el único uso es el filtro, que solo necesita `id` y `nombre`.
- **Sí:** orden por `id` ASC. Decisión del usuario. Coincide con `por_estado_calidad` de `GET /metricas/calidad`.
- **No:** orden por `nombre`, como los otros catálogos. Hoy da el mismo resultado, pero puede divergir del dashboard si se agrega una fila.
- **Sí:** sin filtro de filas. La tabla no tiene `isActive`, igual que `unidades_medida`.
- **Sí:** el uso declarado es el selector de `?estado_calidad_id`. Decisión del usuario. Leyendas y colores no son parte de este spec.
- **Sí:** abierta a cualquier autenticado y sin fila en `catalogo_permisos`/`permisos`. Mismo argumento que los specs 09 y 39: una lista de referencia que todos necesitan no se le negaría a nadie. Los estados de calidad no son un dato sensible.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Se agrega a mano una fila a `estados_calidad` que ningún pesaje usa | Aparece en el selector y el filtro devuelve `[]`. Es correcto: el filtro nunca responde 400 (spec 16). |
| El front sigue escribiendo los ids a mano | El backend no lo impide. La descripción de Swagger indica que este catálogo es la fuente de las opciones. |

---

## What is **not** in this spec

- `codigo`, `created_at` u otros campos en la respuesta.
- `isActive`, filas nuevas o CRUD de `estados_calidad`.
- Restringir la ruta por rol o sembrar una fila de permiso.
- Paginación o filtros.
- Cambios a los filtros de `pesajes` o a `GET /metricas/calidad`.
- DDL.

Cada uno de estos, si se necesita, va en su propio spec.
