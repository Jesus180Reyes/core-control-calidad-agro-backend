# SPEC 44 — Observaciones del pesaje

> **Status:** Draft
> **Depends on:** SPEC 03 (`POST /pesajes`), SPEC 15 (`GET /pesajes/historial`), SPEC 21 (`GET /pesajes/:id`), SPEC 22 (convención de Swagger)
> **Date:** 2026-10-17
> **Objective:** Permitir que el operador guarde una nota de texto libre en cada pesaje y que las tres lecturas de pesajes la devuelvan.

---

## Why this spec exists

Las plantillas de control de calidad de las empacadoras registran más que el peso: °Brix, temperatura de pulpa, humedad, según el producto. Modelar esas mediciones como campos estructurados (rangos por producto, puntos de medición, alertas) se descartó porque haría crecer el proyecto sin que un cliente lo haya pedido.

Este spec es la salida intermedia: un campo de texto libre donde el operador anota lo que su planta mida ("Brix 12, pulpa 8 °C"). Sirve igual para melón, sandía o azúcar, y no compromete a construir nada más. Si un cliente pide después filtrar o graficar alguna medición, lo que ya se escribió en este campo muestra qué miden y con qué formato.

---

## Scope

**In:**

- DDL: columna `pesajes.observaciones VARCHAR(500) NULL`.
- Transcribir el DDL a `db/schema.sql`.
- `POST /pesajes` acepta `observaciones` **opcional**.
  - Se recorta (`trim`).
  - Vacía, solo espacios o `null`: se guarda `NULL`, sin error.
  - Más de 500 caracteres después del recorte: **400** del DTO.
- La respuesta de `POST /pesajes` no cambia: sigue siendo `{ id, peso_neto, fuera_de_rango }`.
- Las tres lecturas devuelven un campo nuevo `observaciones` (el texto, o `null`), al final de sus campos:
  - `GET /pesajes/byLote/:loteId`
  - `GET /pesajes/historial`
  - `GET /pesajes/:id`
- Swagger: descripciones actualizadas de `POST /pesajes` y de las tres lecturas.
- `src/database/types/types.ts` y `CLAUDE.md` actualizados.

**Out of scope (for future specs):**

- Editar o borrar las observaciones de un pesaje ya guardado.
- Mediciones estructuradas: °Brix, temperatura, firmeza, calibre, humedad como campos con tipo y rango.
- Defectos por muestra e inspección de pallets o contenedor.
- Filtrar o buscar por observaciones (`?observaciones`).
- Observaciones en `lotes`.
- Destino del producto rechazado (mercado local o desecho).
- Mostrar `aprobado_con_excepcion_por` en las lecturas.
- Llevar las observaciones al chat (spec 28), al resumen IA (spec 27) o a las métricas (spec 35).

---

## Data model

### DDL

Se aplica a mano en MySQL, en cada entorno, antes de desplegar el código:

```sql
ALTER TABLE pesajes
  ADD COLUMN observaciones VARCHAR(500) NULL AFTER aprobado_con_excepcion_por;
```

- Nullable: los pesajes existentes quedan en `NULL` y el campo es opcional.
- Sin FK, sin índice y sin `UNIQUE`: nadie filtra por esta columna. Los conteos de FKs (24) y `UNIQUE`s no cambian.
- `VARCHAR(500)` y no `TEXT`: una nota de báscula es corta, y el límite lo valida el DTO con el mismo número.

### `src/database/types/types.ts`

`PesajesTable` gana:

```ts
observaciones: string | null;
```

### DTO

`src/modules/pesajes/dto/create-pesaje.dto.ts` gana:

| Campo | Regla |
| --- | --- |
| `observaciones` | `string`, `trim`, máximo 500, opcional. Acepta `null`. Si queda vacía después del recorte, se convierte en `undefined`. |

- El máximo es el largo de la columna. La base corre con `STRICT_TRANS_TABLES`, así que un valor más largo sería un 500 de MySQL en vez de un 400.
- Mensaje del máximo: `Las observaciones no pueden superar los 500 caracteres`.
- Un valor que no es texto (número, objeto) responde 400 del DTO.
- El recorte se aplica **antes** de medir el largo: 500 caracteres con espacios alrededor pasan.

### Escritura: `POST /pesajes`

`createPesaje` agrega `observaciones` al `INSERT` (`observaciones ?? null`). No hay validador nuevo y el resto del método no cambia: el texto no influye en `peso_neto`, `fuera_de_rango`, `estado_calidad_id` ni en la autorización por PIN.

### Lecturas

Los tres métodos de `PesajesRepository` agregan `'pesajes.observaciones'` al final de su `select`, después de `'pesajes.aprobado'`:

