# chat-ai-function-bandeja-del-aprobador-001 — `bandeja_del_aprobador`

**Status:** Propuesta
**Fecha:** 2026-09-25
**Módulo:** src/modules/chat + src/ia/prompts/chat.prompt.ts
**Tipo:** Función nueva de function calling (solo lectura, aditiva)

## Problema

El perfil para el que el SPEC 28 dejó el chat abierto —el aprobador y el `ADMIN`— no puede hacer su pregunta más frecuente: **"¿qué tengo pendiente?"**.

Hoy la única forma de ver lotes a la espera del aprobador es `lotes_de_cliente` con `estado: 'pendiente_aprobacion'`, que exige un `cliente_id` obligatorio (`src/ia/prompts/chat.prompt.ts:210`; el despachador corta sin él en `src/modules/chat/repository/chat.repository.ts:766-768`). El aprobador no tiene cartera: `mis_clientes` le devuelve cero filas con un aviso que lo manda a buscar por nombre (`chat.repository.ts:721-730`). Para contestar "qué lotes esperan aprobación" el modelo tendría que conocer todos los clientes y recorrerlos uno por uno, y con `MAX_VUELTAS = 3` (`chat.repository.ts:131`) eso no cabe ni con dos clientes.

Además, aunque tuviera el lote, saber si **ya puede finalizarse** le cuesta otra llamada por lote. `metricas_de_lote` devuelve `sin_revisar_por_aprobador` (`chat.repository.ts:1005-1008`), pero de un solo lote. La regla real de finalización (`validatePesajesRevisados`, `src/modules/lotes/repository/lotes.repository.ts:742-760`: al menos un pesaje activo y ninguno activo con `aprobado IS NULL`) no la resuelve ninguna herramienta. El modelo tendría que deducirla, y eso es calcular.

## Ejemplos de preguntas

1. **"¿Qué lotes tengo pendientes de aprobar?"**. Hoy: `mis_clientes` → 0 filas → el modelo no sabe qué clientes recorrer → declina o repregunta. Con esta función: 1 llamada.
2. **"¿Cuáles ya puedo finalizar?"**. Hoy: imposible sin recorrer clientes, y además una llamada a `metricas_de_lote` por cada lote para deducir la regla. Agota las vueltas y termina en `redactarConLoQueHay` con datos parciales. Con esta función: 1 llamada con `situacion: 'listos_para_finalizar'`.
3. **"¿Cuántos pesajes me faltan revisar en total?"**. Hoy: exige sumar `sin_revisar_por_aprobador` de varios lotes, una suma que el prompt prohíbe hacer. Con esta función: el total llega resuelto en `resumen.pesajes_sin_revisar`.
4. **"¿Qué lote lleva más tiempo esperando?"**. Hoy: exige comparar fechas, cosa que el modelo tiene prohibida. Con esta función: el orden es de más antiguo a más reciente y `dias_esperando` llega calculado en MySQL.
5. **"¿Qué hay pendiente de Agroexport?"**. Hoy: `buscar_persona` + `lotes_de_cliente`, que funciona pero sin progreso de revisión. Con esta función: `buscar_persona` + esta, con el progreso incluido.

## Propuesta

### Declaración para Gemini

```ts
{
    name: 'bandeja_del_aprobador',
    description:
        'Lista los lotes que el supervisor ya envio al aprobador y que todavia no se finalizaron, de TODOS los clientes a la vez, con el progreso de revision de sus pesajes ya calculado y si ya se pueden finalizar. Usala para "que tengo pendiente de aprobar", "que lotes puedo finalizar", "cuantos pesajes me faltan revisar" o "que lote lleva mas tiempo esperando", sobre todo cuando no se nombra ningun cliente. NO la uses para lotes abiertos ni finalizados: para esos usa lotes_de_cliente. NO la uses para las cifras de peso de un lote: para eso usa metricas_de_lote.',
    parameters: {
        type: 'OBJECT',
        properties: {
            cliente_id: {
                type: 'INTEGER',
                description:
                    'Opcional. Deja solo los lotes de ese cliente. Resuelvelo antes con buscar_persona o mis_clientes; nunca lo inventes. Si no se nombra cliente, no lo mandes.',
            },
            alcance: {
                type: 'STRING',
                enum: ['todos', 'mi_cartera'],
                description:
                    'todos: lotes de cualquier cliente. mi_cartera: solo de los clientes asignados a quien pregunta; usala unicamente si dice "mis clientes" o "mis lotes". Por defecto todos. Se ignora si mandas cliente_id.',
            },
            situacion: {
                type: 'STRING',
                enum: ['todos', 'con_pendientes', 'listos_para_finalizar'],
                description:
                    'todos: toda la bandeja. con_pendientes: lotes con al menos un pesaje sin revisar. listos_para_finalizar: lotes con todos sus pesajes activos ya revisados, que el aprobador puede finalizar. Por defecto todos.',
            },
            limite: {
                type: 'INTEGER',
                description: 'Cuantas filas devolver. Por defecto 10.',
            },
        },
    },
}
```

