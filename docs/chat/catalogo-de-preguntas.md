# Catálogo de preguntas del chat Agri

Documento vivo. Lo mantiene el agente `edith`: en cada revisión anticipa preguntas nuevas, revisa los fallos reales de `chat_log` y comprueba cada pregunta contra el código de `src/ia/prompts/chat.prompt.ts` y `src/modules/chat/repository/chat.repository.ts`.

**Numeración.** Cada pregunta tiene un identificador único y estable (`P01`, `P02`…) para citarla por número. Hay tres reglas:

- Los números **no se reutilizan** ni se renumeran, aunque cambie el orden o la sección.
- Una pregunta nueva toma el **siguiente número libre**, después del más alto que exista.
- Una pregunta que se retira **conserva su número** y queda marcada como *retirada*, con el motivo.

**Cómo leerlo.**

- **Origen**: *anticipada* es una pregunta pensada para el perfil. *Observada ×N* aparece N veces en `chat_log` con la misma intención (los nombres reales se sustituyen por `<cliente>`, `<lote>`, `<persona>`).
- **Estado**:
  - *cubierta*: hay herramienta, el vocabulario la traduce y la cadena cabe en `MAX_VUELTAS = 3`.
  - *frágil*: se puede contestar, pero depende de una elección del modelo, de una cadena larga o de un argumento que el modelo no conoce.
  - *hueco*: el dato existe en la base y ninguna herramienta lo trae.
  - *fuera de alcance*: escritura, un dato que el sistema no tiene, o algo que un spec dejó fuera a propósito.
- **Cadena**: las herramientas en orden. `→` separa vueltas y `+` llamadas paralelas dentro de una vuelta.

Estado del código revisado: 14 herramientas (`comparar_lotes` añadida el 2026-11-12; P17–P22, P26 y P37 verificadas ese día con Gemini real contra la base `agro_demo`, en 1 o 2 llamadas cada una).

---

## Operador de báscula

| # | Pregunta (como la dice el usuario) | Origen | Estado | Cadena o motivo | Spec |
| --- | --- | --- | --- | --- | --- |
| P01 | mis pesajes de hoy | observada ×4 | cubierta | `pesajes_de_usuario` con el id del contexto y `periodo: hoy` | 28 |
| P02 | y los de esta semana? / bueno dime en el mes | observada ×4 | cubierta | Seguimiento: `pesajes_de_usuario` con otro `periodo`. El historial viaja, los resultados no | 28 |
| P03 | mis pesajes de la semana pasada | observada ×1 | cubierta | `pesajes_de_usuario` `periodo: semana_pasada` | 28 |
| P04 | como va mi turno? / como cerro el dia? | observada ×3 | cubierta | `pesajes_de_usuario` `periodo: hoy`. El modelo asume "mi" y lo dice | 28 |
| P05 | Mis pesajes de hoy del cliente `<cliente>` | observada ×3 | cubierta | `pesajes_de_usuario` con `cliente_id` del contexto. Es una de las sugerencias | 28 |
| P06 | dame el detalle del pesaje 1234 / q paso con la etiqueta 1234 | anticipada | cubierta | `detalle_de_pesaje`. Sirve también para anulados | 28 |
| P07 | ese pesaje quedo bien? | anticipada | frágil | `detalle_de_pesaje` solo si el id está en el historial. Sin id, el modelo tiene que repreguntar | 28 |
| P08 | cuanto lleva pesado el lote `<lote>` | anticipada | cubierta | `buscar_persona` → `metricas_de_lote` (`peso_neto_total`) | 28 |
| P09 | cuanto le falta al lote `<lote>` | anticipada | fuera de alcance | `lotes` no guarda una meta de peso ni de unidades. No hay dato contra el que restar | — |
| P10 | que temperatura tenia la pulpa / el brix del pesaje | anticipada | fuera de alcance | Medición que el sistema no modela. `pesajes.observaciones` no viaja a Google (spec 44) | 44 |
| P11 | por que me pidieron PIN en ese pesaje | anticipada | hueco | `pesajes.aprobado_con_excepcion_por` y `autorizaciones_pin` existen. Ninguna herramienta los lee | — |
| P12 | anula el ultimo pesaje que hice | anticipada | fuera de alcance | Escritura. `FRASE_SOLO_LECTURA` | 28 |

