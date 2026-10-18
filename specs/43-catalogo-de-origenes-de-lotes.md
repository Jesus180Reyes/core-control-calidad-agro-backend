# SPEC 43 — Catálogo de orígenes de lotes

> **Status:** Draft
> **Depends on:** SPEC 02 (módulo `lotes` y `POST /lotes`), SPEC 09 (convención de `catalogos`), SPEC 22 (convención de Swagger), SPEC 24 (`GET /lotes/cliente/:clienteId/all/finalizados`)
> **Date:** 2026-10-17
> **Objective:** Crear la tabla `origenes` por cliente, con `POST /origenes` para darlos de alta y `GET /catalogos/origenes/cliente/:clienteId` para el selector, y permitir que un lote guarde su origen y lo muestre en los cuatro listados de lotes.

---

## Why this spec exists

Hoy un lote no dice de dónde vino el producto. Lo más cercano es `clientes.direccion_planta`, que es del cliente y no del lote, y un mismo cliente recibe producto de varias fincas o proveedores.

La idea sale de una conversación con alguien que trabaja en control de calidad de una azucarera: en las plantillas que llenan a mano, cada lote lleva su origen. Este spec agrega ese dato con la forma más simple que sirve: un catálogo de orígenes por cliente, con nombre, dirección y teléfono.

---

## Scope

**In:**

- DDL: tabla nueva `origenes` y columna `lotes.origen_id`, con sus FKs.
- Transcribir el DDL a `db/schema.sql`.
- Módulo nuevo `src/modules/origenes/` con `POST /origenes`.
  - Cuerpo `{ cliente_id, nombre, direccion?, telefono? }`.
  - **400** si el cliente no existe o no está activo.
  - **400** si el cliente ya tiene un origen con ese nombre (sin distinguir mayúsculas, activo o no).
  - Responde **201** `{ ok, msg, origen_id }`.
- `GET /catalogos/origenes/cliente/:clienteId` en `CatalogosController`.
  - `{ ok, msg, data }`, cada elemento exactamente `{ id, nombre }`.
  - Solo orígenes de ese cliente con `isActive = 1`, ordenados por `nombre` ASC.
  - No valida el cliente: uno inexistente o sin orígenes responde 200 con `data: []`.
- `POST /lotes` acepta `origen_id` **opcional**.
  - Si viene: **400** si no existe, no está activo o es de otro cliente.
  - Si no viene: el lote se guarda con `origen_id = NULL`, como hoy.
- Los cuatro listados de lotes devuelven un campo nuevo `origen` (el nombre, o `null`) por `LEFT JOIN`:
  - `GET /lotes/cliente/:clienteId`
  - `GET /lotes/cliente/:clienteId/all`
  - `GET /lotes/cliente/:clienteId/all/approver`
  - `GET /lotes/cliente/:clienteId/all/finalizados`
- Las dos rutas nuevas abiertas a cualquier usuario autenticado, sin `validateVinculoOperador` y sin fila de permiso.
- Swagger: `@ApiTags`/`@ApiBearerAuth` en el controller nuevo, `@ApiOperation` en las dos rutas, `@ApiParam` en `:clienteId`. Descripciones actualizadas de `POST /lotes` y de los cuatro listados.
- `src/database/types/types.ts` y `CLAUDE.md` actualizados.

**Out of scope (for future specs):**

- Editar un origen (`PATCH /origenes/:id`).
- Desactivar o reactivar un origen por API. Hoy `isActive = 0` se pone a mano en MySQL.
- Las columnas `updated_at` y `actualizado_por` en `origenes`. Las agrega el spec de edición, con su `ALTER TABLE`.
- `GET /origenes`, un listado de administración con todos los campos e inactivos.
- Que `origen_id` sea obligatorio en `POST /lotes`.
- Cambiar el origen de un lote ya creado.
- Mostrar el origen en `GET /documentos-fiscales/:id`, en el resumen IA (spec 27), en el chat (spec 28) o en las métricas (spec 35).
- Orígenes globales, compartidos entre clientes.
- Restringir las rutas por rol, validar `cliente_operador` o sembrar una fila de permiso.
- Paginación o filtros en el selector.

---

## Data model

### DDL

Se aplica a mano en MySQL, en cada entorno, antes de desplegar el código. Primero la tabla, después la columna, porque la columna la referencia:

