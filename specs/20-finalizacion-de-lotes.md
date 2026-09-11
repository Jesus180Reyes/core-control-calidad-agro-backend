# SPEC 20 — Finalización de lotes por el aprobador

> **Status:** Implemented
> **Depends on:** SPEC 02, SPEC 13, SPEC 19
> **Date:** 2026-09-11
> **Objective:** Agregar `PATCH /lotes/:id/finalizar/byApprover`, que mueve un lote cerrado en `CLIENTE_FINAL` —con todos sus pesajes activos ya revisados— a la etapa `FINALIZADO` y registra quién lo finalizó y cuándo.

---

## Why this spec exists

`FINALIZADO` es la única de las cuatro filas de `etapas` que **nada escribe nunca**. `createLote` escribe `EN_PROCESO`, los dos rechazos escriben `RECHAZADO` y `aprobarLote` escribe `CLIENTE_FINAL`. La cuarta lleva desde el primer día en la base sin que ninguna línea de código la use.

SPEC 19 completó el flujo del aprobador a nivel de pesaje: ya puede aprobar y rechazar cada pesaje de un lote en cliente final. Lo que no puede es **cerrar el trabajo**. Un lote revisado de punta a punta se queda en `CLIENTE_FINAL` para siempre, indistinguible de uno que el aprobador todavía no abrió. Ese es el hueco que cierra este spec.

Tres cosas conviene tener claras antes de leer el resto.

**La primera: finalizar es el último paso del flujo, no un paso más.** El lote ya está `cerrado` desde `PATCH /lotes/:id/aprobar` (SPEC 13). Este spec **no** vuelve a escribir `estado` ni `cerrado_en`: escribe la etapa y el par de auditoría, igual que `rechazarLoteForApprover` escribe la etapa y el trío de rechazo sin tocar `estado`.

**La segunda: finalizar congela el lote.** Los tres endpoints del aprobador —`PATCH /lotes/:id/rechazar/byApprover`, `PATCH /pesajes/:id/aprobar/byApprover` y `PATCH /pesajes/:id/rechazar/byApprover`— exigen que el lote esté en `CLIENTE_FINAL`. Al pasar a `FINALIZADO` los tres empiezan a responder 400. No es un efecto lateral: es el punto de finalizar, y no requiere escribir código nuevo para lograrlo.

**La tercera: el lote finalizado deja de ser visible por API.** Las dos lecturas de `lotes` filtran `estado = 'abierto'` y la bandeja del aprobador filtra `etapa_id = 2` clavado, así que un lote en `FINALIZADO` no sale en ninguna de las tres. Es el mismo destino que ya tienen los lotes rechazados y aprobados, y es decisión explícita: la lectura de lotes finalizados va en su propio spec.

---

## Scope

**In:**

- DDL a mano en MySQL: dos columnas nullables en `lotes`, `finalizado_por INT NULL` y `finalizado_en DATETIME NULL`, más la FK de `finalizado_por` a `usuarios(id)`.
- Actualizar `LotesTable` en `src/database/types/types.ts` con las dos columnas nuevas.
- Nuevo método `finalizarLote(loteId, userId)` en `src/modules/lotes/repository/lotes.repository.ts`, dentro de una transacción.
- Nuevo método `finalizar(loteId, userId)` en `src/modules/lotes/lotes.service.ts`, pass-through al repositorio.
- Nuevo handler `@Patch(':id/finalizar/byApprover')` en `src/modules/lotes/lotes.controller.ts`, con `@Param('id', ParseIntPipe)` y **sin `@Body()`**.
- Nuevo endpoint `PATCH /lotes/:id/finalizar/byApprover`, protegido solo por el `JwtAuthGuard` global.
- El `UPDATE` escribe exactamente **tres** columnas: `etapa_id` (la fila de `etapas` con `codigo = 'FINALIZADO'`, resuelta por `codigo`), `finalizado_por` (del `req.user.userId`) y `finalizado_en` (`NOW()` de MySQL).
- Nuevo validador privado `validateLoteNoFinalizado(loteId, db)` en `LotesRepository`, que corre **antes** de `validateLoteEnClienteFinal` para dar un mensaje dedicado al lote ya finalizado.
- Nuevo validador privado `validatePesajesRevisados(lote, db)` en `LotesRepository`, que lanza 400 si queda algún pesaje con `isActive = 1` y `aprobado IS NULL`.
- Reuso de los validadores existentes `validateLoteEnClienteFinal`, `validateLoteTienePesajes` y `resolveEtapa`, **sin modificarlos**.
- Respuesta `200` con la forma `{ ok, msg }`, sin payload de recurso y sin body en la petición.
- `400` si el lote no existe, ya fue finalizado, ya fue rechazado, no está cerrado, no está en `CLIENTE_FINAL`, no tiene pesajes activos, o tiene pesajes activos sin revisar.
- Actualizar `CLAUDE.md`: el endpoint nuevo, el DDL, los conteos que cambian y el hecho de que `FINALIZADO` ya se escribe.

**Out of scope (for future specs):**