## Supervisor

| # | Pregunta (como la dice el usuario) | Origen | Estado | Cadena o motivo | Spec |
| --- | --- | --- | --- | --- | --- |
| P13 | como va el lote `<lote>` | observada ×4 | cubierta | `buscar_persona` → `metricas_de_lote` | 28 |
| P14 | Como van los lotes abiertos del cliente `<cliente>` | observada ×6 | cubierta | `lotes_de_cliente` (abierto) y, para cifras, `metricas_de_lote` por lote en paralelo. Es una sugerencia | 28 |
| P15 | q se peso hoy del cliente `<cliente>` | observada ×9 | cubierta | `buscar_persona` → `pesajes_de_cliente`. Antes de esa herramienta fallaba 6 de 9 veces con `TEXTO_NO_CONVERGE` | — |
| P16 | y en este mes? (seguimiento de P15) | observada ×1 | cubierta | `buscar_persona` → `pesajes_de_cliente` `periodo: este_mes` | — |
| P17 | hazme un cuadro comparativo de los lotes del cliente `<cliente>` | observada ×2 | cubierta | `buscar_persona` → `comparar_lotes` con `cliente_id`. Antes recorría `lotes_de_cliente` ×3 y `metricas_de_lote` ×4 a ×8 | — |
| P18 | cual es el que tiene mas pesajes rechazados? | observada ×2 | cubierta | `comparar_lotes` `orden_por: rechazados_por_aprobador`. La posición y los empates vienen calculados | — |
| P19 | y cuales son los lotes con mas aprobaciones? | observada ×3 | cubierta | `comparar_lotes` `orden_por: aprobados_por_aprobador` | — |
| P20 | cuales lotes han destacado mejor de este cliente (para el jefe) | observada ×2 | cubierta | `comparar_lotes` `orden_por: porcentaje_fuera_de_rango`, `direccion: asc`. El prompt fija ese criterio para "el mejor" y lo hace decir | — |
| P21 | dame las metricas de los lotes / de este mes | observada ×2 | cubierta | `comparar_lotes`, con `periodo` si lo hay: la ventana va sobre los pesajes y las cifras cuentan solo los de la ventana | — |
| P22 | que lote tiene mas fuera de rango / el lote mas chasta | anticipada | cubierta | `comparar_lotes` `orden_por: fuera_de_rango` o `porcentaje_fuera_de_rango` | — |
| P23 | cuánto sobrepeso tiene el `<lote>` | observada ×1 | cubierta | `buscar_persona` → `metricas_de_lote` (`estados_calidad`) | 28 |
| P24 | que salio fuera de rango hoy | observada ×1 | hueco | Sin cliente ni persona no hay herramienta. Recorrió 3 clientes y 3 lotes, y contestó solo sobre los lotes abiertos | — |
| P25 | que pesajes hubo hoy? / lo digo en general | observada ×2 | hueco | `pesajes_de_cliente` exige `cliente_id`. El modelo asumió "los tuyos" y, al aclarar "en general", declinó | — |
| P26 | que lotes se trabajaron hoy? | observada ×1 | cubierta | `comparar_lotes` `periodo: hoy`: solo salen los lotes con pesajes en la ventana | — |
| P27 | que actividades hubieron hoy? | observada ×1 | frágil | Contesta con "tus" pesajes y lo dice. Un supervisor esperaba ver la planta entera | — |
| P28 | quienes son los operadores que pesaron en estos lotes? | observada ×3 | hueco | Un turno declinó y otro terminó en `TEXTO_NO_CONVERGE` tras 12 llamadas. Hoy solo sale de las filas de `pesajes_de_lote` | 48 |
| P29 | dame lo que pesaron todos los operadores en los lotes | observada ×2 | hueco | `TEXTO_NO_CONVERGE` tras 8 llamadas. Pide un agregado por operador | — |
| P30 | dame los nombres de los operadores activos | observada ×1 | hueco | Declinó. El dato existe (`usuarios` + rol, spec 39 lo expone como catálogo) | 39 |
| P31 | dame lo que chambeo `<persona>` esta semana | observada ×1 | cubierta | `buscar_persona` → `pesajes_de_usuario` | 28 |
| P32 | ¿qué pesó `<persona>` ayer? | observada ×1 | cubierta | `buscar_persona` → `pesajes_de_usuario` `periodo: ayer` | 28 |
| P33 | quien peso mas hoy / compara a Carlos con Pedro | anticipada | hueco | No hay agregado por operador. Con dos `pesajes_de_usuario` el modelo tendría que comparar totales | — |
| P34 | compara lo de hoy con lo de ayer | anticipada | frágil | Dos llamadas con distinto `periodo`. Presenta las dos cifras, pero la diferencia no la puede calcular | — |
| P35 | que lotes se aprobaron hoy | observada ×7 | cubierta | `lotes_aprobados`. Antes de esa herramienta declinaba 5 de 5 veces | — |
| P36 | que lotes se finalizaron hoy / que terminaron hoy | observada ×9 | cubierta | `lotes_finalizados`. Antes declinaba o confundía con `lotes_aprobados` | — |
| P37 | que lotes rechazaron / cuales lotes se cayeron | anticipada | cubierta | `comparar_lotes` `estado: rechazado` (`motivo_rechazo IS NOT NULL`) | — |
| P38 | ¿Cuánto se fue a mercado local este mes? | observada ×1 | cubierta | `rechazos_por_destino` `periodo: este_mes` | 47 |
| P39 | Qué se hizo con lo malo del lote `<lote>` | observada ×2 | frágil | `buscar_persona` → `rechazos_por_destino`. Una vez encadenó además `pesajes_de_lote` y terminó en `TEXTO_NO_CONVERGE` | 47 |
| P40 | los de antier / los ultimos 15 dias | anticipada | frágil | Fuera del enum `periodo`. El prompt hace que lo diga y ofrezca el más cercano. Es una negativa explicada, no un fallo | 28 |
| P41 | aprueba el lote `<lote>` | anticipada | fuera de alcance | Escritura. `FRASE_SOLO_LECTURA` | 28 |

