# SPEC 41 — Edición de clientes

> **Status:** Approved
> **Depends on:** SPEC 01 (módulo `clientes`), SPEC 11 (`validateClienteActivo` y la terna de rechazo), SPEC 22 (convención de Swagger), SPEC 25 (`constancia_exonerado` y documentos fiscales que leen el cliente por `JOIN`)
> **Date:** 2026-10-14
> **Objective:** Agregar `PATCH /clientes/:id`, que edita los datos de contacto, ubicación, producto, nombre y constancia de exoneración de un cliente activo, sin permitir tocar `rtn` ni `codigo_exportacion`.

---

## Why this spec exists

Hoy un cliente no se puede corregir por API: solo se crea (`POST /clientes`) o se rechaza (`PATCH /clientes/:id/rechazar`). Un teléfono que cambia o un error de tipeo en el nombre se corrigen a mano en MySQL. `constancia_exonerado` (spec 25) solo se mantiene a mano, y el spec 25 dejó `PATCH /clientes/:id` en su lista de trabajo diferido justamente para eso.

`rtn` y `codigo_exportacion` quedan fuera a propósito. Son los identificadores fiscales y aduaneros del cliente, tienen `UNIQUE` en MySQL, y `GET /documentos-fiscales/:id` lee el RTN de `clientes` por `JOIN`, sin copia en la cabecera. Cambiarlos reescribiría facturas ya emitidas.

---

## Scope

**In:**

- Nueva ruta `PATCH /clientes/:id` en `ClientesController`, con `ParseIntPipe` en `:id`.
- Nuevo DTO `EditarClienteDto` con ocho campos editables, todos opcionales: `nombre`, `producto_id`, `correo_contacto`, `telefono`, `direccion_planta`, `ubicacionLongitud`, `ubicacionLatitude` y `constancia_exonerado`.
- `rtn` y `codigo_exportacion` no están en el DTO. Si llegan en el cuerpo, Zod los descarta y no se escriben.
- Un cuerpo sin ningún campo editable responde **400** del DTO.
- Ningún campo acepta `null` ni cadena vacía: un campo se reemplaza, nunca se vacía.
- Solo se escriben los campos presentes en el cuerpo, más `updated_at = NOW()` y `actualizado_por` = usuario del token.
- **400** si el cliente no existe o está rechazado (`isActive = 0`).
- **400** si `producto_id` no existe o no está activo.
- Respuesta `{ ok, msg }` sin payload.
- Abierta a cualquier usuario autenticado, sin `validateVinculoOperador` y sin fila de permiso. El front decide quién ve el botón.
- DDL: columna `clientes.actualizado_por` con FK a `usuarios(id)`.
- Swagger: `@ApiOperation` con summary y descripción, y `@ApiParam` en `:id`.
- `CLAUDE.md` actualizado.

**Out of scope (for future specs):**

- Editar `rtn` o `codigo_exportacion`.
- Vaciar un campo opcional (escribirlo a `NULL`).
- Editar los vínculos de `cliente_operador` (`usuario_ids`).
- Historial de ediciones con valores anteriores.
- Copia del nombre y RTN del cliente en `documentos_fiscales`.
- `GET /clientes/:id`.
- Reactivar un cliente rechazado.
- Restringir la ruta por rol, validar `cliente_operador` o sembrar una fila de permiso.
- Devolver `constancia_exonerado` o `actualizado_por` en alguna lectura.
- Corregir las descripciones de Swagger de `POST /clientes` y `PATCH /clientes/:id/rechazar`, que todavía dicen que el RTN de un cliente rechazado se puede reutilizar.

---

## Data model

### DDL

Se aplica a mano en MySQL, en cada entorno, antes de desplegar el código:

```sql
ALTER TABLE clientes
  ADD COLUMN actualizado_por INT NULL AFTER updated_at;

ALTER TABLE clientes
  ADD CONSTRAINT fk_clientes_actualizado_por
  FOREIGN KEY (actualizado_por) REFERENCES usuarios(id);
```

- Nullable: todas las filas existentes quedan en `NULL`, que significa "nunca editado por API".
- Mismo patrón y nombre de constraint que `fk_clientes_rechazado_por` (spec 11).
- Guarda solo **la última** edición. No hay historial.
- Las FKs pasan de 23 a **24**. No se agrega `UNIQUE` ni índice.

### `src/database/types/types.ts`

`ClientesTable` gana una clave:

```ts
actualizado_por: number | null;
```

### DTO