```sql
CREATE TABLE origenes (
  id          INT          NOT NULL AUTO_INCREMENT,
  cliente_id  INT          NOT NULL,
  nombre      VARCHAR(150) NOT NULL,
  direccion   VARCHAR(255) NULL,
  telefono    VARCHAR(20)  NULL,
  isActive    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  created_by  INT          NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_origenes_cliente    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  CONSTRAINT fk_origenes_created_by FOREIGN KEY (created_by) REFERENCES usuarios(id)
);

ALTER TABLE lotes
  ADD COLUMN origen_id INT NULL AFTER cliente_id;

ALTER TABLE lotes
  ADD CONSTRAINT fk_lotes_origen
  FOREIGN KEY (origen_id) REFERENCES origenes(id);
```

- `cliente_id` obligatorio: un origen pertenece a un cliente.
- `nombre` **sin `UNIQUE`** en MySQL. La unicidad por cliente se valida en el repositorio, como `lotes.nombre_lote`.
- Sin `updated_at` ni `actualizado_por`: nada edita un origen todavía.
- `lotes.origen_id` nullable: los lotes existentes quedan en `NULL` y el campo es opcional en `POST /lotes`.
- `origen_id` queda en la posición 3 de `lotes` y corre una posición todas las columnas siguientes.
- Las FKs pasan de 24 a **27**. No se agrega `UNIQUE` ni índice propio (InnoDB crea el `KEY` de cada FK).

### `src/database/types/types.ts`

Interfaz nueva y clave nueva en `Database`:

```ts
export interface OrigenTable {
  id: Generated<number>;
  cliente_id: number;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  isActive: Generated<number>;
  created_at: Generated<Date | null>;
  created_by: number;
}

// Database
origenes: OrigenTable;
```

`LoteTable` gana:

```ts
origen_id: number | null;
```

### DTOs

`src/modules/origenes/dto/create-origen.dto.ts`:

| Campo | Regla |
| --- | --- |
| `cliente_id` | entero positivo, obligatorio |
| `nombre` | `string`, `trim`, mínimo 1, máximo 150, obligatorio |
| `direccion` | `string`, `trim`, mínimo 1, máximo 255, opcional |
| `telefono` | `string`, `trim`, mínimo 1, máximo 20, opcional |

- Los máximos son el largo de la columna. La base corre con `STRICT_TRANS_TABLES`, así que un valor más largo sería un 500 de MySQL en vez de un 400.
- `direccion` y `telefono` no aceptan `null` ni cadena vacía: si no se tienen, no se mandan.

`src/modules/lotes/dto/create-lote.dto.ts` gana:

```ts
origen_id: z.number().int().positive('El origen_id debe ser un id valido').optional(),
```

### Escritura: `POST /origenes`

`OrigenesRepository.createOrigen(dto, userId)`, en una transacción:

1. `validateCliente(cliente_id, trx)`: 400 `El cliente con id 'X' no existe` o `El cliente 'N' no esta activo`. Mismos mensajes que el validador de `LotesRepository`.
2. `validateNombreOrigenDisponible(cliente_id, nombre, trx)`: busca en `origenes` una fila del mismo cliente con el mismo `nombre`, **sin filtrar `isActive`**. Si existe, 400 `El origen 'N' ya esta registrado para este cliente`. La comparación la hace MySQL con la collation `utf8mb4_0900_ai_ci`, así que no distingue mayúsculas ni tildes.
3. `INSERT` con `cliente_id`, `nombre`, `direccion`, `telefono` y `created_by = userId`.
4. Devuelve `Number(result.insertId)`.

### Lectura: selector

`CatalogosRepository.getOrigenesByCliente(clienteId)`:

```ts
selectFrom('origenes')
  .select(['id', 'nombre'])
  .where('cliente_id', '=', clienteId)
  .where('isActive', '=', 1)
  .orderBy('nombre', 'asc')
```

- Sin validación, sin transacción, como los otros cinco catálogos.

### `POST /lotes`

`createLote` agrega un validador después de `validateUnidadMedida`, **solo si viene `origen_id`**:

`validateOrigen(origen_id, cliente_id, trx)`:

- 400 `El origen con id 'X' no existe`.
- 400 `El origen 'N' no esta activo`.
- 400 `El origen 'N' no pertenece al cliente`.

