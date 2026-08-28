# SPEC 04 — Derivación automática del estado de calidad de un pesaje

> **Status:** Approved
> **Depends on:** SPEC 02, SPEC 03
> **Date:** 2026-08-28
> **Objective:** Que el backend derive el `estado_calidad_id` de cada pesaje a partir del `peso_neto` y del rango del lote, en lugar de recibirlo en el body de `POST /pesajes`.

---

## Why this spec exists

SPEC 03 dejó `estado_calidad_id` como un campo del body que el backend solo valida que exista. Eso permite guardar un pesaje cuyo estado de calidad no corresponde al peso de su propia fila: la app puede mandar `MINIMO` con un peso por encima del `peso_maximo` del lote y el backend lo acepta.

Además, el catálogo real de `estados_calidad` en la base de datos no son los estados del diagrama (`APROBADO` / `APROBADO CON EXCEPCIÓN` / `RECHAZADO`), sino las tres bandas de peso:

| id | `codigo` | `nombre` |
| --- | --- | --- |
| 1 | `IDEAL` | PESO IDEAL |
| 2 | `MAXIMO` | PESO MAXIMO |
| 3 | `MINIMO` | PESO MINIMO |

Siendo bandas de peso, el estado es una función del peso y del rango del lote, no un dato de entrada. Este spec la implementa. Los estados del diagrama, la Etapa y el PIN de supervisor siguen fuera de alcance.

---

## Scope

**In:**

- Quitar `estado_calidad_id` del schema Zod en `src/modules/pesajes/dto/create-pesaje.dto.ts`. El body de `POST /pesajes` deja de aceptarlo.
- Derivar el estado en `PesajesRepository` comparando el `peso_neto` calculado contra `lotes.peso_minimo` y `lotes.peso_maximo` del lote leído en la validación.
- Mapeo de bandas: `peso_neto < peso_minimo` → `MINIMO`; `peso_neto > peso_maximo` → `MAXIMO`; `peso_minimo <= peso_neto <= peso_maximo` → `IDEAL`.
- Resolver el `id` del estado con un `SELECT` por `codigo` contra `estados_calidad`, dentro de la misma transacción.
- Reemplazar el validador privado `validateEstadoCalidad(estadoCalidadId, db)` por el resolutor descrito arriba.
- Actualizar la fila de `pesajes` en la tabla de endpoints de `CLAUDE.md` para reflejar que el estado ahora lo deriva el backend.

**Out of scope (for future specs):**

- Cualquier cambio de esquema en MySQL. Este spec no ejecuta DDL.
- Los estados del diagrama (`APROBADO` / `APROBADO CON EXCEPCIÓN` / `RECHAZADO`) y las filas correspondientes en `estados_calidad`.
- El concepto de **Etapa** (`EN PROCESO` / `CLIENTE FINAL`), ausente del esquema.
- Autorización por PIN de supervisor para pesajes fuera de rango.
- Severidad de alerta (amarilla / roja); hoy solo existe el booleano `fuera_de_rango`.
- Uso de `lotes.peso_ideal` en la derivación, y cualquier campo de desviación contra el ideal.
- Exponer el estado derivado en la respuesta de `POST /pesajes`.
- Cambiar el cálculo de `fuera_de_rango`, que sigue exactamente como lo dejó SPEC 03.
- Recalcular el `estado_calidad_id` de los pesajes ya guardados.
- Endpoints de lectura de pesajes y agregados por estado de calidad.
- Cierre de lote, batch / offline e idempotencia por dispositivo.

---

## Data model

**Este spec no hace ningún cambio de esquema**: no agrega tablas, columnas ni constraints, y no ejecuta DDL. `src/database/types/types.ts` queda igual.

El catálogo `estados_calidad` ya contiene las tres filas necesarias (`IDEAL`, `MAXIMO`, `MINIMO`). El código las referencia por `codigo`, nunca por `id` literal.

DTO después del cambio (`src/modules/pesajes/dto/create-pesaje.dto.ts`):

- `lote_id: number` — entero positivo, requerido.
- `peso_bruto: number` — requerido, positivo.
- `tara: number` — opcional, `>= 0`, con `.default(0)`.
- `dispositivo_identificador: string` — opcional.
- `secuencia_dispositivo: number` — opcional, entero positivo.