`src/modules/clientes/dto/editar-cliente.dto.ts`:

| Campo | Regla |
| --- | --- |
| `nombre` | `string`, `trim`, mínimo 1, máximo el largo de la columna |
| `producto_id` | entero positivo |
| `correo_contacto` | email válido, máximo el largo de la columna |
| `telefono` | `string`, `trim`, mínimo 1, máximo el largo de la columna |
| `direccion_planta` | `string`, `trim`, mínimo 1, máximo el largo de la columna |
| `ubicacionLongitud` | `string`, `trim`, mínimo 1, máximo el largo de la columna |
| `ubicacionLatitude` | `string`, `trim`, mínimo 1, máximo el largo de la columna |
| `constancia_exonerado` | `string`, `trim`, mínimo 1, máximo 50 |

- Todos `.optional()` y **sin** `.nullable()`. Un `null` responde 400.
- Un `.refine()` exige al menos un campo distinto de `undefined`. Mensaje: `Debe enviar al menos un campo a editar`. Es la misma forma que `completar-documento-fiscal.dto.ts`.
- Los máximos salen de `DESCRIBE clientes` (paso 1 del plan). La base corre con `STRICT_TRANS_TABLES`, así que un valor más largo que la columna sería un 500 de MySQL en vez de un 400.

### Escritura

`ClientesRepository.editarCliente(clienteId, dto, userId)`, en una transacción:

1. `validateClienteActivo(clienteId, trx)`: 400 si no existe o si `isActive = 0`. Ya existe (spec 11).
2. Si viene `producto_id`: `validateProducto(producto_id, trx)`. Ya existe.
3. `UPDATE clientes SET <campos presentes>, updated_at = NOW(), actualizado_por = userId WHERE id = clienteId`.
4. Devuelve `true`.

- Solo se agregan al `SET` las claves con valor distinto de `undefined`.
- `updated_at` se escribe con `sql\`NOW()\``, igual que el resto de timestamps del proyecto. Se escribe aunque la columna tenga `ON UPDATE CURRENT_TIMESTAMP`, para no depender del DDL.
- Sin validaciones de unicidad: `nombre` no es único y `rtn` / `codigo_exportacion` no se tocan.

### Respuesta

`PATCH /clientes/12` con `{ "telefono": "9999-0000", "nombre": "Agro Export S.A." }` (**200**):

```json
{
  "ok": true,
  "msg": "Cliente actualizado correctamente"
}
```

Errores:

| Caso | Código | Mensaje |
| --- | --- | --- |
| Sin token | 401 | — |
| `:id` no numérico | 400 | `ParseIntPipe` |
| Cuerpo sin campos editables | 400 | `Debe enviar al menos un campo a editar` |
| Campo con `null`, vacío o inválido | 400 | Del DTO |
| Cliente no existe | 400 | `El cliente con id 'X' no existe` |
| Cliente rechazado | 400 | `El cliente con id 'X' ya fue rechazado` |
| Producto no existe | 400 | `El producto con id 'X' no existe` |
| Producto inactivo | 400 | `El producto 'X' no esta activo` |

### Conteo de rutas

| | Antes | Después |
| --- | --- | --- |
| Rutas de `clientes` | 4 | **5** |
| Rutas que mapea Nest | 44 | **45** |
| Operaciones en `/docs-json` | 43 | **44** |
| Claves de `paths` | 40 | **41** |

`/clientes/{id}` es una clave nueva de `paths`. No se agrupa con `/clientes/{id}/rechazar`.

### Archivos

| Archivo | Cambio |
| --- | --- |
| `src/database/types/types.ts` | `actualizado_por` en `ClientesTable`. |
| `src/modules/clientes/dto/editar-cliente.dto.ts` | Nuevo `EditarClienteDto`. |
| `src/modules/clientes/repository/clientes.repository.ts` | Nuevo método `editarCliente()`. Reusa `validateClienteActivo` y `validateProducto`. |
| `src/modules/clientes/clientes.service.ts` | Nuevo pass-through `editar()`. |
| `src/modules/clientes/clientes.controller.ts` | Nuevo handler `@Patch(':id')` con `@ApiOperation` y `@ApiParam`. |
| `CLAUDE.md` | Fila de `clientes`, conteos de rutas, FKs, escrituras abiertas, `UPDATE`s y endpoints que no validan `cliente_operador`. |

---

## Implementation plan