El `INSERT` escribe `origen_id` (o `NULL` si no vino). El resto de `createLote` no cambia.

### Listados de lotes

Los cuatro métodos agregan:

```ts
.leftJoin('origenes', 'origenes.id', 'lotes.origen_id')
// en el select, al final de los diez campos comunes, después de 'etapas.nombre as etapa':
'origenes.nombre as origen',
```

- Los tres primeros pasan de 10 a **11** campos.
- `GET /lotes/cliente/:clienteId/all/finalizados` pasa de 14 a **15**: `origen` va después de `etapa` y antes de `aprobado_por`, para que los once primeros campos sigan iguales en los cuatro.
- `LEFT JOIN`: un lote sin origen sigue apareciendo, con `origen: null`.
- Se muestra el nombre aunque el origen esté inactivo. Desactivar un origen no le quita el origen a los lotes que ya lo usaron.
- Ningún filtro cambia.

### Respuestas

`POST /origenes` con `{ "cliente_id": 12, "nombre": "Finca El Recreo", "telefono": "9999-0000" }` (**201**):

```json
{
  "ok": true,
  "msg": "Origen creado correctamente",
  "origen_id": 5
}
```

`GET /catalogos/origenes/cliente/12` (**200**):

```json
{
  "ok": true,
  "msg": "Origenes obtenidos correctamente",
  "data": [
    { "id": 5, "nombre": "Finca El Recreo" },
    { "id": 3, "nombre": "Finca San Juan" }
  ]
}
```

Errores:

| Caso | Ruta | Código | Mensaje |
| --- | --- | --- | --- |
| Sin token | ambas | 401 | — |
| `:clienteId` no numérico | `GET` | 400 | `ParseIntPipe` |
| Campo faltante, vacío, `null` o demasiado largo | `POST /origenes` | 400 | Del DTO |
| Cliente no existe | `POST /origenes` | 400 | `El cliente con id 'X' no existe` |
| Cliente no activo | `POST /origenes` | 400 | `El cliente 'N' no esta activo` |
| Nombre repetido en el cliente | `POST /origenes` | 400 | `El origen 'N' ya esta registrado para este cliente` |
| `origen_id` no es entero positivo | `POST /lotes` | 400 | `El origen_id debe ser un id valido` |
| Origen no existe | `POST /lotes` | 400 | `El origen con id 'X' no existe` |
| Origen inactivo | `POST /lotes` | 400 | `El origen 'N' no esta activo` |
| Origen de otro cliente | `POST /lotes` | 400 | `El origen 'N' no pertenece al cliente` |

### Rutas

- `@Get('origenes/cliente/:clienteId')` en `CatalogosController` no choca con ninguna ruta de ese controller: todas las demás son un solo segmento literal.
- `OrigenesController` tiene una sola ruta, `@Post()`.

### Conteo de rutas

| | Antes | Después |
| --- | --- | --- |
| Rutas de `catalogos` | 5 | **6** |
| Rutas de `origenes` | — | **1** |
| Rutas que mapea Nest | 47 | **49** |
| Operaciones en `/docs-json` | 46 | **48** |
| Claves de `paths` | 42 | **44** |

`/origenes` y `/catalogos/origenes/cliente/{clienteId}` son dos claves nuevas de `paths`.

### Archivos

