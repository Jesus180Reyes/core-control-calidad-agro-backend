# SPEC 35 — Métricas de calidad de pesajes

> **Status:** Approved
> **Depends on:** SPEC 16 (convención de filtros por fecha sobre `pesajes.created_at`), SPEC 22 (convención de Swagger), SPEC 25 (`fechaISO` en `src/schemas/fecha.schema.ts`)
> **Date:** 2026-10-09
> **Objective:** Crear un módulo `metricas` con un endpoint `GET /metricas/calidad`. Calcula al vuelo en SQL los indicadores de calidad de los pesajes de un período y los desglosa por cliente, con filtros opcionales de fecha, cliente y operador.

---

## Why this spec exists

El proyecto ya captura todo lo que hace falta para medir la calidad: `fuera_de_rango`, `estado_calidad_id`, el rango `peso_minimo`/`peso_ideal`/`peso_maximo` de cada lote, el veredicto del aprobador (`aprobado`) y las anulaciones (`isActive = 0`). Pero ningún endpoint agrega esos datos. Para saber qué porcentaje de lo pesado este mes salió fuera de rango, hoy hay que ir a MySQL.

El spec 27 calcula agregados por lote (`getMetricasLote`), pero son privados, sirven solo para llenar un prompt y abarcan un único lote. Este spec es el primero que **devuelve agregados como campos** de una lectura. Es también el primero de un módulo de métricas que se piensa en bloques:

| Bloque | Spec |
| --- | --- |
| **A. Calidad del pesaje** | **Este** |
| B. Productividad operativa (pesajes y kg por operador y día, taras, antigüedad de lotes abiertos) | Futuro |
| C. Flujo y tiempos de ciclo de lotes (embudo, `created_at → aprobado_en → finalizado_en`, backlog del aprobador) | Futuro |
| D. Comercial / fiscal (pendientes de facturar, facturado por mes y destino, merma) | Futuro |
| E. Clientes (top por volumen, clientes inactivos) | Futuro |

Cada bloque es su propio spec y su propio endpoint `GET /metricas/<bloque>`. Este spec deja armado el módulo para que los siguientes solo agreguen una ruta.

---

## Scope

**In:**

- Un módulo nuevo, `src/modules/metricas/`, con controller, service, repository y DTO, registrado en `AppModule`.
- `GET /metricas/calidad`, con token, sin body.
- Query params opcionales: `desde`, `hasta`, `cliente_id` y `usuario_id`. Un valor inválido responde **400**.
- Sin `desde` ni `hasta`, el período por defecto son los **últimos 30 días**, incluido hoy, según el reloj de MySQL.
- Un resumen global del período con siete grupos de indicadores (ver Data model).
- La distribución por estado de calidad.
- El desglose por cliente.
- Swagger: `@ApiTags`, `@ApiBearerAuth`, `@ApiOperation`.
- `CLAUDE.md` actualizado.

**Out of scope (for future specs):**

- Los bloques B, C, D y E de la tabla anterior.
- Los desgloses por producto, por operador y la serie diaria. Se ofrecieron y no se eligieron. El filtro `?usuario_id` cubre el caso "las métricas de un operador", pero no hay un listado de todos los operadores.
- Los filtros `?producto_id` y `?lote_id`.
- Restringir el endpoint por rol (`ADMIN`) o por cartera (`cliente_operador`). Ver Decisions.
- Tablas de snapshots, precálculo, caché o cron.
- Paginación del desglose por cliente.
- Excluir los pesajes de lotes rechazados o de clientes rechazados.
- Una desviación absoluta en unidades del lote.
- Exportar a CSV o Excel.
- Una fila en `catalogo_permisos`/`permisos`.

---

## Data model

Este spec **no aplica DDL**. Solo lee `pesajes`, `lotes`, `clientes` y `estados_calidad`. `src/database/types/types.ts` no cambia, y los conteos de FKs y `UNIQUE` del proyecto tampoco.

### Población

