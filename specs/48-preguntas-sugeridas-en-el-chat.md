# SPEC 48 — Preguntas sugeridas cuando el chat no entiende

> **Status:** Approved
> **Depends on:** SPEC 28 (crea el chat, el bucle de herramientas y `chat_log`), SPEC 30 (patrón de frases literales en `chat.prompt.ts`)
> **Date:** 2026-10-23
> **Objective:** Que el chat, ante una pregunta del sistema que cabe en varias consultas, devuelva de 2 a 3 preguntas concretas en un campo `sugerencias` de `POST /chat` que el frontend pinta como botones.

---

## Why this spec exists

Hoy, cuando el mensaje habla del sistema pero es vago ("cómo va lo de Agroexport", "dame lo del aprobador"), el chat tiene dos salidas y las dos fallan:

- **Adivina.** La regla de VOCABULARIO le pide tomar "la lectura más probable" y decirlo. Consulta algo que quizá no era, y el usuario tiene que volver a preguntar.
- **Declina** con `FRASE_DECLINACION`, aunque había tres herramientas que servían. Para el usuario parece un error.

La sección `SUPUESTOS Y REPREGUNTAS` ya permite una repregunta por turno, pero solo resuelve la ambigüedad de **nombres** (dos a cuatro coincidencias). No cubre la ambigüedad de **intención**.

Este spec toma tres decisiones que conviene tener claras antes de leer el resto.

**La primera: las sugerencias viajan como una función, no como salida JSON.** El chat ya usa llamadas a funciones. Se declara `sugerir_preguntas({ preguntas })`, que no consulta nada: es la forma en que el modelo dice "no entendí, propongo estas". El backend la intercepta en el bucle, valida las preguntas y corta el turno. La frontera queda donde ya está: el modelo solo pide funciones y el backend decide qué hacer con ellas. Se descartó pedir a Gemini salida estructurada (`responseSchema`), porque obligaría a que **todas** las respuestas fueran JSON y rompería el markdown de los turnos normales.

**La segunda: el texto que acompaña a los botones es fijo.** `respuesta` lleva una frase literal nueva, `FRASE_SUGERENCIAS`, y las preguntas ya nombran el cliente, lote o periodo. Así no hay texto libre del modelo fuera de las preguntas, y la frase se puede verificar literal en pruebas, igual que las otras.

**La tercera: el contrato solo crece.** `POST /chat` agrega `sugerencias: string[]`, siempre presente y vacío cuando no hay. Un frontend que todavía no lo use lo ignora y sigue funcionando.

---

## Scope

**In:**

- Constante nueva `FRASE_SUGERENCIAS` en `src/ia/prompts/chat.prompt.ts`, exportada y literal, sin tildes como las demás.
- Declaración nueva `sugerir_preguntas` en `HERRAMIENTAS_CHAT`, con un único argumento `preguntas` (arreglo de strings).
- Sección nueva `PREGUNTAS SUGERIDAS:` en `INSTRUCCION_SISTEMA_CHAT`, que dice cuándo llamar a `sugerir_preguntas` y cuándo seguir usando `FRASE_DECLINACION`.
- En `ChatRepository.preguntar` (`src/modules/chat/repository/chat.repository.ts`):
  - interceptar `sugerir_preguntas` antes de `despachar`;
  - validar las preguntas y, si son válidas, cortar el turno sin otra llamada a Gemini;
  - devolver `{ respuesta, sugerencias }` en lugar de un `string`.
- `ChatService.preguntar` y `ChatController.preguntar` propagan el nuevo campo: `{ ok, msg, respuesta, sugerencias }`.
- Todas las salidas del turno llevan `sugerencias`: el límite diario, `TEXTO_DISCULPA`, `TEXTO_NO_CONVERGE` y la vuelta de cierre devuelven `[]`.
- `chat_log.respuesta` guarda las sugerencias dentro del texto, con el formato del Data model. Sin DDL.
- Descripción de Swagger de `POST /chat`: el campo nuevo y cómo usarlo.
- `src/modules/chat/CLAUDE.md`: el campo, la función que no consulta y el formato en `chat_log`.
- Pruebas en `chat.prompt.spec.ts` y `chat.repository.spec.ts`.

**Out of scope (for future specs):**

