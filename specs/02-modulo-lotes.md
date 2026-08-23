# SPEC 02 — Módulo de lotes: creación vinculada al cliente y listado por cliente

> **Status:** Approved
> **Depends on:** SPEC 01
> **Date:** 2026-08-22
> **Objective:** Implementar el módulo `lotes` con `POST /lotes` para crear un lote vinculado a un cliente existente y `GET /lotes/cliente/:clienteId` para listar los lotes de ese cliente, en ambos casos solo si el operador autenticado está vinculado al cliente vía `cliente_operador`.

---

## Scope

**In:**

- Nuevo módulo `src/modules/lotes` siguiendo el layout de `src/modules/clientes` (module → controller → service → repository → dto).
- Endpoint `POST /lotes` para crear un lote asociado a un `cliente_id` existente. `created_by` se toma del `userId` del token JWT.
- Validación de vínculo: el operador autenticado debe estar vinculado al `cliente_id` vía `cliente_operador`, tanto al crear como al consultar.
- Validación de existencia y estado activo de `cliente_id` y `producto_id`, y de existencia de `unidad_medida_id`.
- Validación de rangos de peso: `peso_minimo <= peso_ideal <= peso_maximo`.
- Validación aplicativa de unicidad de `nombre_lote` por cliente (sin constraint en la base de datos).
- Endpoint `GET /lotes/cliente/:clienteId` que devuelve los lotes de ese cliente con los nombres de producto y unidad de medida resueltos por join.
- Registro de `LotesModule` en `src/app.module.ts`.

**Out of scope (for future specs):**

- Cualquier cambio de esquema en MySQL, incluida la `UNIQUE KEY (cliente_id, nombre_lote)` en `lotes`. Este spec no ejecuta DDL.
- Cierre de lote: endpoint para setear `cerrado_en` y cambiar `estado`. El único estado que este spec escribe es `'abierto'` al crear.
- `resumen_ia`: no se escribe, no se expone y no se genera en este spec.
- `PUT` / `PATCH` / `DELETE` de lotes.
- Módulo de pesajes (`src/modules/pesajes` sigue siendo un stub vacío) y cualquier agregado de peso o conteo de pesajes en el listado.
- `GET /lotes/:id` (detalle de un lote individual).
- `GET /lotes` sin filtro (listado global de lotes de todos los clientes del operador).
- Paginación, ordenamiento configurable o filtros adicionales (por `estado`, por fecha) en el listado.
- Validar que el `producto_id` del lote coincida con el `producto_id` del cliente.

---

## Data model

La tabla `lotes` **ya existe** en MySQL y `LotesTable` ya está declarada y registrada en `src/database/types/types.ts`. **Este spec no hace ningún cambio de esquema**: no agrega tablas, columnas ni constraints, y no ejecuta DDL.

La unicidad de `nombre_lote` por cliente se garantiza únicamente con validación aplicativa en el repositorio (patrón `validateRtnDisponible` de `ClientesRepository`).

DTO nuevo `src/modules/lotes/dto/create-lote.dto.ts` (Zod, siguiendo el patrón de `create-cliente.dto.ts`):

- `cliente_id: number` — entero positivo, requerido.
- `nombre_lote: string` — requerido, mínimo 1 carácter.
- `producto_id: number` — entero positivo, requerido.
- `unidad_medida_id: number` — entero positivo, requerido.
- `peso_minimo: number` — requerido, positivo.
- `peso_ideal: number` — requerido, positivo.
- `peso_maximo: number` — requerido, positivo.
- `variedad_o_talla: string` — opcional.

Campos de `lotes` que **no** vienen del body:

- `created_by` — se toma de `req.user.userId` (token JWT).
- `estado` — el repositorio lo inserta explícitamente como `'abierto'`.
- `cerrado_en`, `resumen_ia` — no se escriben en este spec (quedan `null`).
- `created_at`, `updated_at` — los genera MySQL.

Campos devueltos por `GET /lotes/cliente/:clienteId`:

- `lotes.id`, `lotes.nombre_lote`, `lotes.variedad_o_talla`
- `productos.nombre as producto`, `unidad_medida.nombre as unidad_medida`
- `lotes.peso_minimo`, `lotes.peso_ideal`, `lotes.peso_maximo`
- `lotes.estado`, `lotes.created_at`

---

## Implementation plan

