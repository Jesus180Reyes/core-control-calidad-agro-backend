# SPEC 11 — Rechazo de clientes

> **Status:** Implemented
> **Depends on:** SPEC 01, SPEC 08, SPEC 10
> **Date:** 2026-09-01
> **Objective:** Agregar `PATCH /clientes/:id/rechazar`, que da de baja lógica a un cliente poniendo `isActive = 0` y guardando el motivo, el usuario y la fecha del rechazo en tres columnas nuevas de `clientes`.

---

## Why this spec exists

Un cliente se registra mal, o deja de operar, y hoy no hay forma de sacarlo de los listados. `POST /clientes` inserta y nada más. `GET /clientes` y `GET /clientes/all` filtran `clientes.isActive = 1`, y `LotesRepository.validateCliente` ya rechaza un cliente con `isActive = 0`, así que **el mecanismo de baja lógica está a medio construir desde SPEC 01 y nadie escribe la columna**. Este spec la escribe. Es la misma situación que SPEC 10 encontró en `pesajes.isActive`, y se resuelve con la misma forma.

Hay que ser explícito con cuatro cosas.

**La primera: "rechazar" aquí significa baja lógica del cliente, no un flujo de aprobación.** No existe ninguna columna de estado en `clientes` y este spec no la crea. Un cliente no pasa por `pendiente` antes de ser usable: `POST /clientes` sigue creando clientes activos y utilizables de inmediato. Lo único que este spec agrega es la operación inversa.

**La segunda: es la segunda operación de escritura del proyecto abierta a cualquier usuario autenticado, y es más grave que la primera.** Por decisión explícita, `PATCH /clientes/:id/rechazar` **no** llama a `validateVinculoOperador`. SPEC 10 tomó esa misma decisión para anular un pesaje: una fila. Aquí un `Operador` sin ninguna fila en `cliente_operador` puede hacer desaparecer un cliente completo de los dos listados y bloquear la creación de lotes contra él. Se asume y se registra en Risks.

**La tercera: no hay cascada.** Los lotes abiertos del cliente rechazado siguen abiertos, sus pesajes siguen ahí y sus filas de `cliente_operador` quedan intactas. Eso deja dos incoherencias reales, no teóricas: `GET /lotes/cliente/:clienteId` no valida `clientes.isActive`, así que sigue devolviendo los lotes de un cliente rechazado; y `POST /pesajes` valida el lote y el vínculo pero tampoco el cliente, así que se pueden seguir guardando pesajes contra esos lotes. Están en Risks y no se mitigan en este spec.

**La cuarta: el rechazo libera el RTN y el código de exportación.** `validateRtnDisponible` y `validateCodigoExportacionDisponible` filtran `isActive = 1` desde el commit `c60e9dc`, así que después de rechazar un cliente se puede registrar otro con el mismo RTN. Es el comportamiento existente y este spec **no** lo cambia.

---

## Scope

**In:**

- DDL a mano en MySQL: tres columnas nuevas y nullables en `clientes` — `motivo_rechazo`, `rechazado_por` y `rechazado_en` — más una FK de `rechazado_por` a `usuarios(id)`.
- Actualizar `ClientesTable` en `src/database/types/types.ts` con las tres columnas.
- Nuevo DTO `src/modules/clientes/dto/rechazar-cliente.dto.ts` con un único campo `motivo`, obligatorio, entre 5 y 255 caracteres.
- Nuevo método `rechazarCliente(clienteId, dto, userId)` en `src/modules/clientes/repository/clientes.repository.ts`, dentro de una transacción.
- Nuevo validador privado `validateClienteActivo(clienteId, db)` en el mismo repositorio.
- Nuevo método `rechazar(clienteId, dto, userId)` en `src/modules/clientes/clientes.service.ts`, pass-through al repositorio.
- Nuevo handler `@Patch(':id/rechazar')` en `src/modules/clientes/clientes.controller.ts`, con `@Param('id', ParseIntPipe)`.
- Nuevo endpoint `PATCH /clientes/:id/rechazar`, protegido únicamente por el `JwtAuthGuard` global (no lleva `@Public()`).
- El `UPDATE` escribe exactamente cuatro columnas: `isActive = 0`, `motivo_rechazo`, `rechazado_por` (del `req.user.userId`) y `rechazado_en` (`NOW()` de MySQL).
- Respuesta `200` con la forma `{ ok, msg }`, sin payload de recurso.
- `400` si el cliente no existe o si ya está rechazado.
- Actualizar `CLAUDE.md`: fila `clientes` de la tabla de endpoints, las tres columnas nuevas de `clientes` y su FK, y la nota de que es la segunda escritura sin `validateVinculoOperador`.

**Out of scope (for future specs):**

