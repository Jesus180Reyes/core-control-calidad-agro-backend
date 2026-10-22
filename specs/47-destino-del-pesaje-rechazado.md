# SPEC 47 — Destino del pesaje rechazado por el aprobador

> **Status:** Implemented
> **Depends on:** SPEC 09 (convención de `catalogos`), SPEC 19 (revisión del aprobador), SPEC 22 (convención de Swagger), SPEC 43 (catálogo de orígenes, patrón de catálogo con `isActive`)
> **Date:** 2026-10-22
> **Objective:** Crear la tabla `destinos`, exigir un `destino_id` cuando el aprobador rechaza un pesaje (`PATCH /pesajes/:id/rechazar/byApprover`) y exponer `GET /catalogos/destinos` para el selector.

---

## Why this spec exists

El producto que el aprobador rechaza no se destruye: se reutiliza, por ejemplo en el mercado local o como desecho. Lo confirmó alguien que trabaja en control de calidad de una azucarera, y el spec 44 ya lo había diseñado y pospuesto ("destino del rechazo").

Hoy el rechazo del aprobador guarda solo el motivo, que es texto libre. Texto libre no agrupa en un reporte, así que el destino va como catálogo.

---

## Scope

**In:**

- DDL: tabla nueva `destinos` y columna `pesajes.destino_id`, con su FK.
- Transcribir el DDL a `db/schema.sql`.
- `PATCH /pesajes/:id/rechazar/byApprover` exige `destino_id` en el cuerpo.
  - **400** de Zod si falta o no es un entero positivo.
  - **400** si el destino no existe o no está activo.
  - Se escribe en el mismo `UPDATE` que `motivo_rechazo`, `rechazado_por`, `rechazado_en` y `aprobado = 0`.
- `GET /catalogos/destinos` en `CatalogosController`.
  - `{ ok, msg, data }`, cada elemento exactamente `{ id, nombre }`.
  - Todos los destinos con `isActive = 1`, ordenados por `nombre` ASC.
  - Abierto a cualquier usuario autenticado, sin parámetros, sin paginación y sin fila de permiso, como los otros seis selectores.
- Swagger: `@ApiOperation` en la ruta nueva y descripción actualizada de `PATCH /pesajes/:id/rechazar/byApprover`.
- `src/database/types/types.ts` y los `CLAUDE.md` actualizados.

**Out of scope (for future specs):**

- Destino en la anulación del operador (`PATCH /pesajes/:id/rechazar`). Esa ruta anula un error de captura; el producto puede estar bien.
- Destino al rechazar un lote completo (etapa `RECHAZADO`).
- Devolver `destino` (o `motivo_rechazo`) en alguna lectura: `byLote`, `historial`, `GET /pesajes/:id`. Pendiente de decidir por el usuario.
- Llevar el destino al chat (spec 28), al resumen IA (spec 27) o a las métricas (spec 35), por ejemplo kg rechazados por destino.
- CRUD de destinos. Los `INSERT` y la desactivación se hacen a mano en MySQL.
- Columna `codigo` en `destinos`.
- Cambiar el destino de un pesaje ya rechazado.
- Rellenar el destino de los pesajes rechazados antes de este spec.

---

## Data model

### DDL

Se aplica a mano en MySQL, en cada entorno, **antes** de desplegar el código. Primero la tabla, después la columna:

```sql
CREATE TABLE destinos (
  id          INT          NOT NULL AUTO_INCREMENT,
  nombre      VARCHAR(100) NOT NULL,
  isActive    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

ALTER TABLE pesajes
  ADD COLUMN destino_id INT NULL AFTER rechazado_en;

ALTER TABLE pesajes
  ADD CONSTRAINT fk_pesajes_destino
  FOREIGN KEY (destino_id) REFERENCES destinos(id);
```

- **Sin `codigo`**: el destino se identifica por su `id`. Decisión del usuario.
- **Sin `created_by`**: no hay endpoint que cree destinos, se insertan a mano.
- `nombre` sin `UNIQUE`: nada lo valida porque nada lo escribe por API.
- `pesajes.destino_id` nullable: los pesajes existentes, los aprobados, los no revisados y los anulados por el operador quedan en `NULL`. La obligatoriedad vive en el DTO, no en MySQL.
- `db/seed.sql` siembra dos destinos activos, `MERCADO LOCAL` (id 1) y `DESECHO` (id 2), para que un entorno nuevo de Docker pueda rechazar desde el arranque. Decisión del usuario durante la implementación. En los entornos existentes los `INSERT` se hacen a mano; sin filas activas, el rechazo del aprobador responde 400 siempre (ver Risks).