1. Ejecutar a mano el DDL. Confirmar con `DESCRIBE clientes;` que `actualizado_por` aparece nullable después de `updated_at`. Confirmar con `SHOW CREATE TABLE clientes;` que existe `fk_clientes_actualizado_por`. Anotar el largo de cada columna editable para el DTO.
2. Agregar `actualizado_por: number | null` a `ClientesTable`. `POST /clientes` no la escribe y sigue compilando.
3. Crear `editar-cliente.dto.ts` con las reglas del modelo de datos y el `.refine()` de al menos un campo. Todavía nadie lo usa.
4. Agregar `editarCliente()` a `ClientesRepository` con la transacción, los dos validadores y el `UPDATE` de solo los campos presentes.
5. Agregar `editar()` a `ClientesService` como pass-through.
6. Agregar `@Patch(':id')` a `ClientesController`, que responde `{ ok: true, msg: 'Cliente actualizado correctamente' }`. El `@ApiOperation` dice:
   - qué campos acepta;
   - que `rtn` y `codigo_exportacion` no se pueden editar y se ignoran si llegan;
   - que un campo no se puede vaciar;
   - que cambiar el `nombre` cambia el nombre que muestran las facturas ya registradas en `GET /documentos-fiscales/:id`;
   - que no se puede editar un cliente rechazado;
   - que no valida `cliente_operador`: cualquier usuario autenticado puede editar cualquier cliente.

   Prueba manual: editar el teléfono de un cliente responde 200, y `GET /clientes/all` muestra el teléfono nuevo.
7. Actualizar `CLAUDE.md`:
   - La fila de `clientes` en la tabla de endpoints.
   - Los conteos de rutas de la sección de Commands (45 rutas, 44 operaciones, 41 `paths`, `clientes` 5).
   - El conteo de FKs (24) en Caveats.
   - La lista de escrituras abiertas y de endpoints que no validan `cliente_operador`.
   - La lista de `UPDATE`s de la convención de escritura.
   - En Domain, `clientes.actualizado_por`, y que `constancia_exonerado` ya tiene un endpoint que la escribe.
   - En el bloque de diferidos del spec 25, que `PATCH /clientes/:id` ya existe y que el riesgo de no copiar el nombre del cliente en la factura ya no es teórico.

---

## Acceptance criteria

- [ ] El route log muestra **45** rutas, con `PATCH /clientes/:id` entre ellas.
- [ ] Sin header `Authorization`, `PATCH /clientes/1` responde 401.
- [ ] Con el token de un `OPERADOR` sin vínculo en `cliente_operador` con ese cliente, la edición responde 200.
- [ ] `PATCH /clientes/:id` con `{ "telefono": "9999-0000" }` responde `{ ok: true, msg: 'Cliente actualizado correctamente' }` y en MySQL solo cambiaron `telefono`, `updated_at` y `actualizado_por`.
- [ ] `actualizado_por` queda con el `userId` del token y `updated_at` con la hora de la edición.
- [ ] Cada uno de los ocho campos editables se puede cambiar por separado, verificado en MySQL.
- [ ] Un cuerpo `{}` responde 400 `Debe enviar al menos un campo a editar`.
- [ ] Un cuerpo `{ "rtn": "0801..." }` responde 400 `Debe enviar al menos un campo a editar` y el `rtn` no cambia.
- [ ] Un cuerpo `{ "rtn": "0801...", "telefono": "1234" }` responde 200, cambia el teléfono y el `rtn` no cambia.
- [ ] Lo mismo vale para `codigo_exportacion`.
- [ ] `{ "telefono": null }` responde 400.
- [ ] `{ "telefono": "" }` y `{ "nombre": "   " }` responden 400.
- [ ] `{ "correo_contacto": "no-es-correo" }` responde 400.
- [ ] Un valor más largo que su columna responde 400, no 500.
- [ ] Un `:id` que no existe responde 400 `El cliente con id 'X' no existe`.
- [ ] Un cliente rechazado responde 400 `El cliente con id 'X' ya fue rechazado` y ninguna columna cambia.
- [ ] Un `producto_id` inexistente o inactivo responde 400 y ninguna columna cambia.
- [ ] Editar el `nombre` de un cliente con documentos fiscales hace que `GET /documentos-fiscales/:id` muestre el nombre nuevo (riesgo aceptado, verificado).
- [ ] `PATCH /clientes/:id/rechazar` sigue respondiendo igual que antes.
- [ ] `GET /clientes`, `GET /clientes/all` y `POST /clientes` responden igual que antes, y ninguno devuelve `actualizado_por` ni `constancia_exonerado`.
- [ ] `/docs` muestra `PATCH /clientes/{id}` bajo el tag `clientes`, con su descripción y su `@ApiParam`.
- [ ] `SHOW CREATE TABLE clientes` muestra `fk_clientes_actualizado_por`.
- [ ] No se agregó ninguna fila a `catalogo_permisos` ni a `permisos`.