Campos de `pesajes` que **no** vienen del body:

- `usuario_id` — del `req.user.userId` (token JWT).
- `peso_neto` — lo calcula el repositorio como `peso_bruto - tara`.
- `estado_calidad_id` — **nuevo en este spec**: lo deriva el repositorio del `peso_neto` y del rango del lote.
- `fuera_de_rango` — lo calcula el repositorio.
- `isActive` — no se escribe; queda el `DEFAULT` de MySQL.
- `id`, `created_at` — los genera MySQL.

Mapeo de banda a `codigo`:

```
peso_neto < Number(lote.peso_minimo)                   ->  'MINIMO'
peso_neto > Number(lote.peso_maximo)                   ->  'MAXIMO'
Number(lote.peso_minimo) <= peso_neto <= Number(lote.peso_maximo)  ->  'IDEAL'
```

Los límites son inclusivos hacia adentro del rango, igual que el `fuera_de_rango` de SPEC 03 (`peso_neto < peso_minimo || peso_neto > peso_maximo`). Consecuencia buscada: `estado IDEAL` es equivalente a `fuera_de_rango: false`, y son el mismo `peso_neto` y los mismos límites en ambos cálculos.

La forma de la respuesta de `POST /pesajes` (201) **no cambia**:

```json
{
  "ok": true,
  "msg": "Pesaje guardado correctamente",
  "pesaje": {
    "id": 148,
    "peso_neto": 12.4,
    "fuera_de_rango": true
  }
}
```

---

## Implementation plan

1. En `src/modules/pesajes/dto/create-pesaje.dto.ts`, eliminar la clave `estado_calidad_id` del `createPesajeSchema`. El resto del schema queda intacto.
2. En `PesajesRepository`, reemplazar el método privado `validateEstadoCalidad(estadoCalidadId, db)` por `resolveEstadoCalidad(pesoNeto: number, lote, db: Kysely<Database>)`: calcula el `codigo` con el mapeo del modelo de datos usando `Number()` sobre `peso_minimo` y `peso_maximo`, hace `selectFrom('estados_calidad').select(['id', 'codigo']).where('codigo', '=', codigo)` y devuelve la fila, lanzando `BadRequestException` si el catálogo no tiene ese `codigo`.
3. En `createPesaje`, dejar de desestructurar `estado_calidad_id` del DTO, mover el cálculo de `peso_neto` antes de la resolución del estado, llamar a `resolveEstadoCalidad` dentro de la transacción e insertar el `id` devuelto en la columna `estado_calidad_id`. `validateLoteAbierto` y `validateVinculoOperador` no cambian.
4. Actualizar la fila de `pesajes` en la tabla de endpoints de `CLAUDE.md`: el backend computa `peso_neto`, `fuera_de_rango` y ahora también `estado_calidad_id`.
5. Verificación manual: autenticarse como un operador vinculado, y contra un lote abierto guardar tres pesajes — uno dentro del rango, uno por debajo del `peso_minimo` y uno por encima del `peso_maximo` — confirmando en la base de datos que el `estado_calidad_id` de cada fila corresponde a `IDEAL`, `MINIMO` y `MAXIMO` respectivamente.

---

## Acceptance criteria