- Usar `sugerir_preguntas` para la ambigüedad de nombres (dos a cuatro coincidencias de `buscar_persona`). Sigue listando las opciones en texto, como hoy.
- Sugerencias después de una respuesta con datos ("¿quieres ver también…?"). Este spec solo cubre el turno en que el chat no entendió.
- Una columna propia en `chat_log` para las sugerencias o una marca de "turno sin entender".
- Saber qué sugerencia tocó el usuario (telemetría de clics).
- Cambios en `GET /chat/sugerencias`, que sigue siendo sin IA y para la pantalla vacía.
- El frontend. Este spec define el contrato y la recomendación de uso; los botones se construyen en el repo del front.
- Evals contra la API real de Gemini, por la misma razón que en el SPEC 28.

---

## Data model

No hay DDL ni variables de entorno nuevas.

### La respuesta de `POST /chat`

```jsonc
// Turno normal
{ "ok": true, "msg": "Consulta resuelta", "respuesta": "Hoy se registraron **25 pesajes**...", "sugerencias": [] }

// Turno en que el chat no entendió
{
  "ok": true,
  "msg": "Consulta resuelta",
  "respuesta": "No me quedo del todo claro que quieres ver. Elige una de estas preguntas o escribela con tus palabras.",
  "sugerencias": [
    "¿Qué lotes de Agroexport están abiertos?",
    "¿Qué se pesó hoy de Agroexport?",
    "¿Qué rechazó el aprobador de Agroexport esta semana?"
  ]
}
```

`sugerencias` está **siempre** presente. Cuando trae elementos, `respuesta` es exactamente `FRASE_SUGERENCIAS`.

### La constante

```ts
/** El texto que acompana a las preguntas sugeridas. Tambien literal. */
export const FRASE_SUGERENCIAS =
    'No me quedo del todo claro que quieres ver. Elige una de estas preguntas o escribela con tus palabras.';
```

### La declaración

```ts
{
    name: 'sugerir_preguntas',
    description:
        'No consulta datos. Usala cuando la pregunta habla de este sistema pero cabe en dos o mas ' +
        'herramientas distintas o no dice que quiere ver. Propone de 2 a 3 preguntas completas, ' +
        'cada una contestable con UNA herramienta, con el cliente, lote o periodo que el usuario nombro.',
    parameters: {
        type: 'object',
        properties: {
            preguntas: { type: 'array', items: { type: 'string' } },
        },
        required: ['preguntas'],
    },
}
```

### Validación de `preguntas`, en el backend

En este orden:

1. Se toman solo los elementos que son `string`.
2. A cada uno se le hace `trim()` y se reemplaza cualquier salto de línea por un espacio.
3. Se descartan los vacíos, los de más de **150** caracteres y los que tengan una etiqueta HTML (`/<[a-z!/]/i`, la misma regla de `GeminiService`).
4. Se quitan los repetidos (comparación exacta tras el `trim`).
5. Se quedan los **3** primeros.
6. Si quedan **menos de 2**, la llamada no es válida.

Constantes en `ChatRepository`: `MIN_SUGERENCIAS = 2`, `MAX_SUGERENCIAS = 3`, `MAX_CARACTERES_SUGERENCIA = 150`.

### Reglas del bucle

- **`sugerir_preguntas` sola y válida:** el turno termina. `respuesta = FRASE_SUGERENCIAS`, `sugerencias = <validadas>`. No se manda nada de vuelta a Gemini.
- **`sugerir_preguntas` sola e inválida:** se responde como cualquier herramienta que falla, con `functionResponse` `{ error: 'Las preguntas sugeridas no son validas: manda de 2 a 3 preguntas completas, sin HTML y de menos de 150 caracteres.' }`, y el bucle sigue dentro de `MAX_VUELTAS`.
- **`sugerir_preguntas` junto con otras llamadas en la misma vuelta:** se ignora la sugerencia y se ejecutan las demás. A `sugerir_preguntas` se le responde `{ error: 'sugerir_preguntas va sola, sin otras herramientas en la misma vuelta.' }`, porque el protocolo exige una respuesta por cada llamada reenviada en `partes`. Si el modelo pidió datos, los datos ganan.
- **En una vuelta posterior** (por ejemplo, tras un `buscar_persona`), `sugerir_preguntas` sola y válida también corta el turno. `herramientas` en `chat_log` guarda las consultas de datos que sí se hicieron.
- **La vuelta de cierre** (`redactarConLoQueHay`, `mode: 'NONE'`) no puede llamar funciones, así que nunca produce sugerencias.

