# SPEC 03 — Guardado de pesajes en la base de datos

> **Status:** Approved
> **Depends on:** SPEC 01, SPEC 02
> **Date:** 2026-08-24
> **Objective:** Implementar el módulo `pesajes` con `POST /pesajes` para guardar un pesaje individual contra un lote abierto, calculando `peso_neto` en el backend y devolviendo si el peso quedó fuera del rango del lote.

---

## Scope

**In:**

- Nuevo módulo `src/modules/pesajes` siguiendo el layout de `src/modules/lotes` (module → controller → service → repository → dto).
- Endpoint `POST /pesajes` que guarda **un** pesaje por petición. `usuario_id` se toma del `userId` del token JWT.
- Cálculo de `peso_neto` en el backend: `peso_neto = peso_bruto - tara`. El body no acepta `peso_neto`.
- Validación de existencia del `lote_id` y de que el lote esté abierto (`estado = 'abierto'` y `cerrado_en IS NULL`).
- Validación de vínculo: el operador autenticado debe estar vinculado al cliente del lote vía `cliente_operador`.
- Validación de existencia de `estado_calidad_id` contra la tabla `estados_calidad`.
- Campo calculado `fuera_de_rango` en la respuesta: `true` si `peso_neto < lotes.peso_minimo` o `peso_neto > lotes.peso_maximo`. El pesaje se guarda igual.
- Campos opcionales de trazabilidad `dispositivo_identificador` y `secuencia_dispositivo`, guardados tal cual si vienen.
- Registro de `PesajesModule` en `src/app.module.ts`.

**Out of scope (for future specs):**

- Cualquier cambio de esquema en MySQL. Este spec no ejecuta DDL.
- Endpoints de lectura de pesajes: `GET /pesajes`, `GET /pesajes/:id`, `GET /pesajes/lote/:loteId`.
- Agregados por lote: total pesado, conteo de pesajes, conteo por estado de calidad, promedio de peso.
- Guardado en batch (array de pesajes en una petición) y sincronización offline.
- Idempotencia / control de duplicados por `(dispositivo_identificador, secuencia_dispositivo)`.
- Derivación automática del `estado_calidad_id` a partir de los rangos de peso del lote.
- `PUT` / `PATCH` de pesajes y baja lógica (`isActive = 0`).
- Cierre de lote y cualquier efecto de un pesaje sobre el `estado` del lote.
- Validación de que `tara` sea menor que `peso_bruto`.
- Rutas anidadas tipo `POST /lotes/:loteId/pesajes`.

---

## Data model

La tabla `pesajes` **ya existe** en MySQL y `PesajesTable` ya está declarada y registrada en `src/database/types/types.ts`. **Este spec no hace ningún cambio de esquema**: no agrega tablas, columnas ni constraints, y no ejecuta DDL.

DTO nuevo `src/modules/pesajes/dto/create-pesaje.dto.ts` (Zod, siguiendo el patrón de `create-lote.dto.ts`):

- `lote_id: number` — entero positivo, requerido.
- `estado_calidad_id: number` — entero positivo, requerido.
- `peso_bruto: number` — requerido, positivo.
- `tara: number` — opcional, `>= 0`, con `.default(0)`.
- `dispositivo_identificador: string` — opcional.
- `secuencia_dispositivo: number` — opcional, entero positivo.

Campos de `pesajes` que **no** vienen del body:

- `usuario_id` — se toma de `req.user.userId` (token JWT).
- `peso_neto` — lo calcula el repositorio como `peso_bruto - tara`.
- `isActive` — no se escribe; queda el `DEFAULT` de MySQL.
- `id`, `created_at` — los genera MySQL.

Forma de la respuesta de `POST /pesajes` (201):

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

`fuera_de_rango` se calcula comparando el `peso_neto` contra `lotes.peso_minimo` y `lotes.peso_maximo` del lote leído en la validación. Ambos llegan como `string | number` desde el driver de MySQL (`DECIMAL`), así que se convierten con `Number()` antes de comparar.

---

## Implementation plan

