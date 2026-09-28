# SPEC 29 — Trazabilidad de un lote

> **Status:** Draft
> **Depends on:** SPEC 02 (crea `lotes` y su `created_by`), SPEC 03 (crea `pesajes`), SPEC 10 (anulación de pesajes), SPEC 12 (rechazo de lotes), SPEC 13 (aprobación de lotes), SPEC 19 (flujo del aprobador: rechazo de lote y revisión de pesajes), SPEC 20 (finalización de lotes), SPEC 22 (Swagger, donde hay que documentar la ruta nueva), SPEC 25 (documentos fiscales y su puente con `lotes`), SPEC 27 (establece la forma `GET /lotes/:id/<recurso>` y su 404)
> **Date:** 2026-09-27
> **Objective:** Agregar `GET /lotes/:id/trazabilidad`, que devuelve la cabecera de un lote y la línea de tiempo cronológica de todo lo que le pasó a él, a sus pesajes y a los documentos fiscales que lo incluyen, con quién lo hizo y cuándo.

---

## Why this spec exists

Hoy responder "¿qué le pasó a este lote?" exige cruzar a mano cuatro lecturas y MySQL. Las columnas de auditoría existen desde los specs 10 a 20 —`created_by`, `aprobado_por`, `rechazado_por`, `finalizado_por` en `lotes`; `usuario_id`, `rechazado_por`, `aprobado_por` en `pesajes`; `created_by`, `anulado_por` en `documentos_fiscales`—, pero solo `GET /lotes/cliente/:clienteId/all/finalizados` devuelve algunas, y ninguna lectura las junta en orden. El frontend tiene maquetada una pantalla de trazabilidad y no hay endpoint que la alimente.

Tres cosas conviene tener claras antes de leer el resto.

**La primera: no se usa la vista `bitacora`.** En MySQL existe una vista `bitacora`, creada a mano sin spec, con su `BitacoraView` en `src/database/types/types.ts` y ningún endpoint que la lea. Parecía la fuente natural, y se descartó por tres razones verificadas contra la base el 2026-09-27:

- **No puede filtrar los pesajes por lote.** Sus filas de pesaje traen `entidad_id` = id del pesaje y `cliente_id`, pero no `lote_id`. Con `entidad = 'lote' AND entidad_id = 8`, el lote 8 devolvió **1** evento y dejó fuera los **26** de sus pesajes.
- **`WHERE entidad = 'lote'` revienta.** La vista y la base están en `utf8mb4_0900_ai_ci` y la conexión de `mysql2` en `utf8mb4_unicode_ci`, así que la comparación falla con `ER_CANT_AGGREGATE_2COLLATIONS`. Desde el `DatabaseMiddleware` sería un 500.
- **Le faltan eventos y mezcla otros.** No tiene la finalización (SPEC 20), ni la aprobación de un pesaje por el aprobador (SPEC 19), ni nada de documentos fiscales (SPEC 25). Además llama `RECHAZAR` tanto a la anulación del operador como al rechazo del aprobador, que son operaciones distintas.

La vista se queda como está. Este spec solo deja escrito por qué no se usa.

**La segunda: los eventos se derivan de columnas de auditoría, no de un log.** No hay tabla de eventos ni se agrega una. Cada evento es una pareja `(*_por, *_en)` que ya está escrita, y su existencia se decide por `*_en IS NOT NULL`. La consecuencia: la trazabilidad solo puede contar lo que las escrituras dejaron anotado. El resumen IA del SPEC 27 no tiene autor ni fecha, así que no aparece. Tampoco aparece la firma del SPEC 26, que no es un evento sino un dato de la finalización.

**La tercera: se consultó la forma en MySQL antes de escribir el spec.** Un `UNION ALL` directo sobre las tablas, equivalente a lo que este spec pide, se corrió contra el lote 46 (LEO2026) y devolvió 14 eventos coherentes: el `CREAR` del lote, 12 `CREAR` de pesajes y el `APROBAR` del lote, en orden. Este spec implementa lo mismo con tres consultas Kysely en vez de SQL crudo.