| Conjunto | Condición |
| --- | --- |
| **Base del período** | `pesajes INNER JOIN lotes ON lotes.id = pesajes.lote_id`, con `pesajes.created_at >= desde` y `pesajes.created_at < DATE_ADD(hasta, INTERVAL 1 DAY)`, más los filtros recibidos. |
| **Activos** (denominador de casi todo) | La base con `pesajes.isActive = 1`. |
| **Anulados** | La base con `pesajes.isActive = 0`. |

Cuatro consecuencias que conviene tener presentes:

- Un pesaje con `lote_id NULL` no entra en ningún conjunto, porque el `INNER JOIN` lo descarta. Sin lote no hay `peso_ideal` ni `cliente_id`.
- Un pesaje con `isActive = NULL` no cuenta ni como activo ni como anulado, igual que en las dos lecturas de listado.
- **No se filtra por el estado del lote ni del cliente.** Entran los pesajes de lotes abiertos, cerrados, rechazados y finalizados, y los de clientes rechazados. Es una decisión explícita.
- Las anulaciones se ubican en el período por la **fecha del pesaje** (`created_at`), no por `rechazado_en`. Así, "de lo pesado en el período, cuánto se anuló" tiene un denominador coherente.

### Filtros (`FiltrosMetricasCalidadDto`)

| Param | Tipo | Se aplica a |
| --- | --- | --- |
| `desde` | `fechaISO('La fecha desde').optional()` | `pesajes.created_at >= desde` |
| `hasta` | `fechaISO('La fecha hasta').optional()` | `pesajes.created_at < DATE_ADD(hasta, INTERVAL 1 DAY)` (**inclusivo** de todo el día, como en el spec 16) |
| `cliente_id` | `z.coerce.number().int().positive().optional()` | `lotes.cliente_id` |
| `usuario_id` | `z.coerce.number().int().positive().optional()` | `pesajes.usuario_id` |

- **Sin `.catch(undefined)`.** Un valor inválido (`?cliente_id=abc`, `?cliente_id=0`, `?desde=2026-02-30`, `?desde=`) responde **400** desde el pipe. Esto rompe a propósito la regla del spec 16 "ningún filtro produce 400", ver Decisions.
- `desde` posterior a `hasta` (cuando vienen los dos) responde **400** `La fecha desde no puede ser posterior a la fecha hasta`, con un `.refine` sobre el objeto.
- Un param desconocido (`?producto_id=3`, `?foo=bar`) **no** produce 400. Zod lo descarta y responde 200.
- Ningún campo lleva `.transform()` que cambie el tipo. `z.coerce.number()` es idempotente frente al doble pipe global: la segunda pasada recibe un número y lo deja igual.
- Un `cliente_id` o `usuario_id` que no existe **no** produce 404 ni 400: responde 200 con todo en cero, porque el endpoint no valida que existan.

**Resolución del período** (en el repositorio, con el reloj de MySQL):

| Recibido | `desde` aplicado | `hasta` aplicado |
| --- | --- | --- |
| nada | `CURDATE() - INTERVAL 29 DAY` | `CURDATE()` |
| solo `desde` | `desde` | `CURDATE()` |
| solo `hasta` | `hasta - INTERVAL 29 DAY` | `hasta` |
| los dos | `desde` | `hasta` |

Un `desde` posterior a hoy, recibido sin `hasta`, deja un rango invertido. No es 400, porque el DTO no conoce la fecha de MySQL: responde 200 con todo en cero.

### Indicadores

Todos los porcentajes se calculan en el backend con **2 decimales** (`Math.round(x * 100) / 100`). Cuando el denominador es 0 valen `null`, no `0`. Los conteos son enteros y los `DECIMAL`/`AVG` que devuelve MySQL se pasan por `Number()`.