| Archivo | Cambio |
| --- | --- |
| `db/schema.sql` | Tabla `origenes`, columna `lotes.origen_id` y `fk_lotes_origen`. |
| `src/database/types/types.ts` | `OrigenTable`, `origenes` en `Database`, `origen_id` en `LoteTable`. |
| `src/modules/origenes/origenes.module.ts` | Nuevo, con `imports: [DatabaseModule]`. |
| `src/modules/origenes/origenes.controller.ts` | Nuevo, `@Post()` con `@ApiTags('origenes')`, `@ApiBearerAuth` y `@ApiOperation`. |
| `src/modules/origenes/origenes.service.ts` | Nuevo, pass-through `create()`. |
| `src/modules/origenes/repository/origenes.repository.ts` | Nuevo, `createOrigen()`, `validateCliente()` y `validateNombreOrigenDisponible()`. |
| `src/modules/origenes/dto/create-origen.dto.ts` | Nuevo `CreateOrigenDto`. |
| `src/app.module.ts` | Registrar `OrigenesModule`. |
| `src/modules/catalogos/repository/catalogos.repository.ts` | Nuevo `getOrigenesByCliente()`. |
| `src/modules/catalogos/catalogos.service.ts` | Nuevo pass-through. |
| `src/modules/catalogos/catalogos.controller.ts` | Nuevo `@Get('origenes/cliente/:clienteId')` con `@ApiOperation` y `@ApiParam`. |
| `src/modules/lotes/dto/create-lote.dto.ts` | `origen_id` opcional. |
| `src/modules/lotes/repository/lotes.repository.ts` | `validateOrigen()`, `origen_id` en el `INSERT` de `createLote`, `LEFT JOIN` y campo `origen` en los cuatro listados. |
| `src/modules/lotes/lotes.controller.ts` | Descripciones de Swagger de `POST /lotes` y de los cuatro listados. |
| `CLAUDE.md` | Ver paso 8 del plan. |

---

## Implementation plan

1. Ejecutar a mano el DDL. Confirmar con `DESCRIBE origenes;` y `DESCRIBE lotes;` que la tabla y la columna existen, y con `SHOW CREATE TABLE` que existen `fk_origenes_cliente`, `fk_origenes_created_by` y `fk_lotes_origen`. Transcribir el DDL a `db/schema.sql`.
2. Agregar `OrigenTable`, `origenes` en `Database` y `origen_id` en `LoteTable`. El proyecto sigue compilando: nadie escribe la columna todavía.
3. Crear el módulo `origenes` (module, controller, service, repository, DTO) con `POST /origenes`, y registrarlo en `AppModule`. El `@ApiOperation` dice:
   - que el origen pertenece a un cliente y el nombre no se repite dentro del cliente, sin distinguir mayúsculas y contando los inactivos;
   - que `direccion` y `telefono` son opcionales;
   - que devuelve el id creado;
   - que no hay forma de editar ni desactivar un origen por API;
   - que no valida `cliente_operador`: cualquier usuario autenticado puede crear orígenes para cualquier cliente.

   Prueba manual: crear un origen responde 201 con su id, y repetir el nombre en mayúsculas responde 400.
4. Agregar `getOrigenesByCliente()` a `CatalogosRepository`, su pass-through al service y `@Get('origenes/cliente/:clienteId')` a `CatalogosController`, que responde `{ ok: true, msg: 'Origenes obtenidos correctamente', data }`. El `@ApiOperation` dice que solo lista los activos del cliente, que un cliente inexistente responde 200 con `[]` y que no valida `cliente_operador`.

   Prueba manual: el origen del paso 3 aparece en el selector de su cliente y no en el de otro.
5. Agregar `origen_id` opcional a `CreateLoteDto`, `validateOrigen()` a `LotesRepository` y `origen_id` al `INSERT` de `createLote`. Actualizar la descripción de `POST /lotes`: el origen es opcional y, si viene, debe existir, estar activo y ser del mismo cliente.

   Prueba manual: crear un lote con y sin `origen_id`, y con el origen de otro cliente (400).
6. Agregar el `LEFT JOIN` y el campo `origen` a los cuatro listados de lotes. Actualizar sus descripciones de Swagger con el campo nuevo.

   Prueba manual: el lote del paso 5 muestra el nombre del origen, y uno sin origen muestra `null`.
7. Confirmar en el route log que Nest mapea 49 rutas.
8. Actualizar `CLAUDE.md`:
   - Los conteos de rutas de Commands (49 rutas, `catalogos` 6, `origenes` 1, 48 operaciones, 44 `paths`).
   - Una fila `origenes` en la tabla de endpoints, y el selector nuevo en la fila de `catalogos` (seis endpoints con `data`).
   - La fila de `lotes`: `origen_id` opcional en `POST /lotes`, y el campo `origen` en los cuatro listados (11 y 15 campos).
   - La lista de endpoints que no validan `cliente_operador` (de 28 a **30**).
   - En Domain, la tabla `origenes` y `lotes.origen_id`.
   - En Caveats, el DDL del spec 43 y las FKs (24 a **27**).
   - La regla de unicidad: `origenes.nombre` por cliente se valida solo en código, como `nombre_lote`.

