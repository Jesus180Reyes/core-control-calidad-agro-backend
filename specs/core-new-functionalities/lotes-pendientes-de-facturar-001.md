# lotes-pendientes-de-facturar-001 — Listado de lotes finalizados pendientes de facturar

**Status:** Propuesta
**Fecha:** 2026-09-25
**Módulo(s):** `src/modules/documentos-fiscales`
**Tipo:** Lectura nueva

## Problema

El flujo termina en dos pasos que hoy no se conectan. El spec 20 finaliza el lote (`finalizado_por IS NOT NULL`) y el spec 25 lo factura al vincularlo en `documento_fiscal_lote`. Ninguna lectura responde la pregunta que une las dos: **qué lotes ya están finalizados y todavía no tienen un documento fiscal activo.**

El que registra facturas tiene que armar esa lista a mano. Recorre `GET /lotes/cliente/:clienteId/all/finalizados` cliente por cliente (spec 24, que pide un `clienteId` y no dice si el lote está facturado), después abre `GET /documentos-fiscales/:id` documento por documento y cruza las dos listas. Con N clientes son N + M llamadas y el cruce queda del lado del frontend.

El hueco tiene dueño en los specs:

- `specs/25-registro-de-documentos-fiscales.md`, **Risks**: *"Un lote facturado puede quedar huérfano de documento si se anula y nadie registra el correcto. No hay alerta."* La mitigación registrada dice: *"La consulta que lo detecta es 'lotes con `finalizado_por IS NOT NULL` sin fila en `documento_fiscal_lote` de un documento activo', y es exactamente el listado de pendientes por facturar que un spec futuro puede exponer."*
- El mismo spec, **What is not in this spec**: *"Un listado de lotes finalizados pendientes por facturar."*
- `CLAUDE.md`, lista de trabajo diferido del spec 25, que la menciona como la última entrada: *"which is exactly what detects a lote left orphaned after an annulment nobody followed up."*

El spec 25 la difirió por alcance y no la descartó. Esta propuesta no reabre ninguna decisión.

## Usuarios y casos de uso

Lo usa el contador o administrativo que registra documentos fiscales (el operador del spec 25, que hoy no tiene rol propio). De forma secundaria lo usa el `ADMIN` que supervisa el cierre comercial.

1. **Bandeja de trabajo diaria.** El contador abre la pantalla de "Registrar factura" y ve de una vez todos los lotes finalizados que esperan documento, sin elegir cliente primero. Toma uno y lo registra con `POST /documentos-fiscales`.
2. **Huérfanos después de una anulación.** Alguien anuló un documento mal digitado con `PATCH /documentos-fiscales/:id/anular` y no registró el correcto. El lote vuelve a salir en la lista con `anulaciones_previas: 1`, así que se distingue de uno que nunca se facturó.
3. **Antigüedad.** El administrador ordena por lo más viejo y ve que un lote lleva 12 días finalizado sin factura (`dias_pendiente: 12`). Es trabajo comercial atrasado y hoy no se ve en ninguna parte.
4. **Por cliente, antes de emitir.** Antes de emitir la factura en el sistema externo, el contador filtra `?cliente_id=7` para saber qué lotes de ese cliente meter en el mismo documento, con el peso neto total de cada uno como referencia para la `cantidad`.

## Propuesta

### Endpoints

**`GET /documentos-fiscales/lotes-pendientes`**

Query, con la convención del spec 16 (todo `.optional().catch(undefined)`, ningún valor inválido produce 400):

```ts
const filtrosLotesPendientesSchema = z.object({
  cliente_id: z.coerce.number().int().positive().optional().catch(undefined),
});
```

`z.coerce.number()` es idempotente, así que el doble `ZodValidationPipe` no pierde el campo. `cliente_id` es el único filtro: los rangos de fecha sobre `finalizado_en` quedan fuera de alcance.

**Aviso:** el `FiltrosDocumentosFiscalesDto` que ya existe usa `.optional()` **sin** `.catch(undefined)`, aunque su comentario diga lo contrario. Con eso un `?cliente_id=abc` en `GET /documentos-fiscales` responde 400, la misma divergencia que `CLAUDE.md` registra para el spec 17. El DTO nuevo **no** debe copiarlo y tiene que llevar el `.catch`. Esta propuesta no toca el DTO existente.

Respuesta 200:

```json
{
  "ok": true,
  "msg": "Lotes pendientes de facturar obtenidos correctamente",
  "lotes": [
    {
      "id": 41,
      "nombre_lote": "PICOLO2026",
      "variedad_o_talla": "Hass 18",
      "cliente_id": 7,
      "cliente": "Agroexport S.A.",
      "producto": "Aguacate",
      "unidad_medida": "Libras",
      "finalizado_por": "Maria Lopez",
      "finalizado_en": "2026-09-13T15:02:11.000Z",
      "dias_pendiente": 12,
      "pesajes_activos": 14,
      "peso_neto_total": 1734.5,
      "anulaciones_previas": 0
    }
  ]
}
```