| Campo | Cálculo | Sobre |
| --- | --- | --- |
| `total_pesajes` | `COUNT(*)` | Activos |
| `fuera_de_rango` | `SUM(fuera_de_rango = 1)` | Activos |
| `porcentaje_fuera_de_rango` | `fuera_de_rango / total_pesajes × 100` | — |
| `desviacion_promedio_pct` | `AVG((peso_neto - peso_ideal) / peso_ideal × 100)` | Activos con `peso_neto IS NOT NULL` y `peso_ideal > 0` |
| `desviacion_estandar_pct` | `STDDEV_POP` de la misma expresión | Ídem |
| `aprobados_por_aprobador` | `SUM(aprobado = 1)` | Activos |
| `rechazados_por_aprobador` | `SUM(aprobado = 0)` | Activos |
| `sin_revisar` | `SUM(aprobado IS NULL)` | Activos |
| `porcentaje_rechazo_aprobador` | `rechazados / (aprobados + rechazados) × 100` | Solo los revisados |
| `anulados` | `COUNT(*)` | Anulados |
| `porcentaje_anulacion` | `anulados / (total_pesajes + anulados) × 100` | — |

La desviación tiene **signo**. Un valor positivo significa que se pesa por encima del ideal, o sea que se regala producto. Un valor negativo significa que se pesa por debajo, con riesgo de reclamo. Es relativa al `peso_ideal` de cada lote, así que se puede comparar entre productos y unidades de medida.

`sin_revisar` incluye pesajes de lotes que todavía no llegaron a `CLIENTE_FINAL` y que, por lo tanto, nadie podría haber revisado aún. No es un "pendiente del aprobador". Esa métrica es del bloque C.

### Respuesta

`GET /metricas/calidad` (**200**):

```json
{
  "ok": true,
  "msg": "Metricas de calidad obtenidas correctamente",
  "metricas": {
    "periodo": { "desde": "2026-09-10", "hasta": "2026-10-09" },
    "filtros": { "cliente_id": null, "usuario_id": null },
    "resumen": {
      "total_pesajes": 412,
      "fuera_de_rango": 37,
      "porcentaje_fuera_de_rango": 8.98,
      "desviacion_promedio_pct": 1.42,
      "desviacion_estandar_pct": 3.87,
      "aprobados_por_aprobador": 150,
      "rechazados_por_aprobador": 12,
      "sin_revisar": 250,
      "porcentaje_rechazo_aprobador": 7.41,
      "anulados": 9,
      "porcentaje_anulacion": 2.14
    },
    "por_estado_calidad": [
      { "estado_calidad_id": 1, "codigo": "APROBADO", "nombre": "APROBADO", "total": 375, "porcentaje": 91.02 }
    ],
    "por_cliente": [
      {
        "cliente_id": 4,
        "cliente": "Agroexport S.A.",
        "total_pesajes": 210,
        "fuera_de_rango": 20,
        "porcentaje_fuera_de_rango": 9.52,
        "desviacion_promedio_pct": 2.01,
        "desviacion_estandar_pct": 4.1,
        "aprobados_por_aprobador": 80,
        "rechazados_por_aprobador": 5,
        "sin_revisar": 125,
        "porcentaje_rechazo_aprobador": 5.88,
        "anulados": 4,
        "porcentaje_anulacion": 1.87
      }
    ]
  }
}
```

- La clave del payload es `metricas`, el nombre del recurso, según la convención `{ ok, msg, <payload> }`.
- `periodo` siempre trae el rango **aplicado**, no el recibido, en formato `YYYY-MM-DD`.
- `filtros` refleja los dos ids aplicados, o `null` si no vinieron.
- `por_estado_calidad` trae **todas** las filas de `estados_calidad`, también las que tienen `total: 0`, para que la forma sea estable al graficar. Se ordena por `estados_calidad.id` ASC. `porcentaje` es sobre `total_pesajes` de los activos.
- `por_cliente` trae un elemento por cliente con al menos un pesaje activo **o** anulado en la base del período, con los once campos del `resumen`. Los clientes rechazados (`clientes.isActive = 0`) se incluyen. Se ordena por `total_pesajes` DESC y desempata por `cliente_id` ASC. El `cliente` sale de `clientes.nombre` por `LEFT JOIN`, así que un `lotes.cliente_id` huérfano aparece con `cliente: null`. Sin paginación.
- La suma de `total_pesajes` de `por_cliente` es igual a `resumen.total_pesajes`, y lo mismo pasa con `anulados`.
- Con `?cliente_id`, `por_cliente` tiene cero o un elemento.

Errores:

| Caso | Código |
| --- | --- |
| Sin token | 401 |
| Param inválido (`cliente_id`, `usuario_id`, `desde`, `hasta`) | 400 (del pipe de Zod) |
| `desde` > `hasta` | 400 `La fecha desde no puede ser posterior a la fecha hasta` |

No hay 404. Ningún valor de filtro bien formado produce otra cosa que 200.

### Consultas

Cuatro como máximo, ninguna dentro de una transacción (es una lectura):

1. **Resolución del período**: un `SELECT` con `DATE_FORMAT(...)` que devuelve `desde`/`hasta` aplicados. Se hace siempre en MySQL, aunque vengan los dos, para que el formato salga de un solo lugar.
2. **Resumen global**: una sola consulta sobre la base del período con `isActive IN (0, 1)` y agregados condicionales (`SUM(CASE WHEN pesajes.isActive = 1 AND ... THEN 1 ELSE 0 END)`), de modo que activos y anulados salen en el mismo recorrido. `AVG` y `STDDEV_POP` usan `CASE WHEN isActive = 1 AND peso_neto IS NOT NULL AND peso_ideal > 0 THEN (...) END`, para que los `NULL` no cuenten.
3. **Por estado de calidad**: `estados_calidad LEFT JOIN` a la base del período con `isActive = 1`, con las condiciones **en el `ON`** para conservar los estados con cero, y `GROUP BY estados_calidad.id`.
4. **Por cliente**: la misma forma que la consulta 2, más `LEFT JOIN clientes` y `GROUP BY lotes.cliente_id`.

La base se arma una sola vez en un helper privado del repositorio, que aplica el `INNER JOIN`, el rango y los filtros, y de ella derivan las consultas 2, 3 y 4. Es el mismo patrón que dejó el spec 29.

### Archivos

| Archivo | Cambio |
| --- | --- |
| `src/modules/metricas/metricas.module.ts` | Nuevo. `imports: [DatabaseModule]`. |
| `src/modules/metricas/metricas.controller.ts` | Nuevo. `@Controller('metricas')`, `@Get('calidad')`. |
| `src/modules/metricas/metricas.service.ts` | Nuevo. Pass-through. |
| `src/modules/metricas/repository/metricas.repository.ts` | Nuevo. `getMetricasCalidad(filtros)` y helpers privados. |
| `src/modules/metricas/dto/filtros-metricas-calidad.dto.ts` | Nuevo. |
| `src/app.module.ts` | Registra `MetricasModule`. |
| `CLAUDE.md` | Tabla de endpoints, conteo de rutas, lista de endpoints abiertos y nota de la convención de filtros. |

---

## Implementation plan

1. Crear el módulo vacío: `metricas.module.ts`, un controller sin rutas, el service y el repository con `DatabaseService` inyectado, igual que `CatalogosModule`. Registrarlo en `AppModule`. La app arranca y el route log no cambia.
2. Crear `FiltrosMetricasCalidadDto` con los cuatro campos, sin `.catch`, y el `.refine` de `desde <= hasta`. Usar `fechaISO` de `src/schemas/fecha.schema.ts`, no una copia local.
3. En `MetricasRepository`, agregar:
   1. `resolverPeriodo(filtros)`: la consulta 1, según la tabla de resolución.
   2. `baseCalidad(periodo, filtros)`: arma la base del período (`pesajes INNER JOIN lotes`, rango y filtros) sin `SELECT`.
   3. `calcularIndicadores(row)`: función pura que convierte una fila de agregados en los once campos, con `Number()`, redondeo a 2 decimales y `null` cuando el denominador es 0. La usan el resumen y cada elemento de `por_cliente`.