---

## Acceptance criteria

- [ ] El route log muestra **49** rutas, con `POST /origenes` y `GET /catalogos/origenes/cliente/:clienteId` entre ellas.
- [ ] Sin header `Authorization`, las dos rutas nuevas responden 401.
- [ ] Con el token de un `OPERADOR` sin vínculo con el cliente, las dos rutas nuevas responden 201 y 200.
- [ ] `POST /origenes` con `cliente_id` y `nombre` responde 201 `{ ok: true, msg: 'Origen creado correctamente', origen_id }`, y en MySQL la fila tiene `isActive = 1`, `created_by` = usuario del token y `direccion`/`telefono` en `NULL`.
- [ ] `POST /origenes` con `direccion` y `telefono` los guarda.
- [ ] Repetir el nombre de un origen del mismo cliente, aunque cambien mayúsculas, responde 400 `El origen 'N' ya esta registrado para este cliente`.
- [ ] Repetir el nombre de un origen inactivo del mismo cliente también responde 400.
- [ ] El mismo nombre en otro cliente responde 201.
- [ ] Un `cliente_id` inexistente responde 400 `El cliente con id 'X' no existe`, y uno rechazado responde 400 `El cliente 'N' no esta activo`.
- [ ] `{ "nombre": "" }`, `{ "nombre": "   " }`, `{ "telefono": null }` y un `nombre` de 151 caracteres responden 400, no 500.
- [ ] `GET /catalogos/origenes/cliente/:clienteId` responde `{ ok: true, msg: 'Origenes obtenidos correctamente', data }`, con cada elemento exactamente `{ id, nombre }`, solo activos del cliente, ordenados por nombre.
- [ ] Un origen con `isActive = 0` puesto a mano no aparece en el selector.
- [ ] Un `clienteId` sin orígenes o inexistente responde 200 con `data: []`.
- [ ] `POST /lotes` sin `origen_id` responde igual que antes y guarda `origen_id = NULL`.
- [ ] `POST /lotes` con un `origen_id` válido del mismo cliente guarda ese `origen_id`.
- [ ] `POST /lotes` con un `origen_id` inexistente, inactivo o de otro cliente responde 400 con su mensaje, y no se crea el lote.
- [ ] Los cuatro listados de lotes traen el campo `origen` con el nombre, o `null` en un lote sin origen.
- [ ] Los tres primeros listados devuelven 11 campos y `/all/finalizados` 15, con `origen` después de `etapa`.
- [ ] Un lote cuyo origen se desactivó a mano sigue mostrando el nombre del origen.
- [ ] Los demás campos y filtros de los cuatro listados no cambian.
- [ ] `/docs` muestra `POST /origenes` bajo el tag `origenes` y el selector bajo `catalogos`, con su descripción y su `@ApiParam`.
- [ ] `SHOW CREATE TABLE` muestra `fk_origenes_cliente`, `fk_origenes_created_by` y `fk_lotes_origen`.
- [ ] `db/schema.sql` contiene la tabla `origenes` y la columna `lotes.origen_id`.
- [ ] No se agregó ninguna fila a `catalogo_permisos` ni a `permisos`.

---

## Decisions