---

## Scope

**In:**

- Nuevo endpoint `GET /lotes/:id/trazabilidad`, protegido solo por el `JwtAuthGuard` global.
- Nuevo método público `getTrazabilidadLote(loteId)` en `src/modules/lotes/repository/lotes.repository.ts`, con tres consultas privadas —lote, pesajes y documentos fiscales— y la construcción de eventos en TypeScript.
- Nuevo método `obtenerTrazabilidad(loteId)` en `src/modules/lotes/lotes.service.ts`, pass-through.
- Nuevo handler `@Get(':id/trazabilidad')` en `src/modules/lotes/lotes.controller.ts`, con `@Param('id', ParseIntPipe)`, `@ApiOperation` y `@ApiParam`.
- Respuesta `200` con la forma `{ ok, msg, trazabilidad: { lote, eventos } }`.
- `lote`: los **10 campos** de las lecturas de `lotes` más `cliente`.
- `eventos`: **11 tipos** de evento en tres familias (lote, pesaje, documento fiscal), con quién y cuándo resueltos a nombre y rol.
- Orden cronológico **ascendente**, con un desempate determinista.
- **404** `El lote con id 'X' no existe` si el lote no existe, el mismo mensaje que `GET /lotes/:id/resumen`.
- Acepta un lote en **cualquier** estado: abierto, aprobado, rechazado o finalizado.
- Actualizar `CLAUDE.md`: el endpoint, los conteos que cambian y la nota sobre la vista `bitacora`.

**Out of scope (for future specs):**

- **Usar, modificar o eliminar la vista `bitacora`.** Se deja intacta, con su `BitacoraView` en `types.ts`.
- **Una herramienta de trazabilidad para el chatbot del SPEC 28.** Va por el flujo de propuestas de `chat-ai-function-calling-planner`, que puede reusar `getTrazabilidadLote`.
- **Trazabilidad de clientes, de pesajes sueltos o de usuarios.** Este endpoint es por lote.
- **Totales o agregados en la cabecera**: conteos por estado, peso neto total, fuera de rango. Es el "cierre como cómputo" que los specs vienen difiriendo desde el SPEC 12.
- **`resumen_ia` y `firma_aprobador` en la cabecera.** Son pesados y el resumen ya tiene su ruta.
- **Un evento para el resumen IA o para `PATCH /documentos-fiscales/:id/completar`.** Ninguno de los dos tiene columnas de autor y fecha.
- **Una tabla de eventos o de log**, y cualquier DDL.
- **Agrupar los eventos de pesaje** ("12 pesajes entre X y Y"). La lista es plana y el frontend agrupa si quiere.
- **Query params**: filtros por familia, por usuario o por rango de fechas. Tampoco paginación.
- **Validar `cliente_operador`**, exigir un rol o un `PermissionsGuard`.
- **Sembrar filas** en `catalogo_permisos` o en `permisos`.
- **`GET /lotes/:id`.** Este endpoint no lo es: devuelve la trazabilidad, no el lote.
- Cambios a cualquier otro endpoint de `lotes`, `pesajes`, `documentos-fiscales`, `clientes`, `auth`, `permisos`, `catalogos` o `chat`.
- Tests de cualquier tipo.

---

## Data model

**Este spec no introduce estructuras de datos persistentes.** No hay DDL, no hay tabla ni columna nueva y `src/database/types/types.ts` no cambia. Todas las columnas que se leen ya existen.

### Archivos

| Archivo | Cambio |
| --- | --- |
| `src/modules/lotes/repository/lotes.repository.ts` | Tipo exportado `EventoTrazabilidad`, método público `getTrazabilidadLote` y tres privados: `getCabeceraTrazabilidad`, `getPesajesTrazabilidad`, `getDocumentosTrazabilidad` |
| `src/modules/lotes/lotes.service.ts` | Método `obtenerTrazabilidad`, pass-through |
| `src/modules/lotes/lotes.controller.ts` | Handler `@Get(':id/trazabilidad')` con sus decoradores de Swagger |
| `CLAUDE.md` | Endpoint, conteos y nota sobre la vista `bitacora` |