- `finalizado_por` sale resuelto a `usuarios.complete_name` con un `LEFT JOIN` aliasado `finalizador`, igual que los specs 24 y 25. El id no viaja.
- `dias_pendiente` es `DATEDIFF(CURDATE(), lotes.finalizado_en)` y se calcula en SQL. Vale `null` si `finalizado_en` es `NULL`, que puede pasar en una fila movida a mano.
- `pesajes_activos` / `peso_neto_total` vienen de un único `GROUP BY lote_id` sobre `pesajes` con `isActive = 1`. Es la misma técnica que `resumirPesajes` del repositorio. Sirven de referencia para la `cantidad` del documento y no son una validación (el spec 25 descartó cuadrarlas).
- `anulaciones_previas` cuenta las filas de `documento_fiscal_lote` de ese lote cuyo documento tiene `isActive = 0`. Si es `> 0`, el lote quedó huérfano después de una anulación, que es el caso del riesgo del spec 25.

Códigos: **200 siempre**. Sin resultados responde 200 con `[]`. No hay 404 porque no se busca un recurso por id. No hay 400 porque los filtros se ignoran y no se resuelve ningún catálogo: la etapa se detecta con `finalizado_por IS NOT NULL` y no con `resolveEtapa`. 401 sin token, como todo.

### Reglas de negocio y validaciones

No es escritura: no abre transacción y no tiene validadores. La lógica vive en un método nuevo del repositorio, `getLotesPendientesDeFacturar(filtros)`, y son dos consultas.

**Consulta 1: los lotes.**

```sql
SELECT ... FROM lotes
INNER JOIN clientes           ON clientes.id = lotes.cliente_id
LEFT JOIN  productos          ON productos.id = lotes.producto_id
LEFT JOIN  unidades_medida    ON unidades_medida.id = lotes.unidad_medida_id
LEFT JOIN  usuarios finalizador ON finalizador.id = lotes.finalizado_por
WHERE lotes.finalizado_por IS NOT NULL
  AND clientes.isActive = 1
  AND NOT EXISTS (
        SELECT 1 FROM documento_fiscal_lote dfl
        INNER JOIN documentos_fiscales df ON df.id = dfl.documento_id
        WHERE dfl.lote_id = lotes.id AND df.isActive = 1)
  [AND lotes.cliente_id = ?]
ORDER BY lotes.finalizado_en ASC, lotes.id ASC
```

A esto se suma el `anulaciones_previas` como subconsulta correlacionada `COUNT(*)` con `df.isActive = 0`.

Discriminadores, según la tabla de `CLAUDE.md`:

- **Finalizado:** `finalizado_por IS NOT NULL`, la señal canónica. No se usa `estado` (vale `'cerrado'` en tres situaciones) ni `etapa_id`.
- **Rechazado:** no hace falta mirar `motivo_rechazo`. El spec 20 congela el lote al finalizarlo y el spec 25 ya dejó escrito que nadie agregue esa condición "por si acaso" (`validateLotesFinalizados`).
- **Facturado:** existe una fila en `documento_fiscal_lote` de un documento con `isActive = 1`. Es **exactamente** el criterio de `validateLotesNoFacturados`, y tiene que seguir siéndolo: si divergen, la lista ofrece lotes que el `POST` rechaza o esconde lotes que el `POST` aceptaría.
- **Cliente activo:** se exige `clientes.isActive = 1`, porque `validateClienteActivo` rechaza el `POST` para un cliente rechazado. Un lote de ese cliente nunca se va a poder facturar, así que mostrarlo es ruido que el contador no puede resolver. Ver Preguntas abiertas.

**Orden `finalizado_en ASC`**, a propósito. Los hermanos ordenan `DESC`, pero esto es una bandeja de trabajo pendiente y lo más atrasado va primero. Desempata por `id ASC`. Una fila con `finalizado_en NULL` queda **primero**, porque MySQL pone `NULL` al principio en un `ASC`. Es lo deseable: es la fila más sospechosa.

**Consulta 2: resumen de pesajes.** Un `GROUP BY pesajes.lote_id` con `isActive = 1` y `lote_id IN (...)` sobre los ids de la consulta 1, y el mapeo se hace en memoria. Conviene extraer el `resumirPesajes` privado existente para reusarlo tal cual, en vez de duplicarlo.