1. Crear `src/modules/lotes/dto/create-lote.dto.ts` con el schema Zod descrito en el modelo de datos, incluyendo el `.refine()` que valida `peso_minimo <= peso_ideal <= peso_maximo`.
2. Crear `src/modules/lotes/repository/lotes.repository.ts` con el getter `db` (`this.dbService.client`) y el método `getLotesByCliente(clienteId, usuarioId)`: valida el vínculo en `cliente_operador` y hace el `select` con `leftJoin` a `productos` y `unidad_medida`, filtrando por `lotes.cliente_id`, ordenado por `lotes.created_at desc`.
3. Agregar a `LotesRepository` los validadores privados, cada uno recibiendo `db: Kysely<Database>` como en `ClientesRepository`: `validateVinculoOperador(clienteId, usuarioId, db)`, `validateCliente(clienteId, db)`, `validateProducto(productoId, db)`, `validateUnidadMedida(unidadMedidaId, db)` y `validateNombreLoteDisponible(clienteId, nombreLote, db)`.
4. Agregar a `LotesRepository` el método `createLote(data, userId)`: abre `this.db.transaction()`, corre los validadores del paso 3 dentro de la transacción, inserta en `lotes` con `created_by: userId` y `estado: 'abierto'`, y devuelve el `insertId` como `number`.
5. Crear `src/modules/lotes/lotes.service.ts` con `create(dto, userId)` y `findAllByCliente(clienteId, userId)`, ambos delegando al repositorio (patrón de `ClientesService`).
6. Crear `src/modules/lotes/lotes.controller.ts` con `@Controller('lotes')`: `POST /` (`@HttpCode(201)`, `@Body() dto: CreateLoteDto`, `@Req() req` para el `userId`) y `GET /cliente/:clienteId` (`@Param('clienteId', ParseIntPipe)`, `@Req() req`). Ambos responden con la forma `{ ok, msg, ... }` usada en `ClientesController`.
7. Crear `src/modules/lotes/lotes.module.ts` (controller, providers `LotesService` + `LotesRepository`, `imports: [DatabaseModule]`) y registrar `LotesModule` en el arreglo `imports` de `src/app.module.ts`.
8. Verificación manual: autenticarse como un operador vinculado a un cliente, crear un lote con `POST /lotes` y confirmar que aparece en `GET /lotes/cliente/:clienteId`; luego autenticarse con un operador no vinculado a ese cliente y confirmar que ambos endpoints son rechazados.

---

## Acceptance criteria

- [X] El esquema de MySQL no cambió: no se ejecutó ningún DDL en esta implementación.
- [X] `LotesModule` está registrado en `src/app.module.ts` y la app arranca sin errores (`npm run start:dev`).
- [X] `POST /lotes` sin token JWT válido responde 401.
- [X] `POST /lotes` con `cliente_id`, `nombre_lote`, `producto_id`, `unidad_medida_id` y los tres pesos crea el lote y responde 201.
- [X] El lote creado tiene `created_by` igual al `userId` del token JWT usado en la petición.
- [X] El lote creado tiene `estado = 'abierto'`.
- [X] `POST /lotes` con un `cliente_id` al que el operador autenticado **no** está vinculado en `cliente_operador` es rechazado y no inserta ninguna fila.
- [X] `POST /lotes` con un `cliente_id` inexistente o con `isActive = 0` es rechazado.
- [X] `POST /lotes` con un `producto_id` inexistente o inactivo es rechazado.
- [X] `POST /lotes` con un `unidad_medida_id` inexistente es rechazado.
- [X] `POST /lotes` con `peso_minimo > peso_ideal` o `peso_ideal > peso_maximo` es rechazado por el DTO.
- [X] `POST /lotes` con un `nombre_lote` que ya existe para ese mismo `cliente_id` es rechazado con un mensaje que nombra el lote duplicado.
- [X] `POST /lotes` con el mismo `nombre_lote` pero un `cliente_id` distinto sí crea el lote.
- [X] `POST /lotes` omitiendo `variedad_o_talla` crea el lote con ese campo en `null`.
- [X] `GET /lotes/cliente/:clienteId` devuelve únicamente los lotes cuyo `cliente_id` coincide con el parámetro.
- [X] `GET /lotes/cliente/:clienteId` incluye `producto` y `unidad_medida` como nombres, no como ids.
- [X] `GET /lotes/cliente/:clienteId` con un `clienteId` al que el operador autenticado no está vinculado es rechazado.
- [X] `GET /lotes/cliente/:clienteId` de un cliente vinculado sin lotes devuelve `lotes: []`.
- [X] La respuesta del listado no incluye `resumen_ia`.
- [X] `GET /clientes` y `POST /clientes` (SPEC 01) siguen funcionando igual.