No tiene `required`: la pregunta típica no trae ningún argumento.

### Validación en el despachador

`case` nuevo en `despachar()`, antes del `default`:

```ts
case 'bandeja_del_aprobador':
    return await this.bandejaDelAprobador(
        this.aEntero(args.cliente_id),
        this.aAlcance(args.alcance),
        this.aSituacion(args.situacion),
        this.aLimite(args.limite),
        contexto,
    );
```

- `cliente_id`: pasa por `aEntero`. Si llega, se comprueba que el cliente exista (`selectFrom('clientes').select(['id','nombre','isActive'])`, igual que `lotesDeCliente`). Si no existe, se devuelve `{ error: 'No existe ningun cliente con id N.' }`. **No se restringe a la cartera**, por la decisión del SPEC 28.
- `alcance`: coercionador nuevo `aAlcance` que acepta solo `'todos' | 'mi_cartera'`. Cualquier otro valor da `undefined`, que equivale a `'todos'`; un valor raro no se interpreta. Con `'mi_cartera'` los ids salen de **`contexto.clientes`**, nunca del modelo. Si la cartera está vacía se responde con un `aviso` **sin consultar `lotes`**: es el caso normal del aprobador, y el aviso le dice que pida sin ese alcance. Si llega `cliente_id`, `alcance` se ignora y la cabecera lo dice.
- `situacion`: coercionador nuevo `aSituacion` que acepta solo los tres valores del enum. Cualquier otro da `'todos'`.
- `limite`: `aLimite` existente. Queda topado en `LIMITE_MAXIMO` (50) y las filas visibles en `Math.min(limite, MAX_FILAS_MODELO)` (20), igual que las demás listas.
- La etapa `CLIENTE_FINAL` se resuelve **por `codigo`**, nunca por el id 2. Si falta, se devuelve `{ error: "La etapa 'CLIENTE_FINAL' no esta configurada..." }`, el mismo texto que `lotesDeCliente`.

### Consulta

Tres consultas, ninguna dentro de una transacción.

**1. Etapa**

```ts
const etapa = await this.db.selectFrom('etapas').select(['id'])
    .where('codigo', '=', 'CLIENTE_FINAL').executeTakeFirst();
```

**2. Base de la bandeja: los discriminadores de la tabla de CLAUDE.md, `motivo_rechazo` primero**

```ts
// Progreso de revision SOLO de los lotes de la bandeja: el GROUP BY no recorre
// la tabla entera de pesajes, recorre los de los lotes que ya pasaron el filtro.
const revision = this.db
    .selectFrom('pesajes')
    .innerJoin('lotes as lr', 'lr.id', 'pesajes.lote_id')
    .select([
        'pesajes.lote_id',
        sql<number | string>`COUNT(*)`.as('activos'),
        sql<number | string>`SUM(pesajes.aprobado IS NULL)`.as('sin_revisar'),
        sql<number | string>`SUM(pesajes.aprobado = 1)`.as('aprobados'),
        sql<number | string>`SUM(pesajes.aprobado = 0)`.as('rechazados'),
        sql<number | string>`SUM(pesajes.fuera_de_rango = 1)`.as('fuera_de_rango'),
    ])
    .where('pesajes.isActive', '=', 1)
    .where('lr.motivo_rechazo', 'is', null)
    .where('lr.aprobado_por', 'is not', null)
    .where('lr.finalizado_por', 'is', null)
    .where('lr.etapa_id', '=', etapa.id)
    .groupBy('pesajes.lote_id')
    .as('r');

let base = this.db
    .selectFrom('lotes')
    .innerJoin('clientes', 'clientes.id', 'lotes.cliente_id')
    .leftJoin('usuarios as supervisor', 'supervisor.id', 'lotes.aprobado_por')
    .leftJoin(revision, 'r.lote_id', 'lotes.id')
    .where('lotes.motivo_rechazo', 'is', null)      // no rechazado (va primero, siempre)
    .where('lotes.aprobado_por', 'is not', null)    // el supervisor lo envio
    .where('lotes.finalizado_por', 'is', null)      // el aprobador no lo cerro
    .where('lotes.estado', '=', 'cerrado')
    .where('lotes.etapa_id', '=', etapa.id);        // CLIENTE_FINAL por codigo

if (clienteId !== undefined) base = base.where('lotes.cliente_id', '=', clienteId);
else if (alcance === 'mi_cartera')
    base = base.where('lotes.cliente_id', 'in', contexto.clientes.map((c) => c.id));
```