| Ruta | Método | Campos antes | Campos después |
| --- | --- | --- | --- |
| `GET /pesajes/byLote/:loteId` | `getPesajesByLote` | 21 | **22** |
| `GET /pesajes/historial` | `getHistorialByUsuario` | 15 | **16** |
| `GET /pesajes/:id` | `getPesajeById` | 21 | **22** |

- `getPesajeById` lo agrega antes de `isActive` y `motivo_rechazo`, que se descartan antes de responder. Su payload sigue siendo intercambiable con un elemento de `byLote`.
- `CLAUDE.md` dice que `historial` devuelve **catorce** campos. El código devuelve quince, porque `pesajes.aprobado` se agregó después. Este spec corrige esa cifra.
- Ningún filtro, orden ni condición cambia.
- `ChatRepository` tiene sus propias copias de estas consultas y **no se toca**.

### Respuestas

`POST /pesajes` con `{ "lote_id": 7, "peso_bruto": 12.5, "tara": 0.5, "observaciones": "  Brix 12, pulpa 8 °C  " }` (**201**, sin cambios):

```json
{
  "ok": true,
  "msg": "Pesaje guardado correctamente",
  "pesaje": { "id": 310, "peso_neto": 12, "fuera_de_rango": false }
}
```

En MySQL la fila queda con `observaciones = 'Brix 12, pulpa 8 °C'`.

`GET /pesajes/310` (**200**), al final del objeto:

```json
{
  "...": "...",
  "aprobado": null,
  "observaciones": "Brix 12, pulpa 8 °C"
}
```

Errores nuevos:

| Caso | Ruta | Código | Mensaje |
| --- | --- | --- | --- |
| Más de 500 caracteres después del recorte | `POST /pesajes` | 400 | `Las observaciones no pueden superar los 500 caracteres` |
| No es texto | `POST /pesajes` | 400 | Del DTO |

### Archivos

| Archivo | Cambio |
| --- | --- |
| `db/schema.sql` | Columna `observaciones` en `pesajes`. |
| `src/database/types/types.ts` | `observaciones` en `PesajesTable`. |
| `src/modules/pesajes/dto/create-pesaje.dto.ts` | `observaciones` opcional. |
| `src/modules/pesajes/repository/pesajes.repository.ts` | `observaciones` en el `INSERT` de `createPesaje` y en el `select` de las tres lecturas. |
| `src/modules/pesajes/pesajes.controller.ts` | Descripciones de Swagger de `POST /pesajes` y de las tres lecturas. |
| `CLAUDE.md` | Ver paso 5 del plan. |

---

## Implementation plan

1. Ejecutar a mano el DDL. Confirmar con `DESCRIBE pesajes;` que `observaciones` existe, es `varchar(500)` y admite `NULL`. Transcribir el DDL a `db/schema.sql`.
2. Agregar `observaciones: string | null` a `PesajesTable`. El proyecto sigue compilando: nadie escribe la columna todavía.
3. Agregar `observaciones` a `CreatePesajeDto` y al `INSERT` de `createPesaje`. Actualizar la descripción de `POST /pesajes`: el campo es opcional, se recorta, vacío se guarda como `NULL` y no cambia el cálculo del pesaje.

   Prueba manual: un pesaje con observaciones las guarda recortadas; uno sin el campo, con `""` o con `"   "` guarda `NULL`; uno con 501 caracteres responde 400.
4. Agregar `'pesajes.observaciones'` al `select` de `getPesajesByLote`, `getHistorialByUsuario` y `getPesajeById`. Actualizar las descripciones de Swagger de las tres lecturas con el campo nuevo.

   Prueba manual: el pesaje del paso 3 muestra su texto en las tres lecturas, y uno anterior a este spec muestra `null`.
5. Actualizar `CLAUDE.md`:
   - La fila de `pesajes`: `observaciones` opcional en `POST /pesajes`, y el campo en las tres lecturas (22, 16 y 22 campos). Corregir los "fourteen fields" de `historial`.
   - En Domain, `pesajes.observaciones`.
   - En Caveats, el DDL del spec 44 (una columna, sin FK ni índice).

---

## Acceptance criteria