- Cualquier flujo de aprobación de clientes: no se agrega `clientes.estado` ni los valores `pendiente` / `aprobado` / `rechazado`.
- Cambios a `POST /clientes`, que sigue creando clientes activos y sigue liberando el RTN de un cliente rechazado.
- Deshacer un rechazo. No hay endpoint de reactivación y no lo habrá en este spec.
- Rechazar en lote (varios `cliente_id` en una sola llamada).
- Cascada sobre `lotes`: no se cierran, no se desactivan, no se tocan.
- Cascada sobre `pesajes`: no se rechazan ni se desactivan.
- Cascada sobre `cliente_operador`: los vínculos quedan intactos y no se borra ninguna fila.
- Cambios a `GET /lotes/cliente/:clienteId`, que sigue sin validar `clientes.isActive`.
- Cambios a `POST /pesajes` y a `POST /lotes`.
- Sembrar filas en `permisos`. Se decidió explícitamente no hacerlo (ver Decisions). La tabla sigue con las 11 filas de SPEC 08.
- **Aplicar** permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`.
- Validar el vínculo `cliente_operador`. Decisión explícita: cualquier usuario autenticado puede rechazar cualquier cliente.
- Exigir que quien rechaza sea quien creó el cliente (`clientes.created_by`).
- Cambios a `GET /clientes` y `GET /clientes/all`: mantienen su filtro `isActive = 1`, sus seis campos y su orden. Un cliente rechazado desaparece de los dos y no se puede volver a consultar por API.
- Un endpoint para listar clientes rechazados, y cualquier query param del estilo `?incluirRechazados=true`.
- Devolver `motivo_rechazo`, `rechazado_por` o `rechazado_en` en cualquier endpoint de lectura.
- Borrado físico (`DELETE FROM clientes`).
- Editar un cliente (`PUT` / `PATCH` sobre sus datos), y `GET /clientes/:id`.
- Un catálogo de motivos de rechazo. El motivo es texto libre.
- Baja lógica en `lotes`, `usuarios`, `productos` o cualquier otra tabla.

---

## Data model

### DDL (ejecutar a mano en MySQL)

Las tres columnas son nullables porque las filas existentes no tienen valor y no se van a rellenar:

```sql
ALTER TABLE clientes
  ADD COLUMN motivo_rechazo VARCHAR(255) NULL AFTER updated_at,
  ADD COLUMN rechazado_por INT NULL AFTER motivo_rechazo,
  ADD COLUMN rechazado_en DATETIME NULL AFTER rechazado_por;

ALTER TABLE clientes
  ADD CONSTRAINT fk_clientes_rechazado_por
  FOREIGN KEY (rechazado_por) REFERENCES usuarios(id);
```

Los nombres son los mismos tres que SPEC 10 puso en `pesajes`, a propósito: es la misma operación sobre otra tabla y el rastro debe leerse igual.

La FK es la tercera excepción del proyecto a la regla de validar solo en código, después de la de `permisos` a `roles` y la de `pesajes.rechazado_por` a `usuarios(id)`. Se justifica igual que la segunda: es un dato de auditoría y una fila huérfana lo dejaría sin valor probatorio.

Nótese que `clientes.created_by` **no** tiene FK hoy y este spec no se la agrega. Queda la misma inconsistencia intratabla que SPEC 10 dejó en `pesajes`: una columna de usuario con FK y otra sin ella.

### Cambio en `src/database/types/types.ts`

`ClientesTable` gana tres claves al final:

```ts
export interface ClientesTable {
  // ...campos existentes sin cambios...
  updated_at: Generated<Date | string | null>;
  motivo_rechazo: string | null;
  rechazado_por: number | null;
  rechazado_en: Date | string | null;
}
```

Ninguna es `Generated<>`: las tres las escribe la aplicación, no MySQL, y ninguna tiene `DEFAULT`.

### DTO (`src/modules/clientes/dto/rechazar-cliente.dto.ts`)

- `motivo: string` — requerido, `.min(5)`, `.max(255)`.

Es el segundo DTO del módulo, junto a `create-cliente.dto.ts`, y sigue la misma forma: schema Zod envuelto con `createZodDto()`. Es idéntico en contenido a `rechazar-pesaje.dto.ts`.

El `id` del cliente **no** va en el body: viene en la ruta y se convierte con `ParseIntPipe`.

Campos que **no** vienen del body:

- `rechazado_por` — del `req.user.userId` (token JWT).
- `rechazado_en` — `NOW()` de MySQL, en el mismo `UPDATE`.
- `isActive` — lo fija el repositorio en `0`.

### El `UPDATE`

```sql
UPDATE clientes
SET isActive = 0,
    motivo_rechazo = ?,
    rechazado_por = ?,
    rechazado_en = NOW()