Los cinco filtros juntos son exactamente la precondición de `validateLoteEnClienteFinal` más la de `validateLoteNoFinalizado`. La bandeja contiene lo mismo sobre lo que el aprobador puede actuar, ni más ni menos.

**3a. Resumen de la bandeja completa, antes del filtro de `situacion` y sin límite**

```ts
const resumen = await base.select([
    sql<number | string>`COUNT(*)`.as('lotes'),
    sql<number | string>`COALESCE(SUM(COALESCE(r.sin_revisar,0) > 0), 0)`.as('con_pendientes'),
    sql<number | string>`COALESCE(SUM(COALESCE(r.activos,0) > 0 AND COALESCE(r.sin_revisar,0) = 0), 0)`.as('listos'),
    sql<number | string>`COALESCE(SUM(COALESCE(r.activos,0) = 0), 0)`.as('sin_pesajes_activos'),
    sql<number | string>`COALESCE(SUM(r.sin_revisar), 0)`.as('pesajes_sin_revisar'),
]).executeTakeFirst();
```

**3b. Lista filtrada por `situacion`**

```ts
let lista = base;
if (situacion === 'con_pendientes')
    lista = lista.where(sql`COALESCE(r.sin_revisar,0)`, '>', 0);
if (situacion === 'listos_para_finalizar')
    lista = lista.where(sql`COALESCE(r.activos,0)`, '>', 0)
                 .where(sql`COALESCE(r.sin_revisar,0)`, '=', 0);

const consulta = lista.select([
    'lotes.id', 'lotes.nombre_lote', 'lotes.variedad_o_talla',
    'lotes.cliente_id', 'clientes.nombre as cliente',
    'supervisor.complete_name as enviado_por', 'lotes.aprobado_en',
    sql<number | string>`DATEDIFF(CURDATE(), DATE(lotes.aprobado_en))`.as('dias_esperando'),
    sql<number | string>`COALESCE(r.activos,0)`.as('activos'),
    sql<number | string>`COALESCE(r.sin_revisar,0)`.as('sin_revisar'),
    sql<number | string>`COALESCE(r.aprobados,0)`.as('aprobados'),
    sql<number | string>`COALESCE(r.rechazados,0)`.as('rechazados'),
    sql<number | string>`COALESCE(r.fuera_de_rango,0)`.as('fuera_de_rango'),
]);

const total = await this.contarFiltrados(consulta);   // el mismo clearSelect de siempre
const filas = await consulta
    .orderBy('lotes.aprobado_en', 'asc')   // lo que mas lleva esperando, primero
    .orderBy('lotes.id', 'asc')
    .limit(Math.min(limite, ChatRepository.MAX_FILAS_MODELO))
    .execute();
```

Notas:

- **Sin `selectAll()`**: se enumeran columnas, así que ni `firma_aprobador` ni `resumen_ia` viajan a Google.
- `aprobado` es tri-estado y se cuenta en SQL: `IS NULL` es sin revisar, `= 1` aprobado y `= 0` rechazado. Nunca se compara con `false`.
- Los días se calculan en MySQL con `CURDATE()`, el mismo reloj que escribió `aprobado_en`.

### Respuesta de la herramienta

Cada fila lleva `situacion` resuelta en el repositorio, a partir de enteros ya contados:

- `activos = 0` → `'sin_pesajes_activos'`
- `sin_revisar > 0` → `'con_pendientes'`
- en otro caso → `'listo_para_finalizar'`

