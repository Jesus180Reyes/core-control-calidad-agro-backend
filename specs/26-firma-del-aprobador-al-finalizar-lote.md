# SPEC 26 — Firma del aprobador al finalizar un lote

> **Status:** Approved
> **Depends on:** SPEC 02 (crea el módulo `lotes`), SPEC 13 (escribe `aprobado_por`/`aprobado_en`), SPEC 20 (crea `PATCH /lotes/:id/finalizar/byApprover`, que este spec modifica), SPEC 22 (Swagger, donde hay que documentar el cuerpo nuevo), SPEC 24 (la única lectura de lotes finalizados, que **no** debe devolver la firma)
> **Date:** 2026-09-18
> **Objective:** Agregar la columna `lotes.firma_aprobador` y exigirla como cuerpo obligatorio de `PATCH /lotes/:id/finalizar/byApprover`, de modo que un lote no se pueda finalizar sin la firma manuscrita del aprobador guardada como data URL de PNG en base64.

---

## Why this spec exists

El SPEC 20 dejó la finalización como el último acto del flujo y le puso auditoría: `finalizado_por` y `finalizado_en` dicen **quién** cerró el lote y **cuándo**. Lo que no hay es evidencia de que esa persona estuvo delante del lote y lo firmó. Un `userId` sacado de un token es una afirmación del sistema sobre sí mismo; una firma trazada a mano es un acto del aprobador.

Este spec agrega esa evidencia, y toma tres decisiones que conviene tener claras antes de leer el resto.

**La primera: la firma viaja en el cuerpo de la finalización, no en un endpoint aparte.** `PATCH /lotes/:id/finalizar/byApprover` era uno de los **tres** endpoints de escritura del proyecto sin body y sin DTO. Deja de serlo. El motivo es que la firma y la finalización son el mismo acto: separarlas abre dos estados que no significan nada —un lote finalizado sin firmar y una firma sobre un lote sin finalizar— y obliga a decidir qué hacer con cada uno. En una sola transacción no existe ninguno de los dos.

**La segunda: la firma es obligatoria, y eso rompe a los clientes actuales.** Hoy el endpoint se llama sin cuerpo. Después de este spec, una llamada sin cuerpo responde **400** del `ZodValidationPipe`. Es un cambio incompatible y consciente: una firma opcional termina siendo una firma ausente en la mayoría de los lotes, y entonces no sirve como evidencia de nada. El frontend tiene que desplegar el canvas antes de llamar.

**La tercera: la firma nace invisible.** Ninguna lectura la devuelve, ni siquiera `GET /lotes/cliente/:clienteId/all/finalizados`, que es la única que muestra un lote finalizado. Es el mismo camino que recorrieron `aprobado_por` en el SPEC 13 y `finalizado_por` en el SPEC 20: la columna se escribe desde el día uno y la lectura va en su propio spec, con su propia decisión sobre si se devuelve en el listado o por una ruta dedicada. La razón de no resolverlo aquí es concreta: meter un blob de cientos de kilobytes en un listado de N filas multiplica el payload por N, y esa decisión merece su propia discusión.

---

## Scope

**In:**

- DDL a mano en MySQL: una columna nullable en `lotes`, `firma_aprobador MEDIUMTEXT NULL`. **Sin FK** — es texto, no apunta a ninguna fila.
- Actualizar `LotesTable` en `src/database/types/types.ts` con la columna nueva.
- Archivo nuevo `src/modules/lotes/dto/finalizar-lote.dto.ts` con `FinalizarLoteDto`, schema Zod de un solo campo obligatorio `firma_aprobador`.
- El schema valida **tamaño primero y formato después**: máximo **500.000 caracteres**, y regex de data URL de PNG en base64.
- Cambiar la firma de `finalizarLote(loteId, userId)` a `finalizarLote(loteId, dto, userId)` en `src/modules/lotes/repository/lotes.repository.ts`.
- El `UPDATE` pasa de **tres** columnas a **cuatro**: agrega `firma_aprobador` a `etapa_id`, `finalizado_por` y `finalizado_en`.
- Cambiar la firma de `finalizar(loteId, userId)` a `finalizar(loteId, dto, userId)` en `src/modules/lotes/lotes.service.ts`, sigue siendo pass-through.
- Agregar `@Body() dto: FinalizarLoteDto` al handler `@Patch(':id/finalizar/byApprover')` de `src/modules/lotes/lotes.controller.ts`.
- Actualizar el `@ApiOperation` de ese handler: deja de decir "sin cuerpo de peticion" y explica el campo nuevo.
- Respuesta `200` con la forma `{ ok, msg }`, **sin cambios**. La firma no se devuelve en la respuesta de la escritura.
- `400` del `ZodValidationPipe` si falta `firma_aprobador`, si no es un data URL de PNG en base64, o si excede los 500.000 caracteres.
- Actualizar `CLAUDE.md`: la columna nueva, el DDL, el cuerpo obligatorio, y los conteos que cambian.

**Out of scope (for future specs):**