WHERE id = ?;
```

No toca `nombre`, `rtn`, `producto_id`, `codigo_exportacion`, `correo_contacto`, `telefono`, `direccion_planta`, la ubicación, `created_by` ni `created_at`. Un cliente rechazado conserva todos sus datos originales; lo único que cambia es que deja de estar activo.

### Definición de "ya rechazado"

Un cliente está rechazado si `isActive = 0`. Una fila con `isActive = NULL` **no** se considera rechazada y sí se puede rechazar, aunque hoy tampoco aparezca en `GET /clientes` ni en `GET /clientes/all`. Es el mismo criterio que SPEC 10 fijó para `pesajes`, por la misma razón: deja el `motivo_rechazo` escrito en vez de fallar con un mensaje confuso.

### Petición y respuestas

Petición:

```
PATCH /clientes/7/rechazar
Authorization: Bearer <token>

{
  "motivo": "La empresa cerro operaciones de exportacion en agosto"
}
```

Respuesta (200):

```json
{
  "ok": true,
  "msg": "Cliente rechazado correctamente"
}
```

Errores, todos `400` con la forma estándar de Nest:

| Caso | Mensaje |
| --- | --- |
| El cliente no existe | `El cliente con id '7' no existe` |
| El cliente ya está rechazado | `El cliente con id '7' ya fue rechazado` |
| `motivo` ausente, corto o largo | El error de validación de Zod |
| `id` de ruta no numérico | El error de `ParseIntPipe` |

### Efecto observable en los endpoints existentes

Ninguno de estos endpoints se modifica en este spec. La tabla es el comportamiento resultante:

| Endpoint | Efecto sobre un cliente rechazado |
| --- | --- |
| `GET /clientes` | Desaparece: ya filtra `clientes.isActive = 1`. |
| `GET /clientes/all` | Desaparece: ya filtra `clientes.isActive = 1`. |
| `POST /lotes` | Falla con 400 `El cliente 'X' no esta activo`: `validateCliente` ya lo comprueba. |
| `GET /lotes/cliente/:clienteId` | **Sigue devolviendo los lotes.** No valida `clientes.isActive`. |
| `POST /pesajes` | **Sigue aceptando pesajes** contra los lotes abiertos de ese cliente. Valida lote y vínculo, no el cliente. |
| `POST /clientes` | Puede registrar un cliente nuevo con el **mismo RTN** y el mismo `codigo_exportacion`. |

Las tres últimas filas son las incoherencias asumidas por este spec y están en Risks.

---

## Implementation plan

1. Ejecutar a mano el `ALTER TABLE` de las tres columnas y el de la FK. Confirmar con `DESCRIBE clientes;` que las tres aparecen como nullables y con `SHOW CREATE TABLE clientes;` que la FK quedó creada. Confirmar que las filas existentes tienen las tres en `NULL` y que su `isActive` no cambió.
2. Agregar las tres claves a `ClientesTable` en `src/database/types/types.ts`. Confirmar que la app sigue compilando (`npm run build`): `POST /clientes` no las escribe, así que el insert existente sigue siendo válido.
3. Crear `src/modules/clientes/dto/rechazar-cliente.dto.ts` con `rechazarClienteSchema` (`motivo: z.string().min(5).max(255)`) y la clase `RechazarClienteDto extends createZodDto(...)`, siguiendo la forma de `rechazar-pesaje.dto.ts`.
4. Agregar el validador privado `validateClienteActivo(clienteId, db)` a `ClientesRepository`: `selectFrom('clientes').select(['id', 'nombre', 'isActive']).where('id', '=', clienteId)`, lanzando `BadRequestException` si no existe y otro si `isActive === 0`. Devuelve la fila.
5. Agregar `rechazarCliente(clienteId, dto, userId)` a `ClientesRepository`: abre `this.db.transaction().execute(...)`, llama a `validateClienteActivo`, y ejecuta el `updateTable('clientes').set({ isActive: 0, motivo_rechazo: motivo, rechazado_por: userId, rechazado_en: sql`NOW()` }).where('id', '=', clienteId)`. No llama a ningún validador de vínculo. Devuelve `true`. Importar `sql` de `kysely`.
6. Agregar `rechazar(clienteId, dto, userId)` a `ClientesService` como pass-through, igual en forma a `create`.
7. Agregar el handler `@Patch(':id/rechazar')` a `ClientesController` con `@Param('id', ParseIntPipe) id: number`, `@Body() dto: RechazarClienteDto` y `@Req() req: Request`. Lee `const { userId } = req.user as { userId: number }`. Responde `{ ok: true, msg: 'Cliente rechazado correctamente' }`. Sin `@Public()` y sin `@HttpCode`. Importar `Patch`, `Param` y `ParseIntPipe` de `@nestjs/common`.
8. Levantar con `npm run start:dev` y confirmar que compila y que `PATCH /clientes/:id/rechazar` aparece en el log de rutas de Nest, junto a `GET /clientes/all`, `GET /clientes` y `POST /clientes`.
9. Verificación manual del camino feliz: crear un cliente con `POST /clientes`, anotar su `id`, confirmar que aparece en `GET /clientes/all`, rechazarlo con un motivo válido, confirmar 200, confirmar en MySQL que la fila tiene `isActive = 0`, el motivo escrito, `rechazado_por` con el id del token y `rechazado_en` con la hora actual, y confirmar que ya **no** aparece en `GET /clientes/all` ni en `GET /clientes`.
10. Verificación manual del efecto en `lotes`: intentar `POST /lotes` con el `cliente_id` rechazado y confirmar 400 con `El cliente 'X' no esta activo`.
11. Verificación manual de los errores: rechazar el mismo cliente otra vez y confirmar 400 sin que el `motivo_rechazo` ni el `rechazado_en` originales cambien; rechazar un `id` inexistente y confirmar 400; mandar un `motivo` de tres caracteres y confirmar el error de Zod; llamar a `PATCH /clientes/abc/rechazar` y confirmar 400; llamar sin header `Authorization` y confirmar 401.
12. Verificación manual de la ausencia de control de acceso: login con un `Operador` **no** vinculado al cliente y confirmar que lo rechaza igual, con **200 y no 403**. Es el resultado esperado de este spec y el criterio que documenta que el vínculo no se valida.
13. Actualizar `CLAUDE.md`: agregar `PATCH /clientes/:id/rechazar` a la fila `clientes` de la tabla de endpoints; corregir la frase que afirma que `PATCH /pesajes/:id/rechazar` es el único `PATCH`, el único `UPDATE` y el único `:id` del proyecto; agregar este endpoint a la lista de rutas que se saltan `validateVinculoOperador`, que pasa de cuatro a cinco; anotar las tres columnas nuevas de `clientes` y su FK; anotar que el rechazo libera el RTN y el `codigo_exportacion`; y anotar que `GET /lotes/cliente/:clienteId` y `POST /pesajes` no validan `clientes.isActive`.

---

## Acceptance criteria

- [X] `DESCRIBE clientes;` muestra `motivo_rechazo VARCHAR(255)`, `rechazado_por INT` y `rechazado_en DATETIME`, las tres nullables.
- [X] `SHOW CREATE TABLE clientes;` muestra la FK de `rechazado_por` a `usuarios(id)`.
- [X] Las filas de `clientes` anteriores al DDL tienen las tres columnas en `NULL` y su `isActive` sin cambios.
- [X] `ClientesTable` en `src/database/types/types.ts` declara las tres columnas nuevas, ninguna como `Generated<>`.
- [X] La app arranca sin errores de compilación (`npm run start:dev`).
- [X] La tabla `permisos` sigue teniendo exactamente las 11 filas de SPEC 08: no se sembró ninguna fila nueva.
- [X] Existe `src/modules/clientes/dto/rechazar-cliente.dto.ts` y su schema tiene exactamente un campo, `motivo`.
- [X] `PATCH /clientes/:id/rechazar` aparece en el log de rutas de Nest al arrancar.
- [X] `src/app.module.ts` no cambió: `ClientesModule` ya estaba registrado.
- [X] No se creó ningún módulo, controller ni service nuevo: solo se modificaron `clientes.controller.ts`, `clientes.service.ts` y `repository/clientes.repository.ts`, y se agregó un DTO.
- [X] Rechazar un cliente activo con un motivo válido responde 200 con exactamente `{ ok: true, msg: 'Cliente rechazado correctamente' }`.
- [X] La respuesta **no** incluye ninguna clave de recurso: no hay `cliente`, ni `data`, ni el motivo devuelto.
- [X] Después del rechazo, la fila tiene `isActive = 0`.
- [X] Después del rechazo, `motivo_rechazo` contiene exactamente el texto enviado en el body.
- [X] Después del rechazo, `rechazado_por` es el `userId` del token que llamó, no el `created_by` del cliente.
- [X] Después del rechazo, `rechazado_en` tiene la fecha y hora del rechazo, no `NULL`.
- [X] El rechazo **no** modifica `nombre`, `rtn`, `producto_id`, `codigo_exportacion`, `correo_contacto`, `telefono`, `direccion_planta`, `ubicacionLongitud`, `ubicacionLatitude`, `created_by` ni `created_at` de la fila.
- [X] Un cliente rechazado desaparece de `GET /clientes/all`, y el resto de los clientes sigue apareciendo igual.
- [X] Un cliente rechazado desaparece de `GET /clientes` para todos los usuarios vinculados a él.
- [X] `POST /lotes` con el `cliente_id` de un cliente rechazado responde 400 con `El cliente 'X' no esta activo`.
- [X] Rechazar un `id` que no existe responde 400 con `El cliente con id 'X' no existe`, no 404 y no 500.
- [X] Rechazar un cliente que ya tiene `isActive = 0` responde 400 con `El cliente con id 'X' ya fue rechazado`.
- [X] Tras ese 400, el `motivo_rechazo`, el `rechazado_por` y el `rechazado_en` del primer rechazo quedan intactos: el segundo intento no sobrescribe nada.
- [X] Un `motivo` de menos de 5 caracteres responde 400 por validación de Zod y no modifica la fila.
- [X] Un `motivo` de más de 255 caracteres responde 400 por validación de Zod y no modifica la fila.
- [X] Un body sin `motivo` responde 400 por validación de Zod.
- [ ] Un `id` de ruta no numérico (`PATCH /clientes/abc/rechazar`) responde 400 por `ParseIntPipe`.
- [X] `PATCH /clientes/:id/rechazar` sin header `Authorization` responde 401: el endpoint no es `@Public()`.
- [X] `PATCH /clientes/:id/rechazar` con un token expirado o firmado con otro secreto responde 401.
- [X] Un `Operador` **sin** fila en `cliente_operador` para ese cliente lo rechaza igual: responde **200, no 403**. **Este spec no valida el vínculo.**
- [X] Un usuario que no creó el cliente puede rechazarlo: no se compara contra `clientes.created_by`.
- [X] Cuando cualquier validación falla, ninguna columna de la fila cambia: la transacción no deja escrituras parciales.
- [X] Las filas de `cliente_operador` del cliente rechazado siguen existiendo, con el mismo conteo que antes del rechazo.
- [X] Los lotes del cliente rechazado no cambian: mismo `estado`, mismo `cerrado_en`, y siguen apareciendo en `GET /lotes/cliente/:clienteId`.
- [X] Los pesajes de esos lotes no cambian: ninguno queda con `isActive = 0` por efecto de este rechazo.
- [X] Después de rechazar un cliente, `POST /clientes` acepta un cliente nuevo con el mismo `rtn` y el mismo `codigo_exportacion`. **Es el comportamiento esperado y este spec no lo cambia.**
- [X] `GET /clientes`, `GET /clientes/all` y `POST /clientes` no cambiaron: mismos campos, mismos filtros, mismo orden, misma forma de respuesta.
- [X] `GET /permisos/me` responde exactamente igual que antes de este spec: siete códigos para `Admin` y cuatro para `Operador`, ninguno de rechazo de clientes.
- [X] No existe ningún endpoint para deshacer un rechazo ni para listar clientes rechazados.
- [X] El payload del JWT no cambió y `req.user` sigue siendo `{ userId, username }`.
- [X] `POST /lotes`, `GET /lotes/cliente/:clienteId` (SPEC 02), `POST /pesajes` (SPEC 03, SPEC 04), `PATCH /pesajes/:id/rechazar`, `GET /pesajes/byLote/:loteId` (SPEC 10), `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh` (SPEC 05), `GET /permisos/me` (SPEC 07) y los tres `GET /catalogos/*` (SPEC 09) siguen funcionando igual.
- [X] `CLAUDE.md` lista `PATCH /clientes/:id/rechazar` en la tabla de endpoints y ya no afirma que `PATCH /pesajes/:id/rechazar` es el único `PATCH`, el único `UPDATE` ni el único `:id` del proyecto.

---

## Decisions

- **Sí:** "rechazar" significa **baja lógica del cliente** con `isActive = 0`. Decisión explícita del usuario. La columna ya existe, los dos listados ya la filtran y `LotesRepository.validateCliente` ya la comprueba: el mecanismo estaba a medio construir desde SPEC 01 y este spec lo termina.
- **No:** un flujo de aprobación con una columna `clientes.estado` de valores `pendiente` / `aprobado` / `rechazado`. Se descarta: obligaría a que `POST /clientes` dejara de crear clientes usables de inmediato, y a que `GET /clientes`, `GET /clientes/all` y `validateCliente` filtraran por el estado nuevo. Toca SPEC 01 y SPEC 08 y es un spec bastante más grande.
- **No:** interpretar "rechazar cliente" como desvincular operadores (`cliente_operador`). Se descarta: es la gestión de vínculos que SPEC 01 dejó fuera de alcance y no tiene nada que ver con el cliente en sí.
- **Sí:** `PATCH /clientes/:id/rechazar`. Decisión explícita del usuario. Copia literal del precedente que SPEC 10 fijó con `PATCH /pesajes/:id/rechazar`. No choca con `@Get('all')` porque el verbo es distinto.
- **No:** `PATCH /clientes/:id/desactivar`, que describiría mejor lo que técnicamente hace. Se descarta: se aparta de la palabra que el proyecto ya usa para esta operación y del pedido original.
- **No:** `DELETE /clientes/:id`. Se mantiene la decisión de SPEC 10: `DELETE` con body es ambiguo en HTTP y varios clientes lo descartan, y el motivo va en el body. Además sugiere borrado físico cuando es baja lógica.
- **Sí:** el `id` va en la ruta, no en el body. Es el recurso que se está modificando.
- **Sí:** DDL con tres columnas nuevas — `motivo_rechazo`, `rechazado_por`, `rechazado_en`. Decisión explícita del usuario. Sin esto, dar de baja a un cliente sería una operación destructiva sin rastro de quién la hizo ni por qué, y el proyecto no tiene migraciones para agregarlo después sin dolor.
- **No:** solo `isActive = 0`, sin DDL. Se descarta pese a ser el alcance mínimo y de cero riesgo de ambiente desincronizado, por la razón anterior.
- **No:** solo la columna del motivo, sin usuario ni fecha. Se descarta: saber por qué se dio de baja sin saber quién ni cuándo deja la auditoría a medias. Es la misma decisión de SPEC 10.
- **Sí:** los nombres son exactamente los tres de SPEC 10. Es la misma operación sobre otra tabla, y el rastro debe leerse igual en las dos.
- **Sí:** FK real de `rechazado_por` a `usuarios(id)`. Decisión explícita del usuario. Es la tercera excepción del proyecto a la regla de validar solo en código, y se justifica igual que la de `pesajes`: es un dato de auditoría y una fila huérfana lo dejaría sin valor probatorio.
- **No:** agregarle también la FK a `clientes.created_by`, que sigue sin ella. Se descarta: queda la misma inconsistencia intratabla que SPEC 10 dejó en `pesajes`, y unificarla es su propio spec.
- **Sí:** las tres columnas son nullables. Las filas existentes no tienen valor y no se van a rellenar.
- **Sí:** `motivo` obligatorio, entre 5 y 255 caracteres. Decisión explícita del usuario. Mismo DTO en contenido que `rechazar-pesaje.dto.ts`. Si se agrega la columna para auditar, permitirla vacía la dejaría inútil.
- **No:** `motivo` opcional, y **no:** sin body. Se descartan por la decisión anterior.
- **Sí:** el motivo es texto libre. Un catálogo de motivos sería otra tabla, otro endpoint de catálogo y otro spec.
- **Sí:** 400 al rechazar un cliente ya rechazado. Decisión explícita del usuario. Protege el rastro: el motivo y la fecha del primer rechazo no se sobrescriben.
- **No:** idempotente con 200 y sin cambios. Se descarta: sería más amable con los reintentos de red, pero la app no distinguiría entre "lo rechacé yo" y "ya estaba rechazado".
- **Sí:** `isActive = 0` es la definición de "rechazado". Una fila con `isActive = NULL` no se considera rechazada y sí se puede rechazar. Mismo criterio de SPEC 10.
- **Sí:** `BadRequestException` (400) cuando el cliente no existe. Es lo que ya hacen `validateProducto` en este mismo archivo y `validateCliente` en `LotesRepository`, y la coherencia dentro del proyecto pesa más aquí.
- **No:** `NotFoundException` (404), que sería lo natural para un `:id` de ruta. Se descarta por la decisión anterior, igual que en SPEC 10. El proyecto sigue con los dos criterios conviviendo y unificarlos es su propio spec.
- **Sí:** cualquier usuario autenticado puede rechazar cualquier cliente, sin `validateVinculoOperador`. Decisión explícita del usuario, tomada después de que se le presentara la alternativa y se le señalara que esto es **más grave** que la excepción de SPEC 10: allí se anulaba una fila de pesaje, aquí desaparece un cliente completo de los dos listados y se bloquea la creación de lotes contra él. Se registra en Risks sin adornos.
- **No:** exigir el vínculo `cliente_operador` con 403, que es la convención de acceso declarada del proyecto. Se descarta. Se anota la consecuencia que motivó la duda: hoy nada discrimina por rol, así que exigir el vínculo habría dejado a un `Admin` sin filas en `cliente_operador` sin poder rechazar ningún cliente.
- **No:** verificar el permiso a mano dentro del repositorio con un `validatePermiso(...)`. Se mantiene la decisión de SPEC 08: inventaría un mecanismo paralelo al `PermissionsGuard` futuro.
- **No:** exigir que quien rechaza sea quien creó el cliente (`clientes.created_by`). Se descarta por la misma razón que SPEC 10 descartó comparar contra `pesajes.usuario_id`: bloquearía al supervisor que corrige el registro de otro.
- **Sí:** ninguna fila nueva en `permisos`. Decisión explícita del usuario. La tabla sigue en 11 filas. Es la cuarta excepción a la regla de SPEC 06, después de `GET /permisos/me`, los catálogos de SPEC 09 y el rechazo de pesajes de SPEC 10.
- **No:** sembrar `clientes.rechazar` para `Admin` (una fila, tabla en 12), que es lo que la convención pide y lo que habría recuperado la regla que SPEC 09 y 10 rompieron. Se descarta. Consecuencia asumida: el `PermissionsGuard` futuro va a encontrar **dos** operaciones destructivas sin código de permiso que exigir, y tendrá que inventar los dos.
- **No:** sembrarlo para `Admin` y `Operador` (dos filas, tabla en 13). Se descarta por la decisión anterior.
- **Sí:** sin cascada. Decisión explícita del usuario. Los lotes abiertos siguen abiertos, sus pesajes intactos y los vínculos `cliente_operador` sin tocar.
- **No:** bloquear el rechazo si el cliente tiene lotes abiertos. Se descarta: hoy nada puede cerrar un lote (`lotes.cerrado_en` no lo escribe ningún endpoint), así que un cliente con un lote abierto quedaría imposible de rechazar para siempre.
- **No:** cerrar en cascada los lotes abiertos del cliente. Se descarta: implicaría implementar el cierre de lote, que todos los specs anteriores dejaron fuera de alcance. Sería un spec de dos features.
- **No:** borrar las filas de `cliente_operador` del cliente. Se descarta: sería el primer borrado físico del proyecto y perdería información que no se puede reconstruir.
- **Sí:** el rechazo libera el `rtn` y el `codigo_exportacion` para que otro cliente los use. Decisión explícita del usuario, tomada después de que se le señalara el efecto. `validateRtnDisponible` y `validateCodigoExportacionDisponible` filtran `isActive = 1` desde el commit `c60e9dc`, y ese comportamiento se mantiene.
- **No:** quitar el filtro `isActive = 1` de esos dos validadores para que un RTN rechazado siga ocupado. Se descarta: cambiaría el contrato de `POST /clientes` dentro de este spec y revertiría una decisión reciente. Consecuencia asumida: la tabla `clientes` puede terminar con dos filas del mismo RTN, una activa y una rechazada.
- **Sí:** el rechazo es irreversible. Decisión explícita del usuario. La fila no se borra, así que el dato se puede recuperar por SQL a mano si hace falta.
- **No:** un endpoint de reactivación que devuelva `isActive = 1`. Se descarta: duplica el trabajo y abre la pregunta de qué pasa con el rastro del rechazo anterior. Va en su propio spec, junto con el resto de la administración de clientes.
- **Sí:** la respuesta es solo `{ ok, msg }`. Decisión explícita del usuario. Es el segundo endpoint del proyecto que no devuelve nada del recurso que tocó, y coincide con el otro endpoint de rechazo, que es el que más se le parece.
- **No:** `{ ok, msg, cliente: { id, nombre, rechazado_en } }`, que habría vuelto a la convención de payload con clave nombrada del resto del proyecto. Se descarta por la decisión anterior: dejaría los dos endpoints de rechazo con formas distintas.
- **Sí:** el `UPDATE` y su validación van dentro de una transacción, con el validador recibiendo el `trx`. Es la convención de escritura del proyecto y se mantiene aunque aquí solo haya una sentencia de escritura.
- **Sí:** `rechazado_en` se escribe con `NOW()` de MySQL, no con un `new Date()` de Node. Se mantiene la decisión de SPEC 10: es la misma fuente de hora que `created_at`, así que las dos fechas de la misma fila son comparables sin depender de la zona horaria del proceso de Node.
- **Sí:** todo va en el módulo `clientes` existente. Es la misma tabla y el mismo dominio.
- **Sí:** `GET /clientes` y `GET /clientes/all` no cambian. Su filtro `isActive = 1` ya hace que un cliente rechazado desaparezca de los dos, que es el efecto buscado, sin escribir una línea.
- **No:** un query param `?incluirRechazados=true`. Se mantiene la decisión de SPEC 10: exigiría el primer DTO Zod de query del proyecto y una segunda forma de respuesta que mantener.
- **No:** rechazo en lote (varios ids en una llamada). Se descarta: abre la pregunta de qué pasa si uno de los ids falla, y hoy no hay un caso que lo pida.
- **No:** borrado físico. Se descarta: perdería la fila y con ella la auditoría, que es lo que este spec construye. Además `lotes.cliente_id` y `cliente_operador.cliente_id` apuntan a ella.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **Cualquier usuario autenticado puede rechazar cualquier cliente**, incluido un `Operador` sin ninguna fila en `cliente_operador` para ese cliente. Es la segunda escritura abierta del proyecto y de mayor impacto que la de SPEC 10: el cliente desaparece de los dos listados y `POST /lotes` deja de aceptarlo. | **Sin mitigar por diseño**, por decisión explícita del usuario tomada con la consecuencia sobre la mesa. Es el riesgo principal de este spec. Hay dos criterios de aceptación que lo verifican y lo dejan registrado como comportamiento esperado. La mitigación real es el spec del `PermissionsGuard`, más el `validateVinculoOperador` que este endpoint decidió no llamar. |
| Al no sembrar ninguna fila en `permisos`, el `PermissionsGuard` futuro se encuentra con **dos** operaciones destructivas sin código de permiso — esta y la de SPEC 10 — y sin saber si fue decisión o descuido. | Queda registrado aquí, en tres decisiones y en `CLAUDE.md`. El paso 13 del plan lo incluye. La regla de SPEC 06 lleva tres specs seguidos sin cumplirse. |
| `ClientesRepository` queda con dos criterios de acceso: `createCliente` no valida vínculo porque crea, y `rechazarCliente` tampoco lo valida aunque destruye. Nada en el módulo `clientes` valida `cliente_operador` en el camino de escritura. | Sin mitigar en el código. Está en Decisions con la consecuencia escrita y en la nota de `CLAUDE.md` del paso 13, donde la lista de rutas que se saltan la convención pasa de cuatro a cinco. |
| `GET /lotes/cliente/:clienteId` **sigue devolviendo los lotes de un cliente rechazado**: no valida `clientes.isActive`. La app puede mostrar lotes de un cliente que ya no aparece en ningún listado de clientes. | Sin mitigar por decisión explícita (sin cascada). Hay un criterio de aceptación que lo verifica como comportamiento esperado. Corregirlo es un cambio a un endpoint de SPEC 02 y va en su propio spec. |
| `POST /pesajes` **sigue aceptando pesajes** contra los lotes abiertos de un cliente rechazado: valida el lote y el vínculo, no el cliente. Se pueden seguir generando datos para un cliente dado de baja. | Sin mitigar por decisión explícita. Es la consecuencia más incómoda de no tener cascada y de que nada pueda cerrar un lote todavía. Queda anotada en `CLAUDE.md` en el paso 13. |
| El rechazo libera el `rtn` y el `codigo_exportacion`, así que la tabla `clientes` puede terminar con dos filas del mismo RTN: una activa y una rechazada. | Asumido por decisión explícita. No hay constraint de MySQL que lo impida (la unicidad es solo de código, por decisión de SPEC 01), y ningún endpoint expone el `rtn`, así que la colisión no es visible por API. |
| El rechazo es irreversible y no hay endpoint para deshacerlo: un rechazo por error deja al cliente inaccesible por API para siempre, y con él la creación de lotes nuevos. | Parcialmente mitigado: la fila no se borra, así que se puede reactivar por SQL a mano. El motivo obligatorio y el `rechazado_por` reducen los rechazos accidentales al obligar a escribir algo. |
| Un cliente rechazado desaparece de los dos listados y no hay ningún endpoint que lo liste, así que la app no puede mostrar qué se dio de baja ni por qué. | Sin mitigar por decisión explícita. Las tres columnas quedan escritas en la base desde el día uno, así que cuando llegue el endpoint de lectura el dato histórico ya existe. |
| El DDL se aplica en un ambiente y no en otro, y el `UPDATE` falla por columna inexistente. Es el riesgo heredado de no tener migraciones. | Sin mitigación automática. El paso 1 del plan verifica con `DESCRIBE clientes;` y `SHOW CREATE TABLE clientes;`. El DDL queda escrito en este spec, que es la única fuente. |
| Se agrega `GET /clientes/:id` en el futuro y alguien lo declara antes de `@Get('all')`, rompiendo `GET /clientes/all`. | No lo introduce este spec: `PATCH` y `GET` son verbos distintos y el segmento `rechazar` desambigua. Se repite el aviso que SPEC 08 ya dejó, porque este spec agrega el primer `:id` al controller de `clientes` y hace la confusión más probable. |
| Alguien lee "rechazar cliente" y asume que existe un flujo de aprobación de clientes. | Está en el objetivo, en la sección de por qué existe el spec, en dos decisiones y en la lista de lo que no está. No se agrega ninguna columna de estado, así que el esquema no da pie a la confusión. |

---

## What is **not** in this spec

- Cualquier flujo de aprobación de clientes: no existe `clientes.estado` ni los valores `pendiente` / `aprobado` / `rechazado`.
- Deshacer un rechazo: no hay endpoint de reactivación.
- Rechazo en lote de varios clientes en una llamada.
- Cascada sobre `lotes`, `pesajes` o `cliente_operador`.
- Cambios a `POST /clientes`, `GET /clientes`, `GET /clientes/all`, `POST /lotes`, `GET /lotes/cliente/:clienteId` y `POST /pesajes`.
- Bloquear la reutilización del `rtn` y del `codigo_exportacion` de un cliente rechazado.
- Sembrar filas en `permisos`: la tabla sigue con las 11 filas de SPEC 08.
- Aplicar permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`.
- Validar el vínculo `cliente_operador`, ni exigir que quien rechaza sea quien creó el cliente.
- Un endpoint para listar clientes rechazados, y cualquier query param para incluirlos.
- Devolver `motivo_rechazo`, `rechazado_por` o `rechazado_en` en algún endpoint de lectura.
- Borrado físico de clientes.
- Editar un cliente, y `GET /clientes/:id`.
- Un catálogo de motivos de rechazo.
- Baja lógica en `lotes`, `usuarios` o cualquier otra tabla.
- Cierre de lote: nada puede escribir `lotes.cerrado_en`.

Cada uno de estos, si se necesita, va en su propio spec.