`porcentaje_revisado` se calcula con `dosDecimales((aprobados + rechazados) * 100 / activos)`, o `null` si `activos = 0`.

```json
{
  "alcance_aplicado": "todos los clientes, los 10 que mas llevan esperando",
  "resumen": {
    "lotes_en_bandeja": 7,
    "con_pendientes": 4,
    "listos_para_finalizar": 2,
    "sin_pesajes_activos": 1,
    "pesajes_sin_revisar": 38
  },
  "situacion_consultada": "todos",
  "total": 7,
  "mostrados": 7,
  "lotes": [
    {
      "id": 41,
      "nombre_lote": "BILLS2026",
      "variedad_o_talla": "Grande",
      "cliente": "Agroexport",
      "enviado_por": "Ana Supervisora",
      "enviado_en": "12/09/2026 10:32",
      "dias_esperando": 13,
      "pesajes_activos": 14,
      "sin_revisar": 0,
      "aprobados": 11,
      "rechazados": 3,
      "fuera_de_rango": 3,
      "porcentaje_revisado": 100,
      "situacion": "listo_para_finalizar"
    }
  ]
}
```

Sin filas, sin tocar la regla de "nunca 'no hay datos'":

```json
{
  "alcance_aplicado": "solo el cliente Agroexport",
  "resumen": { "lotes_en_bandeja": 0, "con_pendientes": 0, "listos_para_finalizar": 0, "sin_pesajes_activos": 0, "pesajes_sin_revisar": 0 },
  "situacion_consultada": "listos_para_finalizar",
  "lotes": [],
  "total": 0,
  "aviso": "No hay ningun lote de Agroexport esperando al aprobador que ya se pueda finalizar. La bandeja solo incluye lotes que el supervisor envio y que nadie finalizo ni rechazo."
}
```

Con `alcance: 'mi_cartera'` y la cartera vacía:

```json
{
  "lotes": [],
  "total": 0,
  "aviso": "Quien pregunta no tiene clientes asignados, asi que 'mi cartera' esta vacia. Es lo normal para un aprobador: se puede consultar la bandeja de todos los clientes sin ese alcance."
}
```

### Línea para el system instruction (opcional)

Se agrega al final del bloque `SUPUESTOS Y REPREGUNTAS`, sin tocar nada de lo que ya hay:

```
- Para "que tengo pendiente de aprobar", "que lotes puedo finalizar" o "cuantos
  pesajes me faltan revisar" sin un cliente concreto, usa bandeja_del_aprobador:
  nunca recorras lotes_de_cliente cliente por cliente.
```

## Impacto técnico

- Archivos a tocar, solo agregados:
  - `src/ia/prompts/chat.prompt.ts`: un objeto al final de `HERRAMIENTAS_CHAT` y, si se aprueba, la línea del system instruction.
  - `src/modules/chat/repository/chat.repository.ts`: un `case` en `despachar()`, el método privado `bandejaDelAprobador` y dos coercionadores nuevos, `aAlcance` y `aSituacion`, con sus tipos `Alcance` y `SituacionBandeja`. Reutiliza `aEntero`, `aLimite`, `contarFiltrados`, `dosDecimales` y `fechaHora` sin modificarlos.
  - `src/modules/chat/repository/chat.repository.spec.ts`: un `describe` nuevo.
- DDL: ninguno. Antes de implementar conviene revisar con `SHOW INDEX FROM pesajes` que haya índice sobre `lote_id` y, si hace falta, mirar la consulta con `EXPLAIN`. Es una comprobación, no un cambio.
- Tests a agregar, con el doble de Kysely por cola que ya existe:
  - el despachador enruta `bandeja_del_aprobador` y no cae en el `default`;
  - sin la etapa `CLIENTE_FINAL`, responde con texto de error y no consulta `lotes`;
  - `alcance: 'mi_cartera'` con la cartera vacía devuelve el aviso sin consultar `lotes`;
  - un `cliente_id` inexistente devuelve texto, no lanza;
  - `alcance` y `situacion` desconocidos se ignoran y caen a `'todos'`;
  - `limite: 500` se recorta a 50 y las filas visibles a 20;
  - la clasificación de `situacion` por fila: `activos = 0`, `sin_revisar > 0` y todo revisado;
  - `porcentaje_revisado` con 3 de 14 da exactamente `21.43` y con 0 activos da `null`;
  - una bandeja vacía devuelve `aviso` y `total: 0`.