- [ ] `DESCRIBE pesajes;` muestra `observaciones` como `varchar(500)`, `NULL` permitido, después de `aprobado_con_excepcion_por`.
- [ ] `db/schema.sql` contiene la columna `observaciones` en `pesajes`.
- [ ] `POST /pesajes` sin `observaciones` responde igual que antes y guarda `NULL`.
- [ ] `POST /pesajes` con `"observaciones": "  Brix 12  "` guarda `Brix 12`.
- [ ] `POST /pesajes` con `""`, `"   "` o `null` responde 201 y guarda `NULL`.
- [ ] `POST /pesajes` con 501 caracteres responde 400 `Las observaciones no pueden superar los 500 caracteres`, y no se crea el pesaje.
- [ ] `POST /pesajes` con 500 caracteres responde 201 y los guarda completos.
- [ ] `POST /pesajes` con `"observaciones": 12` responde 400.
- [ ] La respuesta de `POST /pesajes` no incluye `observaciones`.
- [ ] Un pesaje con observaciones tiene el mismo `peso_neto`, `fuera_de_rango` y `estado_calidad_id` que uno igual sin ellas.
- [ ] `GET /pesajes/byLote/:loteId` devuelve 22 campos, con `observaciones` al final.
- [ ] `GET /pesajes/historial` devuelve 16 campos, con `observaciones` al final, con y sin paginación.
- [ ] `GET /pesajes/:id` devuelve 22 campos, con `observaciones` al final, y no devuelve `isActive` ni `motivo_rechazo`.
- [ ] Un pesaje creado antes de este spec muestra `observaciones: null` en las tres lecturas.
- [ ] Los filtros y el orden de las tres lecturas no cambian.
- [ ] `/docs` muestra las descripciones actualizadas de `POST /pesajes` y de las tres lecturas.
- [ ] Nest sigue mapeando **47** rutas.

---

## Decisions

- **Sí:** un solo campo de texto libre. Decisión del usuario. Cubre °Brix, temperatura o humedad sin modelar nada.
- **No:** mediciones estructuradas (°Brix, temperatura) con rangos por producto. Se investigó y se descartó: haría crecer el proyecto sin un cliente que lo pida.
- **No:** campos con nombre (`brix`, `temperatura`) pero de texto. No permiten calcular y su nombre promete una validación futura.
- **Sí:** la columna va en `pesajes` y no en `lotes`. El operador anota en la báscula, y el lote se crea una sola vez al inicio.
- **No:** observaciones también en `lotes`. Se ofreció y se descartó para mantener el spec chico.
- **Sí:** `VARCHAR(500)`. Suficiente para una nota de báscula y validable en el DTO con el mismo número.
- **Sí:** vacía, solo espacios o `null` se guarda como `NULL`, sin error. Decisión del usuario. El front no tiene que limpiar el campo antes de mandarlo.
- **No:** responder 400 a la cadena vacía, como hace el spec 41. Allí se edita un dato maestro; aquí es una nota opcional.
- **Sí:** las observaciones no se pueden editar. Igual que el resto del pesaje: lo que se pesó no se corrige, se anula y se vuelve a pesar.
- **Sí:** la respuesta de `POST /pesajes` no cambia. Decisión del usuario. Devuelve lo que calcula el backend, y el texto ya lo tiene el front.
- **Sí:** `observaciones` va al final de los campos de las tres lecturas. No cambia la posición de ningún campo existente.
- **No:** filtro `?observaciones`. Se ofreció y se descartó para mantener el spec chico.
- **No:** llevar las observaciones al chat, al resumen IA o a las métricas. Decisión del usuario. Es texto libre que puede llevar cualquier cosa, y mandarlo a Google se decide en otro spec.
- **No:** destino del rechazo. Se diseñó en la conversación y el usuario lo pospuso.
- **No:** mostrar `aprobado_con_excepcion_por`. Se ofreció y se descartó para mantener el spec chico.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Cada operador escribe las mediciones con su propio formato ("12", "12°", "doce") | Riesgo aceptado. Es texto libre. Si un cliente pide analizarlas, ese spec decide el formato estructurado. |
| Alguien anota datos que no deberían quedar en la báscula | Riesgo aceptado. El texto no sale a terceros: no llega al chat ni al resumen IA. |
| Las observaciones se vuelven visibles para cualquiera que lea el pesaje | Las tres lecturas ya devuelven el pesaje a quien hoy puede verlo (`GET /pesajes/:id` a cualquier autenticado). El campo sigue esas mismas reglas. |
| El DDL no se aplicó en un entorno | `POST /pesajes` y las tres lecturas fallan con un 500 de MySQL. El paso 1 del plan se repite en cada entorno, producción incluida. |

---

## What is **not** in this spec

- Editar o borrar observaciones.
- Mediciones estructuradas, defectos o inspección de embarque.
- Filtrar por observaciones.
- Observaciones en `lotes`.
- Destino del rechazo.
- `aprobado_con_excepcion_por` en las lecturas.
- Observaciones en el chat, el resumen IA o las métricas.

Cada uno de estos, si se necesita, va en su propio spec.