Nada de `selectAll()`: `lotes` carga `firma_aprobador` (`MEDIUMTEXT`) y `resumen_ia`, y `clientes` carga `constancia_exonerado`. Los tres quedan fuera de la respuesta.

Coerción: `peso_neto_total` y los conteos se pasan con `Number()`, y `lotes.id` también, como en el resto del proyecto.

### Modelo de datos

**Ninguno.** No hay DDL, ni columnas, ni cambios a `src/database/types/types.ts`. Todas las tablas y columnas que usa existen desde los specs 20 y 25.

No hace falta índice nuevo. La FK `fk_dfl_lote` de `documento_fiscal_lote.lote_id` ya crea en InnoDB un índice sobre `lote_id`, y ese índice atiende el `NOT EXISTS` y el conteo de anulaciones. `lotes.finalizado_por` tiene la FK del spec 20 y con ella su índice. No se agregan FKs ni `UNIQUE`: los conteos siguen en 16 y 6.

### Control de acceso

- **No valida `cliente_operador`.** El argumento es el del spec 24 y el mismo spec 25: quien opera este módulo (contador, `ADMIN`) no tiene filas en `cliente_operador`, así que validar cerraría la pantalla justo a quien la usa. Los cinco endpoints del módulo ya se saltan el vínculo, y un sexto que sí lo validara sería incoherente con su propio controller.
- **No siembra fila en `catalogo_permisos` / `permisos`.** Es el mismo razonamiento de los specs 09 a 27: sin `PermissionsGuard` la fila no cambia nada, y el spec 25 ya declinó crear el rol `CONTADOR`. Si el guard llega, esta ruta tiene que entrar en el mismo lote de decisiones que las otras cinco del módulo.
- **Lo que abre de nuevo, dicho sin rodeos:** es la **primera lectura del proyecto que lista lotes de todos los clientes a la vez** sin pedir un `clienteId`. `GET /lotes/cliente/:clienteId/all/finalizados` expone los mismos campos, pero cliente por cliente. En la práctica la superficie ya existe: `GET /clientes/all` da todos los ids y la ruta del spec 24 no valida nada. Esto la vuelve una sola llamada. Los datos son de la misma categoría que ya expone `GET /documentos-fiscales/:id` (nombre del lote, pesos, quién finalizó). No hay montos, RTN ni nada fiscal, porque por definición estos lotes todavía no tienen documento.
- Con esto las rutas que se saltan `validateVinculoOperador` suben en una y las lecturas abiertas a cualquier autenticado también.

## Impacto técnico

- **Archivos nuevos:** `src/modules/documentos-fiscales/dto/filtros-lotes-pendientes.dto.ts`.
- **Archivos a modificar:**
  - `documentos-fiscales.controller.ts`: handler `@Get('lotes-pendientes')`, **declarado antes de `@Get(':id')`**. `lotes-pendientes` es un segmento único y la ruta bare `:id` lo tragaría con un 400 del `ParseIntPipe`. Es la trampa que `CLAUDE.md` documenta, y el comentario que ya está sobre `findOne` la cubre.
  - `documentos-fiscales.service.ts`: un pass-through.
  - `repository/documentos-fiscales.repository.ts`: `getLotesPendientesDeFacturar`, reusando `resumirPesajes`.
  - `CLAUDE.md`: fila del módulo en la tabla de endpoints, conteo de rutas de `documentos-fiscales` (5 → 6), rutas que se saltan el vínculo, lecturas abiertas, y quitar el listado de pendientes de la lista de diferidos del spec 25.
- **Efecto sobre endpoints existentes:** ninguno. No cambia ninguna respuesta. `GET /documentos-fiscales/:id` sigue respondiendo igual mientras el orden de declaración se respete.
- **Swagger:** `@ApiOperation` con resumen y una descripción que diga que responde siempre 200, que usa el mismo criterio de "facturado" que el `POST`, que `anulaciones_previas > 0` indica un huérfano, que ordena por lo más antiguo y que **NO valida el vínculo `cliente_operador`**. No hay `@ApiParam` (no hay path params). Los query params se documentan solos por `createZodDto`. Sin `@ApiResponse`, por la decisión del spec 22.

## Alternativas consideradas