- [ ] El esquema de MySQL no cambió: no se ejecutó ningún DDL en esta implementación.
- [ ] La app arranca sin errores de compilación (`npm run start:dev`).
- [ ] `POST /pesajes` sin `estado_calidad_id` en el body responde 201 y guarda el pesaje.
- [ ] Un pesaje con `peso_neto` entre `peso_minimo` y `peso_maximo` se guarda con el `estado_calidad_id` de la fila `codigo = 'IDEAL'`.
- [ ] Un pesaje con `peso_neto` menor al `peso_minimo` se guarda con el `estado_calidad_id` de la fila `codigo = 'MINIMO'`.
- [ ] Un pesaje con `peso_neto` mayor al `peso_maximo` se guarda con el `estado_calidad_id` de la fila `codigo = 'MAXIMO'`.
- [ ] Un pesaje con `peso_neto` exactamente igual al `peso_minimo` del lote se guarda como `IDEAL`.
- [ ] Un pesaje con `peso_neto` exactamente igual al `peso_maximo` del lote se guarda como `IDEAL`.
- [ ] En toda fila guardada, `fuera_de_rango = false` si y solo si el `estado_calidad_id` es el de `IDEAL`.
- [ ] El estado se deriva del `peso_neto`, no del `peso_bruto`: un pesaje con `peso_bruto` dentro del rango y una `tara` que deja el `peso_neto` por debajo del `peso_minimo` se guarda como `MINIMO`.
- [ ] `POST /pesajes` con `estado_calidad_id` en el body ignora ese campo: el estado guardado es el derivado del peso.
- [ ] El DTO ya no exige `estado_calidad_id`: un body sin ese campo no produce un error de validación.
- [ ] La respuesta de `POST /pesajes` sigue siendo `{ ok, msg, pesaje: { id, peso_neto, fuera_de_rango } }`, sin campos nuevos.
- [ ] La resolución del estado ocurre dentro de la misma transacción que el insert.
- [ ] Las validaciones de SPEC 03 siguen vigentes: lote inexistente, lote no abierto, operador no vinculado, `peso_bruto <= 0` y `tara` negativa siguen siendo rechazados y no insertan ninguna fila.
- [ ] `POST /lotes` y `GET /lotes/cliente/:clienteId` (SPEC 02) siguen funcionando igual.
- [ ] `GET /clientes` y `POST /clientes` (SPEC 01) siguen funcionando igual.

---

## Decisions