- **Sí:** tabla simple con `nombre`, `direccion`, `telefono`, `isActive` y auditoría de creación. Decisión del usuario.
- **No:** separar productor, finca y lote de campo en varias tablas. Se ofreció como trazabilidad más fina y se descartó por complejidad.
- **Sí:** un origen pertenece a un cliente (`origenes.cliente_id`). Decisión del usuario.
- **No:** orígenes globales compartidos entre clientes. Se recomendó, porque una finca puede venderle a varios clientes, y se descartó.
- **Sí:** solo `created_at` y `created_by`. Decisión del usuario. Nada edita un origen todavía.
- **No:** crear ya `updated_at` y `actualizado_por`. Se recomendó para que el spec de edición no necesite DDL, y se descartó.
- **Sí:** endpoints mínimos: el selector y `POST /origenes`. Decisión del usuario.
- **No:** `PATCH /origenes/:id`, desactivar, reactivar y `GET /origenes`. Se recomendó el set completo y se descartó. Editar o desactivar se hace a mano en MySQL.
- **Sí:** módulo nuevo `origenes` para el `POST`. Decisión del usuario. `CatalogosRepository` es solo lectura (spec 09), y el módulo deja lugar para la edición futura.
- **Sí:** el selector en `catalogos`, con la forma `{ id, nombre }` y la clave `data` de los otros cinco.
- **Sí:** el cliente del selector va en el path, `/catalogos/origenes/cliente/:clienteId`. Decisión del usuario. Mismo estilo que `GET /lotes/cliente/:clienteId`.
- **No:** `?cliente_id` como query param. Sería el primer catálogo con DTO de query y obligaría a decidir qué pasa si falta.
- **Sí:** el selector no valida el cliente y responde `[]`. Igual que `GET /lotes/cliente/:clienteId/all/finalizados`.
- **Sí:** solo `nombre` es obligatorio en `POST /origenes`. Decisión del usuario. Muchas veces solo se sabe el nombre de la finca.
- **Sí:** nombre único por cliente, validado en el repositorio. Decisión del usuario. Evita dos entradas iguales en el selector.
- **No:** `UNIQUE (cliente_id, nombre)` en MySQL. Se sigue el criterio de `lotes.nombre_lote`: un duplicado de origen no es una multa.
- **Sí:** la unicidad cuenta los orígenes inactivos. Reactivar uno a mano nunca deja dos con el mismo nombre.
- **Sí:** `POST /origenes` responde `{ ok, msg, origen_id }`. Decisión del usuario. El front puede preseleccionar el origen recién creado. Misma forma que `POST /documentos-fiscales`.
- **Sí:** `origen_id` opcional en `POST /lotes`. Decisión del usuario. No rompe el front actual.
- **No:** `origen_id` obligatorio. Se recomendó, porque un dato opcional casi nunca se llena, y se descartó.
- **Sí:** si viene `origen_id`, se valida que exista, esté activo y sea del mismo cliente del lote.
- **Sí:** el campo `origen` en los cuatro listados de lotes. Decisión del usuario. Sin él, el dato se guarda y nadie lo ve.
- **Sí:** `origen` va al final de los diez campos comunes. Los once primeros campos siguen iguales en los cuatro listados, y en `/all/finalizados` los campos de auditoría quedan al final.
- **Sí:** un lote muestra el nombre de su origen aunque el origen esté inactivo. Desactivar es dejar de ofrecerlo, no borrar la historia.
- **Sí:** cualquier usuario autenticado. Decisión del usuario. El permiso se valida en el front, igual que los specs 41 y 42.
- **No:** solo `ADMIN`. Impediría al operador dar de alta una finca al crear el lote.
- **Sí:** sin fila en `catalogo_permisos`/`permisos`. Sin un `PermissionsGuard` la fila no cambia nada, el mismo argumento de los specs anteriores.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Como `origen_id` es opcional, la mayoría de los lotes queda sin origen | Riesgo aceptado. El front puede exigirlo en el formulario. Hacerlo obligatorio en el backend es otro spec. |
| Un origen mal escrito no se puede corregir ni desactivar por API | Se corrige a mano en MySQL. El spec de edición lo resuelve. |
| La misma finca le vende a dos clientes y queda cargada dos veces | Consecuencia de la decisión "por cliente". Cada carga es independiente. |
| Dos `POST /origenes` simultáneos con el mismo nombre en el mismo cliente | La ventana entre el `SELECT` y el `INSERT` deja crear los dos, igual que con `nombre_lote`. No hay `UNIQUE` en MySQL. |
| Cualquiera con un token crea orígenes para cualquier cliente llamando a la API directo | Riesgo aceptado. `created_by` registra quién lo creó. |
| El DDL no se aplicó en un entorno | `POST /origenes` y los cuatro listados fallan con un 500 de MySQL. El paso 1 del plan se repite en cada entorno, producción incluida. |

---

## What is **not** in this spec

- Editar, desactivar o reactivar orígenes por API, y `GET /origenes`.
- `updated_at` y `actualizado_por` en `origenes`.
- `origen_id` obligatorio o editable en un lote existente.
- El origen en documentos fiscales, resumen IA, chat o métricas.
- Orígenes globales.
- Restringir por rol, validar `cliente_operador` o sembrar permisos.
- Paginación o filtros en el selector.

Cada uno de estos, si se necesita, va en su propio spec.