1. Crear `src/modules/pesajes/dto/create-pesaje.dto.ts` con el schema Zod descrito en el modelo de datos, incluyendo `tara` opcional con `.default(0)`.
2. Crear `src/modules/pesajes/repository/pesajes.repository.ts` con el getter `db` (`this.dbService.client`) y los validadores privados, cada uno recibiendo `db: Kysely<Database>` como en `LotesRepository`: `validateLoteAbierto(loteId, db)` (devuelve el lote con `cliente_id`, `estado`, `cerrado_en`, `peso_minimo`, `peso_maximo`), `validateVinculoOperador(clienteId, usuarioId, db)` y `validateEstadoCalidad(estadoCalidadId, db)`.
3. Agregar a `PesajesRepository` el método `createPesaje(data, userId)`: abre `this.db.transaction()`, corre los validadores del paso 2 dentro de la transacción, calcula `peso_neto`, inserta en `pesajes` con `usuario_id: userId`, y devuelve `{ id, peso_neto, fuera_de_rango }` con el `insertId` convertido a `number`.
4. Crear `src/modules/pesajes/pesajes.service.ts` con `create(dto, userId)` delegando al repositorio (patrón de `LotesService`).
5. Crear `src/modules/pesajes/pesajes.controller.ts` con `@Controller('pesajes')`: `POST /` (`@HttpCode(201)`, `@Body() dto: CreatePesajeDto`, `@Req() req` para el `userId`), respondiendo con la forma `{ ok, msg, pesaje }` documentada arriba.
6. Crear `src/modules/pesajes/pesajes.module.ts` (controller, providers `PesajesService` + `PesajesRepository`, `imports: [DatabaseModule]`) y registrar `PesajesModule` en el arreglo `imports` de `src/app.module.ts`.
7. Verificación manual: autenticarse como un operador vinculado a un cliente, crear un lote con `POST /lotes`, guardar un pesaje dentro del rango y otro por debajo del `peso_minimo`, y confirmar el `fuera_de_rango` de cada respuesta; luego autenticarse con un operador no vinculado a ese cliente y confirmar que `POST /pesajes` contra ese lote es rechazado.

---

## Acceptance criteria

- [ ] El esquema de MySQL no cambió: no se ejecutó ningún DDL en esta implementación.
- [ ] `PesajesModule` está registrado en `src/app.module.ts` y la app arranca sin errores (`npm run start:dev`).
- [ ] `POST /pesajes` sin token JWT válido responde 401.
- [ ] `POST /pesajes` con `lote_id`, `estado_calidad_id` y `peso_bruto` guarda el pesaje y responde 201.
- [ ] El pesaje guardado tiene `usuario_id` igual al `userId` del token JWT usado en la petición.
- [ ] El pesaje guardado tiene `peso_neto = peso_bruto - tara`.
- [ ] `POST /pesajes` omitiendo `tara` guarda el pesaje con `peso_neto = peso_bruto`.
- [ ] `POST /pesajes` con `peso_neto` en el body ignora ese campo: el `peso_neto` guardado es el calculado por el backend.
- [ ] `POST /pesajes` con un `lote_id` inexistente es rechazado y no inserta ninguna fila.
- [ ] `POST /pesajes` contra un lote cuyo `estado` no es `'abierto'` es rechazado.
- [ ] `POST /pesajes` contra un lote con `cerrado_en` distinto de `null` es rechazado.
- [ ] `POST /pesajes` contra un lote de un cliente al que el operador autenticado **no** está vinculado en `cliente_operador` es rechazado y no inserta ninguna fila.
- [ ] `POST /pesajes` con un `estado_calidad_id` inexistente es rechazado.
- [ ] `POST /pesajes` con `peso_bruto` igual a 0 o negativo es rechazado por el DTO.
- [ ] `POST /pesajes` con `tara` negativa es rechazado por el DTO.
- [ ] Un pesaje con `peso_neto` entre `peso_minimo` y `peso_maximo` del lote responde `fuera_de_rango: false`.
- [ ] Un pesaje con `peso_neto` menor al `peso_minimo` del lote se guarda y responde `fuera_de_rango: true`.
- [ ] Un pesaje con `peso_neto` mayor al `peso_maximo` del lote se guarda y responde `fuera_de_rango: true`.
- [ ] `POST /pesajes` con `dispositivo_identificador` y `secuencia_dispositivo` los guarda tal cual en la fila.
- [ ] `POST /pesajes` omitiendo los campos de dispositivo guarda el pesaje con ambos en `null`.
- [ ] La respuesta de `POST /pesajes` incluye el `id` del pesaje creado como número.
- [ ] `POST /lotes` y `GET /lotes/cliente/:clienteId` (SPEC 02) siguen funcionando igual.
- [ ] `GET /clientes` y `POST /clientes` (SPEC 01) siguen funcionando igual.

---

## Decisions