4. Agregar `getMetricasCalidad(filtros)`: resuelve el período y corre las consultas 2, 3 y 4 con `Promise.all` sobre `this.dbService.client`. El pool de una conexión las serializa, y no pasa nada. Devuelve `{ periodo, filtros, resumen, por_estado_calidad, por_cliente }`.
5. `MetricasService.getMetricasCalidad` como pass-through.
6. En `MetricasController`, agregar `@Get('calidad')` con `@Query() filtros: FiltrosMetricasCalidadDto`, `@ApiTags('metricas')` y `@ApiBearerAuth()` en la clase, y `@ApiOperation`. Responde `{ ok: true, msg: 'Metricas de calidad obtenidas correctamente', metricas }`. La descripción de Swagger dice: que es abierto a cualquier autenticado y no valida `cliente_operador`, que el período por defecto son 30 días, que un filtro inválido responde 400 (a diferencia de los filtros de `pesajes`), que la desviación es relativa al `peso_ideal` y tiene signo, y que incluye pesajes de lotes y clientes rechazados.
7. Verificar a mano contra MySQL. Con el mismo rango, comparar `total_pesajes`, `fuera_de_rango` y `anulados` del resumen con un `SELECT COUNT(*)` escrito a mano, y comprobar que `por_cliente` suma lo mismo que el resumen.
8. Actualizar `CLAUDE.md`:
   - Fila `metricas` en la tabla de endpoints.
   - Conteo de rutas: **37** en total, `metricas` **1**, **36** operaciones OpenAPI bajo **33** `paths`.
   - Lista de endpoints que omiten `validateVinculoOperador` (de 22 a **23**) y lecturas abiertas (de 19 a **20**).
   - Nota de que `?usuario_id` existe aquí y no en `GET /pesajes/historial`, y por qué no rompe la garantía del spec 15.
   - Nota de que este DTO responde 400, igual que `FiltrosClientesDto`, contra la regla del spec 16.

---

## Acceptance criteria

- [ ] El route log muestra exactamente una ruta más que antes de este spec: `GET /metricas/calidad`.
- [ ] Sin header `Authorization`, responde 401.
- [ ] Con el token de un `OPERADOR` sin ninguna fila en `cliente_operador`, responde 200 con las métricas de todos los clientes.
- [ ] Sin params, `metricas.periodo.hasta` es la `CURDATE()` de MySQL y `metricas.periodo.desde` es 29 días antes.
- [ ] Con `?desde=2026-09-01&hasta=2026-09-30`, `periodo` devuelve exactamente esas dos fechas.
- [ ] Con solo `?hasta=2026-09-30`, `periodo.desde` es `2026-09-01`.
- [ ] Un pesaje creado a las 23:59:59 del día `hasta` cuenta en el período.
- [ ] `resumen.total_pesajes` coincide con un `SELECT COUNT(*)` a mano de pesajes `isActive = 1` con `lote_id` no nulo en el rango.
- [ ] `resumen.anulados` coincide con el mismo conteo con `isActive = 0`.
- [ ] Los pesajes de un lote rechazado y los de un cliente rechazado cuentan en el resumen y aparecen en `por_cliente`.
- [ ] Un pesaje con `lote_id NULL` no cuenta en ningún indicador.
- [ ] `porcentaje_fuera_de_rango` es igual a `fuera_de_rango / total_pesajes × 100` redondeado a 2 decimales.
- [ ] `desviacion_promedio_pct` es positiva en un lote cuyos pesajes están todos por encima de `peso_ideal`, y negativa en uno con todos por debajo.
- [ ] Un período sin pesajes responde 200 con `total_pesajes: 0`, todos los porcentajes y desviaciones en `null`, `por_cliente: []` y `por_estado_calidad` con todas las filas del catálogo en `total: 0`.
- [ ] `por_estado_calidad` trae una fila por cada fila de `estados_calidad`, ordenadas por id.
- [ ] La suma de `total_pesajes` de `por_cliente` es igual a `resumen.total_pesajes`, y la suma de `anulados` es igual a `resumen.anulados`.
- [ ] `por_cliente` está ordenado por `total_pesajes` DESC.
- [ ] `?cliente_id=X` deja `por_cliente` con un solo elemento, el de `X`, y el resumen coincide con ese elemento.
- [ ] `?usuario_id=Y` solo cuenta pesajes con `pesajes.usuario_id = Y`.
- [ ] `?cliente_id=999999` (inexistente) responde 200 con todo en cero.
- [ ] `?cliente_id=abc`, `?cliente_id=0`, `?cliente_id=-1`, `?usuario_id=abc`, `?desde=2026-02-30`, `?desde=` y `?hasta=hoy` responden 400.
- [ ] `?desde=2026-10-01&hasta=2026-09-01` responde 400 `La fecha desde no puede ser posterior a la fecha hasta`.
- [ ] `?producto_id=3` y `?foo=bar` responden 200, ignorados.
- [ ] La respuesta tiene la forma `{ ok, msg, metricas: { periodo, filtros, resumen, por_estado_calidad, por_cliente } }`.
- [ ] Ningún campo de la respuesta es un string numérico: todos los conteos y porcentajes son `number` o `null`.
- [ ] `/docs` muestra el endpoint bajo el tag `metricas` con su descripción, el candado de bearer y los cuatro query params.
- [ ] No se aplicó DDL y no se agregó ninguna fila a `catalogo_permisos` ni a `permisos`.