## Aprobador

| # | Pregunta (como la dice el usuario) | Origen | Estado | Cadena o motivo | Spec |
| --- | --- | --- | --- | --- | --- |
| P42 | qué tengo pendiente de aprobar | observada ×8 | cubierta | `lotes_pendientes`. Antes de esa herramienta recorría clientes | — |
| P43 | ¿Qué lote lleva más tiempo esperando? | observada ×1 | cubierta | `lotes_pendientes` sale ordenado del más viejo al más nuevo | — |
| P44 | ¿Cuáles ya puedo finalizar? | observada ×1 | frágil | `lotes_pendientes` trae `pesajes_sin_revisar`. "Puedo finalizar" = 0 sin revisar es una lectura del modelo | — |
| P45 | ¿Cuántos pesajes me faltan revisar en total? | observada ×2 | frágil | `lotes_pendientes` trae el conteo por lote y no el total. Sumarlo es lo que el prompt prohíbe. Una vez declinó | — |
| P46 | que aplazo el aprobador esta semana y a donde se mando | observada ×1 | cubierta | `rechazos_por_destino` `periodo: esta_semana` | 47 |
| P47 | qué observación dejó el aprobador en el lote `<lote>` | observada ×4 | cubierta | `buscar_persona` → `metricas_de_lote` (`cierre`). Antes de eso, 1 declinación y 1 `TEXTO_NO_CONVERGE` | 46 |
| P48 | Que observacion dejo el aprobador en los lotes finalizados de `<cliente>` | observada ×2 | cubierta | `buscar_persona` → `lotes_de_cliente` (finalizado) | 46 |
| P49 | Muéstrame los pesajes del lote `<lote>` y a dónde fue cada rechazado | observada ×2 | cubierta | `buscar_persona` → `pesajes_de_lote` (`destino_del_rechazo`) | 47 |
| P50 | cual fue el motivo del rechazo del pesaje 1234 | anticipada | fuera de alcance | `motivo_rechazo` no viaja a Google, por decisión (spec 47). Se ofrece el destino | 47 |
| P51 | que pesajes rechace yo este mes | anticipada | hueco | `pesajes.rechazado_por` existe. Ninguna herramienta filtra por quien revisó | — |
| P52 | que lotes finalice yo esta semana | anticipada | frágil | `lotes_finalizados` trae `finalizado_por` por fila, pero no filtra por persona. Con más de 20 filas la lista queda recortada | — |
| P53 | finaliza el lote `<lote>` con la firma | anticipada | fuera de alcance | Escritura. `FRASE_SOLO_LECTURA` | 28 |