- Cualquier lectura de lotes finalizados: ni endpoint nuevo, ni parámetro, ni cambio a las tres lecturas existentes. El lote finalizado queda **invisible por API**.
- Corregir el `where('lotes.etapa_id', '=', 2)` clavado de `getAllLotesByClienteForApprover`. Sigue fuera de alcance, igual que en SPEC 19.
- Deshacer una finalización, o reabrir un lote finalizado.
- Finalizar automáticamente al aprobar el último pesaje sin revisar. La finalización es una acción humana explícita.
- Finalizar varios lotes en una llamada.
- Devolver `finalizado_por` o `finalizado_en` en algún endpoint de lectura. Nacen invisibles, igual que `aprobado_por` y `aprobado_en`.
- Un motivo, observación o comentario de finalización. El endpoint no recibe body.
- Exigir que todos los pesajes estén **aprobados**: un lote con pesajes rechazados por el aprobador se puede finalizar.
- Agregados por lote (peso total, conteos por estado de calidad) y `resumen_ia`. Finalizar no calcula nada.
- Cerrar el lote como resultado computado. `estado` y `cerrado_en` ya vienen escritos de SPEC 13 y este spec no los toca.
- Sembrar filas en `catalogo_permisos` o en `permisos`, y **aplicar** permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`.
- Validar el vínculo `cliente_operador`, exigir un rol de aprobador, o exigir que quien finaliza no sea quien aprobó el lote.
- Unificar las copias de `validateLoteEnClienteFinal` y `resolveEtapa` entre `LotesRepository` y `PesajesRepository`.
- Cambios a `POST /lotes`, `PATCH /lotes/:id/rechazar`, `PATCH /lotes/:id/aprobar`, `PATCH /lotes/:id/rechazar/byApprover`, a las tres lecturas de `lotes` y a cualquier endpoint de `pesajes`, `clientes`, `auth`, `permisos` o `catalogos`.

---

## Data model

### DDL nuevo

```sql
ALTER TABLE lotes
  ADD COLUMN finalizado_por INT NULL AFTER aprobado_en,
  ADD COLUMN finalizado_en DATETIME NULL AFTER finalizado_por;

ALTER TABLE lotes
  ADD CONSTRAINT fk_lotes_finalizado_por
  FOREIGN KEY (finalizado_por) REFERENCES usuarios(id);
```

Las dos columnas son nullables y ninguna fila existente se toca: todos los lotes de hoy quedan con `finalizado_por = NULL` y `finalizado_en = NULL`, que es exactamente lo que corresponde.

El par es el **espejo** de `aprobado_por` / `aprobado_en` que SPEC 13 agregó a la misma tabla. **No hay tercera columna de texto**, porque la finalización no lleva motivo, igual que la aprobación.

Esa FK es la **octava** excepción del proyecto a la regla de validar solo en código, después de `permisos` → `roles`, las cuatro de auditoría de SPEC 10 a 13, `permisos.permiso_id` de SPEC 14 y `pesajes.aprobado_por` que adoptó SPEC 19. Misma justificación: es auditoría y una fila huérfana la dejaría sin valor probatorio.

### `LotesTable`

```ts
export interface LotesTable {
  // ...campos existentes sin cambios...
  motivo_rechazo: string | null;
  rechazado_por: number | null;
  rechazado_en: Date | string | null;
  aprobado_por: number | null;
  aprobado_en: Date | string | null;
  finalizado_por: number | null;      // nueva
  finalizado_en: Date | string | null; // nueva
}
```

### El `UPDATE`

```sql
UPDATE lotes
SET etapa_id = <id de la fila con codigo = 'FINALIZADO'>,
    finalizado_por = ?,
    finalizado_en = NOW()