**Ningún archivo nuevo, ningún DTO, ningún módulo nuevo.** `lotes.module.ts` no cambia.

### Respuesta

```ts
{
  ok: true,
  msg: 'Trazabilidad obtenida correctamente',
  trazabilidad: {
    lote: {
      id, nombre_lote, variedad_o_talla, producto, unidad_medida,
      peso_minimo, peso_ideal, peso_maximo, estado, etapa,
      cliente,               // clientes.nombre, campo 11
    },
    eventos: EventoTrazabilidad[],
  },
}
```

Los 10 primeros campos de `lote` son exactamente los de `GET /lotes/cliente/:clienteId`, con los mismos alias, en el mismo orden y sin `Number()` en los pesos. `cliente` va al final.

### El evento

```ts
export type EventoTrazabilidad = {
  entidad: 'lote' | 'pesaje' | 'documento_fiscal';
  entidad_id: number;
  accion:
    | 'CREAR' | 'APROBAR' | 'RECHAZAR' | 'RECHAZAR_APROBADOR' | 'FINALIZAR' // lote
    | 'ANULAR'                                                           // pesaje y documento
    | 'REGISTRAR';                                                       // documento
  motivo: string | null;
  ocurrio_en: Date | string | null;
  usuario: string | null;          // usuarios.complete_name
  usuario_rol: string | null;      // roles.nombre
  peso_neto: number | null;        // solo entidad = 'pesaje'
  numero_documento: string | null; // solo entidad = 'documento_fiscal'
};
```

Las 9 claves están siempre presentes. `peso_neto` y `numero_documento` valen `null` en las familias a las que no pertenecen. El frontend arma el texto: no hay campo `detalle` que tenga que parsear.

- **`entidad_id` pasa por `Number()`**, porque `pesajes.id` es `BIGINT` y el driver puede entregarlo como string.
- **`peso_neto` pasa por `Number()`** cuando no es `null`. Esto se aparta a propósito de la cabecera, cuyos pesos viajan como llegan para seguir siendo intercambiables con las lecturas hermanas. El evento es una forma nueva y no tiene con quién ser intercambiable.
- **Los ids de usuario no viajan**, solo el nombre y el rol, igual que en el SPEC 24.

### Los 11 eventos

| Entidad | `accion` | Aparece si | Quién / cuándo | `motivo` |
| --- | --- | --- | --- | --- |
| lote | `CREAR` | siempre | `created_by` / `created_at` | `null` |
| lote | `APROBAR` | `aprobado_en IS NOT NULL` | `aprobado_por` / `aprobado_en` | `null` |
| lote | `RECHAZAR` | `rechazado_en IS NOT NULL` y `aprobado_en IS NULL` | `rechazado_por` / `rechazado_en` | `motivo_rechazo` |
| lote | `RECHAZAR_APROBADOR` | `rechazado_en IS NOT NULL` y `aprobado_en IS NOT NULL` | `rechazado_por` / `rechazado_en` | `motivo_rechazo` |
| lote | `FINALIZAR` | `finalizado_en IS NOT NULL` | `finalizado_por` / `finalizado_en` | `null` |
| pesaje | `CREAR` | siempre, **incluidos los anulados** | `usuario_id` / `created_at` | `null` |
| pesaje | `ANULAR` | `rechazado_en IS NOT NULL` y `isActive === 0` | `rechazado_por` / `rechazado_en` | `motivo_rechazo` |
| pesaje | `RECHAZAR_APROBADOR` | `rechazado_en IS NOT NULL` y `isActive !== 0` | `rechazado_por` / `rechazado_en` | `motivo_rechazo` |
| pesaje | `APROBAR` | `aprobado_en IS NOT NULL` y `aprobado` verdadero | `aprobado_por` / `aprobado_en` | `null` |
| documento_fiscal | `REGISTRAR` | siempre, **incluidos los anulados** | `created_by` / `created_at` | `null` |
| documento_fiscal | `ANULAR` | `anulado_en IS NOT NULL` | `anulado_por` / `anulado_en` | `motivo_anulacion` |