- **Cualquier lectura de la firma.** Ni endpoint nuevo, ni campo nuevo en `GET /lotes/cliente/:clienteId/all/finalizados`, ni en ninguna de las otras tres rutas `cliente/...`. La firma se escribe y no se lee por API.
- **Un `GET /lotes/:id/firma`**, que fue la alternativa considerada para la lectura. Va en el spec de lectura, junto con la decisión de si el listado la lleva o no.
- **Firma del supervisor que aprueba** (`PATCH /lotes/:id/aprobar`). Ese endpoint no cambia y sigue sin body ni DTO. Una `firma_supervisor` es otro spec.
- **Firma en los pesajes**, y con ella el PIN de supervisor del diagrama para pesajes fuera de rango.
- **Firma en los documentos fiscales** del SPEC 25.
- **Reemplazar, corregir o borrar una firma ya escrita.** La finalización es irreversible desde el SPEC 20 y la firma hereda esa propiedad.
- **Rellenar la firma de los lotes ya finalizados.** Quedan con `firma_aprobador = NULL` para siempre; no hay endpoint que los complete.
- **Subida de archivos** (`multipart/form-data`), almacenamiento en disco o en un bucket, y una columna de URL como la `archivo_url` del SPEC 25. La firma viaja y se guarda como texto.
- **Firma digital criptográfica**: certificados, hash del contenido del lote, sellado de tiempo, no repudio. Esto guarda un trazo, no una firma electrónica avanzada.
- **Verificar que la firma no esté en blanco**, que tenga trazos, o compararla contra una firma de referencia del usuario. El backend valida formato y tamaño, nada más.
- **Reencodear, recomprimir o redimensionar la imagen** en el backend. Se guarda el string tal como llega.
- **Aceptar JPEG, WEBP, SVG o cualquier otro mime.** Solo PNG.
- **Una columna de mime aparte.** El data URL ya lo lleva dentro.
- **Un `firma_aprobador_en`** o cualquier fecha propia de la firma. `finalizado_en` ya es esa fecha.
- **Validar el vínculo `cliente_operador`** en la finalización. Sigue sin validarse, igual que desde el SPEC 20.
- **Sembrar filas en `catalogo_permisos` o en `permisos`**, y cualquier forma de `PermissionsGuard`.
- **Rate limiting** o límite de tamaño de body a nivel de Express. El SPEC 23 sigue en su propio estado y este spec no lo adelanta.
- Cambios a `POST /lotes`, `PATCH /lotes/:id/rechazar`, `PATCH /lotes/:id/aprobar`, `PATCH /lotes/:id/rechazar/byApprover`, a las **cuatro** lecturas de `lotes`, y a cualquier endpoint de `pesajes`, `clientes`, `auth`, `permisos`, `catalogos` o `documentos-fiscales`.
- Tests de cualquier tipo: el proyecto sigue sin un solo `*.spec.ts`.

---

## Data model

### DDL nuevo

```sql
ALTER TABLE lotes
  ADD COLUMN firma_aprobador MEDIUMTEXT NULL AFTER finalizado_en;
```

Una sola columna, nullable, **sin FK y sin índice**. Ninguna fila existente se toca: todos los lotes de hoy —incluidos los ya finalizados— quedan con `firma_aprobador = NULL`, que es exactamente lo que corresponde, porque se finalizaron antes de que la firma existiera.

**No es una excepción a la regla de validar solo en código.** Las dieciséis FK y los seis `UNIQUE` del proyecto quedan como estaban: esta columna no tiene ninguno de los dos.

**Por qué `MEDIUMTEXT` y no `TEXT`.** `TEXT` topa en 65.535 bytes. Una firma de canvas en PNG ronda los 7–20 KB en base64, así que `TEXT` alcanza en el caso normal — pero un canvas de alta resolución o un trazo denso se pasa, y MySQL **trunca en silencio** en modo no estricto. Una firma truncada se guarda sin error y se pinta rota. `MEDIUMTEXT` (16 MB) hace que ese borde no exista, y el límite real lo impone el DTO, que sí devuelve un 400 legible.

**Dónde vive el dato.** MySQL guarda las columnas `TEXT` fuera de la fila, así que las cuatro lecturas de `lotes` —que seleccionan columnas explícitas y nunca `firma_aprobador`— no pagan nada por esta columna.

### `LotesTable`

```ts
export interface LotesTable {
  // ...campos existentes sin cambios...
  aprobado_por: number | null;
  aprobado_en: Date | string | null;
  finalizado_por: number | null;
  finalizado_en: Date | string | null;
  firma_aprobador: string | null; // nueva
}
```

Ninguna otra interfaz del archivo cambia.

### El DTO

```ts
// src/modules/lotes/dto/finalizar-lote.dto.ts
import { createZodDto } from 'nestjs-zod';
import z from 'zod';

const finalizarLoteSchema = z.object({
    firma_aprobador: z
        .string({ error: 'Firma del aprobador requerida' })
        .max(500000, 'La firma no puede exceder los 500000 caracteres')
        .regex(
            /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/,
            'La firma debe ser un data URL de PNG en base64',
        ),
});

export class FinalizarLoteDto extends createZodDto(finalizarLoteSchema) { }
```

Cinco cosas de ese schema:

