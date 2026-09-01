# SPEC 10 — Rechazo de pesajes

> **Status:** Implemented
> **Depends on:** SPEC 02, SPEC 03
> **Date:** 2026-09-01
> **Objective:** Agregar `PATCH /pesajes/:id/rechazar`, que anula un pesaje mal capturado poniendo `isActive = 0` y guardando el motivo, el usuario y la fecha del rechazo en tres columnas nuevas de `pesajes`.

---

## Why this spec exists

Un pesaje se captura mal. La tara quedó equivocada, la báscula dio doble lectura, el operador tocó guardar dos veces. Hoy no hay forma de sacar esa fila de la cuenta del lote: `POST /pesajes` inserta y nada más, y no existe ningún `UPDATE` ni `DELETE` en todo el proyecto.

La columna `pesajes.isActive` ya existe en el esquema y hoy **nadie la escribe**: `createPesaje` la deja con el `DEFAULT` de MySQL. `getPesajesByLote` ya filtra `isActive = 1`. O sea que el mecanismo de baja lógica está a medio construir desde SPEC 03 y este spec lo termina.

Hay que ser explícito con tres cosas.

**La primera: este spec no toca el estado de calidad.** "Rechazar" aquí significa **anular la fila**, no marcar el producto como `RECHAZADO`. Los estados del diagrama (`APROBADO` / `APROBADO CON EXCEPCIÓN` / `RECHAZADO`) siguen fuera del esquema y fuera de alcance, igual que en SPEC 04. Un pesaje rechazado por este endpoint conserva intacto su `estado_calidad_id` derivado (`IDEAL`, `MAXIMO` o `MINIMO`): simplemente deja de contar.

**La segunda: es la primera operación de escritura del proyecto abierta a cualquier usuario autenticado.** Por decisión explícita, `PATCH /pesajes/:id/rechazar` **no** llama a `validateVinculoOperador`. SPEC 08 y SPEC 09 ya habían abierto rutas sin filtro de vínculo, pero ambas eran lecturas. Esta es destructiva: un `Operador` sin ninguna fila en `cliente_operador` puede anular el pesaje de un cliente que no le corresponde. Se asume y se registra en Risks.

**La tercera: es el primer `UPDATE`, el primer `PATCH` y el primer parámetro `:id` del proyecto.** Las tres cosas son precedentes que los specs siguientes van a copiar.

Este spec también documenta `GET /pesajes/byLote/:loteId`, que existe en el código desde SPEC 03 pero nunca se anotó en `CLAUDE.md` — la tabla de endpoints todavía afirma que no hay ningún `GET` de pesajes. No se cambia, solo se registra, porque su filtro `isActive = 1` es lo que hace que el rechazo tenga efecto visible.

---

## Scope

**In:**

- DDL a mano en MySQL: tres columnas nuevas y nullables en `pesajes` — `motivo_rechazo`, `rechazado_por` y `rechazado_en` — más una FK de `rechazado_por` a `usuarios(id)`.
- Actualizar `PesajesTable` en `src/database/types/types.ts` con las tres columnas.
- Nuevo DTO `src/modules/pesajes/dto/rechazar-pesaje.dto.ts` con un único campo `motivo`, obligatorio, entre 5 y 255 caracteres.
- Nuevo método `rechazarPesaje(pesajeId, dto, userId)` en `src/modules/pesajes/repository/pesajes.repository.ts`, dentro de una transacción.
- Dos validadores privados nuevos en el mismo repositorio: `validatePesajeActivo(pesajeId, db)` y la reutilización de `validateLoteAbierto(loteId, db)`, que ya existe.
- Nuevo método `rechazar(pesajeId, dto, userId)` en `src/modules/pesajes/pesajes.service.ts`, pass-through al repositorio.
- Nuevo handler `@Patch(':id/rechazar')` en `src/modules/pesajes/pesajes.controller.ts`, con `@Param('id', ParseIntPipe)`.
- Nuevo endpoint `PATCH /pesajes/:id/rechazar`, protegido únicamente por el `JwtAuthGuard` global (no lleva `@Public()`).
- El `UPDATE` escribe exactamente cuatro columnas: `isActive = 0`, `motivo_rechazo`, `rechazado_por` (del `req.user.userId`) y `rechazado_en` (`NOW()` de MySQL).
- Respuesta `200` con la forma `{ ok, msg }`, sin payload de recurso.
- `400` si el pesaje no existe, si ya está rechazado, o si su lote no está abierto.
- Actualizar `CLAUDE.md`: fila `pesajes` de la tabla de endpoints con el endpoint nuevo **y** con `GET /pesajes/byLote/:loteId`, que hoy falta; nota de que es el primer `UPDATE`/`PATCH`/`:id` del proyecto; nota de que es la primera escritura sin `validateVinculoOperador`.