---

## Decisions

- **Sí:** `producto_id` explícito en el body de `POST /lotes`, validado solo contra la tabla `productos`. Permite que un cliente maneje lotes de productos distintos al `producto_id` registrado en su ficha.
- **No:** heredar el `producto_id` del cliente. Se descarta porque amarraría a cada cliente a un único producto por lote.
- **No:** validar que el `producto_id` del lote coincida con el del cliente. Redundante con la decisión anterior.
- **Sí:** validar el vínculo `cliente_operador` tanto al crear como al listar. Coherente con SPEC 01: sin esta validación, cualquier usuario autenticado podría crear o leer lotes de clientes ajenos y el filtro de `GET /clientes` quedaría sin efecto real.
- **Sí:** ruta `GET /lotes/cliente/:clienteId`. Es explícita y deja libre un futuro `GET /lotes/:id` para el detalle de un lote.
- **No:** `GET /lotes?cliente_id=X`. Se descarta porque un filtro obligatorio en query param es menos explícito, y no necesitamos filtros combinables todavía.
- **No:** ruta anidada `GET /clientes/:id/lotes`. Obligaría a meter lógica de lotes en `ClientesController` o a compartir controllers entre módulos.
- **Sí:** el backend inserta `estado: 'abierto'` explícitamente en lugar de depender del `DEFAULT` de MySQL. Deja el estado inicial visible en el código y no en el esquema.
- **Sí:** `nombre_lote` único por cliente, validado únicamente en la aplicación (patrón `validateRtnDisponible`). Da un mensaje de error legible y no requiere tocar el esquema.
- **No:** `UNIQUE KEY (cliente_id, nombre_lote)` en MySQL. Se descarta por decisión explícita del usuario durante la implementación: este spec no ejecuta DDL. Consecuencia aceptada: queda una ventana de carrera entre el `SELECT` de validación y el `INSERT` (ver Riesgos). Si más adelante se quiere cerrar, la constraint va en su propio spec.
- **No:** permitir reusar el `nombre_lote` cuando el lote anterior está cerrado. Se descarta porque el cierre de lote está fuera de alcance en este spec.
- **Sí:** campos seleccionados con joins en el listado, siguiendo el patrón de `getAllClientesByOperador`. Evita exponer `resumen_ia` y los ids crudos de las FK.
- **Sí:** toda la creación va dentro de una transacción Kysely, igual que `createCliente`. Las validaciones y el insert comparten la misma conexión.
- **Sí:** `POST /lotes` devuelve el id del lote creado, igual que `POST /clientes` devuelve el id del cliente. Mantiene la consistencia de la API.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| `peso_minimo`/`peso_ideal`/`peso_maximo` son `string \| number` en `LotesTable` (MySQL `DECIMAL` los devuelve como string) | El DTO acepta y valida `number`; el listado los devuelve tal como los entrega el driver. Cualquier formateo queda del lado del consumidor. |
| Sin `UNIQUE KEY`, dos peticiones concurrentes con el mismo `nombre_lote` y `cliente_id` pueden pasar ambas la validación antes de que cualquiera inserte, creando dos lotes con el mismo nombre | **Sin mitigar por decisión explícita.** La validación aplicativa cubre el caso secuencial, que es el flujo real de un operador creando lotes desde la app. Si el duplicado llega a ocurrir, se resuelve a mano. |

---

## What is **not** in this spec

- Cambios de esquema en MySQL, incluida la `UNIQUE KEY (cliente_id, nombre_lote)`.
- Cierre de lote (`cerrado_en`, cambio de `estado`).
- Generación o exposición de `resumen_ia`.
- Actualización o eliminación de lotes (`PUT` / `PATCH` / `DELETE`).
- Detalle de un lote individual (`GET /lotes/:id`).
- Listado global de lotes sin filtro por cliente.
- Módulo de pesajes y cualquier agregado de pesajes en el listado de lotes.
- Paginación y filtros adicionales en el listado.

Cada uno de estos, si se necesita, va en su propio spec.