### `src/database/types/types.ts`

Interfaz nueva y clave nueva en `Database`:

```ts
export interface DestinosTable {
  id: Generated<number>;
  nombre: string;
  isActive: Generated<number>;
  created_at: Generated<Date | null>;
}

// Database
destinos: DestinosTable;
```

`PesajesTable` gana:

```ts
destino_id: number | null;
```

### DTO

`RechazarPesajeDto` lo comparten hoy las dos rutas de rechazo. Como el destino es obligatorio solo para el aprobador, se crea un DTO propio y la anulación del operador no cambia.

`src/modules/pesajes/dto/rechazar-pesaje-aprobador.dto.ts` → `RechazarPesajeAprobadorDto`:

| Campo | Regla |
| --- | --- |
| `motivo` | igual que `RechazarPesajeDto`: `string`, 5–255, obligatorio |
| `destino_id` | `z.number().int().positive()`, obligatorio. `.int()` y `.positive()` responden `El destino_id debe ser un id valido`; si falta o no es número, queda el mensaje por defecto de Zod (`Invalid input: expected number, received ...`). Decisión del usuario durante la implementación. |

### Escritura: `PATCH /pesajes/:id/rechazar/byApprover`

Dentro de la transacción existente de `rechazarPesajeApprover`, en este orden:

1. Las validaciones que ya existen, sin cambios: pesaje activo, sin revisar, con `lote_id`, lote cerrado en `CLIENTE_FINAL`.
2. `validateDestino(destinoId, trx)`, nuevo `private` en `PesajesRepository`, mismo molde que `validateOrigen` de `LotesRepository`:
   - **400** `El destino con id 'X' no existe` si no hay fila.
   - **400** `El destino 'nombre' no esta activo` si `isActive === 0`.
3. El `UPDATE` agrega `destino_id` a los campos que ya escribe.

La respuesta no cambia: `{ ok, msg }`.

### Lectura: `GET /catalogos/destinos`

`CatalogosRepository.getDestinos()`: `SELECT id, nombre FROM destinos WHERE isActive = 1 ORDER BY nombre ASC`. Sin validación ni transacción, como los otros seis.

---

## Implementation plan

1. Aplicar el DDL en la base local y transcribirlo a `db/schema.sql` (`CREATE TABLE destinos` en orden alfabético y la columna con su FK en `pesajes`).
2. Agregar `DestinosTable`, la clave `destinos` en `Database` y `destino_id` en `PesajesTable` (`src/database/types/types.ts`).
3. `GET /catalogos/destinos`: `getDestinos()` en `CatalogosRepository`, pass-through en `CatalogosService`, ruta con `@ApiOperation` en `CatalogosController`. Prueba manual: con dos filas insertadas a mano, una inactiva, la ruta devuelve solo la activa.
4. Crear `RechazarPesajeAprobadorDto` y usarlo en `rechazarByAp` (controller), `rechazarByApprover` (service) y `rechazarPesajeApprover` (repository). Agregar `validateDestino` y `destino_id` en el `UPDATE`. Actualizar la descripción Swagger de la ruta: el destino es obligatorio y se elige de `GET /catalogos/destinos`.
5. Actualizar la memoria:
   - `src/modules/pesajes/CLAUDE.md`: columna `destino_id`, cuerpo y errores nuevos de `rechazar/byApprover`, y que ninguna lectura lo devuelve.
   - `src/modules/catalogos/CLAUDE.md`: séptimo selector en la tabla, `destinos` en la lista de tablas sin CRUD.
   - `src/database/CLAUDE.md`: el DDL de este spec en el historial.
   - `CLAUDE.md` raíz: conteo de rutas (`catalogos` 7, **50** rutas; **49** operaciones bajo **45** `paths`), `destinos` en la lista de tablas del dominio y en "Hand-maintained tables".

---

## Acceptance criteria