### `chat_log`

- `sugerir_preguntas` **no se agrega** a `usadas`. Un turno que solo sugirió deja `herramientas` en `NULL`, porque es verdad que no hubo dato detrás.
- `respuesta` guarda la frase y las preguntas en un solo texto, armado por un helper exportado `textoConSugerencias(respuesta, sugerencias)`:

```
No me quedo del todo claro que quieres ver. Elige una de estas preguntas o escribela con tus palabras.

- ¿Qué lotes de Agroexport están abiertos?
- ¿Qué se pesó hoy de Agroexport?
- ¿Qué rechazó el aprobador de Agroexport esta semana?
```

Con `sugerencias` vacío, el helper devuelve `respuesta` sin cambios.

### Uso recomendado en el frontend

- Si `sugerencias.length > 0`, pintar un botón por pregunta debajo del mensaje.
- Al tocar un botón, mandar ese texto tal cual como `mensaje` del siguiente `POST /chat`.
- En `historial`, el turno del asistente se guarda con el mismo formato de `chat_log` (frase, línea en blanco, una viñeta por pregunta). Así, si el usuario escribe "la segunda" en vez de tocar, el modelo ve las opciones. El máximo es 101 + 2 + 3 × 152 caracteres, muy por debajo de los 4000 que acepta `historial`.

---

## Implementation plan

1. Añadir `FRASE_SUGERENCIAS` a `src/ia/prompts/chat.prompt.ts`, junto a las otras frases. Sin usarla todavía. `npm run lint` pasa.
2. Añadir la declaración `sugerir_preguntas` al final de `HERRAMIENTAS_CHAT`. En `ChatRepository.despachar`, si llega por error hasta ahí, devuelve `{ error }` como cualquier nombre desconocido. El chat sigue funcionando igual.
3. Añadir la sección `PREGUNTAS SUGERIDAS:` a `INSTRUCCION_SISTEMA_CHAT`, después de `VOCABULARIO` y antes de `CIFRAS`, con el texto del bloque de abajo. Ajustar la regla de VOCABULARIO "toma la mas probable y dilo" para que remita a esta sección cuando la duda es entre herramientas.
4. En `ChatRepository`: las tres constantes, un método privado `validarSugerencias(argumentos): string[] | null` y el helper exportado `textoConSugerencias`. Pruebas unitarias del validador y del helper.
5. Cambiar `preguntar` para que devuelva `{ respuesta: string; sugerencias: string[] }` en todas sus salidas, con `sugerencias: []` en todas. Propagar el tipo en `ChatService` y en `ChatController`. Ajustar las pruebas existentes de `chat.repository.spec.ts` que esperan un `string`.
6. Interceptar `sugerir_preguntas` en el bucle según las reglas del Data model. `registrar` recibe `textoConSugerencias(respuesta, sugerencias)`. Pruebas en `chat.repository.spec.ts` con Gemini simulado.
7. Actualizar la descripción de Swagger de `POST /chat` y `src/modules/chat/CLAUDE.md`.
8. Prueba manual contra la API real, con el servidor en marcha: los mensajes de los criterios manuales, uno por turno, sin historial.

### Texto de la sección del prompt

```
PREGUNTAS SUGERIDAS:
- Si el mensaje habla de este sistema (un lote, un cliente, una persona,
  pesajes, la calidad, el aprobador) pero cabe en dos o mas herramientas
  distintas, o no dice que quiere ver, no declines y no adivines: llama a
  sugerir_preguntas, sola, sin otras herramientas en la misma vuelta.
- Cada pregunta sugerida es una pregunta completa que se contesta con UNA
  herramienta, y ya trae el cliente, lote, persona o periodo que el usuario
  nombro. No inventes nombres que no dijo.
- Manda de 2 a 3 preguntas, cortas, sin markdown.
- Cuenta como la UNA repregunta del turno. Si en el historial ya sugeriste
  preguntas y el usuario sigue sin concretar, toma la opcion mas amplia y di
  cual tomaste.
- Si el usuario contesta con una referencia a tus sugerencias ("la segunda",
  "la de los rechazos"), contestala como si la hubiera escrito completa.
- Si la pregunta no tiene nada que ver con este sistema, sigue respondiendo
  la frase de declinacion: no sugieras preguntas para eso.
- Si la duda es solo de nombre (varias personas o clientes coinciden), sigue
  la regla de SUPUESTOS Y REPREGUNTAS, no esta.
```