- **PIN de supervisor para pesajes fuera de rango en `CLIENTE_FINAL`:** es el paso más visible que le falta al diagrama, pero choca con la decisión del spec 13 (aprobar cierra el lote y bloquea `POST /pesajes`). Necesita DDL y un diseño de PIN que ningún spec ha empezado. Es demasiado para una propuesta mediana.
- **Severidad de alerta amarilla/roja:** el diagrama la decide por etapa, pero hoy solo se puede pesar en `EN_PROCESO`, así que toda alerta sería amarilla. Aporta poco hasta que exista el pesaje en `CLIENTE_FINAL`.
- **`GET /lotes/:id`:** los specs 21 y 24 lo declinaron porque falta decidir campos y filtros. No hay argumento nuevo para reabrirlo.
- **Exponer como campos las métricas por lote que el spec 27 calcula en privado:** es útil, pero ningún flujo actual se traba sin ellas. El detalle del spec 25 ya da conteo y peso neto donde más importa.
- **`GET /documentos-fiscales/resumen-isv`:** sirve para declarar y no para auditar, y el spec 25 lo difirió con ese argumento. Es más caro, con agrupación por destino y tarifas, y más discutible que cerrar un riesgo ya registrado.

## Riesgos

- **Divergencia de criterio con `validateLotesNoFacturados`.** Si alguien cambia uno de los dos (por ejemplo, para que una nota de crédito no cuente como facturación), la lista y el `POST` se contradicen en silencio. Mitigación: que el spec diga que los dos criterios son el mismo, y quizás extraer la subconsulta a un helper privado que usen ambos.
- **Carrera benigna.** Dos contadores ven el mismo lote pendiente y los dos intentan facturarlo. El segundo `POST` responde 400 por `validateLotesNoFacturados`. No hay corrupción, solo una lista vieja.
- **Sin paginación.** Como ninguna lectura del proyecto la tiene, la lista crece con cada lote finalizado y nunca facturado. Si el negocio no factura por el sistema, la lista crece sin límite. Aceptable mientras el volumen sea de decenas.
- **Lotes que nunca se facturarán** (muestras, mermas, lotes cortesía) quedan en la bandeja para siempre, porque no existe forma de marcarlos "no facturable". Ver Preguntas abiertas.
- **Exposición cross-cliente en una sola llamada**, descrita en Control de acceso. No abre datos nuevos, pero sí los junta.
- **Tensiona el spec 18 (`Draft`)**, dueño de los filtros de `lotes`. Esta ruta vive en `documentos-fiscales` y filtra lotes. El argumento es que su pregunta es fiscal y no de calidad, y que usa la convención del spec 16 igual que todos. Aun así, `/spec` debería decirlo.

## Fuera de alcance

- Marcar un lote como "no facturable" o cualquier escritura sobre `lotes` o `documento_fiscal_lote`.
- Notificaciones o alertas activas (correo, push) por lotes pendientes o por antigüedad.
- Filtros por rango de fecha (`?desde`/`?hasta` sobre `lotes.finalizado_en`). El orden por antigüedad y `dias_pendiente` ya cubren la bandeja. Si se piden, seguirían la forma de los filtros de pesajes (`fechaISO()`, `hasta` inclusivo con `DATE_ADD(..., INTERVAL 1 DAY)` porque la columna es `DATETIME`).
- Un filtro `?solo_huerfanos=true`. El campo `anulaciones_previas` basta para filtrar en el frontend. Si se pide, sería un booleano con `.transform()` idempotente como `?fuera_de_rango`.
- Umbrales de antigüedad configurables o semáforos por días.
- Cambiar `GET /lotes/cliente/:clienteId/all/finalizados` para agregar un indicador de facturado.
- Corregir el `.catch(undefined)` que le falta a `FiltrosDocumentosFiscalesDto`: es un arreglo aparte.
- Paginación, `PermissionsGuard`, rol `CONTADOR`.
- Cualquier cosa del chatbot.

## Preguntas abiertas

1. **¿Se excluyen los lotes de clientes rechazados (`clientes.isActive = 0`)?** La propuesta los excluye porque el `POST` no los puede facturar. La alternativa es incluirlos con un campo `cliente_activo: false` para que un huérfano de un cliente rechazado después no se pierda de vista.
2. **¿Cuenta una `NOTA_CREDITO` o `NOTA_DEBITO` activa como "facturado"?** Hoy `validateLotesNoFacturados` no distingue `tipo_documento`, así que un lote vinculado solo a una nota de crédito queda fuera de la lista y además bloqueado para una factura. Si eso es un error del spec 25, conviene resolverlo antes o junto con este.
3. **¿Ruta en `documentos-fiscales` o en `lotes`?** Se propone `GET /documentos-fiscales/lotes-pendientes` porque la pregunta es fiscal y el repositorio que ya conoce `documento_fiscal_lote` es ese. `GET /lotes/pendientes-facturacion` también funciona (en `LotesController` no hay `:id` pelado), pero mete facturación en el módulo de calidad, que es lo que el spec 25 evitó con la tabla puente.
4. **¿Hace falta un "no facturable"?** Si en la operación real hay lotes que nunca llevan factura, sin esa marca la bandeja pierde utilidad con el tiempo, y eso sería otro spec con DDL.