Cuatro reglas que salen de esa tabla:

- **Los dos rechazos de lote se distinguen por `aprobado_en`.** `PATCH /lotes/:id/rechazar` exige el lote abierto, así que nunca tiene aprobación. `PATCH /lotes/:id/rechazar/byApprover` exige el lote en `CLIENTE_FINAL`, que solo alcanza `aprobarLote`. No hay tercer caso.
- **Los dos rechazos de pesaje se distinguen por `isActive`.** La anulación del operador (SPEC 10) escribe `isActive = 0`. El rechazo del aprobador (SPEC 19) deja `isActive = 1` y escribe `aprobado = 0`. Son excluyentes por construcción: el primero exige el lote abierto y el segundo el lote en `CLIENTE_FINAL`, y un lote no se reabre. Se compara `isActive === 0`, igual que `validatePesajeActivo`, así que un `NULL` cuenta como activo.
- **`aprobado` se compara por verdad, nunca con `=== false`**, porque MySQL lo devuelve como `0`/`1`. Es la regla que `CLAUDE.md` fija desde el commit `af47797`.
- **Un lote finalizado lleva `APROBAR` y `FINALIZAR`**, porque los dos pares de auditoría se acumulan. Uno rechazado por el aprobador lleva `APROBAR` y `RECHAZAR_APROBADOR`.

### Las tres consultas

1. **`getCabeceraTrazabilidad(loteId)`**: `lotes` con `LEFT JOIN` a `productos`, `unidades_medida`, `etapas` y `clientes`, más cuatro `LEFT JOIN` a `usuarios` con alias (`creador`, `aprobador`, `rechazador`, `finalizador`) y otros cuatro a `roles` con alias (`rol_creador`, `rol_aprobador`, `rol_rechazador`, `rol_finalizador`). Selecciona los 11 campos de la cabecera, las cuatro fechas, los cuatro nombres, los cuatro roles y `motivo_rechazo`. Usa `executeTakeFirstOrThrow` con `NotFoundException(\`El lote con id '${loteId}' no existe\`)`. **Es la primera consulta** y la única que puede fallar: si el lote no existe, las otras dos no se ejecutan.
2. **`getPesajesTrazabilidad(loteId)`**: `pesajes` `WHERE lote_id = loteId`, **sin filtro de `isActive`**, con tres `LEFT JOIN` a `usuarios` (`operador`, `aprobador`, `rechazador`) y tres a `roles`. Selecciona `id`, `peso_neto`, `isActive`, `aprobado`, `motivo_rechazo`, las tres fechas y los tres pares nombre/rol.
3. **`getDocumentosTrazabilidad(loteId)`**: `documento_fiscal_lote` `INNER JOIN documentos_fiscales ON documentos_fiscales.id = documento_fiscal_lote.documento_id` `WHERE documento_fiscal_lote.lote_id = loteId`, **sin filtro de `isActive`**, con dos `LEFT JOIN` a `usuarios` (`registrador`, `anulador`) y dos a `roles`. Selecciona `id`, `numero_completo`, `motivo_anulacion`, las dos fechas y los dos pares nombre/rol.

Reglas de las consultas:

- **Todos los joins a `usuarios` y `roles` son `LEFT`.** Un usuario borrado deja el evento con `usuario: null`, no hace desaparecer el evento.
- **La columna puente se llama `documento_id`, no `documento_fiscal_id`.** El borrador del query falló justo por eso.
- **Ninguna consulta compara un literal de texto en un `WHERE`.** Es lo que evita el error de collation que tiene la vista.
- **Los documentos se deduplican por `id` en TypeScript.** Si una fila de `documento_fiscal_lote` se repitiera para el mismo par documento/lote, el documento generaría sus eventos una sola vez.
- **Las tres corren sobre `this.db`, sin transacción.** Es una lectura y no hay nada que aislar, como en `getLotesFinalizadosByCliente`.