---

## Acceptance criteria

**Automáticos (`chat.prompt.spec.ts`):**

- [X] `FRASE_SUGERENCIAS` está exportada y es distinta de `FRASE_DECLINACION`.
- [X] `HERRAMIENTAS_CHAT` contiene una declaración llamada `sugerir_preguntas` con `preguntas` en `required`.
- [X] `INSTRUCCION_SISTEMA_CHAT` contiene el encabezado `PREGUNTAS SUGERIDAS:` y el nombre `sugerir_preguntas`.
- [X] `INSTRUCCION_SISTEMA_CHAT` sigue conteniendo `FRASE_DECLINACION` literal.

**Automáticos (`chat.repository.spec.ts`, Gemini simulado):**

- [X] Gemini pide `sugerir_preguntas` con 3 preguntas válidas: `preguntar` devuelve `respuesta === FRASE_SUGERENCIAS` y esas 3 preguntas, y `conversar` se llamó **una** vez.
- [X] Con 4 preguntas válidas, `sugerencias` trae las 3 primeras.
- [X] Con 1 pregunta válida, o con 3 donde dos son vacías o tienen HTML, el turno no corta: Gemini recibe un `functionResponse` con `error` y `conversar` se llama de nuevo.
- [X] Con preguntas repetidas, se devuelven sin repetir.
- [X] Una pregunta de 151 caracteres se descarta y una de 150 se acepta.
- [X] `sugerir_preguntas` junto con `lotes_de_cliente` en la misma vuelta: se ejecuta `lotes_de_cliente`, `sugerir_preguntas` recibe un `error` y el turno sigue.
- [X] Un turno de texto normal devuelve `sugerencias: []`.
- [X] El límite diario agotado, el `TEXTO_DISCULPA` y el `TEXTO_NO_CONVERGE` devuelven `sugerencias: []`.
- [X] En un turno que solo sugirió, el `INSERT` en `chat_log` lleva `herramientas: null` y `respuesta === textoConSugerencias(FRASE_SUGERENCIAS, sugerencias)`.
- [X] `textoConSugerencias(x, [])` devuelve `x` sin cambios.
- [X] `npm run test` pasa y `npm run lint` no da errores.

**Manuales, contra la API real (`POST /chat` con token, sin historial, con un cliente real en lugar de `<cliente>`):**

- [X] `{ mensaje: "como va lo de <cliente>" }` responde 200, `respuesta` es exactamente `FRASE_SUGERENCIAS` y `sugerencias` trae 2 o 3 preguntas que nombran a `<cliente>`.
- [X] `{ mensaje: "dame lo del aprobador" }` responde 200 con `FRASE_SUGERENCIAS` y entre 2 y 3 sugerencias, no con `FRASE_DECLINACION`.
- [X] Mandar como `mensaje` una de las sugerencias devueltas responde con datos, `sugerencias: []`, y su fila de `chat_log` tiene `herramientas` distinto de `NULL`.
- [X] `{ mensaje: "cuanto es el 15% de 300" }` sigue respondiendo `FRASE_DECLINACION` con `sugerencias: []`.
- [X] `{ mensaje: "que se peso hoy de <cliente>" }` responde con datos y `sugerencias: []`.
- [X] `{ mensaje: "quien eres?" }` sigue respondiendo `FRASE_IDENTIDAD` con `sugerencias: []`.

---

## Decisions