**Out of scope (for future specs):**

- Marcar el estado de calidad como `RECHAZADO`. Los estados del diagrama siguen sin existir en `estados_calidad`, igual que decidió SPEC 04.
- Cualquier cambio a `estado_calidad_id`: el pesaje rechazado conserva la banda que SPEC 04 derivó de su peso.
- Deshacer un rechazo. No hay endpoint de reactivación y no lo habrá en este spec.
- Rechazar en lote (varios `pesaje_id` en una sola llamada).
- Sembrar filas en `permisos`. Se decidió explícitamente no hacerlo (ver Decisions). La tabla sigue con las 11 filas de SPEC 08.
- **Aplicar** permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`.
- Validar el vínculo `cliente_operador`. Decisión explícita: cualquier usuario autenticado puede rechazar cualquier pesaje.
- Exigir que quien rechaza sea el autor del pesaje (`pesajes.usuario_id`).
- Cambios a `POST /pesajes`, que sigue sin escribir `isActive` y sin conocer las columnas nuevas.
- Cambios a `GET /pesajes/byLote/:loteId`: mantiene su filtro `isActive = 1`, sus campos y su orden. Los pesajes rechazados desaparecen de ese listado y no se pueden volver a consultar por API.
- Un endpoint para listar pesajes rechazados, y cualquier query param del estilo `?incluirRechazados=true`.
- Devolver `motivo_rechazo`, `rechazado_por` o `rechazado_en` en cualquier endpoint de lectura.
- Borrado físico (`DELETE FROM pesajes`).
- Editar un pesaje (corregir `peso_bruto` o `tara` en vez de anularlo).
- Recalcular agregados del lote al rechazar. No existen agregados todavía.
- Cierre de lote: nada puede escribir `lotes.cerrado_en` ni cambiar `lotes.estado`, igual que antes de este spec.
- Un catálogo de motivos de rechazo. El motivo es texto libre.
- Baja lógica en cualquier otra tabla (`clientes`, `lotes`, `usuarios`).

---

## Data model

### DDL (ejecutar a mano en MySQL)

Es el primer spec desde SPEC 03 que ejecuta DDL. Las tres columnas son nullables porque las filas existentes no tienen valor y no se van a rellenar:

```sql
ALTER TABLE pesajes
  ADD COLUMN motivo_rechazo VARCHAR(255) NULL AFTER fuera_de_rango,
  ADD COLUMN rechazado_por INT NULL AFTER motivo_rechazo,
  ADD COLUMN rechazado_en DATETIME NULL AFTER rechazado_por;

ALTER TABLE pesajes
  ADD CONSTRAINT fk_pesajes_rechazado_por
  FOREIGN KEY (rechazado_por) REFERENCES usuarios(id);
```

La FK es una excepción consciente a la regla del proyecto de validar solo en código, igual que la que `permisos` tiene a `roles`. Aquí se justifica distinto: `rechazado_por` es un dato de auditoría y una fila huérfana lo dejaría sin valor probatorio.

Nótese que `pesajes.usuario_id` **no** tiene FK hoy y este spec no se la agrega. La inconsistencia queda registrada a propósito.

### Cambio en `src/database/types/types.ts`

`PesajesTable` gana tres claves al final:

```ts
export interface PesajesTable {
  // ...campos existentes sin cambios...
  fuera_de_rango: boolean | null;
  motivo_rechazo: string | null;
  rechazado_por: number | null;
  rechazado_en: Date | string | null;
}
```

Ninguna es `Generated<>`: las tres las escribe la aplicación, no MySQL, y ninguna tiene `DEFAULT`.

### DTO (`src/modules/pesajes/dto/rechazar-pesaje.dto.ts`)

- `motivo: string` — requerido, `.min(5)`, `.max(255)`.

Es el segundo DTO del módulo, junto a `create-pesaje.dto.ts`, y sigue la misma forma: schema Zod envuelto con `createZodDto()`.

El `id` del pesaje **no** va en el body: viene en la ruta y se convierte con `ParseIntPipe`.

Campos que **no** vienen del body:

- `rechazado_por` — del `req.user.userId` (token JWT).
- `rechazado_en` — `NOW()` de MySQL, en el mismo `UPDATE`.
- `isActive` — lo fija el repositorio en `0`.

### El `UPDATE`

```sql
UPDATE pesajes
SET isActive = 0,
    motivo_rechazo = ?,
    rechazado_por = ?,
    rechazado_en = NOW()