## Administrador

| # | Pregunta (como la dice el usuario) | Origen | Estado | Cadena o motivo | Spec |
| --- | --- | --- | --- | --- | --- |
| P54 | cual es el cliente con mayor casos de exito en sus pesajes y lotes? | observada ×1 | hueco | Recorrió lotes de 2 clientes y comparó a ojo. El agregado por cliente existe en `GET /metricas/calidad` (spec 35), pero no en el chat | 35 |
| P55 | como vamos de calidad este mes / porcentaje de rechazo del mes | anticipada | hueco | Misma fuente: `resumen` del spec 35. Ninguna herramienta lo trae | 35 |
| P56 | cuantos lotes se abrieron este mes | anticipada | frágil | `comparar_lotes` trae `total_lotes`, pero su ventana va sobre los pesajes y no sobre la apertura del lote: cuenta los lotes trabajados, no los abiertos | — |
| P57 | que clientes estan rechazados | anticipada | frágil | `buscar_persona` devuelve el estado del cliente al buscarlo, pero no hay un listado | — |
| P58 | cuantas facturas tiene el lote `<lote>` | anticipada | fuera de alcance | `documentos-fiscales` quedó fuera de las herramientas (spec 28) | 28 |

## Sobre el chat mismo

| # | Pregunta (como la dice el usuario) | Origen | Estado | Cadena o motivo | Spec |
| --- | --- | --- | --- | --- | --- |
| P59 | quien eres? / quien te creo? / eres ChatGPT o Gemini? | observada ×10 | cubierta | `FRASE_IDENTIDAD`. Antes del spec 30 declinaba (5 turnos) | 30 |
| P60 | gracias / ok / cheke | observada ×6 | cubierta | `FRASE_CORTESIA` | 31 |
| P61 | es certera esta informacion? / entonces es veridica? | observada ×3 | cubierta | `FRASE_VERACIDAD`, sin herramienta. Antes era frágil: una vez declinó llamando a 3 herramientas | — |
| P62 | pero tienes contexto de todo este chat? | observada ×1 | cubierta | `FRASE_MEMORIA`, sin herramienta. Antes contestaba bien pero dependía del modelo | — |
| P63 | puedes darme el archivo pdf? | observada ×1 | cubierta | Declinación correcta: el chat no genera archivos | 28 |
| P64 | quien invento apple / cual es la raiz cuadrada de 20 | observada ×5 | cubierta | Declinación correcta (`FRASE_DECLINACION`) | 28 |

---

## Totales de esta revisión

64 preguntas (P01–P64): 37 cubiertas, 10 frágiles, 10 huecos y 7 fuera de alcance. 43 son intenciones observadas en `chat_log` (153 turnos entre el 2026-09-20 y el 2026-10-22) y 21 son anticipadas. Siguiente número libre: **P65**.

Los huecos se concentran en tres familias:

- **Comparar y ordenar lotes**: P17–P22, con 14 turnos observados, 5 de ellos en `TEXTO_NO_CONVERGE`. Resuelta el 2026-11-12 con `comparar_lotes`, que también cubre P26 y P37 y deja P56 frágil. P28 (operadores de esos lotes) pasa a la familia de agregados por operador.
- **Pesajes de la planta entera, sin cliente ni persona**: P24 y P25, con 3 turnos. P26 (que lotes se trabajaron) ya la cubre `comparar_lotes`.
- **Agregados por operador**: P28, P29, P30 y P33, con 6 turnos.

**Última revisión:** 2026-11-12 (solo `comparar_lotes`; `chat_log` no se volvió a revisar desde el 2026-10-23).