- **Sí:** derivar el `estado_calidad_id` en el backend. Reabre explícitamente la decisión de SPEC 03 (*"`estado_calidad_id` viene en el body y el backend solo valida que exista"*), que ese mismo spec aplazó a un spec propio. El catálogo real son bandas de peso, así que el estado es una función del peso, no una opinión de la app.
- **Sí:** comparar contra `peso_neto`. Es la misma base que ya usa `fuera_de_rango`, así que los dos campos derivados de la misma fila nunca se contradicen.
- **No:** comparar contra `peso_bruto`. Se descarta porque con `tara > 0` un pesaje podría quedar `fuera_de_rango: true` (por neto) y a la vez `IDEAL` (por bruto) en la misma fila.
- **No:** cambiar `fuera_de_rango` para que use `peso_bruto`. Se descarta: SPEC 03 ya definió el neto como la base y no hay motivo para cambiarla.
- **Sí:** mapeo por rango, con `IDEAL` para todo el intervalo `[peso_minimo, peso_maximo]`. `IDEAL` significa "aceptable", que es lo que la operación necesita saber.
- **No:** mapeo por cercanía al `peso_ideal` (`< ideal` → `MINIMO`, `> ideal` → `MAXIMO`, `== ideal` → `IDEAL`). Se descarta porque con columnas `DECIMAL` la igualdad exacta casi nunca ocurre: `IDEAL` quedaría prácticamente inalcanzable y todo pesaje bueno se guardaría como `MINIMO` o `MAXIMO`.
- **No:** límites exclusivos (`peso_neto <= peso_minimo` → `MINIMO`). Se descarta para mantener la equivalencia exacta con `fuera_de_rango`, que ya trata los límites como dentro del rango.
- **Sí:** `lotes.peso_ideal` no participa en la derivación. Queda como dato de referencia del lote, que `GET /lotes/cliente/:clienteId` ya expone.
- **No:** agregar un campo calculado `desviacion_ideal = peso_neto - peso_ideal` a la respuesta. Se descarta en este spec: la UI puede calcularlo con los rangos del lote que ya recibe.
- **Sí:** quitar `estado_calidad_id` del DTO. Mismo criterio que `peso_neto` en SPEC 03: si el backend lo deriva, el body no lo acepta. Hace imposible guardar un estado que no cuadra con el peso de su propia fila.
- **No:** dejarlo opcional en el schema e ignorarlo. Se descarta porque un campo que se acepta y se descarta en silencio es peor que uno que no existe.
- **No:** dejar que el body gane si viene (`estado_calidad_id` explícito respetado, derivado si falta). Se descarta: reabre exactamente el agujero que este spec cierra. Cuando lleguen la Etapa y el PIN de supervisor, la excepción se modelará con esos campos, no con un override libre del estado.
- **Sí:** resolver el `id` con un `SELECT` por `codigo`. Un query extra por pesaje, a cambio de no acoplar el código a los ids `1` / `2` / `3` de un ambiente concreto.
- **No:** constantes hardcodeadas `{ IDEAL: 1, MAXIMO: 2, MINIMO: 3 }`. Se descarta porque se rompería en silencio, escribiendo un estado equivocado, si los ids difieren entre ambientes.
- **No:** cargar las tres filas del catálogo y mapear en memoria. Se descarta por no traer filas que no se van a usar; el `SELECT` por `codigo` ya es un solo query.
- **Sí:** la respuesta de `POST /pesajes` no cambia. La app puede deducir la banda con el `fuera_de_rango` y los rangos del lote que ya tiene, así que exponer el estado no es urgente y evita un cambio incompatible extra.
- **No:** devolver `estado_calidad: { id, codigo, nombre }` en la respuesta. Se descarta en este spec; entra con los endpoints de lectura de pesajes.
- **Sí:** lanzar `BadRequestException` si el catálogo no tiene el `codigo` buscado. Es un error de datos maestros y debe ser ruidoso, no guardarse con un estado nulo o inventado.
- **No:** recalcular el `estado_calidad_id` de los pesajes ya guardados. Se descarta: es una migración de datos y va en su propio spec si se necesita.
- **Sí:** la derivación va dentro de la transacción existente, como el resto de las validaciones de `createPesaje`.
- **No:** los estados del diagrama, la Etapa y el PIN de supervisor. Cada uno necesita esquema nuevo y va en su propio spec.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| El catálogo `estados_calidad` de un ambiente no tiene alguna de las filas `IDEAL` / `MAXIMO` / `MINIMO`, y ningún pesaje de esa banda se puede guardar | Se lanza `BadRequestException` nombrando el `codigo` faltante, así el error apunta al dato maestro en lugar de fallar por constraint. Las tres filas ya existen en la base actual. |
| La app móvil sigue mandando `estado_calidad_id` en el body después del cambio | No rompe: el schema Zod no es `.strict()`, así que la clave desconocida se descarta y el backend usa el estado derivado. El campo se elimina de la app en su propio release. |
| Los pesajes guardados antes de este spec pueden tener un `estado_calidad_id` que no corresponde a su peso, y quedan mezclados con los nuevos en cualquier reporte | **Sin mitigar por decisión explícita.** No se recalculan. Si un reporte lo necesita, se recalcula en el spec de agregados o en una migración aparte. |
| Una `tara` mal capturada mayor al `peso_bruto` deja un `peso_neto` de 0 o negativo, que ahora se guarda además como `MINIMO` | **Sin mitigar por decisión explícita**, igual que en SPEC 03, que descartó validar `tara < peso_bruto`. El estado `MINIMO` es en realidad una señal más de que la fila está mal capturada. |
| `peso_minimo` y `peso_maximo` llegan como `string \| number` (MySQL `DECIMAL`) y una comparación directa daría una banda equivocada | Se convierten con `Number()` antes de comparar, en la misma línea que ya hace el cálculo de `fuera_de_rango`. |

---

## What is **not** in this spec

- Cambios de esquema en MySQL.
- Los estados del diagrama: `APROBADO`, `APROBADO CON EXCEPCIÓN`, `RECHAZADO`.
- El concepto de Etapa (`EN PROCESO` / `CLIENTE FINAL`).
- PIN de supervisor para pesajes fuera de rango.
- Severidad de alerta (amarilla / roja).
- Uso de `lotes.peso_ideal` en la derivación y campos de desviación contra el ideal.
- Exponer el estado derivado en la respuesta de `POST /pesajes`.
- Recálculo del estado de los pesajes ya guardados.
- Endpoints de lectura de pesajes y agregados por estado de calidad.
- Cierre de lote, guardado en batch, sincronización offline e idempotencia por dispositivo.

Cada uno de estos, si se necesita, va en su propio spec.