WHERE id = ?;
```

No toca `estado_calidad_id`, `peso_bruto`, `tara`, `peso_neto` ni `fuera_de_rango`. Un pesaje rechazado conserva todos sus datos originales; lo único que cambia es que deja de estar activo.

### Definición de "ya rechazado"

Un pesaje está rechazado si `isActive = 0`. Una fila con `isActive = NULL` **no** se considera rechazada y sí se puede rechazar, aunque hoy tampoco aparezca en `getPesajesByLote`. Es un caso que no debería existir (la columna tiene `DEFAULT`), y el criterio elegido es el que deja el `motivo_rechazo` escrito en vez de fallar con un mensaje confuso.

### Petición y respuestas

Petición:

```
PATCH /pesajes/148/rechazar
Authorization: Bearer <token>

{
  "motivo": "Doble lectura de la bascula, el peso ya se registro en el pesaje 147"
}
```

Respuesta (200):

```json
{
  "ok": true,
  "msg": "Pesaje rechazado correctamente"
}
```

Errores, todos `400` con la forma estándar de Nest:

| Caso | Mensaje |
| --- | --- |
| El pesaje no existe | `El pesaje con id '148' no existe` |
| El pesaje ya está rechazado | `El pesaje con id '148' ya fue rechazado` |
| El pesaje no tiene lote (`lote_id` NULL) | `El pesaje con id '148' no tiene un lote asociado` |
| El lote no existe | `El lote con id '9' no existe` |
| El lote no está abierto | `El lote 'LOTE-001' no esta abierto` |
| `motivo` ausente, corto o largo | El error de validación de Zod |

Los dos últimos mensajes de lote son los que ya lanza `validateLoteAbierto` y no se cambian.

---

## Implementation plan

1. Ejecutar a mano el `ALTER TABLE` de las tres columnas y el de la FK. Confirmar con `DESCRIBE pesajes;` que las tres aparecen como nullables y con `SHOW CREATE TABLE pesajes;` que la FK quedó creada. Confirmar que las filas existentes tienen las tres en `NULL` y que su `isActive` no cambió.
2. Agregar las tres claves a `PesajesTable` en `src/database/types/types.ts`. Confirmar que la app sigue compilando (`npm run build`): `POST /pesajes` no las escribe, así que el insert existente sigue siendo válido.
3. Crear `src/modules/pesajes/dto/rechazar-pesaje.dto.ts` con `rechazarPesajeSchema` (`motivo: z.string().min(5).max(255)`) y la clase `RechazarPesajeDto extends createZodDto(...)`, siguiendo la forma de `create-pesaje.dto.ts`.
4. Agregar el validador privado `validatePesajeActivo(pesajeId, db)` a `PesajesRepository`: `selectFrom('pesajes').select(['id', 'lote_id', 'isActive']).where('id', '=', pesajeId)`, lanzando `BadRequestException` si no existe y otro si `isActive === 0`. Devuelve la fila.
5. Agregar `rechazarPesaje(pesajeId, dto, userId)` a `PesajesRepository`: abre `this.db.transaction().execute(...)`, llama a `validatePesajeActivo`, lanza `BadRequestException` si el `lote_id` es `null`, llama a `validateLoteAbierto(lote_id, trx)` — que ya existe y no se modifica —, y ejecuta el `updateTable('pesajes').set({ isActive: 0, motivo_rechazo: motivo, rechazado_por: userId, rechazado_en: sql\`NOW()\` }).where('id', '=', pesajeId)`. No llama a `validateVinculoOperador`. Devuelve `true`.
6. Agregar `rechazar(pesajeId, dto, userId)` a `PesajesService` como pass-through, igual en forma a `create`.
7. Agregar el handler `@Patch(':id/rechazar')` a `PesajesController` con `@Param('id', ParseIntPipe) id: number`, `@Body() dto: RechazarPesajeDto` y `@Req() req: Request`. Lee `const { userId } = req.user as { userId: number }`. Responde `{ ok: true, msg: 'Pesaje rechazado correctamente' }`. Sin `@Public()`. Importar `Patch` de `@nestjs/common`.
8. Levantar con `npm run start:dev` y confirmar que compila y que `PATCH /pesajes/:id/rechazar` aparece en el log de rutas de Nest, junto a `POST /pesajes` y `GET /pesajes/byLote/:loteId`.
9. Verificación manual del camino feliz: guardar un pesaje con `POST /pesajes`, anotar su `id`, confirmar que aparece en `GET /pesajes/byLote/:loteId`, rechazarlo con un motivo válido, confirmar 200, confirmar en MySQL que la fila tiene `isActive = 0`, el motivo escrito, `rechazado_por` con el id del token y `rechazado_en` con la hora actual, y confirmar que ya **no** aparece en `GET /pesajes/byLote/:loteId`.
10. Verificación manual de los errores: rechazar el mismo pesaje otra vez y confirmar 400 sin que el `motivo_rechazo` ni el `rechazado_en` originales cambien; rechazar un `id` inexistente y confirmar 400; mandar un `motivo` de tres caracteres y confirmar el error de Zod; llamar sin header `Authorization` y confirmar 401.
11. Verificación manual de la ausencia de control de acceso: login con un `Operador` **no** vinculado al cliente del lote y confirmar que rechaza el pesaje igual, con **200 y no 403**. Es el resultado esperado de este spec y el criterio que documenta que el vínculo no se valida.
12. Actualizar `CLAUDE.md`: en la tabla de endpoints, agregar a la fila `pesajes` tanto `PATCH /pesajes/:id/rechazar` como `GET /pesajes/byLote/:loteId`, que hoy falta; corregir la frase que afirma que no existe ningún `PUT`/`PATCH`/`DELETE` ni ningún `GET /pesajes/*`; anotar que es el primer `UPDATE` del proyecto y que la convención de acceso por `cliente_operador` se saltó a propósito aquí; anotar las tres columnas nuevas de `pesajes` y su FK; y dejar claro que este rechazo es baja lógica, no el estado `RECHAZADO` del diagrama.

---

## Acceptance criteria

- [ ] `DESCRIBE pesajes;` muestra `motivo_rechazo VARCHAR(255)`, `rechazado_por INT` y `rechazado_en DATETIME`, las tres nullables.
- [ ] `SHOW CREATE TABLE pesajes;` muestra la FK de `rechazado_por` a `usuarios(id)`.
- [ ] Las filas de `pesajes` anteriores al DDL tienen las tres columnas en `NULL` y su `isActive` sin cambios.
- [ ] `PesajesTable` en `src/database/types/types.ts` declara las tres columnas nuevas, ninguna como `Generated<>`.
- [ ] La app arranca sin errores de compilación (`npm run start:dev`).
- [ ] La tabla `permisos` sigue teniendo exactamente las 11 filas de SPEC 08: no se sembró ninguna fila nueva.
- [ ] Existe `src/modules/pesajes/dto/rechazar-pesaje.dto.ts` y su schema tiene exactamente un campo, `motivo`.
- [ ] `PATCH /pesajes/:id/rechazar` aparece en el log de rutas de Nest al arrancar.
- [ ] `src/app.module.ts` no cambió: `PesajesModule` ya estaba registrado.
- [ ] No se creó ningún módulo, controller ni service nuevo: solo se modificaron `pesajes.controller.ts`, `pesajes.service.ts` y `repository/pesajes.repository.ts`, y se agregó un DTO.
- [ ] Rechazar un pesaje activo con un motivo válido responde 200 con exactamente `{ ok: true, msg: 'Pesaje rechazado correctamente' }`.
- [ ] La respuesta **no** incluye ninguna clave de recurso: no hay `pesaje`, ni `data`, ni el motivo devuelto.
- [ ] Después del rechazo, la fila tiene `isActive = 0`.
- [ ] Después del rechazo, `motivo_rechazo` contiene exactamente el texto enviado en el body.
- [ ] Después del rechazo, `rechazado_por` es el `userId` del token que llamó, no el `usuario_id` que creó el pesaje.
- [ ] Después del rechazo, `rechazado_en` tiene la fecha y hora del rechazo, no `NULL`.
- [ ] El rechazo **no** modifica `estado_calidad_id`, `peso_bruto`, `tara`, `peso_neto`, `fuera_de_rango`, `lote_id`, `usuario_id` ni `created_at` de la fila.
- [ ] Un pesaje rechazado desaparece de `GET /pesajes/byLote/:loteId`, y el resto de los pesajes del lote sigue apareciendo igual.
- [ ] Rechazar un `id` que no existe responde 400 con `El pesaje con id 'X' no existe`, no 404 y no 500.
- [ ] Rechazar un pesaje que ya tiene `isActive = 0` responde 400 con `El pesaje con id 'X' ya fue rechazado`.
- [ ] Tras ese 400, el `motivo_rechazo`, el `rechazado_por` y el `rechazado_en` del primer rechazo quedan intactos: el segundo intento no sobrescribe nada.
- [ ] Rechazar un pesaje cuyo lote tiene `estado != 'abierto'` o `cerrado_en != NULL` responde 400 y no modifica la fila.
- [ ] Un `motivo` de menos de 5 caracteres responde 400 por validación de Zod y no modifica la fila.
- [ ] Un `motivo` de más de 255 caracteres responde 400 por validación de Zod y no modifica la fila.
- [ ] Un body sin `motivo` responde 400 por validación de Zod.
- [ ] Un `id` de ruta no numérico (`PATCH /pesajes/abc/rechazar`) responde 400 por `ParseIntPipe`.
- [ ] `PATCH /pesajes/:id/rechazar` sin header `Authorization` responde 401: el endpoint no es `@Public()`.
- [ ] `PATCH /pesajes/:id/rechazar` con un token expirado o firmado con otro secreto responde 401.
- [ ] Un `Operador` **sin** fila en `cliente_operador` para el cliente del lote rechaza el pesaje igual: responde **200, no 403**. **Este spec no valida el vínculo.**
- [ ] Un usuario que no es el autor del pesaje puede rechazarlo: no se compara contra `pesajes.usuario_id`.
- [ ] Cuando cualquier validación falla, ninguna columna de la fila cambia: la transacción no deja escrituras parciales.
- [ ] `GET /permisos/me` responde exactamente igual que antes de este spec: siete códigos para `Admin` y cuatro para `Operador`, ninguno de rechazo.
- [ ] `POST /pesajes` responde exactamente igual que antes de este spec, sigue sin escribir `isActive` y sigue sin conocer las columnas nuevas.
- [ ] `GET /pesajes/byLote/:loteId` no cambió: mismos campos, mismo filtro `isActive = 1`, mismo orden por `created_at` descendente.
- [ ] No existe ningún endpoint para deshacer un rechazo ni para listar pesajes rechazados.
- [ ] El payload del JWT no cambió y `req.user` sigue siendo `{ userId, username }`.
- [ ] `POST /clientes`, `GET /clientes`, `GET /clientes/all` (SPEC 01, SPEC 08), `POST /lotes`, `GET /lotes/cliente/:clienteId` (SPEC 02), `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh` (SPEC 05), `GET /permisos/me` (SPEC 07) y los tres `GET /catalogos/*` (SPEC 09) siguen funcionando igual.
- [ ] `CLAUDE.md` lista `PATCH /pesajes/:id/rechazar` **y** `GET /pesajes/byLote/:loteId` en la tabla de endpoints, y ya no afirma que no existe ningún `PATCH` ni ningún `GET` de pesajes.

---

## Decisions

- **Sí:** "rechazar" significa **anular la fila** con `isActive = 0`. Decisión explícita del usuario. El caso real es el pesaje mal capturado (tara equivocada, doble lectura de báscula), y el esquema ya tiene la columna y el listado ya la filtra.
- **No:** marcar el estado de calidad como `RECHAZADO`. Se descarta: exigiría sembrar filas nuevas en `estados_calidad` y chocaría de frente con SPEC 04, que derivó el estado del peso y cerró la puerta a que venga de afuera. Es un spec más grande y va aparte.
- **No:** hacer las dos cosas a la vez. Se descarta: son dos conceptos con ciclos de vida distintos. Un pesaje mal capturado no es un producto que no pasó calidad.
- **Sí:** el pesaje rechazado conserva su `estado_calidad_id`, su peso y su `fuera_de_rango`. Lo único que cambia es que deja de estar activo, así que la fila sigue siendo auditable tal como se capturó.
- **Sí:** `PATCH /pesajes/:id/rechazar`. Decisión explícita del usuario. El verbo dice que es una modificación parcial y el segmento nombrado dice qué acción es. Es el primer `PATCH` y el primer `:id` del proyecto, y queda como precedente.
- **No:** `DELETE /pesajes/:id`. Se descarta: `DELETE` con body es ambiguo en HTTP y varios clientes lo descartan, y el motivo va en el body. Además sugiere borrado físico cuando es baja lógica.
- **No:** `POST /pesajes/:id/rechazar`, que habría evitado introducir un verbo nuevo. Se descarta por precisión semántica: no se crea nada.
- **Sí:** el `id` va en la ruta, no en el body. Es el recurso que se está modificando.
- **Sí:** DDL con tres columnas nuevas — `motivo_rechazo`, `rechazado_por`, `rechazado_en`. Decisión explícita del usuario. Sin esto, anular un pesaje sería una operación destructiva sin rastro de quién la hizo ni por qué, y el proyecto no tiene migraciones para agregarlo después sin dolor.
- **No:** solo `isActive = 0`, sin DDL. Se descarta pese a ser el alcance mínimo, por la razón anterior.
- **No:** solo la columna del motivo, sin usuario ni fecha. Se descarta: saber por qué se anuló sin saber quién ni cuándo deja la auditoría a medias.
- **Sí:** los nombres son `motivo_rechazo`, `rechazado_por` y `rechazado_en`. Decisión explícita del usuario. Siguen el estilo de `cerrado_en` en `lotes` y `created_at` en el resto del esquema.
- **No:** `rechazo_motivo` / `rechazo_usuario_id` / `rechazo_fecha` con prefijo común. Se descarta: agruparía las columnas alfabéticamente pero se aparta del estilo del esquema.
- **Sí:** FK real de `rechazado_por` a `usuarios(id)`. Decisión explícita del usuario. Es la segunda excepción del proyecto a la regla de validar solo en código, después de la FK de `permisos` a `roles`. Se justifica porque es un dato de auditoría y una fila huérfana lo dejaría sin valor probatorio.
- **No:** dejar `rechazado_por` como `INT` suelto, que habría sido coherente con `pesajes.usuario_id`, que hoy no tiene FK. Se descarta por la decisión anterior. Consecuencia anotada: la misma tabla queda con una columna de usuario con FK y otra sin ella. Este spec no le agrega la FK a `usuario_id`.
- **Sí:** las tres columnas son nullables. Las filas existentes no tienen valor y no se van a rellenar.
- **No:** rellenar las filas existentes con un valor por defecto. Se descarta: no fueron rechazadas, así que `NULL` es la respuesta correcta.
- **Sí:** `motivo` obligatorio, entre 5 y 255 caracteres. Decisión explícita del usuario. Si se agrega la columna para auditar, permitirla vacía la dejaría inútil en la mitad de las filas.
- **No:** `motivo` opcional. Se descarta por la decisión anterior.
- **No:** `motivo` obligatorio pero con `.min(1)`. Se descarta: aceptaría un punto o una letra, que es lo mismo que no tener motivo.
- **Sí:** el motivo es texto libre. Un catálogo de motivos sería otra tabla, otro endpoint de catálogo y otro spec.
- **Sí:** 400 al rechazar un pesaje ya rechazado. Decisión explícita del usuario. Protege el rastro: el motivo y la fecha del primer rechazo no se sobrescriben.
- **No:** idempotente con 200 y sin cambios. Se descarta: sería más amable con los reintentos de red, pero la app no distinguiría entre "lo rechacé yo" y "ya estaba rechazado".
- **No:** sobrescribir el motivo y la fecha con los del último rechazo. Se descarta: pierde exactamente lo que la auditoría quiere conservar.
- **Sí:** se valida que el lote esté abierto, reusando `validateLoteAbierto` sin modificarlo. Decisión explícita del usuario. Un lote cerrado es un resultado congelado. Consecuencia anotada: hoy nada puede escribir `lotes.cerrado_en` ni cambiar `lotes.estado`, así que en la práctica esta validación todavía no rechaza nada.
- **No:** permitir rechazar en un lote cerrado para poder corregir errores detectados después. Se descarta: cualquier total ya calculado sobre ese lote cambiaría después de haberse dado por bueno.
- **Sí:** un pesaje con `lote_id = NULL` se rechaza con 400. La columna es nullable en el esquema y sin lote no hay nada que validar. Es una fila que no debería existir y el error debe ser ruidoso.
- **Sí:** `isActive = 0` es la definición de "rechazado". Una fila con `isActive = NULL` no se considera rechazada y sí se puede rechazar. Es un caso que no debería existir, y este criterio deja el motivo escrito en vez de fallar con un mensaje confuso.
- **Sí:** `BadRequestException` (400) cuando el pesaje no existe. Es lo que ya hacen `validateLote` y `validateLoteAbierto` en este mismo archivo para el lote inexistente, y la coherencia dentro del archivo pesa más aquí.
- **No:** `NotFoundException` (404), que sería lo natural para un `:id` de ruta y es lo que hace `GET /permisos/me` cuando el usuario no existe. Se descarta por la decisión anterior. Se anota que el proyecto queda con los dos criterios conviviendo, y que unificarlos es su propio spec.
- **Sí:** cualquier usuario autenticado puede rechazar cualquier pesaje, sin `validateVinculoOperador`. Decisión explícita del usuario, tomada después de que se le señalara que es la primera **escritura** abierta del proyecto y que un `Operador` sin vínculo podría anular el pesaje de un cliente ajeno. Se registra en Risks sin adornos.
- **No:** exigir el vínculo `cliente_operador` como hace `POST /pesajes` en la misma clase. Se descarta pese a ser la convención de acceso declarada del proyecto. Consecuencia asumida: `PesajesRepository` queda con dos criterios de acceso distintos en dos métodos vecinos, y el que valida es el de crear, no el de destruir.
- **No:** exigir que quien rechaza sea el autor del pesaje (`pesajes.usuario_id`). Se descarta: bloquearía al supervisor que corrige el error de un operador, que es el caso de uso probable.
- **Sí:** el rechazo es irreversible. Decisión explícita del usuario. Si se necesita el dato, se captura un pesaje nuevo.
- **No:** un endpoint de reactivación que devuelva `isActive = 1`. Se descarta: duplica el trabajo y abre la pregunta de qué pasa con el rastro del rechazo anterior. Va en su propio spec si hace falta.
- **Sí:** la respuesta es solo `{ ok, msg }`. Decisión explícita del usuario. La app ya sabe qué motivo mandó, así que solo necesita saber que salió bien.
- **No:** `{ ok, msg, pesaje: { id, motivo_rechazo, rechazado_en } }`. Se descarta por la decisión anterior. Consecuencia anotada: es el primer endpoint del proyecto que no devuelve nada del recurso que tocó, un tercer estilo de respuesta junto a la clave nombrada y al `data` de SPEC 09.
- **No:** devolver el pesaje completo actualizado. Se descarta: expondría campos que ningún endpoint de pesajes devuelve hoy.
- **Sí:** ninguna fila nueva en `permisos`. Decisión explícita del usuario. La tabla sigue en 11 filas. Es la tercera excepción a la regla de SPEC 06, después de `GET /permisos/me` y los catálogos de SPEC 09.
- **No:** sembrar `pesajes.rechazar` para `Admin` y `Operador` (dos filas, tabla en 13), que es lo que la convención pide. Se descarta. Consecuencia asumida y **más grave que en SPEC 09**: allí las tres rutas sin código de permiso eran lecturas de listas de referencia; aquí es una escritura destructiva, así que cuando llegue el `PermissionsGuard` no va a encontrar ningún código que exigir para anular un pesaje y tendrá que crearlo en ese momento.
- **No:** sembrar `pesajes.rechazar` solo para `Admin`. Se descarta por la decisión anterior, y porque declararlo exclusivo de `Admin` mientras el endpoint responde 200 a cualquiera repetiría la contradicción que SPEC 08 ya dejó registrada.
- **Sí:** `rechazado_en` se escribe con `NOW()` de MySQL, no con un `new Date()` de Node. Juicio tomado al redactar el spec: es la misma fuente de hora que `created_at`, que usa `DEFAULT CURRENT_TIMESTAMP`, así que las dos fechas de la misma fila son comparables sin depender de la zona horaria del proceso de Node.
- **No:** `new Date()` en el código de la aplicación. Se descarta por la decisión anterior.
- **Sí:** el `UPDATE` y sus validaciones van dentro de una transacción, con los validadores recibiendo el `trx`. Es la convención de escritura del proyecto y se mantiene aunque aquí solo haya una sentencia de escritura.
- **Sí:** todo va en el módulo `pesajes` existente. Es la misma tabla y el mismo dominio.
- **Sí:** `validateLoteAbierto` se reusa tal cual, sin tocarlo. Ya hace exactamente lo que hace falta y lo comparte con `createPesaje`.
- **Sí:** `GET /pesajes/byLote/:loteId` no cambia. Decisión explícita del usuario. Su filtro `isActive = 1` ya hace que un pesaje rechazado desaparezca del listado, que es el efecto buscado, sin escribir una línea.
- **No:** quitarle el filtro y devolver los rechazados con su motivo para mostrarlos tachados. Se descarta: cambiaría el contrato de un endpoint existente dentro de este spec.
- **No:** un query param `?incluirRechazados=true`. Se descarta: exigiría el primer DTO Zod de query del proyecto y una segunda forma de respuesta que mantener.
- **Sí:** `GET /pesajes/byLote/:loteId` se documenta en `CLAUDE.md` en este spec. Existe en el código desde SPEC 03 pero nunca se anotó, y la tabla de endpoints todavía afirma que no hay ningún `GET` de pesajes. Se corrige aquí porque es justo el endpoint donde se ve el efecto del rechazo.
- **No:** rechazo en lote (varios ids en una llamada). Se descarta: abre la pregunta de qué pasa si uno de los ids falla, y hoy no hay un caso que lo pida.
- **No:** borrado físico. Se descarta: perdería la fila y con ella la auditoría, que es lo que este spec construye.
- **No:** editar un pesaje para corregir el peso en vez de anularlo. Se descarta: es otra operación, con otra semántica de auditoría, y va en su propio spec.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **Cualquier usuario autenticado puede anular cualquier pesaje**, incluido un `Operador` sin ninguna fila en `cliente_operador` para ese cliente. Es la primera operación de **escritura** abierta del proyecto: SPEC 08 y SPEC 09 abrieron lecturas, esta destruye datos. | **Sin mitigar por diseño**, por decisión explícita del usuario. Es el riesgo principal de este spec. Hay dos criterios de aceptación que lo verifican y lo dejan registrado como comportamiento esperado. La mitigación real es el spec del `PermissionsGuard`, más el `validateVinculoOperador` que este endpoint decidió no llamar. |
| Al no sembrar ninguna fila en `permisos`, el `PermissionsGuard` futuro no va a encontrar código de permiso para una operación destructiva, y no va a saber si fue decisión o descuido. | Queda registrado aquí, en dos decisiones y en `CLAUDE.md`. El paso 12 del plan lo incluye. Es la diferencia con SPEC 09: allí las rutas sin permiso eran lecturas inocuas. |
| `PesajesRepository` queda con dos criterios de acceso distintos en métodos vecinos: `createPesaje` valida el vínculo y `rechazarPesaje` no. Alguien copia el que no valida al escribir el siguiente método. | Sin mitigar en el código. Está en Decisions con la consecuencia escrita y en la nota de `CLAUDE.md` del paso 12, que hoy afirma que **toda** operación sobre datos de un cliente valida el vínculo. Esa frase deja de ser cierta con este spec y hay que corregirla, no matizarla. |
| El rechazo es irreversible y no hay endpoint para deshacerlo: un rechazo por error deja el pesaje inaccesible por API para siempre. | Parcialmente mitigado: la fila no se borra, así que el dato se puede recuperar por SQL a mano. El motivo obligatorio y el `rechazado_por` reducen los rechazos accidentales al obligar a escribir algo. |
| Un pesaje rechazado desaparece de `GET /pesajes/byLote/:loteId` y no hay ningún endpoint que lo liste, así que la app no puede mostrar qué se anuló ni por qué. | Sin mitigar por decisión explícita. Las tres columnas quedan escritas en la base desde el día uno, así que cuando llegue el endpoint de lectura el dato histórico ya existe. |
| El DDL se aplica en un ambiente y no en otro, y el `UPDATE` falla por columna inexistente. Es el riesgo heredado de no tener migraciones. | Sin mitigación automática. El paso 1 del plan verifica con `DESCRIBE pesajes;` y `SHOW CREATE TABLE pesajes;`. El DDL queda escrito en este spec, que es la única fuente. |
| `pesajes.id` es `BIGINT` y llega como `Generated<string \| number>`, mientras que el `:id` de la ruta pasa por `ParseIntPipe` y llega como `number`. | Sin problema práctico: `Number.MAX_SAFE_INTEGER` está muy por encima del volumen esperado, y la comparación en el `where` la hace MySQL. Es el mismo criterio de `Number()` que ya aplica `createPesaje` al `insertId`. |
| Se agrega `GET /pesajes/:id` en el futuro y Nest lo resuelve antes que `PATCH /pesajes/:id/rechazar` o al revés. | No aplica hoy: los verbos son distintos y el segmento `rechazar` desambigua. Se anota junto al riesgo equivalente que SPEC 08 dejó para `GET /clientes/all`. |
| Alguien lee "rechazar" y asume que es el estado `RECHAZADO` del diagrama, y construye encima la lógica de calidad. | Está en el objetivo, en la sección de por qué existe el spec, en dos decisiones y en un criterio de aceptación que verifica que `estado_calidad_id` no cambia. El paso 12 lo anota en `CLAUDE.md`. |

---

## What is **not** in this spec

- El estado `RECHAZADO` del diagrama, y cualquier cambio a `estados_calidad` o a `estado_calidad_id`.
- Deshacer un rechazo: no hay endpoint de reactivación.
- Rechazo en lote de varios pesajes en una llamada.
- Sembrar filas en `permisos`: la tabla sigue con las 11 filas de SPEC 08.
- Aplicar permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`.
- Validar el vínculo `cliente_operador`, ni exigir que quien rechaza sea el autor del pesaje.
- Cambios a `POST /pesajes` y a `GET /pesajes/byLote/:loteId`.
- Un endpoint para listar pesajes rechazados, y cualquier query param para incluirlos.
- Devolver `motivo_rechazo`, `rechazado_por` o `rechazado_en` en algún endpoint de lectura.
- Borrado físico de pesajes.
- Editar un pesaje para corregir su peso.
- Recalcular agregados del lote al rechazar, y los agregados en sí.
- Cierre de lote: nada puede escribir `lotes.cerrado_en`.
- Un catálogo de motivos de rechazo.
- Baja lógica en `clientes`, `lotes` o `usuarios`.

Cada uno de estos, si se necesita, va en su propio spec.