### El orden

`eventos` se ordena en TypeScript, en este orden de claves:

1. `ocurrio_en` **ascendente**. Los eventos con `ocurrio_en` en `null` van **al final**.
2. Familia: `lote`, luego `pesaje`, luego `documento_fiscal`.
3. `entidad_id` ascendente.
4. `accion`, en el orden de la tabla de los 11 eventos.

El desempate existe porque `NOW()` tiene resolución de segundos y dos escrituras del mismo segundo son posibles. Con esas cuatro claves, dos llamadas sobre los mismos datos devuelven siempre el mismo orden.

### Lo que cambia en los conteos

Los valores de "Antes" son los que registra `CLAUDE.md`. El paso 1 del plan los verifica contra el log, porque el SPEC 28 agregó rutas y puede que el archivo no esté al día.

| Conteo | Antes | Después |
| --- | --- | --- |
| Rutas del módulo `lotes` | 11 | **12** |
| Rutas que mapea Nest | la del log del paso 1 | **+1** |
| Claves en `paths` de `/docs-json` | las del paso 1 | **+1**, `/lotes/{id}/trazabilidad` es clave nueva |
| Rutas que se saltan `validateVinculoOperador` | 22 | **23** |
| Lecturas abiertas a cualquier autenticado | 19 | **20** |
| Filas en `catalogo_permisos` / `permisos` | sin cambio | sin cambio |

---

## Implementation plan

1. **Anotar el punto de partida.** Arrancar con `npm run start:dev` si no está corriendo y anotar el total de rutas del log y las de `lotes`, además del número de operaciones y de claves en `paths` de `/docs-json`. Elegir tres lotes de prueba en MySQL: uno **abierto con pesajes** (el 46 sirve), uno **finalizado** y, si existe, uno con un **documento fiscal** registrado. Anotar también uno **rechazado** y, si hay, un pesaje anulado y otro rechazado por el aprobador.
2. **Agregar a `LotesRepository`** el tipo `EventoTrazabilidad` y `getCabeceraTrazabilidad` con sus joins y su 404. Verificación: compila en watch mode.
3. **Agregar `getPesajesTrazabilidad` y `getDocumentosTrazabilidad`.** Verificación: compila.
4. **Agregar `getTrazabilidadLote`**: llama a la cabecera primero y a las otras dos después, construye los eventos con las reglas de la tabla, deduplica documentos, aplica `Number()` a `entidad_id` y `peso_neto`, ordena con las cuatro claves y devuelve `{ lote, eventos }`. Los campos de auditoría de la cabecera no viajan dentro de `lote`, solo alimentan los eventos. Verificación: compila.
5. **Agregar `obtenerTrazabilidad` a `LotesService`** como pass-through.
6. **Agregar el handler `@Get(':id/trazabilidad')` a `LotesController`**, justo después de `@Get(':id/resumen')`, que devuelve `{ ok: true, msg: 'Trazabilidad obtenida correctamente', trazabilidad }`. Verificación: el log muestra una ruta más y `lotes` pasa a **12**.
7. **Verificación funcional con el lote 46.** La respuesta trae los mismos 14 eventos y en el mismo orden que el query de referencia: `CREAR` del lote, 12 `CREAR` de pesaje y `APROBAR` del lote.
8. **Verificación de las familias**, con los lotes del paso 1:
   - El finalizado trae `APROBAR` y `FINALIZAR`.
   - El rechazado trae `RECHAZAR` o `RECHAZAR_APROBADOR`, con su motivo.
   - Un pesaje anulado trae `ANULAR` y uno rechazado por el aprobador trae `RECHAZAR_APROBADOR`.
   - Un lote con factura trae `REGISTRAR` con `numero_documento`. Si la factura se anuló, trae además `ANULAR` con `motivo_anulacion`.