---

## Decisions

- **Sí:** `PATCH /clientes/:id`. No choca con `PATCH /clientes/:id/rechazar`: el segundo tiene un segmento literal detrás del parámetro. Tampoco es la trampa de `@Get(':id')`, porque es otro verbo.
- **No:** editar `rtn`. Decisión del usuario. `GET /documentos-fiscales/:id` lo lee por `JOIN`, así que cambiarlo reescribiría facturas emitidas.
- **No:** editar `codigo_exportacion`. Decisión del usuario. El front tampoco ofrece ese campo.
- **Sí:** Zod descarta `rtn` y `codigo_exportacion` en vez de responder 400. Es el mismo trato que el `password` en `POST /auth/register` (spec 37).
- **Sí:** `nombre` editable siempre. Decisión del usuario. Se aceptó que las facturas ya registradas muestren el nombre nuevo.
- **No:** `nombre` editable solo si el cliente no tiene facturas activas. Se ofreció como término medio y se descartó.
- **Sí:** cualquier usuario autenticado puede editar. Decisión del usuario. El permiso se valida en el front, igual que el bloqueo por PIN del spec 38.
- **No:** solo `ADMIN` con `validateCallerEsAdmin`. Se recomendó y se descartó.
- **No:** validar `cliente_operador`. Ningún endpoint del módulo `clientes` lo valida en escritura.
- **No:** vaciar campos con `null`. Decisión del usuario. Un dato cargado se reemplaza, nunca vuelve a `NULL` por API.
- **Sí:** cuerpo sin campos editables responde 400. Así el front se entera si mandó solo campos bloqueados.
- **Sí:** columna `actualizado_por` con FK. Decisión del usuario. Si cualquiera puede editar, hace falta saber quién lo hizo. FK por el mismo argumento que `rechazado_por`: una auditoría que apunta a un usuario inexistente no sirve.
- **No:** tabla de historial con valores anteriores. Más completa, pero es su propio spec.
- **No:** solo `updated_at`. Dice cuándo, no quién.
- **Sí:** `{ ok, msg }` sin payload. Decisión del usuario. Igual que `PATCH /clientes/:id/rechazar`.
- **No:** devolver el cliente actualizado. Sería la primera escritura de `clientes` que devuelve la fila.
- **Sí:** cliente rechazado responde 400. Reusa `validateClienteActivo`. Un cliente rechazado es inalcanzable por API y editarlo no tiene uso.
- **Sí:** se valida `producto_id` con `validateProducto`, como en `POST /clientes`.
- **Sí:** sin fila en `catalogo_permisos`/`permisos`. Sin un `PermissionsGuard` la fila no cambia nada, el mismo argumento de los specs anteriores.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Cualquiera con un token edita cualquier cliente llamando a la API directo, saltándose el front | Riesgo aceptado. `actualizado_por` registra quién hizo la última edición. |
| Cambiar el `nombre` cambia el nombre en facturas ya registradas | Riesgo aceptado. La solución es copiar el nombre en `documentos_fiscales`, que es otro spec. La descripción de Swagger lo advierte. |
| Solo se guarda la última edición | Una edición pisa el `actualizado_por` de la anterior. El historial es otro spec. |
| Un dato cargado por error en un campo opcional no se puede borrar | Se reemplaza por el valor correcto. Borrarlo es un `UPDATE` a mano. |
| El DDL no se aplicó en un entorno | El `UPDATE` falla con un 500 de MySQL por columna inexistente. El paso 1 del plan se repite en cada entorno, producción incluida. |

---

## What is **not** in this spec

- Editar `rtn`, `codigo_exportacion` o los vínculos de `cliente_operador`.
- Vaciar campos.
- Historial de ediciones.
- Copia del cliente en `documentos_fiscales`.
- `GET /clientes/:id` o reactivar clientes rechazados.
- Restringir por rol, validar `cliente_operador` o sembrar permisos.
- Devolver `actualizado_por` o `constancia_exonerado` en lecturas.
- Corregir las descripciones de Swagger existentes de `clientes`.

Cada uno de estos, si se necesita, va en su propio spec.