- **Sí:** las sugerencias como una función declarada (`sugerir_preguntas`) que el backend intercepta. Reusa el mecanismo de llamadas a funciones que el chat ya tiene. **No:** salida estructurada de Gemini (`responseSchema`), que obligaría a que todas las respuestas fueran JSON. **No:** que el modelo escriba las preguntas en el markdown y el backend las extraiga con regex, que es frágil y no distingue una lista de datos de una lista de sugerencias.
- **Sí:** botones en el frontend con un campo `sugerencias` aparte. Decisión explícita del usuario tras ver la maqueta. **No:** solo viñetas en el markdown (la propuesta A), que no cambiaba el contrato pero obligaba a reescribir o copiar la pregunta.
- **Sí:** `sugerencias` siempre presente, `[]` cuando no hay. El front no tiene que revisar si el campo existe. **No:** omitirlo en los turnos normales.
- **Sí:** `respuesta` fija (`FRASE_SUGERENCIAS`) cuando hay sugerencias. Se verifica literal y no deja texto libre del modelo fuera de las preguntas. **No:** un argumento `introduccion` redactado por el modelo, que habría que validar aparte y que la maqueta mostraba con el nombre del cliente: el nombre ya va en las preguntas.
- **Sí:** el turno corta en cuanto llega una `sugerir_preguntas` válida, sin devolverla a Gemini. Ahorra una llamada y la latencia de Google. **No:** reenviar el resultado para que el modelo redacte la introducción.
- **Sí:** sugerencias inválidas vuelven al modelo como `{ error }`, igual que cualquier herramienta que falla ("una herramienta nunca lanza"). **No:** caer directo en `FRASE_DECLINACION`, que tira una vuelta que aún podía arreglarse.
- **Sí:** si llega junto con otras llamadas, ganan los datos. **No:** cortar el turno con sugerencias cuando el modelo ya decidió consultar algo.
- **Sí:** guardar las sugerencias dentro de `chat_log.respuesta`. Decisión explícita del usuario. Evita DDL a mano en cada entorno, y la frase fija al inicio basta para filtrar esas filas. **No:** una columna `sugerencias JSON`, que queda para su propio spec si hace falta analizarlas.
- **Sí:** `sugerir_preguntas` no cuenta en `herramientas`. Esa columna existe para saber si hubo dato detrás, y aquí no lo hubo. **No:** registrarla como una herramienta más, que haría pasar por consulta un turno sin datos.
- **Sí:** de 2 a 3 preguntas de hasta 150 caracteres. Una sola no es una elección, y más de tres botones no caben en una pantalla de teléfono. **No:** tope de cuatro.
- **Sí:** cuenta como la única repregunta del turno y consume un turno de `CHAT_LIMITE_DIARIO`, igual que la repregunta por nombre. **No:** un turno gratis, que obligaría a distinguirlo en el conteo de `turnosDeHoy`.
- **Sí:** la ambigüedad de nombres sigue como está. **No:** meterla aquí, que cambia una regla que ya funciona y merece medirse aparte.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| El modelo abusa de `sugerir_preguntas` y la usa en preguntas claras, lo que suma un turno a cada consulta | La regla exige que la pregunta quepa en dos o más herramientas. Los criterios manuales comprueban que "que se peso hoy de `<cliente>`" responde con datos. `chat_log` permite contar las filas que empiezan por `FRASE_SUGERENCIAS` y vigilar la proporción |
| El modelo la usa para preguntas fuera del sistema en lugar de declinar | La regla lo prohíbe explícitamente y un criterio manual lo comprueba con una pregunta de aritmética |
| Una sugerencia inventa un nombre de cliente o lote que el usuario no dijo | La regla lo prohíbe. Si pasa, el usuario toca el botón y el despachador valida el id contra el contexto, como con cualquier pregunta: como mucho responde que no lo encontró |
| Una sugerencia no se puede contestar con ninguna herramienta | La regla pide una pregunta por herramienta. Si pasa, el turno siguiente declina como hoy; no hay dato inventado |
| El frontend no guarda las sugerencias en `historial` y "la segunda" no se resuelve | El botón manda la pregunta completa y no depende del historial. El formato recomendado está documentado en Swagger y en el `CLAUDE.md` del módulo |
| Un texto inyectado en un dato (nombre de lote) pide al modelo sugerir algo malicioso | Las preguntas pasan por la validación de HTML y longitud, el front las pinta como texto, y al tocarlas son un `mensaje` normal sujeto a todas las reglas. La sección `SEGURIDAD` del SPEC 28 ya ordena no obedecer instrucciones dentro de los datos |
| Cambia el tipo que devuelve `ChatRepository.preguntar` y se rompen pruebas existentes | El paso 5 del plan las ajusta en el mismo commit que el cambio de tipo |

---

## What is **not** in this spec

- Botones para la ambigüedad de nombres.
- Sugerencias de seguimiento después de una respuesta con datos.
- Una columna en `chat_log` para las sugerencias.
- Telemetría de qué sugerencia se tocó.
- Cambios en `GET /chat/sugerencias`.
- El código del frontend.
- Evals contra la API real de Gemini.

Cada una, si llega, va en su propio spec.