- [X] La tabla `destinos` y la columna `pesajes.destino_id` con `fk_pesajes_destino` existen en MySQL y en `db/schema.sql`.
- [X] `GET /catalogos/destinos` responde `{ ok, msg, data }` con elementos exactamente `{ id, nombre }`, solo `isActive = 1`, ordenados por `nombre` ASC.
- [X] `GET /catalogos/destinos` sin destinos activos responde 200 con `data: []`.
- [X] `PATCH /pesajes/:id/rechazar/byApprover` sin `destino_id` responde 400 y no modifica el pesaje.
- [X] Con `destino_id: 0`, `-1`, `1.5` o `"1"` responde 400.
- [X] Con un `destino_id` inexistente responde 400 `El destino con id 'X' no existe` y no modifica el pesaje.
- [X] Con un destino inactivo responde 400 `El destino '<nombre>' no esta activo` y no modifica el pesaje.
- [X] Con un destino válido deja `aprobado = 0`, el trío de rechazo y `destino_id` escritos en la misma fila, y responde `{ ok, msg }` como antes.
- [X] Las validaciones previas de la ruta (pesaje anulado, ya revisado, sin lote, lote fuera de `CLIENTE_FINAL`) siguen respondiendo los mismos 400.
- [X] `PATCH /pesajes/:id/rechazar` (operador) sigue aceptando solo `{ motivo }` y no escribe `destino_id`; un `destino_id` en su cuerpo se descarta.
- [X] `PATCH /pesajes/:id/aprobar/byApprover` no escribe `destino_id`.
- [X] Las tres lecturas de `pesajes` devuelven los mismos campos que antes.
- [X] `/docs` muestra `GET /catalogos/destinos` y la descripción actualizada del rechazo del aprobador.
- [X] `npm run lint` sin errores y `npx jest` en verde.

---

## Decisions

- **Sí:** tabla catálogo `destinos` en vez de `ENUM` o texto libre. Se agregan destinos sin DDL y agrupa en un reporte futuro.
- **Sí:** el destino solo en el rechazo del aprobador. Decisión del usuario. La anulación del operador corrige un error de captura y el producto puede estar bien.
- **No:** destino al rechazar un lote completo. Decisión del usuario: otro spec.
- **Sí:** `destino_id` obligatorio en el rechazo del aprobador. Decisión del usuario.
- **Sí:** la columna es nullable y la obligatoriedad vive en el DTO. Los pesajes existentes, aprobados y anulados no tienen destino.
- **Sí:** DTO propio `RechazarPesajeAprobadorDto` en vez de agregar el campo a `RechazarPesajeDto`. Agregarlo como obligatorio rompería la anulación del operador; agregarlo como opcional dejaría la regla en el repositorio.
- **Sí:** `GET /catalogos/destinos`, séptimo selector de `catalogos` con su forma `{ id, nombre }`. Decisión del usuario.
- **No:** módulo propio `destinos`. Solo vale la pena si algún día tiene CRUD.
- **No:** CRUD de destinos. Decisión del usuario: los `INSERT` van directo a la base.
- **No:** columna `codigo`. Decisión del usuario: el `id` es lo que distingue un destino. Contradice la regla "resolver catálogos por `codigo`", pero el backend nunca resuelve un destino concreto: solo valida el id que manda el front.
- **No:** devolver el destino en las lecturas. El usuario lo dejó pendiente para decidirlo después.
- **No:** destino en chat, resumen IA o métricas. Decisión del usuario: otro spec.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Un entorno sin filas activas en `destinos` deja al aprobador sin poder rechazar ningún pesaje: todo rechazo responde 400. | El DDL y los `INSERT` iniciales se aplican a mano antes de desplegar, en cada entorno, producción incluida. El selector vacío avisa al front. |
| Desplegar el código antes del `ALTER TABLE` hace que el `UPDATE` falle con 500 por columna inexistente. | Orden de despliegue: DDL primero, como en todo spec con esquema. |
| El destino se guarda y ninguna lectura lo devuelve, así que por API no se puede verificar ni usar. | Decisión pendiente, registrada en Out of scope. Se verifica en MySQL hasta el spec de lectura. |
| Sin `codigo`, un reporte futuro que agrupe por destino depende de ids que pueden diferir entre entornos. | Aceptado por decisión. Si se necesita, el spec de métricas agrega `codigo` con su `ALTER TABLE`. |
| El front que hoy rechaza como aprobador sin `destino_id` empieza a recibir 400 al desplegar. | Coordinar el despliegue del front con el del backend. |

---

## What is **not** in this spec

- Destino en la anulación del operador.
- Destino al rechazar un lote.
- Destino o motivo en las lecturas de pesajes.
- Destino en chat, resumen IA o métricas.
- CRUD de destinos o columna `codigo`.
- Editar el destino o rellenarlo en rechazos anteriores.

Cada uno de estos, si llega, va en su propio spec.