## Por qué mejora la precisión y la experiencia

- **Cierra el hueco del perfil principal.** El aprobador, sin cartera, hoy no puede preguntar por su trabajo pendiente sin nombrar clientes uno a uno. Con esto es una llamada y una redacción: dos de las tres vueltas.
- **Quita tres cálculos al modelo:** la suma de pesajes sin revisar entre lotes, la regla de "listo para finalizar" y la antigüedad en días. Los tres llegan resueltos en SQL o en el repositorio.
- **Quita una ambigüedad de estados.** "Pendiente" queda definido por los discriminadores canónicos (`motivo_rechazo`, `aprobado_por`, `finalizado_por`) más la etapa por `codigo`, que es la misma precondición de los endpoints del aprobador. Lo que el chat dice que se puede finalizar es lo que `PATCH /lotes/:id/finalizar/byApprover` acepta.
- **Ya no hay que llegar a la vuelta de cierre.** La pregunta que hoy agotaría `MAX_VUELTAS` y acabaría en `redactarConLoQueHay` con datos parciales se contesta completa.

## Riesgos

- **Exposición:** lista lotes de todos los clientes con el nombre del supervisor que los envió. No agrega nada nuevo: `lotes_de_cliente` ya expone lo mismo cliente por cliente y la decisión de acceso abierto es del SPEC 28. No viaja ningún dato fiscal, RTN, teléfono ni dirección.
- **Costo:** tres consultas por llamada. El `GROUP BY` está acotado a los pesajes de los lotes que ya están en la bandeja, gracias al `innerJoin` con los mismos discriminadores, no a toda la tabla. La bandeja es pequeña por naturaleza (lotes a la espera de una persona).
- **Confusión con `lotes_de_cliente` y `pendiente_aprobacion`:** las dos devuelven lotes en `CLIENTE_FINAL`. La descripción nueva dice cuándo usar cada una (sin cliente, o con progreso de revisión, esta; abiertos o finalizados, la otra). No se cambia la descripción existente.
- **Divergencia mínima de criterio:** esta herramienta añade `motivo_rechazo IS NULL` y `finalizado_por IS NULL`, que `lotes_de_cliente` no aplica. Hoy no produce diferencias, porque rechazar desde el aprobador mueve la etapa a `RECHAZADO` y finalizar la mueve a `FINALIZADO`. Si alguien moviera etapas a mano, esta herramienta sería la más estricta de las dos, que es lo más seguro.
- **"Listo para finalizar" no cubre la firma:** el endpoint pide además `firma_aprobador` en el cuerpo. La herramienta dice que el lote cumple las condiciones de datos, no que el trámite esté hecho. El prompt ya impide ofrecer la acción (`FRASE_SOLO_LECTURA`).

## Fuera de alcance

- **No modifica ninguna herramienta existente**: ni nombre, ni parámetros, ni descripción, ni comportamiento de las ocho actuales.
- No toca `INSTRUCCION_SISTEMA_CHAT` más allá de la línea nueva opcional, ni `generationConfig`, `toolConfig`, `MAX_VUELTAS`, `LIMITE_MAXIMO` o `MAX_FILAS_MODELO`.
- No finaliza, aprueba ni rechaza nada. No tiene ningún camino de escritura.
- No corrige el `etapa_id = 2` de `getAllLotesByClienteForApprover`, que sigue siendo del módulo `lotes` y está fuera del chat.
- No lista pesajes individuales pendientes de revisión: para eso ya está `pesajes_de_lote`.
- No incluye lotes abiertos, finalizados ni rechazados.
- No hace DDL ni crea tablas de conversación. `chat_log` sigue siendo de solo escritura.

## Preguntas abiertas

1. **Orden**: ¿lo que más lleva esperando primero (`aprobado_en ASC`, propuesto) o lo más reciente primero, como el resto del chat? La propuesta rompe con el `DESC` a propósito, porque una bandeja de trabajo se atiende por antigüedad.
2. **Lotes `sin_pesajes_activos`**: ¿se muestran (propuesto, porque el aprobador tiene que saber que están bloqueados y solo puede rechazarlos) o se excluyen de la bandeja?
3. **`dias_esperando`**: ¿días naturales con `DATEDIFF` (propuesto) o laborables? Los laborables necesitarían un calendario que no existe.