9. **Verificación de los bordes.** Un id inexistente responde `404` con el mensaje exacto. Un id no numérico responde `400` del `ParseIntPipe`. Sin token responde `401`. Un usuario sin fila en `cliente_operador` para el cliente responde `200`.
10. **Verificación de no regresión.** `GET /lotes/:id/resumen` y las cuatro rutas `cliente/...` devuelven lo mismo que en el paso 1.
11. **Agregar `@ApiOperation` y `@ApiParam`** al handler, con el estilo del SPEC 22. La descripción dice que la ruta no valida `cliente_operador`, que acepta lotes en cualquier estado y qué significa cada `accion`. Verificación: `/docs` la muestra bajo `lotes` y `/docs-json` tiene una clave más en `paths`.
12. **Pasar `npm run lint`** sin errores nuevos.
13. **Actualizar `CLAUDE.md`:**
    - El endpoint en la tabla de `lotes`, con la forma de la respuesta y los 11 eventos.
    - Los conteos nuevos.
    - Que es la primera lectura que devuelve **todas** las columnas de auditoría de `lotes` y de `pesajes`, y la primera que muestra un pesaje anulado y su motivo como campo.
    - La nota sobre la vista `bitacora`: existe, nadie la lee, no filtra pesajes por lote y falla con collation al comparar `entidad`.

---

## Acceptance criteria

- [ ] La app arranca y `npm run lint` no introduce errores nuevos.
- [ ] El log de Nest mapea exactamente **una** ruta más que en el paso 1, y `lotes` tiene **12**.
- [ ] `GET /lotes/:id/trazabilidad` responde **200** con la forma `{ ok, msg, trazabilidad: { lote, eventos } }`.
- [ ] `lote` tiene exactamente **11** claves: las 10 de `GET /lotes/cliente/:clienteId`, con los mismos nombres y el mismo orden, más `cliente` al final.
- [ ] `lote` no incluye `resumen_ia`, `firma_aprobador` ni ningún campo de auditoría.
- [ ] Cada elemento de `eventos` tiene exactamente las **9** claves de `EventoTrazabilidad`.
- [ ] `usuario` trae el nombre completo, `usuario_rol` el nombre del rol, y ningún evento trae un id de usuario.
- [ ] Para el lote 46, `eventos` trae 14 elementos, iguales en acción y orden a los del query de referencia.
- [ ] Un lote finalizado trae un evento `APROBAR` y otro `FINALIZAR` de entidad `lote`.
- [ ] Un lote rechazado sin aprobación previa trae `RECHAZAR`, y uno rechazado por el aprobador trae `RECHAZAR_APROBADOR`, los dos con `motivo`.
- [ ] Un pesaje anulado por el operador aparece con su `CREAR` y un `ANULAR` con `motivo`.
- [ ] Un pesaje rechazado por el aprobador aparece con `RECHAZAR_APROBADOR`, no con `ANULAR`.
- [ ] Un pesaje aprobado por el aprobador aparece con `APROBAR`.
- [ ] Un documento fiscal que incluye el lote aparece con `REGISTRAR` y su `numero_documento`, y si está anulado también con `ANULAR`.
- [ ] En los eventos de pesaje `numero_documento` es `null`, en los de documento `peso_neto` es `null`, y en los de lote los dos son `null`.
- [ ] `entidad_id` y `peso_neto` son `number`, no string.
- [ ] `eventos` viene ordenado por `ocurrio_en` ascendente, y dos llamadas seguidas sobre los mismos datos devuelven el mismo orden.
- [ ] Un lote abierto, uno rechazado y uno finalizado responden **200**: la ruta no valida el estado.
- [ ] Un id inexistente responde **404** `El lote con id 'X' no existe`.
- [ ] Un id no numérico responde **400** del `ParseIntPipe`.
- [ ] Sin token responde **401**.
- [ ] Un usuario sin fila en `cliente_operador` para el cliente del lote responde **200**, no 403.
- [ ] Ninguna de las tres consultas lee la vista `bitacora`.
- [ ] El handler tiene `@ApiOperation` con resumen y descripción y `@ApiParam` para `id`, y no se agregó ningún `@ApiResponse`.
- [ ] `/docs-json` tiene una clave más en `paths`: `/lotes/{id}/trazabilidad`.
- [ ] No se creó ningún archivo de código. Los únicos tocados son el repositorio, el servicio y el controller de `lotes`.
- [ ] No se creó ningún DTO ni se agregó ningún query param.
- [ ] `src/database/types/types.ts` no cambió, no se aplicó DDL y la vista `bitacora` sigue igual.
- [ ] `catalogo_permisos` y `permisos` tienen las mismas filas que en el paso 1.
- [ ] `GET /lotes/:id/resumen` y las cuatro rutas `cliente/...` responden igual que antes.
- [ ] `CLAUDE.md` documenta el endpoint, los conteos y la nota sobre la vista `bitacora`.