- **`.max()` va antes que `.regex()`.** Es deliberado: acota el string antes de pasarle una expresión regular, y el mensaje de "demasiado grande" es más útil que el de formato cuando alguien manda una foto por error.
- **No hay ningún `.transform()`.** El `ZodValidationPipe` está registrado **dos veces** —`APP_PIPE` en `AppModule` y `useGlobalPipes` en `main.ts`— así que todo DTO se valida dos veces y la segunda pasada recibe la salida de la primera. Un schema que solo valida es idempotente por construcción y la trampa del SPEC 16 no aplica. **No agregar un `.transform()` aquí sin arreglar antes la doble registración.**
- **No hay `.optional()` ni `.catch()`.** El campo es obligatorio: sin él, 400.
- **El regex exige el prefijo exacto** `data:image/png;base64,`, seguido de al menos un carácter del alfabeto base64 y como mucho dos `=` de padding. No acepta espacios, saltos de línea ni otro mime.
- **Es el tercer DTO de `lotes`**, después de `create-lote.dto.ts` y `rechazar-lote.dto.ts`, y el **decimosexto** DTO de entrada del proyecto, que es el conteo que `CLAUDE.md` da para Swagger.

### El `UPDATE`

```sql
UPDATE lotes
SET etapa_id = <id de la fila con codigo = 'FINALIZADO'>,
    finalizado_por = ?,
    finalizado_en = NOW(),
    firma_aprobador = ?
WHERE id = ?;
```

Pasa de tres columnas a **cuatro**. Sigue sin tocar `estado`, `cerrado_en`, `motivo_rechazo`, `rechazado_por`, `rechazado_en`, `aprobado_por`, `aprobado_en`, `cliente_id`, `nombre_lote`, `producto_id`, `unidad_medida_id`, los tres pesos, `variedad_o_talla`, `resumen_ia`, `created_by` ni `created_at`.

Con esto, `finalizarLote` deja de empatar con `approvePesajeForApprover` como el `UPDATE` más estrecho del proyecto: el más estrecho pasa a ser `approvePesajeForApprover` en solitario, con tres columnas.

Las cinco validaciones del SPEC 20 —`validateLoteNoFinalizado`, `validateLoteEnClienteFinal`, `validateLoteTienePesajes`, `validatePesajesRevisados` y `resolveEtapa`— **no cambian**: ni firma, ni condición, ni mensajes. La firma se valida en el pipe, antes de que el repositorio corra.

### Orden de validación

Esto importa porque cambia qué error ve el usuario:

1. `JwtAuthGuard` → 401 sin token.
2. `ParseIntPipe` sobre `:id` → 400 si el id no es numérico.
3. `ZodValidationPipe` sobre el body → **400 de la firma**.
4. Los cinco validadores del repositorio, dentro de la transacción → 400 del estado del lote.

Es decir: **una petición con una firma inválida sobre un lote que tampoco se puede finalizar responde el error de la firma**, no el del lote. El body se valida antes de mirar la base.

### Petición y respuestas