---

## Decisions

- **Sí:** un módulo de métricas por bloques, uno por spec. Meter calidad, productividad, flujo, fiscal y clientes en un solo spec tocaba cuatro dominios con reglas de acceso distintas.
- **Sí:** empezar por calidad. Decisión del usuario. Es el núcleo del sistema y lo que el diagrama persigue.
- **Sí:** abierto a cualquier autenticado. Decisión del usuario. Sigue la línea de los 22 endpoints que no validan `cliente_operador`. Es el **decimoséptimo** spec consecutivo sin fila de permiso.
- **No:** restringirlo a `ADMIN` con el patrón del spec 34. Se ofreció como recomendación y se descartó. Ver Risks.
- **No:** filtrar por cartera (`cliente_operador`). Habría dos caminos de consulta.
- **Sí:** calcular al vuelo en SQL. Decisión del usuario. Sin DDL, siempre al día, y suficiente para el volumen actual.
- **No:** tabla de snapshots. Pide DDL, un proceso programado y una estrategia de recálculo. Si el volumen lo exige, va en su propio spec.
- **Sí:** un endpoint por bloque con filtros (`GET /metricas/calidad`). Decisión del usuario. Pocas rutas, y el front arma el dashboard.
- **No:** un `GET /metricas/dashboard` único (rígido y pesado) ni un endpoint por métrica (demasiadas rutas).
- **Sí:** población de **todos los pesajes activos**, sin mirar el estado del lote ni del cliente. Decisión del usuario. Mide la calidad de lo que se pesó, independientemente de lo que pasó después con el lote.
- **No:** excluir los lotes rechazados (era la recomendación) ni limitarse a los finalizados.
- **Sí:** desviación **relativa en %** frente al `peso_ideal`, con signo. Decisión del usuario. Es la única forma comparable entre productos con unidades y rangos distintos.
- **Sí:** también la desviación estándar de esa misma expresión. Un promedio cercano a 0 puede esconder pesajes muy dispersos hacia los dos lados.
- **No:** desviación absoluta en unidades. Solo tendría sentido dentro de un lote.
- **Sí:** desglose solo por cliente. Decisión del usuario.
- **No:** desgloses por producto, por operador y serie diaria. Se pueden sumar en otro spec sin romper la forma de la respuesta, porque serían claves nuevas al lado de `por_cliente`.
- **Sí:** clientes rechazados incluidos en el desglose. Decisión del usuario. Si no, el desglose no sumaría lo mismo que el resumen.
- **Sí:** período por defecto de 30 días según el reloj de MySQL. Decisión del usuario. Acota el costo de la consulta, y usar el reloj de MySQL lo alinea con el `NOW()` con el que se escribe `created_at`.
- **Sí:** con un solo extremo, el otro se completa para formar 30 días. Es la extensión natural del default, y evita que `?hasta` sin `desde` recorra todo el histórico.
- **Sí:** `hasta` inclusivo con `DATE_ADD(hasta, INTERVAL 1 DAY)`. `created_at` es `DATETIME`, igual que en los filtros de pesajes del spec 16.
- **Sí:** filtros `cliente_id` y `usuario_id`. Decisión del usuario.
- **No:** `producto_id` y `lote_id`. Para un lote ya existe el resumen del spec 27.
- **Sí:** `?usuario_id` existe aquí aunque el spec 16 lo prohibió en `GET /pesajes/historial`. Ese endpoint garantiza que solo ves lo tuyo. Este nunca lo prometió: es abierto y agrega datos de todos. El historial no cambia.
- **Sí:** un filtro inválido responde **400**. Decisión del usuario. **Rompe a propósito la regla del spec 16** ("ningún filtro produce 400"), y es el segundo DTO del proyecto que lo hace, después de `FiltrosClientesDto`. La diferencia es que acá la ruptura queda escrita en un spec. La razón: un dashboard que muestra "métricas de todos" porque un id mal escrito se ignoró en silencio es peor que un error visible.
- **Sí:** un param desconocido sigue sin dar 400. Es el comportamiento por defecto de Zod en todo el proyecto, y cambiarlo aquí sería una tercera política.
- **Sí:** un id inexistente responde 200 con ceros, no 404. No hace falta una consulta extra para validar, y el resultado ya es correcto.
- **Sí:** anulaciones ubicadas por la fecha del pesaje, no por `rechazado_en`. Decisión del usuario. Así la tasa tiene un denominador coherente.
- **Sí:** `por_estado_calidad` con todas las filas del catálogo, también en cero. La forma estable le simplifica el gráfico al front.
- **Sí:** porcentajes calculados en el backend con 2 decimales y `null` con denominador 0. El spec 27 enseñó que es mejor no delegar la aritmética. `null` en lugar de `0` distingue "no hubo datos" de "salió 0%".
- **Sí:** hasta cuatro consultas fijas, ninguna por cliente. El desglose sale de un solo `GROUP BY`.
- **Sí:** sin transacción. Es una lectura, igual que las demás.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Cualquier autenticado, operador incluido, ve la calidad de **todos** los clientes y, con `?usuario_id`, el rendimiento de cualquier otro operador | **Aceptado por decisión explícita.** Es la lectura agregada más amplia del proyecto, la vigésima abierta. Cerrarla con `validateCallerEsAdmin` es un cambio de una línea, si se decide en otro spec. |
| El volumen de `pesajes` crece y la consulta se vuelve lenta, sobre todo con rangos largos | El default de 30 días acota el caso común. Si hace falta, un índice sobre `pesajes.created_at` (DDL de otro spec) o snapshots. Hoy no hay límite máximo de rango. |
| El filtro inválido responde 400 mientras los de `pesajes` lo ignoran, y el front se confunde | Queda escrito en la descripción de Swagger y en `CLAUDE.md`. |
| Un lote con `peso_ideal = 0` o mal cargado distorsiona la desviación | `peso_ideal > 0` lo excluye del cálculo de desviación, aunque sigue contando en los conteos. Un `peso_ideal` absurdo pero positivo sí distorsiona, y no hay forma de detectarlo desde aquí. |
| Incluir los pesajes de lotes rechazados hace que un lote descartado por un error de carga empeore las métricas | **Aceptado por decisión del usuario.** El dato sigue siendo un pesaje real. |
| `sin_revisar` se lee como "pendientes del aprobador" | Está documentado que incluye lotes que todavía no llegaron a `CLIENTE_FINAL`. El backlog real es del bloque C. |
| `desde` en el futuro sin `hasta` deja un rango invertido y responde 200 con ceros, sin error | Es raro y no es dañino. El DTO no puede validarlo porque no conoce la fecha de MySQL. |
| `por_cliente` sin paginación crece con la cantidad de clientes | Solo incluye clientes con pesajes en el período. Con el volumen actual es aceptable. |

---

## What is **not** in this spec

- Bloques B (productividad), C (flujo y tiempos de lotes), D (comercial/fiscal) y E (clientes).
- Desgloses por producto, por operador y serie diaria.
- Filtros `producto_id` y `lote_id`.
- Restricción por rol o por cartera.
- Snapshots, caché o precálculo.
- Paginación del desglose.
- Exportación a CSV/Excel.
- Índices o cualquier otro DDL.

Cada uno de estos, si se necesita, va en su propio spec.