---

## Decisions

- **Sí:** la ruta es `GET /lotes/:id/trazabilidad`. Decisión explícita del usuario. Es la misma forma de `GET /lotes/:id/resumen`, y por la misma razón que el SPEC 27 dejó escrita, el segmento literal después de `:id` la hace disjunta de `cliente/:clienteId` y no activa la trampa del `:id`. Su posición en el controller **no** es de carga.
- **No:** un módulo `trazabilidad` propio. Solo tendría sentido con trazabilidad de otras entidades, que este spec no incluye.
- **Sí:** cabecera más eventos planos. Decisión explícita del usuario. La pantalla maquetada pinta los dos y así los obtiene en una llamada.
- **Sí:** la cabecera lleva los 10 campos de siempre más `cliente`. Decisión explícita del usuario. Reusa la forma que el frontend ya conoce.
- **No:** totales o conteos en la cabecera. Es el "cierre como cómputo" que se difiere desde el SPEC 12, y el SPEC 27 ya los calcula solo para el prompt.
- **Sí:** tres familias de eventos: lote, pesaje y documento fiscal. Decisión explícita del usuario. El documento fiscal es el final natural de la trazabilidad de una exportación, y el detalle del SPEC 25 ya es abierto, así que no expone nada que no esté expuesto.
- **Sí:** se incluyen los pesajes anulados y los documentos anulados. Una trazabilidad que esconde lo anulado no sirve para auditar, que es el mismo argumento con el que el SPEC 25 devuelve el documento anulado en su detalle.
- **Sí:** tres consultas Kysely y armado en TypeScript. Decisión explícita del usuario. El resultado queda tipado, no hace falta SQL crudo y no se compara ningún literal de texto en un `WHERE`, que es lo que rompe la vista.
- **No:** el `UNION ALL` probado, en `sql```. Se usó para validar la forma contra la base, pero en crudo Kysely no tipa el resultado y el proyecto no tiene precedente de lecturas completas en `sql```.
- **No:** una cuarta consulta que resuelva todos los usuarios juntos por `IN (...)`. Ahorraría joins, pero el usuario eligió tres consultas. Los joins son por clave primaria y el volumen por lote es chico.
- **No:** usar la vista `bitacora`. No filtra pesajes por lote, falla por collation al comparar `entidad`, le faltan tres familias de eventos y mezcla dos rechazos distintos. Verificado contra MySQL el 2026-09-27.
- **Sí:** la vista no se toca. Decisión explícita del usuario. Borrarla exigiría confirmar que nada fuera del repo la lee, y arreglarla es otro trabajo.
- **Sí:** eventos con campos fijos (`peso_neto`, `numero_documento`) y sin un `detalle` de texto. Decisión explícita del usuario. El frontend no parsea strings y los tipos se mantienen.
- **Sí:** los rechazos se separan en `RECHAZAR`/`RECHAZAR_APROBADOR` (lote) y `ANULAR`/`RECHAZAR_APROBADOR` (pesaje). Son operaciones distintas con endpoints distintos, y la vista las mezclaba.
- **Sí:** orden cronológico ascendente con cuatro claves de desempate. Decisión explícita del usuario. Una línea de tiempo se lee de arriba abajo, y sin desempate dos eventos del mismo segundo cambiarían de orden entre llamadas.
- **Sí:** no valida `cliente_operador`. Decisión explícita del usuario. Es el mismo argumento de los specs 24, 27 y 28: el aprobador y el `ADMIN` no tienen filas en `cliente_operador` y son quienes miran la trazabilidad.
- **No:** sembrar una fila de permiso. Sin `PermissionsGuard` la fila no cambia nada, igual que en los specs anteriores.
- **Sí:** 404 si el lote no existe, con el mensaje de `GET /lotes/:id/resumen`. Decisión explícita del usuario. Es la distinción del SPEC 21: 404 cuando el recurso no está.
- **Sí:** no se valida el estado del lote. Cualquier lote tiene historia, y la de uno rechazado es justo la que se quiere revisar.
- **No:** una herramienta para el chatbot en este spec. Decisión explícita del usuario. Va por el flujo de propuestas del chat.
- **No:** un evento para el resumen IA y para `completar` del documento fiscal. Ninguno tiene autor ni fecha. Inventarlos exigiría DDL, y el SPEC 27 rechazó a propósito auditar el resumen.
- **No:** query params ni paginación. Ninguna lectura del proyecto pagina, y el volumen de eventos de un lote está acotado por sus pesajes.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **La ruta es abierta y el id del lote es secuencial.** Cualquier autenticado recorre la historia completa de cualquier lote, con nombres y roles de quién hizo cada cosa, motivos de rechazo y números de factura. | Aceptado por decisión, como las otras rutas abiertas. Documentado en Swagger y en `CLAUDE.md`. La salida sigue siendo el `PermissionsGuard`. |
| **Es la primera lectura que expone `motivo_rechazo` de pesajes y de lotes como campo.** Hasta ahora solo viajaba dentro del texto de un 400 del SPEC 21. | Aceptado: es el propósito de una trazabilidad. Queda anotado en `CLAUDE.md`. |
| **Los eventos se derivan de columnas, así que una fila tocada a mano en MySQL** (por ejemplo, la etapa movida sin escribir `finalizado_en`) no genera su evento, o genera uno con `usuario: null`. | Sin mitigar, y es deliberado: la trazabilidad refleja lo que se escribió. Los eventos sin fecha van al final del orden. |
| **La cabecera hace ocho joins a `usuarios`/`roles` más cuatro de catálogo.** | Aceptado: todos por clave primaria, sobre una sola fila de `lotes`. |
| **Un lote con muchos pesajes produce una respuesta larga**, sin paginación. | Aceptado: hoy el lote más grande tiene 22 pesajes. Si crece, paginar es trabajo de otro spec. |
| **Distinguir los rechazos depende de invariantes de otros specs.** Si una escritura futura permitiera rechazar un lote aprobado desde otro camino, o anular un pesaje ya revisado, la clasificación se equivocaría sin fallar. | Las invariantes están escritas en este spec y en `CLAUDE.md`. Quien agregue esa escritura tiene que revisar `getTrazabilidadLote`. |
| **La vista `bitacora` sigue en la base con su error de collation.** Alguien puede usarla más adelante pensando que es la fuente de la trazabilidad. | La nota en `CLAUDE.md` explica que no lo es y por qué. |

---

## What is **not** in this spec

- Usar, modificar o eliminar la vista `bitacora`.
- Una herramienta de trazabilidad para el chatbot.
- Trazabilidad de clientes, pesajes sueltos o usuarios.
- Totales, agregados, `resumen_ia` o `firma_aprobador` en la cabecera.
- Eventos del resumen IA o de `completar` un documento fiscal.
- Tablas de eventos, DDL y cambios a `types.ts`.
- Agrupar eventos de pesaje, query params y paginación.
- `GET /lotes/:id`.
- Validar `cliente_operador`, el `PermissionsGuard` y sembrar permisos.
- Cambios a cualquier otro endpoint.
- Tests de cualquier tipo.

Cada uno de estos, si se necesita, va en su propio spec.