```
PATCH /lotes/12/finalizar/byApprover
Authorization: Bearer <token>
Content-Type: application/json

{
  "firma_aprobador": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

```json
{
  "ok": true,
  "msg": "Lote finalizado correctamente"
}
```

**La respuesta no cambia.** Sigue siendo `{ ok, msg }` sin payload de recurso, igual que los otros nueve `PATCH` del proyecto. La firma no vuelve.

Errores nuevos, todos `400` con la forma del `ZodValidationPipe`:

| Caso | Mensaje |
| --- | --- |
| Sin body, o body sin `firma_aprobador` | `Firma del aprobador requerida` |
| `firma_aprobador` no es string | `Firma del aprobador requerida` |
| Cadena de más de 500.000 caracteres | `La firma no puede exceder los 500000 caracteres` |
| Base64 sin el prefijo `data:image/png;base64,` | `La firma debe ser un data URL de PNG en base64` |
| Data URL de otro mime (`image/jpeg`, `image/svg+xml`) | `La firma debe ser un data URL de PNG en base64` |
| Cadena vacía | `La firma debe ser un data URL de PNG en base64` |

Los errores del SPEC 20 —`no existe`, `ya fue finalizado`, `ya fue rechazado`, `no esta cerrado`, `no esta en la etapa CLIENTE_FINAL`, `no tiene pesajes registrados`, `tiene pesajes sin revisar por el aprobador`, `La etapa con codigo 'FINALIZADO' no existe`— quedan **idénticos**.

### Lo que cambia en los conteos

| Conteo | Antes | Después |
| --- | --- | --- |
| Rutas que mapea Nest | 32 | **32**, sin cambio |
| Operaciones en `/docs-json` | 31 en 29 claves | **31 en 29 claves**, sin cambio |
| `UPDATE`s del proyecto | 10 | **10**, sin cambio |
| Escrituras abiertas a cualquier autenticado | 11 | **11**, sin cambio |
| Rutas que se saltan `validateVinculoOperador` | 20 | **20**, sin cambio |
| Endpoints de escritura **sin body ni DTO** | 3 | **2** |
| DTOs de entrada que se autodocumentan en Swagger | 15 | **16** |
| Archivos en `src/modules/lotes/dto/` | 2 | **3** |
| Columnas que escribe `finalizarLote` | 3 | **4** |
| FKs fuera de la regla de validar solo en código | 16 | **16**, sin cambio |
| `UNIQUE`s reales en MySQL | 6 | **6**, sin cambio |
| Filas en `catalogo_permisos` / `permisos` | 9 / 14 | **9 / 14**, sin cambio |

### Archivos

| Archivo | Cambio |
| --- | --- |
| MySQL | `ALTER TABLE lotes ADD COLUMN firma_aprobador MEDIUMTEXT NULL` |
| `src/database/types/types.ts` | `firma_aprobador: string \| null` en `LotesTable` |
| `src/modules/lotes/dto/finalizar-lote.dto.ts` | **Archivo nuevo** |
| `src/modules/lotes/repository/lotes.repository.ts` | `finalizarLote` recibe el dto y escribe una columna más |
| `src/modules/lotes/lotes.service.ts` | `finalizar` recibe el dto y lo pasa |
| `src/modules/lotes/lotes.controller.ts` | `@Body() dto: FinalizarLoteDto` y `@ApiOperation` actualizado |
| `CLAUDE.md` | Columna, DDL, cuerpo obligatorio y conteos |

**Ningún módulo nuevo, ningún controller nuevo, ningún endpoint nuevo.** `lotes.module.ts` y `src/app.module.ts` no cambian.

---

## Implementation plan

1. Verificar la base antes de tocar nada: `DESCRIBE lotes;` para confirmar que `firma_aprobador` no existe, `SELECT COUNT(*) FROM lotes WHERE finalizado_por IS NOT NULL;` para anotar cuántos lotes quedarán con la columna en `NULL`, y `@@sql_mode` para saber si es estricto.
2. Aplicar a mano el `ALTER TABLE` y agregar `firma_aprobador: string | null` a `LotesTable` en `src/database/types/types.ts`. Verificación: `DESCRIBE lotes;` muestra `mediumtext YES NULL`, `npm run build` pasa y ninguna otra interfaz del archivo cambió.
3. Preparar los datos de prueba: **dos** lotes cerrados en `CLIENTE_FINAL` con todos sus pesajes activos revisados. Confirmar que hoy, antes del cambio, finalizar sin body responde 200, y dejarlos sin finalizar. Uno servirá para los rechazos y el otro para el camino feliz.
4. Crear `src/modules/lotes/dto/finalizar-lote.dto.ts` con `FinalizarLoteDto`, tal como está en el modelo de datos. Verificación: `npm run build` pasa; todavía no lo usa nadie.
5. Encadenar el dto por las tres capas: `finalizarLote(loteId, dto, userId)` en `LotesRepository` con `firma_aprobador` en el `.set()`, `finalizar(loteId, dto, userId)` en `LotesService`, y `@Body() dto: FinalizarLoteDto` en el handler del controller. No tocar ninguno de los cinco validadores. Verificación: `npm run build` pasa y el log de Nest sigue mapeando **32** rutas, con `lotes` en **9**.
6. Verificar los rechazos del DTO sobre el primer lote, confirmando cada vez que la fila no cambió: sin body; `{}`; `firma_aprobador` en `null`, en `123`, en `""`, en un base64 sin prefijo, en un data URL de `image/jpeg` y de `image/svg+xml`; y una cadena de 500.001 caracteres. Confirmar también que una firma inválida sobre un lote **no finalizable** devuelve el error de la firma y no el del lote. **Si alguno responde `PayloadTooLargeError` en vez del mensaje del DTO, es el límite de body de Express** — anotarlo y decidir entonces qué límite mover.
7. Camino feliz sobre el segundo lote, con un data URL de PNG real de un canvas: 200 con exactamente `{ ok: true, msg: ... }` y dos claves; en MySQL, `etapa_id` de `FINALIZADO`, `finalizado_por`, `finalizado_en` y `firma_aprobador` con el string completo —comparar `LENGTH()` contra la longitud enviada, porque si difieren la columna truncó—; `estado`, `cerrado_en`, el par de aprobación, la terna de rechazo, los pesos y `created_at` sin cambios; ninguna fila de `pesajes` tocada. Pegar el valor en el `src` de un `<img>` y confirmar que se ve el trazo.
8. Verificar que la firma no se lee: `GET /lotes/cliente/:clienteId/all/finalizados` devuelve el lote con **14** claves y sin `firma_aprobador`, igual que las otras tres rutas `cliente/...` y los dos `GET` de `pesajes`. **Buscar `selectAll()` en `LotesRepository` y confirmar que no hay ninguno** — es la misma trampa que el SPEC 25 documentó para `clientes.constancia_exonerado`.
9. Verificar que nada del SPEC 20 cambió, **mandando siempre una firma válida**: los ocho mensajes de error siguen idénticos, y un `Operador` sin fila en `cliente_operador` finaliza igual con **200, no 403**.
10. Actualizar el `@ApiOperation` del handler: quitar "Sin cuerpo de peticion" y explicar el campo nuevo. Verificación: `/docs` muestra el schema del body y `/docs-json` sigue con **31** operaciones en **29** claves.
11. `npm run lint` y `npm run build` sin errores nuevos, y no regresión general: los demás endpoints de `lotes`, `pesajes`, `clientes`, `documentos-fiscales`, `permisos`, `catalogos` y `auth` responden igual, con `catalogo_permisos` en **9** filas y `permisos` en **14**.
12. Actualizar `CLAUDE.md`: la columna en la sección Domain y su DDL sin FK ni `UNIQUE` en Caveats; que `PATCH /lotes/:id/finalizar/byApprover` ya tiene body y DTO, así que los endpoints de escritura sin body pasan de **tres** a **dos** y `finalizarLote` escribe **cuatro** columnas; que los DTOs de entrada de Swagger pasan de **15** a **16**; que la firma se escribe y **no se lee**, con la advertencia del `selectAll()`; y que los lotes finalizados antes de este spec quedan con `firma_aprobador = NULL` sin forma de completarlos por API.

---

## Acceptance criteria

- [ ] `DESCRIBE lotes;` muestra `firma_aprobador` como `mediumtext`, nullable.
- [ ] `SHOW CREATE TABLE lotes;` **no** muestra ninguna FK ni índice nuevo sobre `firma_aprobador`.
- [ ] El DDL no modificó ninguna fila existente: todos los lotes anteriores quedan con `firma_aprobador = NULL`, incluidos los ya finalizados.
- [ ] `LotesTable` en `src/database/types/types.ts` declara `firma_aprobador: string | null`, y ninguna otra interfaz del archivo cambió.
- [ ] Existe `src/modules/lotes/dto/finalizar-lote.dto.ts` con `FinalizarLoteDto`, y `src/modules/lotes/dto/` pasa a tener exactamente **tres** archivos.
- [ ] El schema del DTO **no** contiene ningún `.transform()`, ningún `.optional()` y ningún `.catch()`.
- [ ] El schema aplica `.max(500000)` **antes** que el `.regex()`.
- [ ] No se creó ningún módulo, controller, service, repositorio ni endpoint nuevo.
- [ ] `src/app.module.ts` y `src/modules/lotes/lotes.module.ts` no cambiaron.
- [ ] El log de Nest sigue mapeando **32** rutas, con el reparto `auth` 2, `catalogos` 3, `clientes` 4, `lotes` **9**, `permisos` 1, `pesajes` 7, `documentos-fiscales` 5, más `GET /`.
- [ ] `PATCH /lotes/:id/finalizar/byApprover` con un lote finalizable y una firma válida responde 200 con exactamente `{ ok: true, msg: 'Lote finalizado correctamente' }`.
- [ ] La respuesta del 200 tiene exactamente **dos** claves: **no** devuelve `firma_aprobador` ni ninguna clave de recurso.
- [ ] Después de finalizar, la fila tiene `firma_aprobador` con el string **completo** que se envió: `LENGTH(firma_aprobador)` coincide con la longitud del string enviado.
- [ ] El valor guardado, pegado en el `src` de un `<img>`, pinta la firma.
- [ ] Después de finalizar, `etapa_id` es el de la fila `codigo = 'FINALIZADO'`, `finalizado_por` es el `userId` del token y `finalizado_en` la hora de la finalización.
- [ ] Después de finalizar, `estado` sigue en `'cerrado'` y `cerrado_en` conserva **la hora de la aprobación**, no la de la finalización.
- [ ] Después de finalizar, `aprobado_por`, `aprobado_en`, `motivo_rechazo`, `rechazado_por`, `rechazado_en`, los tres pesos, `variedad_o_talla`, `resumen_ia`, `created_by` y `created_at` quedan **sin cambios**.
- [ ] La finalización **no** modifica ninguna fila de `pesajes`.
- [ ] `PATCH /lotes/:id/finalizar/byApprover` **sin body** responde **400** `Firma del aprobador requerida`, y ninguna columna del lote cambia. **Este es el cambio incompatible del spec.**
- [ ] Un body `{}` responde 400 con el mismo mensaje.
- [ ] `firma_aprobador` en `null` o en un número responde 400.
- [ ] `firma_aprobador` en `""` responde 400 `La firma debe ser un data URL de PNG en base64`.
- [ ] Un base64 **sin** el prefijo `data:image/png;base64,` responde 400.
- [ ] Un data URL de `image/jpeg`, de `image/webp` o de `image/svg+xml` responde 400.
- [ ] Una cadena de **500.001** caracteres responde 400 `La firma no puede exceder los 500000 caracteres`.
- [ ] Una cadena de exactamente **500.000** caracteres con formato válido **no** es rechazada por el límite.
- [ ] Cuando el DTO rechaza, la transacción del repositorio **nunca corre**: ninguna columna cambia.
- [ ] Una petición con firma inválida **y** un lote no finalizable devuelve el error de la **firma**, no el del lote.
- [ ] Los ocho mensajes de error del SPEC 20 siguen **idénticos** cuando la firma es válida: `no existe`, `ya fue finalizado`, `ya fue rechazado`, `no esta cerrado`, `no esta en la etapa CLIENTE_FINAL`, `no tiene pesajes registrados`, `tiene pesajes sin revisar por el aprobador` y `La etapa con codigo 'FINALIZADO' no existe`.
- [ ] `validateLoteNoFinalizado`, `validateLoteEnClienteFinal`, `validateLoteTienePesajes`, `validatePesajesRevisados`, `resolveEtapa`, `validateLoteAbierto`, `validateEtapaEnProceso` y `validateVinculoOperador` **no se modificaron**: ni firma, ni condición, ni mensajes, ni `select`.
- [ ] `finalizarLote` sigue corriendo sus cinco validaciones dentro de la misma transacción y en el mismo orden.
- [ ] El `UPDATE` escribe exactamente **cuatro** columnas.
- [ ] Un `Operador` **sin** fila en `cliente_operador` para el cliente del lote finaliza igual: responde **200, no 403**. Este spec no cambia el control de acceso.
- [ ] `GET /lotes/cliente/:clienteId/all/finalizados` devuelve exactamente los mismos **14** campos que antes: **no** incluye `firma_aprobador`.
- [ ] `GET /lotes/cliente/:clienteId`, `/all` y `/all/approver` devuelven exactamente los mismos **10** campos que antes.
- [ ] Ningún endpoint de la API devuelve `firma_aprobador` en ninguna respuesta.
- [ ] No hay ningún `selectAll()` en `LotesRepository`.
- [ ] `PATCH /lotes/:id/aprobar` sigue **sin** body y **sin** DTO.
- [ ] `PATCH /pesajes/:id/aprobar/byApprover` sigue **sin** body y **sin** DTO.
- [ ] Los otros ocho endpoints de `lotes`, los siete de `pesajes`, los cuatro de `clientes`, los cinco de `documentos-fiscales`, `GET /permisos/me`, los tres `GET /catalogos/*` y los dos de `auth` responden igual que antes.
- [ ] `catalogo_permisos` sigue con **9** filas y `permisos` con **14**: no se sembró ninguna fila.
- [ ] El handler tiene su `@ApiOperation` actualizado, sin la frase "sin cuerpo de peticion", y `/docs` muestra el schema del body con `firma_aprobador` como requerido.
- [ ] No se agregó ningún `@ApiResponse` en ninguna parte.
- [ ] `/docs-json` sigue con **31** operaciones en **29** claves de `paths`.
- [ ] `npm run build` pasa y `npm run lint` no introduce errores nuevos.
- [ ] `README.md` no cambió.
- [ ] `CLAUDE.md` documenta la columna, el DDL sin FK, el cuerpo obligatorio, que los endpoints sin body pasan de tres a **dos**, que `finalizarLote` escribe **cuatro** columnas, y que la firma se escribe y no se lee.

---

## Decisions

- **Sí:** una columna `firma_aprobador` en `lotes`, con la firma manuscrita del aprobador que **finaliza** el lote. Decisión explícita del usuario. Acompaña a `finalizado_por`/`finalizado_en` y cierra el flujo con evidencia del acto, no solo con un id de token.
- **No:** que sea la firma del supervisor que **aprueba** (`PATCH /lotes/:id/aprobar`). Se descarta: ese endpoint no se toca en este spec. Una `firma_supervisor` es su propio spec si alguna vez hace falta.
- **No:** dos firmas, una por cada paso. Se descarta: duplica el alcance —dos columnas, dos DDL, dos endpoints, dos validaciones— para un caso que hoy no se pide.
- **Sí:** la firma viaja en el **cuerpo de `PATCH /lotes/:id/finalizar/byApprover`**. Decisión explícita del usuario. Firma y finalización son el mismo acto y se escriben en la misma transacción: no existe lote finalizado sin firma ni firma sobre un lote sin finalizar.
- **No:** un endpoint dedicado tipo `PATCH /lotes/:id/firma`. Se descarta pese a que permitiría reintentar si el canvas falla: abre dos estados que no significan nada y obliga a decidir qué hacer con cada uno, además de sumar una ruta y una novena escritura abierta.
- **No:** las dos cosas a la vez —opcional en finalizar más endpoint aparte—. Se descarta: es el escenario con más estados posibles y el más difícil de auditar, que es justo lo contrario de lo que persigue una firma.
- **Sí:** la firma es **obligatoria**. Decisión explícita del usuario. Una firma opcional termina ausente en la mayoría de los lotes y entonces no prueba nada.
- **Sí, consecuencia asumida:** es un **cambio incompatible**. Toda llamada actual a `PATCH /lotes/:id/finalizar/byApprover` sin body pasa a responder 400. El frontend tiene que desplegar el canvas antes de llamar. Hay un criterio de aceptación que lo fija como comportamiento esperado.
- **No:** un periodo de gracia donde la firma sea opcional y luego obligatoria. Se descarta: es el mismo trabajo hecho dos veces y deja lotes finalizados sin firma durante la ventana, que es exactamente el dato incompleto que se quería evitar.
- **Sí:** el endpoint deja de ser uno de los tres sin body ni DTO. Pasan a ser **dos**: los dos `aprobar`. Se acepta romper esa propiedad porque la alternativa es peor.
- **Sí:** se guarda el **data URL completo**, `data:image/png;base64,...`. Decisión explícita del usuario. El frontend lo pinta directo en un `<img src>` sin reconstruir nada, y el prefijo declara el tipo dentro del propio dato.
- **No:** base64 puro sin prefijo. Se descarta: ahorra ~22 bytes y deja el tipo de imagen sin declarar, obligando al frontend a saber por convención que es PNG.
- **No:** base64 puro más una columna de mime. Se descarta: es una columna extra para un caso que hoy tiene un solo formato, y el data URL ya lleva el mime dentro.
- **Sí:** **solo PNG**. Decisión explícita del usuario. Es lo que produce `canvas.toDataURL()` por defecto, y cuanto más cerrado el regex, menos superficie.
- **No:** aceptar JPEG o WEBP. Se descarta: son formatos con pérdida y un trazo de firma es justo lo que peor sobrevive a la compresión.
- **No:** aceptar cualquier `image/*`. Se descarta explícitamente por el SVG, que puede llevar script dentro. Aunque un `<img>` no lo ejecute, no hace falta abrir esa superficie.
- **Sí:** `MEDIUMTEXT`. Decisión explícita del usuario. `TEXT` topa en 64 KB y, fuera de modo estricto, MySQL trunca en silencio: una firma cortada se guarda sin error y se pinta rota.
- **No:** `TEXT`. Se descarta por ese borde, aunque alcance en el caso normal.
- **No:** `LONGTEXT`. Se descarta: 4 GB no aporta nada sobre 16 MB para una firma.
- **Sí:** el límite real lo pone el DTO en **500.000 caracteres** (~365 KB de imagen). Decisión explícita del usuario. Techo que ningún canvas de firma normal alcanza y que impide que alguien mande una foto de 5 MB por el mismo campo.
- **No:** 100.000 caracteres. Se descarta: un canvas en alta resolución lo puede rozar y el usuario vería un 400 sin entender por qué.
- **No:** sin límite en el DTO. Se descarta: dejaría el endpoint abierto a peticiones de megas, y el rate limiting del SPEC 23 no está implementado.
- **Sí:** `.max()` antes que `.regex()`. Acota el string antes de pasarle la expresión regular y da el mensaje más útil cuando el problema es el tamaño.
- **Sí:** el schema **solo valida**, sin `.transform()`. Es idempotente por construcción, así que la doble registración del `ZodValidationPipe` —el problema que el SPEC 16 documentó— no le afecta. Queda anotado para quien vaya a modificarlo.
- **Sí:** la firma **nace invisible**. Decisión explícita del usuario. Ninguna lectura la devuelve. Es el mismo camino de `aprobado_por` entre el SPEC 13 y el 24, y de `finalizado_por` entre el SPEC 20 y el 24.
- **No:** devolverla como campo 15 de `GET /lotes/cliente/:clienteId/all/finalizados`. Se descarta: ese listado devuelve N lotes y un blob de cientos de kilobytes por fila multiplicaría el payload por N, para un dato que casi nunca se va a pintar en una lista.
- **No:** un `GET /lotes/:id/firma` en este spec. Se descarta: es la alternativa más razonable para la lectura, pero es un endpoint con sus propias decisiones —404 contra 400, qué lotes puede leer, si devuelve JSON o la imagen con su `Content-Type`— y va en su propio spec.
- **Sí, consecuencia asumida:** hasta ese spec, la firma se escribe y no se puede ver salvo entrando a MySQL. Mismo criterio con el que el proyecto vivió cuatro specs sin poder leer quién aprobó un lote.
- **Sí:** los lotes finalizados **antes** de este spec quedan con `firma_aprobador = NULL` para siempre. No hay endpoint que los complete, y rellenarlos a mano sería inventar una firma.
- **Sí:** la firma es **irreversible**, como la finalización. No se reemplaza, no se corrige y no se borra por API. Una firma equivocada se arregla por SQL a mano, igual que una finalización equivocada desde el SPEC 20.
- **Sí:** el backend valida **formato y tamaño, nada más**. No comprueba que el trazo no esté en blanco, no decodifica el base64 para verificar que sea un PNG válido, y no lo compara contra nada.
- **No:** decodificar y validar los magic bytes del PNG. Se descarta: cuesta CPU en cada finalización, el regex ya acota el formato declarado, y un PNG corrupto se detecta al pintarlo.
- **No:** reencodear, recomprimir o redimensionar la imagen en el backend. Se descarta: el string se guarda tal como llega, byte por byte, que es lo que corresponde a una evidencia.
- **No:** subida de archivo (`multipart/form-data`) con almacenamiento en disco o bucket y una columna de URL, al estilo de `archivo_url` del SPEC 25. Se descarta: el proyecto no implementa storage en ninguna parte, y una firma de 20 KB en una columna es más simple que un archivo suelto que puede perderse aparte de la fila.
- **No:** firma digital criptográfica —certificado, hash del contenido del lote, sellado de tiempo, no repudio—. Se descarta: es otro problema, de otro tamaño. Esto guarda un trazo como evidencia operativa, no una firma electrónica avanzada. Queda en Risks.
- **No:** una columna `firma_aprobador_en`. Se descarta: `finalizado_en` ya es la fecha de la firma, porque se escriben en el mismo `UPDATE`.
- **No:** FK o índice sobre la columna. No apunta a ninguna fila y nadie va a buscar por ella. Los conteos de excepciones del proyecto quedan en 16 FKs y 6 `UNIQUE`s.
- **No:** validar el vínculo `cliente_operador` ahora que hay una firma de por medio. Se descarta: sería cambiar el control de acceso del endpoint dentro de un spec que va de otra cosa. Queda como está desde el SPEC 20 y en Risks.
- **No:** sembrar una fila en `catalogo_permisos` y `permisos`. Decimoquinto spec seguido que se salta la regla del SPEC 06, con el mismo argumento: sin `PermissionsGuard` la fila no cambia nada.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **Cambio incompatible: toda llamada actual sin body pasa a responder 400.** Si el frontend se despliega después del backend, la finalización queda rota en producción durante la ventana. | Sin mitigar en código, por decisión. La mitigación es de despliegue: coordinar el release del canvas con el del backend. Hay un criterio de aceptación que fija el 400 como comportamiento esperado, para que no se lea como un bug. |
| **La firma se escribe y no se puede leer por API.** Se finaliza un lote firmado y no hay forma de ver la firma salvo entrando a MySQL. | Sin mitigar por decisión explícita. La columna queda escrita desde el día uno, así que cuando llegue el spec de lectura el dato histórico ya existe. Mismo criterio del SPEC 13, 19 y 20. |
| **Esto no es una firma electrónica.** Un PNG en base64 no tiene criptografía, no está atado al contenido del lote y no da no repudio: cualquiera con acceso a MySQL puede sustituirlo, y cualquiera con el token puede mandar la firma de otro. | Sin mitigar, y es importante no venderlo como lo que no es. Su valor es operativo —evidencia de que alguien firmó en pantalla— no probatorio. Una firma avanzada es otro spec, de otro tamaño. |
| **Cualquier usuario autenticado puede finalizar cualquier lote**, y ahora además puede pegar la imagen que quiera como firma del cierre. La firma le da apariencia de formalidad a una escritura que sigue sin control de acceso. | Sin mitigar por diseño, igual que desde el SPEC 20. Este spec **empeora la lectura** del problema sin cambiar el problema. La salida sigue siendo el `PermissionsGuard`, sin dueño desde el SPEC 06. |
| **Peticiones de hasta ~500 KB contra un endpoint sin rate limiting.** El SPEC 23 no está implementado, así que nada limita cuántas se pueden mandar seguidas. | Mitigado en parte por el `.max()` del DTO, que rechaza antes de tocar la base, y porque el pipe corre antes de abrir la transacción. El límite de body de Express (100 KB por defecto en `body-parser`) puede además rechazar antes que Zod: **verificarlo en el paso 10**, porque daría un error distinto al esperado. |
| **El `.max()` del DTO y el límite de body de Express pueden no coincidir.** Si Express corta en 100 KB, el límite de 500.000 caracteres nunca se alcanza y el usuario ve un `PayloadTooLargeError`, no el mensaje del DTO. | Detectado por el paso 10 del plan. Si ocurre, la decisión —subir el límite de Express o bajar el del DTO— se toma con el dato en la mano y se anota en `CLAUDE.md`. No se cambia a ciegas. |
| **Un `selectAll()` en `LotesRepository` filtraría la firma** a cualquiera de las cuatro lecturas, igual que pasaría con `clientes.constancia_exonerado` del SPEC 25. Serían cientos de KB por fila en un listado. | Mitigado por el paso 15 del plan, que lo busca explícitamente, por un criterio de aceptación, y por la nota en `CLAUDE.md`. Las cuatro lecturas seleccionan columnas explícitas hoy. |
| **`MEDIUMTEXT` crece la tabla sin límite práctico.** Con miles de lotes finalizados, `lotes` engorda con datos que casi nunca se leen. | Aceptado. MySQL guarda `TEXT` fuera de la fila, así que las lecturas que no la seleccionan no pagan nada. Si alguna vez molesta, la salida es moverla a su propia tabla, que sería su spec. |
| **Hay DDL a mano y no hay tooling de migración.** Si la columna no se aplica en un ambiente, el `UPDATE` falla con un error de MySQL, no con un 400 legible. | Mitigado: los pasos 1 a 3 aplican y verifican el DDL **antes** de escribir código. Es la misma mecánica de los SPEC 10 a 13, 20 y 25. |
| **Si `sql_mode` no es estricto y alguien cambia la columna a `TEXT`**, una firma grande se guardaría truncada sin error y se pintaría rota. | El paso 1 verifica `@@sql_mode` y lo anota. La columna es `MEDIUMTEXT` precisamente para que el caso no se dé. |

---

## What is **not** in this spec

- Cualquier lectura de la firma: endpoint nuevo, campo nuevo en el listado de finalizados, o cambio a las otras tres lecturas de `lotes`.
- `GET /lotes/:id/firma`, y con él `GET /lotes/:id`.
- Firma del supervisor que aprueba, firma en los pesajes, y firma en los documentos fiscales del SPEC 25.
- El PIN de supervisor del diagrama para pesajes fuera de rango.
- Reemplazar, corregir o borrar una firma ya escrita, y deshacer una finalización.
- Rellenar la firma de los lotes ya finalizados.
- Subida de archivos, storage en disco o bucket, y columnas de URL.
- Firma digital criptográfica: certificados, hash del lote, sellado de tiempo, no repudio.
- Verificar que la firma no esté en blanco, decodificar el base64, o comparar contra una firma de referencia.
- Reencodear, recomprimir o redimensionar la imagen.
- Aceptar JPEG, WEBP, SVG o cualquier mime que no sea PNG, y una columna de mime aparte.
- Una fecha propia de la firma.
- FK o índice sobre la columna.
- Validar el vínculo `cliente_operador` en la finalización, el `PermissionsGuard`, `@Permisos()` y cualquier enforcement de permisos.
- Sembrar filas en `catalogo_permisos` o en `permisos`.
- Rate limiting y límites de tamaño de body a nivel de Express (SPEC 23).
- Cambios a `POST /lotes`, `PATCH /lotes/:id/rechazar`, `PATCH /lotes/:id/aprobar`, `PATCH /lotes/:id/rechazar/byApprover`, a las cuatro lecturas de `lotes`, y a los endpoints de `pesajes`, `clientes`, `auth`, `permisos`, `catalogos` y `documentos-fiscales`.
- Tests de cualquier tipo.

Cada uno de estos, si se necesita, va en su propio spec.