WHERE id = ?;
```

Son tres columnas. **No toca** `estado`, `cerrado_en`, `motivo_rechazo`, `rechazado_por`, `rechazado_en`, `aprobado_por`, `aprobado_en`, `cliente_id`, `nombre_lote`, `producto_id`, `unidad_medida_id`, los tres pesos, `variedad_o_talla`, `resumen_ia`, `created_by` ni `created_at`.

`estado` ya vale `'cerrado'` y `cerrado_en` ya está escrito desde `PATCH /lotes/:id/aprobar`. Volver a escribirlos movería la hora de cierre a la de la finalización, que es otro momento. Es el mismo criterio con el que `rechazarLoteForApprover` deja `estado` y `cerrado_en` intactos.

`finalizado_en` se escribe con `NOW()` de MySQL, no con un `new Date()` de Node: misma fuente de hora que `created_at`, como en SPEC 10 a 13 y 19.

La etapa se resuelve con `resolveEtapa('FINALIZADO', trx)`. **El número `4` no aparece en el código.**

### Definición de "finalizable"

Un lote se puede finalizar si cumple **las cinco** condiciones, verificadas en este orden:

1. Existe, y su `etapa_id` **no** es el de la fila `FINALIZADO` — el validador nuevo `validateLoteNoFinalizado`.
2. `motivo_rechazo IS NULL`, `estado = 'cerrado'` y su `etapa_id` es el de la fila `CLIENTE_FINAL` — el validador existente `validateLoteEnClienteFinal`, sin cambios.
3. Tiene al menos un pesaje con `isActive = 1` — el validador existente `validateLoteTienePesajes`, sin cambios.
4. Ningún pesaje con `isActive = 1` tiene `aprobado IS NULL` — el validador nuevo `validatePesajesRevisados`.
5. Existe la fila `codigo = 'FINALIZADO'` en `etapas` — `resolveEtapa`.

Los cinco pasos corren **dentro** de la transacción, recibiendo el `trx`.

La condición 1 existe solo para el mensaje: sin ella, un lote ya finalizado cortaría en la condición 2 con `no esta en la etapa CLIENTE_FINAL`, que es confuso para un lote que sí pasó por ahí. Cuesta un `SELECT` extra sobre la misma fila; ver Decisions.

La condición 4 es la regla de negocio del spec: **finalizar significa "ya revisé todo"**. Un pesaje con `aprobado = NULL` es uno que el aprobador no miró, y `NULL` no significa "no aprobado" — ver la tabla de tres estados de SPEC 19.

La condición 4 **no** exige que los pesajes estén aprobados. Un lote donde el aprobador rechazó todos sus pesajes (`aprobado = 0`) se finaliza igual: quedó revisado, que es lo que la condición pide.

### Los pesajes que cuentan

| Pesaje | ¿Bloquea la finalización? |
| --- | --- |
| `isActive = 1`, `aprobado IS NULL` | **Sí.** Es lo que el validador busca. |
| `isActive = 1`, `aprobado = 1` | No. Revisado y aprobado. |
| `isActive = 1`, `aprobado = 0` | No. Revisado y rechazado por el aprobador. |
| `isActive = 0` (anulado por el operador) | No. No se cuenta ni para el mínimo de uno ni para los pendientes. |

Un pesaje anulado con `PATCH /pesajes/:id/rechazar` nunca llegó al aprobador, así que exigir que esté revisado dejaría lotes imposibles de finalizar.

### Petición y respuestas

```
PATCH /lotes/12/finalizar/byApprover
Authorization: Bearer <token>
```

```json
{
  "ok": true,
  "msg": "Lote finalizado correctamente"
}
```

Errores, todos `400` con la forma estándar de Nest:

| Caso | Mensaje |
| --- | --- |
| El lote no existe | `El lote con id '12' no existe` |
| El lote ya fue finalizado | `El lote 'LOTE-001' ya fue finalizado` |
| El lote fue rechazado | `El lote 'LOTE-001' ya fue rechazado` |
| El lote no está cerrado | `El lote 'LOTE-001' no esta cerrado` |
| El lote no está en cliente final | `El lote 'LOTE-001' no esta en la etapa CLIENTE_FINAL` |
| El lote no tiene pesajes activos | `El lote 'LOTE-001' no tiene pesajes registrados` |
| Quedan pesajes sin revisar | `El lote 'LOTE-001' tiene pesajes sin revisar por el aprobador` |
| Falta la fila `FINALIZADO` en `etapas` | `La etapa con codigo 'FINALIZADO' no existe` |
| Falta la fila `CLIENTE_FINAL` en `etapas` | `La etapa con codigo 'CLIENTE_FINAL' no existe` |
| `id` de ruta no numérico | El error de `ParseIntPipe` |
| Sin header `Authorization` | 401 del `JwtAuthGuard` |

No hay error de Zod: no hay body que validar.

### Qué pasa con el lote después de finalizarlo

| Endpoint | Antes de finalizar | Después de finalizar |
| --- | --- | --- |
| `GET /lotes/cliente/:clienteId` | no lo lista (filtra `abierto`) | no lo lista |
| `GET /lotes/cliente/:clienteId/all` | no lo lista (filtra `abierto`) | no lo lista |
| `GET /lotes/cliente/:clienteId/all/approver` | **lo lista** | **deja de listarlo** (`etapa_id` ya no es 2) |
| `PATCH /lotes/:id/rechazar/byApprover` | 200 | **400** `no esta en la etapa CLIENTE_FINAL` |
| `PATCH /lotes/:id/aprobar` | 400 (ya cerrado) | 400 (ya cerrado) |
| `PATCH /pesajes/:id/aprobar/byApprover` | 200 | **400** `no esta en la etapa CLIENTE_FINAL` |
| `PATCH /pesajes/:id/rechazar/byApprover` | 200 | **400** `no esta en la etapa CLIENTE_FINAL` |
| `POST /pesajes` | 400 (lote cerrado) | 400 (lote cerrado) |
| `PATCH /pesajes/:id/rechazar` | 400 (lote cerrado) | 400 (lote cerrado) |
| `GET /pesajes/byLote/:loteId` | lista sus pesajes | **sin cambios**: los sigue listando |
| `GET /pesajes/historial` | muestra el `nombre_lote` | **sin cambios** |

**El lote queda congelado y fuera de toda lectura de `lotes`.** Sus pesajes siguen siendo visibles por los dos `GET` de `pesajes`, que no miran la etapa.

### Cómo distinguir los estados de un lote, actualizado

`estado = 'cerrado'` ahora significa **tres** cosas, y la columna sigue sin poder distinguirlas:

| Señal | Rechazado | Aprobado (en `CLIENTE_FINAL`) | Finalizado |
| --- | --- | --- | --- |
| `estado` | `'cerrado'` | `'cerrado'` | `'cerrado'` — **inútil como discriminador** |
| `cerrado_en` | escrito | escrito | escrito — **también inútil** |
| `motivo_rechazo` | `NOT NULL` | `NULL` | `NULL` |
| `aprobado_por` / `aprobado_en` | `NULL` | `NOT NULL` | `NOT NULL` — la finalización **no** los borra |
| `finalizado_por` / `finalizado_en` | `NULL` | `NULL` | `NOT NULL` — **la señal canónica de la finalización** |
| `etapa_id` | fila `RECHAZADO` | fila `CLIENTE_FINAL` | fila `FINALIZADO` |

Un lote finalizado es un lote aprobado que además se cerró: conserva `aprobado_por`, así que `aprobado_por IS NOT NULL` sigue siendo la señal de "pasó por la aprobación del supervisor". Para "el aprobador terminó con él", la señal es `finalizado_por IS NOT NULL`.

Después de este spec, las cuatro filas de `etapas` tienen código que las escribe: `EN_PROCESO` por `createLote`, `RECHAZADO` por los dos rechazos de lote, `CLIENTE_FINAL` por `aprobarLote` y `FINALIZADO` por este spec.

### DTO

**Este endpoint no tiene DTO.** No recibe body: el `id` viene en la ruta y el usuario del token. Es el tercer endpoint de escritura del proyecto sin schema Zod, después de `PATCH /lotes/:id/aprobar` (SPEC 13) y `PATCH /pesajes/:id/aprobar/byApprover` (SPEC 19). Un body enviado de todas formas se ignora.

---

## Implementation plan

1. Verificar el estado de la base antes de tocar nada: `DESCRIBE lotes;` para confirmar que `finalizado_por` y `finalizado_en` **no** existen todavía, y `SELECT id, codigo, nombre FROM etapas;` para confirmar que existe la fila `codigo = 'FINALIZADO'` y anotar su `id`. Confirmar también el `id` de `CLIENTE_FINAL` y que sigue siendo **2**, que es lo que `getAllLotesByClienteForApprover` tiene clavado.
2. Aplicar a mano el DDL de las dos columnas y la FK, tal como está en el modelo de datos. Verificar con `DESCRIBE lotes;` y `SHOW CREATE TABLE lotes;`. Confirmar con `SELECT COUNT(*) FROM lotes WHERE finalizado_por IS NOT NULL;` que da **0**.
3. Agregar `finalizado_por` y `finalizado_en` a `LotesTable` en `src/database/types/types.ts`. Confirmar que compila (`npm run build`) y que ningún otro archivo cambió.
4. Preparar los datos de prueba: un lote con al menos dos pesajes activos, aprobado con `PATCH /lotes/:id/aprobar` para que quede `cerrado` en `CLIENTE_FINAL`. Confirmar que aparece en `GET /lotes/cliente/:clienteId/all/approver` y que sus pesajes salen con `aprobado: null`. **No revisarlos todavía.**
5. Agregar el validador privado `validatePesajesRevisados(lote, db)` a `LotesRepository`: busca el primer pesaje con `lote_id = lote.id`, `isActive = 1` y `aprobado is null` con `limit(1)`; si lo encuentra, lanza `BadRequestException` con `El lote '${lote.nombre_lote}' tiene pesajes sin revisar por el aprobador`. Mismo molde que `validateLoteTienePesajes`.
6. Agregar el validador privado `validateLoteNoFinalizado(loteId, db)` a `LotesRepository`: selecciona `id`, `nombre_lote` y `etapa_id` del lote, lanzando el 400 de `no existe` si no está; resuelve la etapa `FINALIZADO` con `resolveEtapa` y, si `lote.etapa_id` coincide, lanza `BadRequestException` con `El lote '${lote.nombre_lote}' ya fue finalizado`. Devuelve el lote.
7. Agregar `finalizarLote(loteId, userId)` a `LotesRepository`: abre `this.db.transaction().execute(...)`, llama en orden a `validateLoteNoFinalizado`, `validateLoteEnClienteFinal`, `validateLoteTienePesajes`, `validatePesajesRevisados` y `resolveEtapa('FINALIZADO', trx)`, y ejecuta el `updateTable('lotes').set({ etapa_id: etapa.id, finalizado_por: userId, finalizado_en: sql\`NOW()\` }).where('id', '=', loteId)`. No llama a `validateVinculoOperador`. Devuelve `true`.
8. Agregar `finalizar(loteId, userId)` a `LotesService` como pass-through, igual en forma a `aprobar`.
9. Agregar el handler `@Patch(':id/finalizar/byApprover')` a `LotesController`, declarado **después** de `@Patch(':id/aprobar')`, con `@Param('id', ParseIntPipe) id: number` y `@Req() req: Request`, **sin `@Body()`**. Responde `{ ok: finalizado, msg: 'Lote finalizado correctamente' }`. Sin `@Public()` y sin `@HttpCode`.
10. Levantar con `npm run start:dev` y confirmar que `PATCH /lotes/:id/finalizar/byApprover` aparece en el log de rutas de Nest y que las otras seis rutas de `lotes` siguen apareciendo.
11. Verificación del camino bloqueado: finalizar el lote del paso 4 **con sus pesajes sin revisar** y confirmar 400 `tiene pesajes sin revisar por el aprobador`, y que `etapa_id`, `finalizado_por` y `finalizado_en` no cambiaron.
12. Revisar los pesajes: aprobar uno con `PATCH /pesajes/:id/aprobar/byApprover` y rechazar el otro con `PATCH /pesajes/:id/rechazar/byApprover`. Confirmar que quedan `aprobado = 1` y `aprobado = 0`, los dos con `isActive = 1`.
13. Verificación del camino feliz: finalizar el lote, confirmar 200 con `{ ok, msg }`, y confirmar en MySQL que la fila tiene `etapa_id` de `FINALIZADO`, `finalizado_por` con el id del token y `finalizado_en` con la hora actual, y que `estado`, `cerrado_en`, `aprobado_por`, `aprobado_en`, `motivo_rechazo`, `rechazado_por`, `rechazado_en`, los tres pesos y `created_at` **no cambiaron**. **Este es el primer `FINALIZADO` escrito por código en el proyecto.**
14. Verificación de que el lote se congela: sobre el lote ya finalizado, `PATCH /lotes/:id/rechazar/byApprover` responde 400 `no esta en la etapa CLIENTE_FINAL`, y lo mismo `PATCH /pesajes/:id/aprobar/byApprover` y `PATCH /pesajes/:id/rechazar/byApprover` sobre cualquiera de sus pesajes.
15. Verificación de la doble finalización: finalizar otra vez el mismo lote y confirmar 400 `ya fue finalizado`, con `finalizado_por` y `finalizado_en` intactos. **Este es el mensaje que el paso 6 existe para dar.**
16. Verificación de las lecturas: confirmar que el lote finalizado **no** aparece en `GET /lotes/cliente/:clienteId/all/approver`, ni en `GET /lotes/cliente/:clienteId`, ni en `GET /lotes/cliente/:clienteId/all`. Confirmar que sus pesajes **sí** siguen apareciendo en `GET /pesajes/byLote/:loteId` con los mismos campos de antes, y que ni ahí ni en `GET /pesajes/historial` aparece nada de `finalizado_por` o `finalizado_en`.
17. Verificación de los demás errores: finalizar un `id` inexistente (400 `no existe`); un lote **abierto** en `EN_PROCESO` (400 `no esta cerrado`); un lote rechazado con `PATCH /lotes/:id/rechazar` (400 `ya fue rechazado`); un lote rechazado por el aprobador con `PATCH /lotes/:id/rechazar/byApprover` (400 `ya fue rechazado`); `PATCH /lotes/abc/finalizar/byApprover` (400 de `ParseIntPipe`); sin header `Authorization` (401).
18. Verificación del caso sin pesajes: poner a mano `isActive = 0` en todos los pesajes de un lote cerrado en `CLIENTE_FINAL` y finalizarlo. Confirmar 400 `no tiene pesajes registrados`, no 200.
19. Verificación de la ausencia de control de acceso: login con un `Operador` **sin** fila en `cliente_operador` para el cliente del lote y confirmar que finaliza igual, con **200 y no 403**. Es el resultado esperado de este spec.
20. Verificación de que nada más cambió: `POST /lotes`, `PATCH /lotes/:id/rechazar`, `PATCH /lotes/:id/aprobar`, las tres lecturas de `lotes`, los cinco endpoints de `pesajes` con sus filtros de SPEC 16, los cuatro de `clientes`, `GET /permisos/me`, los tres `GET /catalogos/*` y los dos de `auth` responden igual. Confirmar que `permisos` sigue con **14 filas** y `catalogo_permisos` con **9**.
21. Actualizar `CLAUDE.md`:
    - Agregar `PATCH /lotes/:id/finalizar/byApprover` a la fila `lotes` de la tabla de endpoints, con sus cinco validaciones, sus tres columnas y el hecho de que congela el lote.
    - Documentar el DDL de `finalizado_por` / `finalizado_en` y su FK como la **octava** excepción a la regla de validar solo en código.
    - Borrar la afirmación de que **`FINALIZADO` nunca lo escribe nada**, que aparece en varios puntos del archivo, y anotar que las cuatro filas de `etapas` ya tienen código que las escribe.
    - Reemplazar la tabla de discriminación de `lotes.estado` por la de tres columnas de este spec: `'cerrado'` significa rechazado, aprobado **o finalizado**, y la señal canónica de la finalización es `finalizado_por IS NOT NULL`.
    - Anotar que un lote finalizado **no aparece en ninguna lectura de `lotes`**, y que los tres endpoints del aprobador empiezan a responder 400 sobre él.
    - Corregir los conteos: `PATCH`es, `UPDATE`s y escrituras abiertas a cualquier autenticado pasan de **siete** a **ocho**; las rutas que se saltan `validateVinculoOperador` deliberadamente pasan de doce a **trece** (más la decimocuarta que nunca lo tuvo, `GET /lotes/cliente/:clienteId/all`); los endpoints de escritura sin body ni DTO pasan de dos a **tres**.
    - Anotar en la sección de trabajo diferido que sigue **sin** existir cierre de lote como resultado computado, ni agregados, ni `resumen_ia`, y que no hay lectura de lotes finalizados.

---

## Acceptance criteria

- [X] `DESCRIBE lotes;` muestra `finalizado_por INT NULL` y `finalizado_en DATETIME NULL`, y `SHOW CREATE TABLE lotes;` la FK de `finalizado_por` a `usuarios(id)`.
- [X] El DDL no modificó ninguna fila existente: todos los lotes anteriores quedan con `finalizado_por` y `finalizado_en` en `NULL`.
- [X] `LotesTable` en `src/database/types/types.ts` declara las dos columnas nuevas, y ninguna otra interfaz del archivo cambió.
- [X] No se creó ningún DTO: `src/modules/lotes/dto/` sigue con exactamente dos archivos (`create-lote.dto.ts`, `rechazar-lote.dto.ts`).
- [X] No se creó ningún módulo, controller, service ni repositorio nuevo: solo se modificaron `lotes.controller.ts`, `lotes.service.ts`, `repository/lotes.repository.ts` y `types.ts`.
- [X] `src/app.module.ts` no cambió y la app arranca sin errores de compilación.
- [X] `PATCH /lotes/:id/finalizar/byApprover` aparece en el log de rutas de Nest, y las otras seis rutas de `lotes` siguen apareciendo.
- [X] El handler no tiene `@Body()` y el endpoint funciona con una petición sin body.
- [X] Finalizar un lote cerrado en `CLIENTE_FINAL`, con al menos un pesaje activo y **todos** sus pesajes activos revisados, responde 200 con exactamente `{ ok: true, msg: 'Lote finalizado correctamente' }`.
- [X] La respuesta **no** incluye ninguna clave de recurso: no hay `lote`, ni `data`.
- [X] Después de finalizar, la fila tiene `etapa_id` igual al de la fila `codigo = 'FINALIZADO'` de `etapas`, `finalizado_por` con el `userId` del token y `finalizado_en` con la hora de la finalización.
- [X] Después de finalizar, `estado` sigue en `'cerrado'` y `cerrado_en` conserva **la hora de la aprobación**, no la de la finalización.
- [X] Después de finalizar, `aprobado_por` y `aprobado_en` **conservan** los valores que escribió `PATCH /lotes/:id/aprobar`: la finalización no los sobrescribe ni los borra.
- [X] Después de finalizar, `motivo_rechazo`, `rechazado_por` y `rechazado_en` siguen en `NULL`.
- [X] La finalización **no** modifica `cliente_id`, `nombre_lote`, `producto_id`, `unidad_medida_id`, `peso_minimo`, `peso_ideal`, `peso_maximo`, `variedad_o_talla`, `resumen_ia`, `created_by` ni `created_at`.
- [X] La finalización **no** modifica ninguna fila de `pesajes`: los `aprobado`, `aprobado_por`, `aprobado_en` e `isActive` de sus pesajes quedan idénticos.
- [X] El número `4` **no aparece** en ninguna línea del código nuevo: la etapa se resuelve por `codigo`.
- [X] Finalizar un lote con **algún** pesaje activo en `aprobado IS NULL` responde 400 con `El lote 'X' tiene pesajes sin revisar por el aprobador`, y ninguna columna cambia.
- [X] Un lote cuyos pesajes activos están **todos rechazados** por el aprobador (`aprobado = 0`) se finaliza igual: responde 200.
- [X] Un pesaje anulado por el operador (`isActive = 0`) con `aprobado IS NULL` **no** bloquea la finalización.
- [X] Finalizar un lote **sin ningún** pesaje activo responde 400 con `El lote 'X' no tiene pesajes registrados`, no 200.
- [X] Finalizar un lote **ya finalizado** responde 400 con `El lote 'X' ya fue finalizado`, y `finalizado_por` y `finalizado_en` quedan intactos.
- [X] Finalizar un lote **abierto** responde 400 con `El lote 'X' no esta cerrado`.
- [X] Finalizar un lote **rechazado**, por cualquiera de los dos endpoints de rechazo, responde 400 con `El lote 'X' ya fue rechazado`.
- [X] Finalizar un lote cerrado que no está en `CLIENTE_FINAL` responde 400 con `no esta en la etapa CLIENTE_FINAL`.
- [X] Finalizar un `id` que no existe responde 400 con `El lote con id 'X' no existe`, no 404 y no 500.
- [X] Si falta la fila `codigo = 'FINALIZADO'` en `etapas`, responde 400 `La etapa con codigo 'FINALIZADO' no existe`.
- [X] Un `id` de ruta no numérico responde 400 por `ParseIntPipe`.
- [X] Sin header `Authorization`, o con un token inválido, responde 401: el endpoint no es `@Public()`.
- [X] Un `Operador` **sin** fila en `cliente_operador` para el cliente del lote finaliza igual: responde **200, no 403**. **Este spec no valida el vínculo.**
- [X] No se exige ningún rol, y `req.user` sigue siendo `{ userId, username }`.
- [X] Quien finaliza puede ser el mismo usuario que aprobó el lote: no se compara contra `aprobado_por`.
- [X] Cuando cualquier validación falla, ninguna columna cambia: la transacción no deja escrituras parciales.
- [X] Sobre un lote ya finalizado, `PATCH /lotes/:id/rechazar/byApprover` responde 400 `no esta en la etapa CLIENTE_FINAL`.
- [X] Sobre los pesajes de un lote ya finalizado, `PATCH /pesajes/:id/aprobar/byApprover` y `PATCH /pesajes/:id/rechazar/byApprover` responden 400 `no esta en la etapa CLIENTE_FINAL`.
- [X] El lote finalizado **no** aparece en `GET /lotes/cliente/:clienteId/all/approver`, ni en `GET /lotes/cliente/:clienteId`, ni en `GET /lotes/cliente/:clienteId/all`.
- [X] Los pesajes del lote finalizado **siguen** apareciendo en `GET /pesajes/byLote/:loteId` y en `GET /pesajes/historial`, con exactamente los mismos campos que antes.
- [X] Ninguna respuesta de la API devuelve `finalizado_por` ni `finalizado_en`.
- [X] `validateLoteEnClienteFinal`, `validateLoteTienePesajes`, `validateLoteAbierto`, `validateEtapaEnProceso`, `resolveEtapa`, `resolveEtapaRechazado` y `validateVinculoOperador` **no se modificaron**: ni firma, ni condición, ni mensajes, ni `select`.
- [X] `POST /lotes`, `PATCH /lotes/:id/rechazar`, `PATCH /lotes/:id/aprobar` y `PATCH /lotes/:id/rechazar/byApprover` funcionan exactamente igual que antes.
- [X] Los cinco endpoints de `pesajes`, los cuatro de `clientes`, `GET /permisos/me`, los tres `GET /catalogos/*` y los dos de `auth` responden igual.
- [X] `permisos` sigue con exactamente **14 filas** y `catalogo_permisos` con **9**: no se sembró ninguna fila.
- [X] No existe ningún endpoint para deshacer una finalización, para reabrir un lote, para finalizar varios lotes en una llamada, ni para listar lotes finalizados.
- [X] Aprobar el último pesaje sin revisar de un lote **no** lo finaliza: la finalización solo ocurre por llamada explícita a este endpoint.
- [X] `CLAUDE.md` documenta `PATCH /lotes/:id/finalizar/byApprover`, el DDL como octava excepción, y ya **no** dice que `FINALIZADO` no lo escribe nada.
- [X] `CLAUDE.md` tiene la tabla de discriminación actualizada a tres estados de `'cerrado'`, con `finalizado_por IS NOT NULL` como señal canónica.
- [X] Los conteos de `CLAUDE.md` quedan en **ocho** `PATCH`es, **ocho** `UPDATE`s, **ocho** escrituras abiertas a cualquier autenticado, **trece** rutas que se saltan `validateVinculoOperador` deliberadamente y **tres** endpoints de escritura sin body ni DTO.

---

## Decisions

- **Sí:** finalizar un lote es escribir `etapa_id = FINALIZADO`, `finalizado_por` y `finalizado_en`. Decisión explícita del usuario. Es el espejo de `aprobarLote` y la primera operación del proyecto que escribe la cuarta fila de `etapas`.
- **Sí:** DDL nuevo, dos columnas de auditoría en `lotes` más la FK a `usuarios(id)`. Decisión explícita del usuario. Sigue el patrón de SPEC 10 a 13: toda operación deja autor y fecha.
- **No:** escribir solo `etapa_id`, sin auditoría. Se descarta: la finalización es el último acto del flujo y sería la única escritura del proyecto sin rastro, justo al lado de un rechazo y una aprobación que sí lo tienen.
- **No:** reusar `aprobado_por` / `aprobado_en` sobrescribiéndolos. Se descarta: ese par es la firma del supervisor que mandó el lote a `CLIENTE_FINAL`, y sobrescribirlo borraría quién hizo ese paso. Los dos pares conviven y responden preguntas distintas.
- **No:** una tercera columna de texto para un motivo u observación de finalización. Se descarta: finalizar no lleva texto libre, igual que aprobar.
- **Sí:** el endpoint exige que **todos** los pesajes activos estén revisados (`aprobado IS NOT NULL`). Decisión explícita del usuario. Es lo que significa finalizar: el aprobador terminó de mirar el lote.
- **No:** exigir que todos estén **aprobados** (`aprobado = 1`). Se descarta: un solo pesaje rechazado por el aprobador bloquearía la finalización para siempre, y la revisión es irreversible por decisión de SPEC 19. Un lote con pesajes rechazados también terminó de revisarse.
- **No:** no mirar `aprobado` en absoluto, exigiendo solo que haya pesajes. Se descarta: dejaría finalizar un lote que el aprobador nunca abrió, que es justo lo que el endpoint debería impedir.
- **Sí:** además se exige **al menos un pesaje activo**, reusando `validateLoteTienePesajes`. Decisión explícita del usuario. Sin eso, un lote con cero pesajes activos cumpliría "todos revisados" vacíamente y se finalizaría vacío.
- **Sí:** los pesajes anulados (`isActive = 0`) se ignoran en las dos condiciones. Nunca llegaron al aprobador, así que exigir que estén revisados dejaría lotes imposibles de finalizar.
- **Sí:** se exige que el lote esté cerrado, en `CLIENTE_FINAL` y sin `motivo_rechazo`, reusando `validateLoteEnClienteFinal` sin modificarlo. Es la misma precondición de los tres endpoints del aprobador, y el validador ya existe.
- **Sí:** un mensaje dedicado, `ya fue finalizado`, con un validador propio que corre **antes**. Decisión explícita del usuario. Sin él, finalizar dos veces respondería `no esta en la etapa CLIENTE_FINAL`, que es confuso para un lote que sí estuvo ahí. Mismo criterio con el que SPEC 19 distinguió `ya fue aprobado` de `ya fue rechazado`.
- **Sí:** ese validador hace un `SELECT` propio sobre la misma fila, así que el método consulta `lotes` dos veces. Se acepta el costo: la alternativa es modificar `validateLoteEnClienteFinal`, que es compartido con `rechazarLoteForApprover` y cambiaría los mensajes de un endpoint ya en producción.
- **No:** modificar `validateLoteEnClienteFinal` para que distinga el lote finalizado. Se descarta por lo anterior. Consecuencia asumida: `PATCH /lotes/:id/rechazar/byApprover` sobre un lote finalizado sigue devolviendo el mensaje genérico.
- **Sí:** `PATCH /lotes/:id/finalizar/byApprover`, con el sufijo `/byApprover`. Decisión explícita del usuario. Es la convención de las otras tres rutas del aprobador, y `finalizar` nombra la etapa destino sin chocar con el `/aprobar` del supervisor.
- **No:** `PATCH /lotes/:id/aprobar/byApprover` como espejo del de pesajes. Se descarta: se confundiría con `PATCH /lotes/:id/aprobar` y no dice que la etapa pasa a `FINALIZADO`.
- **Sí:** **sin body y sin DTO**. Decisión explícita del usuario. Tercer endpoint de escritura del proyecto sin schema Zod, después de los dos `aprobar`.
- **Sí:** la respuesta es solo `{ ok, msg }`. Los ocho `PATCH` del proyecto quedan con la misma forma.
- **Sí:** `finalizado_en` con `NOW()` de MySQL, no con `new Date()` de Node. Se mantiene la decisión de SPEC 10 a 13 y 19.
- **Sí:** el `UPDATE` y sus validaciones van dentro de una transacción, con los validadores recibiendo el `trx`. Es la convención de escritura del proyecto.
- **Sí:** **no** se vuelven a escribir `estado` ni `cerrado_en`. Ya valen `'cerrado'` y la hora de la aprobación desde SPEC 13, y reescribirlos movería la hora de cierre. Mismo criterio de `rechazarLoteForApprover`.
- **Sí:** finalizar **congela** el lote: los tres endpoints del aprobador empiezan a responder 400 porque exigen `CLIENTE_FINAL`. Es el efecto buscado y no cuesta una línea de código.
- **Sí:** la finalización es **irreversible**. Mismo criterio que los siete `PATCH` anteriores: nada en este proyecto se deshace por API.
- **Sí:** el lote finalizado **deja de ser visible** en las tres lecturas de `lotes`. Decisión explícita del usuario. Mismo destino que los lotes rechazados y aprobados hoy.
- **No:** agregar en este spec una lectura de lotes finalizados. Se descarta: es un endpoint de lectura y va en su propio spec, con su propia decisión sobre filtros y campos.
- **No:** incluir `FINALIZADO` en `getAllLotesByClienteForApprover`. Se descarta: mezclaría lo pendiente de revisar con lo ya cerrado en una sola bandeja, y obligaría a tocar un método que este spec no necesita tocar.
- **No:** corregir el `etapa_id = 2` clavado de `getAllLotesByClienteForApprover`. Se descarta otra vez, con el mismo argumento de SPEC 19: es un endpoint que este spec no toca. Queda en Risks.
- **Sí:** finalizar es una acción humana explícita. Decisión explícita del usuario. Aprobar el último pesaje sin revisar **no** dispara nada.
- **No:** finalizar automáticamente cuando el último pesaje queda revisado. Se descarta: duplica el alcance, obliga a que `approvePesajeForApprover` escriba en `lotes`, y le quita al aprobador la decisión de cerrar.
- **Sí:** cualquier usuario autenticado puede finalizar cualquier lote, sin `validateVinculoOperador`. Decisión explícita del usuario. Es la **octava** escritura abierta del proyecto y la tercera no destructiva.
- **No:** exigir el vínculo `cliente_operador`. Se descarta con el mismo argumento de SPEC 11 a 13 y 19: rompería la simetría con las otras tres rutas del aprobador y dejaría a un `ADMIN` sin filas en `cliente_operador` sin poder finalizar nada.
- **No:** exigir un rol de aprobador, o que quien finaliza no sea quien aprobó. Se descarta: no hay `PermissionsGuard`, `req.user` es `{ userId, username }` y el `rol_id` no viaja en el token.
- **Sí:** ninguna fila nueva en `catalogo_permisos` ni en `permisos`. Decisión explícita del usuario. Undécima excepción consecutiva a la regla de SPEC 06.
- **No:** sembrar un `FINALIZAR-LOTE` sin aplicarlo. Se descarta pese al argumento de que el código existiría el día que llegue el guard. Consecuencia asumida: de las ocho escrituras, las cuatro de SPEC 10 a 13 tienen código y las cuatro del aprobador no.
- **No:** devolver `finalizado_por` y `finalizado_en` en alguna lectura. Se descarta: cambia los campos de respuestas existentes y es un spec de campos. Consecuencia asumida: se puede finalizar un lote pero no se puede ver por API quién lo finalizó. Mismo criterio de SPEC 13 y 19.
- **No:** calcular agregados, escribir `resumen_ia` o cerrar el lote como resultado computado al finalizar. Se descarta: sigue siendo trabajo diferido desde SPEC 02, y este spec no lo desbloquea ni lo cierra.
- **No:** unificar las copias de `validateLoteEnClienteFinal` y `resolveEtapa` entre los dos repositorios. Se mantiene el criterio de SPEC 13 y 19: la duplicación es deliberada y visible, y unificarla es una limpieza propia.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **Cualquier usuario autenticado puede finalizar cualquier lote**, incluido un `Operador` sin fila en `cliente_operador` para ese cliente. Octava escritura abierta del proyecto. | **Sin mitigar por diseño**, por decisión explícita del usuario. Hay un criterio de aceptación que lo fija como comportamiento esperado. La mitigación real es el spec del `PermissionsGuard`. |
| **El lote finalizado desaparece de toda lectura de `lotes`.** Se finaliza y no hay forma de volver a verlo por API, ni de saber que existe, salvo consultando MySQL. | Sin mitigar por decisión explícita. Los pesajes siguen visibles por `GET /pesajes/byLote/:loteId`, así que el dato no se pierde. La lectura de finalizados va en su propio spec. |
| **La finalización es irreversible y congela el lote.** Finalizar por error deja el lote sin forma de rechazarlo ni de seguir revisando sus pesajes. | Sin mitigar por decisión. Se revierte por SQL a mano: `etapa_id` de vuelta a `CLIENTE_FINAL` y las dos columnas nuevas en `NULL`. El validador de "ya finalizado" evita al menos la doble escritura. |
| **`getAllLotesByClienteForApprover` tiene `where('lotes.etapa_id', '=', 2)` clavado.** Este spec depende de que el lote salga de esa bandeja al cambiar de etapa, y eso solo funciona si `CLIENTE_FINAL` es el id 2 en ese ambiente. | Anotado, no corregido: sigue fuera de alcance. El paso 1 del plan verifica el id contra la base antes de empezar. El arreglo es resolver por `codigo`, como hace el resto. |
| **Hay DDL a mano y no hay tooling de migración.** Si las dos columnas no se aplican en un ambiente, el `UPDATE` falla con un error de MySQL, no con un 400 legible. | Mitigado: los pasos 1 a 3 aplican y verifican el DDL **antes** de escribir código, y `types.ts` se actualiza en el mismo paso. Es la misma mecánica de SPEC 10 a 13. |
| **El método consulta `lotes` dos veces** por el validador de "ya finalizado". Dentro de la misma transacción y sobre la misma fila. | Aceptado por decisión: el costo es un `SELECT` por llamada a un endpoint de baja frecuencia, contra modificar un validador compartido con un endpoint en producción. |
| Alguien lee `estado = 'cerrado'` como "rechazado o aprobado" y ahora significa **tres** cosas. Los conteos por estado de lote quedan mal. | Mitigado con documentación: la tabla de discriminación de tres estados está en el modelo de datos y el paso 21 la lleva a `CLAUDE.md`. La señal canónica es `finalizado_por IS NOT NULL`. |
| Un lote queda **imposible de finalizar** si tiene un pesaje activo sin revisar y el aprobador no puede revisarlo por alguna razón operativa. | Sin mitigar: es la regla de negocio elegida. La salida es revisar el pesaje —aprobarlo o rechazarlo— que es exactamente lo que el flujo pide. Anular el pesaje no sirve: `PATCH /pesajes/:id/rechazar` responde 400 sobre un lote cerrado. |
| `finalizado_por` y `finalizado_en` **no se pueden leer por API**. Se finaliza un lote y no hay forma de ver quién lo hizo ni cuándo, salvo por MySQL. | Sin mitigar por decisión explícita. Las columnas quedan escritas desde el día uno, así que cuando llegue el spec de lectura el dato histórico ya existe. Mismo criterio de SPEC 13 y 19. |

---

## What is **not** in this spec

- Cualquier lectura de lotes finalizados: endpoint nuevo, parámetro o cambio a las tres lecturas existentes.
- Deshacer una finalización o reabrir un lote finalizado.
- Finalizar automáticamente al aprobar el último pesaje sin revisar.
- Finalizar varios lotes en una llamada.
- Devolver `finalizado_por` o `finalizado_en` en algún endpoint de lectura.
- Un motivo u observación de finalización, y por tanto cualquier DTO para este endpoint.
- Exigir que todos los pesajes estén **aprobados** para finalizar.
- Agregados por lote, `resumen_ia` y cierre del lote como resultado computado.
- Corregir el `etapa_id = 2` clavado de `getAllLotesByClienteForApprover`.
- Unificar las copias de `validateLoteEnClienteFinal` y `resolveEtapa` entre los dos repositorios.
- Modificar `validateLoteEnClienteFinal`, `validateLoteTienePesajes`, `validateLoteAbierto` o `resolveEtapa`.
- El PIN de supervisor para pesajes fuera de rango en cliente final.
- Sembrar filas en `catalogo_permisos` o en `permisos`, ni aplicar permisos.
- Validar el vínculo `cliente_operador`, exigir un rol de aprobador, o exigir que quien finaliza no sea quien aprobó.
- Cambios a `POST /lotes`, `PATCH /lotes/:id/rechazar`, `PATCH /lotes/:id/aprobar`, `PATCH /lotes/:id/rechazar/byApprover` y a los endpoints de `pesajes`, `clientes`, `auth`, `permisos` y `catalogos`.
- Borrado físico de lotes.

Cada uno de estos, si se necesita, va en su propio spec.