- **Sí:** un pesaje por petición (`POST /pesajes`). El flujo real es la app pesando en línea contra la báscula, así que un insert por petición da errores claros por pesaje.
- **No:** guardado en batch con un array de pesajes. Se descarta porque obligaría a decidir el comportamiento parcial (¿falla todo el lote si un elemento es inválido?) sin tener todavía el flujo offline definido. Va en su propio spec junto con la sincronización.
- **Sí:** `estado_calidad_id` viene en el body y el backend solo valida que exista. Mantiene este spec en "guardar", sin lógica de clasificación.
- **No:** derivar el `estado_calidad_id` de los rangos de peso del lote. Requiere definir el mapeo rango → código de estado, que es una decisión de dominio propia y merece su spec.
- **Sí:** el backend calcula `peso_neto` a partir de `peso_bruto` y `tara`. Una sola fuente de verdad; hace imposible que llegue un neto inconsistente desde la app.
- **No:** aceptar `peso_neto` en el body. Se descarta porque permitiría guardar un neto que no cuadra con el bruto y la tara de la misma fila.
- **Sí:** `tara` opcional con `.default(0)`. Las básculas que ya descuentan tara y el pesaje manual sin envase siguen funcionando sin mandar el campo.
- **No:** validar que `tara < peso_bruto`. Se descarta por decisión explícita del usuario. Consecuencia aceptada: un error de captura puede guardar un `peso_neto` de 0 o negativo (ver Riesgos).
- **Sí:** validar el vínculo `cliente_operador` a través del `cliente_id` del lote. Coherente con SPEC 02: sin esta validación cualquier usuario autenticado podría pesar contra lotes de clientes ajenos.
- **Sí:** rechazar pesajes contra un lote que no esté abierto. Un lote cerrado ya fue reportado; agregarle pesajes invalidaría ese reporte.
- **Sí:** guardar el pesaje aunque quede fuera del rango del lote, y avisarlo con `fuera_de_rango` en la respuesta. Este es un sistema de **control** de calidad: la desviación es justamente el dato que interesa registrar.
- **No:** rechazar los pesajes fuera de rango. Se descarta porque esconder la desviación deja al lote sin evidencia del problema.
- **Sí:** `fuera_de_rango` como booleano simple. Se descarta agregar un campo `desviacion` con el lado de la desviación (`'bajo'` / `'sobre'`) por decisión explícita del usuario: la UI puede deducirlo con los rangos del lote, que ya expone `GET /lotes/cliente/:clienteId`.
- **No:** comunicar la desviación solo dentro del texto de `msg`. Obligaría a la UI a parsear un string.
- **Sí:** `dispositivo_identificador` y `secuencia_dispositivo` opcionales en el body. Permiten trazabilidad desde ya sin bloquear el guardado manual desde web.
- **No:** idempotencia por `(dispositivo_identificador, secuencia_dispositivo)`. Se descarta en este spec: con el flujo uno-por-petición en línea, un reintento duplicado se resuelve a mano. La idempotencia va en el spec de sincronización offline.
- **No:** `UNIQUE KEY` en MySQL sobre los campos de dispositivo. Este spec no ejecuta DDL, igual que SPEC 02.
- **Sí:** ruta `POST /pesajes` con `lote_id` en el body. Coherente con SPEC 02, que descartó rutas anidadas para no repartir la lógica de un módulo entre controllers. Deja libre `GET /pesajes/lote/:loteId` para el spec de lectura.
- **No:** ruta anidada `POST /lotes/:loteId/pesajes`.
- **Sí:** dejar el `DEFAULT` de MySQL para `isActive` en lugar de insertarlo explícitamente, por decisión explícita del usuario. Se aparta del criterio de SPEC 02 con `estado: 'abierto'`, pero `isActive` es una bandera de baja lógica, no un estado inicial de dominio.
- **Sí:** toda la creación va dentro de una transacción Kysely, igual que `createLote`. Las validaciones y el insert comparten la misma conexión.
- **Sí:** el spec solo cubre el guardado. Los listados y los agregados por lote van en su propio spec.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Sin la validación `tara < peso_bruto`, un error de captura guarda un `peso_neto` de 0 o negativo | **Sin mitigar por decisión explícita.** El DTO sí garantiza `peso_bruto > 0` y `tara >= 0`, así que el caso requiere una tara mal capturada. Si ocurre, la fila se corrige a mano. |
| `peso_minimo` / `peso_maximo` del lote llegan como `string \| number` (MySQL `DECIMAL`) y una comparación directa contra el `peso_neto` numérico daría un resultado incorrecto | Se convierten con `Number()` antes de comparar, dentro del repositorio. |
| `pesajes.id` está tipado como `Generated<string \| number>` (`BIGINT`), así que el `insertId` no es un `number` directo | Se convierte con `Number(result.insertId)` antes de devolverlo, igual que en `createLote`. |
| `pesajes.lote_id` y `pesajes.usuario_id` son nullable en el esquema, así que la base de datos no impide un pesaje huérfano | Ambos son requeridos en la capa aplicativa: `lote_id` es obligatorio en el DTO y validado contra `lotes`, y `usuario_id` sale del token JWT. |

---

## What is **not** in this spec

- Cambios de esquema en MySQL, incluido cualquier `UNIQUE KEY` sobre los campos de dispositivo.
- Endpoints de lectura de pesajes (`GET /pesajes`, `GET /pesajes/:id`, `GET /pesajes/lote/:loteId`).
- Agregados por lote: total pesado, conteo de pesajes, conteo por estado de calidad.
- Guardado en batch y sincronización offline.
- Idempotencia / control de duplicados por dispositivo.
- Derivación automática del estado de calidad a partir de los rangos del lote.
- Actualización de pesajes y baja lógica (`isActive = 0`).
- Cierre de lote y efectos de un pesaje sobre el estado del lote.
- Validación de `tara` contra `peso_bruto`.

Cada uno de estos, si se necesita, va en su propio spec.
