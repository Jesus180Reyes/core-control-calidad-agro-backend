import {
    BadGatewayException,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    construirPeticionResumen,
    ResumenLotePayload,
} from './prompts/resumen-lote.prompt';
import {
    ContenidoGemini,
    ContextoChat,
    construirPeticionChat,
    ParteGemini,
} from './prompts/chat.prompt';

/** Solo la parte de la respuesta de Gemini que consumimos. */
interface RespuestaGemini {
    candidates?: {
        content?: {
            parts?: {
                text?: string;
                functionCall?: { name?: string; args?: Record<string, unknown> };
            }[];
        };
        finishReason?: string;
    }[];
}

/** Una funcion que el modelo pide ejecutar. Nada aqui esta validado todavia. */
export interface LlamadaHerramienta {
    nombre: string;
    argumentos: Record<string, unknown>;
}

/**
 * Lo que devuelve una vuelta de `conversar()`.
 *
 * `partes` es el turno del modelo tal cual vino, y quien llama tiene que
 * reenviarlo como `{ role: 'model', parts }` antes de mandar los resultados de
 * las herramientas: el protocolo exige que la peticion de la funcion siga en la
 * conversacion cuando llega su respuesta. Sin eso, Gemini vuelve a pedir la
 * misma funcion en bucle hasta agotar las tres vueltas.
 */
export type TurnoGemini =
    | { tipo: 'texto'; texto: string; partes: ParteGemini[] }
    | {
        tipo: 'herramientas';
        llamadas: LlamadaHerramienta[];
        partes: ParteGemini[];
    };

/**
 * Cliente de la API REST de Gemini (SPEC 27).
 *
 * NO inyecta `DatabaseService`, asi que es un singleton normal y no se contagia
 * del `Scope.REQUEST` del proyecto. Si algun dia necesita la base, hay que
 * resolverlo sin inyectar ese servicio.
 *
 * Usa `fetch` nativo a proposito: es un POST de JSON a un endpoint REST, y el
 * repo ya evita capas —no hay ORM, no hay cliente HTTP y no usa `rxjs`—.
 */
@Injectable()
export class GeminiService {
    private readonly logger = new Logger(GeminiService.name);

    private static readonly MODELO_POR_DEFECTO = 'gemini-3.1-flash-lite';
    /**
     * El chat usa su propio modelo, `GEMINI_CHAT_MODEL`, y no el del resumen:
     * alli el modelo solo redacta sobre cifras dadas y el mas barato basta, aqui
     * ELIGE la herramienta, que es la decision de la que depende todo el turno.
     * Reusar `GEMINI_MODEL` acoplaria las dos cosas para siempre.
     *
     * **Es una version fija y no el alias `gemini-flash-latest`**, que tambien
     * existe. Un alias cambia de modelo por debajo sin avisar, y como el SPEC 28
     * decidio no guardar `modelo` en `chat_log`, una regresion de calidad no se
     * podria atribuir a nada. Con la version escrita, al menos el cambio es un
     * commit.
     *
     * Ojo al elegirlo: `gemini-3.1-flash` NO existe —solo su variante lite— y la
     * API responde 404, que `generateContent` convierte en 502 y el chat en su
     * texto de disculpa. Comprobar contra `GET /v1beta/models` antes de cambiarlo.
     */
    private static readonly MODELO_CHAT_POR_DEFECTO = 'gemini-3.8-flash';
    /**
     * 45 s y no los 20 s de la version aprobada del SPEC 27. El paso 6 del plan
     * midio la latencia real: las llamadas que funcionan van de 1,0 a 18,2 s, y
     * con el tope en 20 s se tiraba una respuesta buena que tardo 18,2 s —en la
     * primera tanda fallaron 4 de 6 llamadas por timeout—.
     */
    private static readonly TIMEOUT_POR_DEFECTO_MS = 45000;

    /** Tope duro de la salida. No se trunca: se rechaza y se vuelve a pedir. */
    private static readonly MAX_CARACTERES = 2000;

    /**
     * El chat admite mas que el resumen porque aqui si caben tablas: veinte
     * filas de pesajes con sus columnas se comen los 2000 del SPEC 27 sin haber
     * hecho nada raro. Sigue siendo un tope duro y sigue sin truncar.
     */
    private static readonly MAX_CARACTERES_CHAT = 4000;

    /**
     * Exige una letra, un '!' o un '/' detras del '<', de modo que un '<' suelto
     * —"promedio < 20.00 lb"— pasa sin problema y una etiqueta no.
     */
    private static readonly ETIQUETA_HTML = /<[a-z!/]/i;

    private static readonly MSG_SIN_CONFIGURAR =
        'La integracion con Gemini no esta configurada';
    private static readonly MSG_NO_RESPONDIO =
        'No se pudo generar el resumen: el servicio de IA no respondio correctamente';
    private static readonly MSG_NO_VALIDA =
        'No se pudo generar el resumen: la respuesta del servicio de IA no es valida';
    /**
     * Mensajes propios del chat. Ninguno llega nunca al supervisor: el SPEC 28
     * exige responder 200 con un texto de disculpa pase lo que pase, asi que
     * `ChatRepository` atrapa estas excepciones y las sustituye. Existen para
     * que el log diga que fallo y para no reciclar un texto que habla de
     * "generar el resumen" cuando no hay ningun resumen de por medio.
     */
    private static readonly MSG_CHAT_NO_VALIDO =
        'La respuesta del servicio de IA no es valida';
    private static readonly MSG_CHAT_NO_RESPONDIO =
        'El servicio de IA no respondio correctamente';

    constructor(private readonly config: ConfigService) { }

    /**
     * Manda las metricas ya calculadas y devuelve el markdown validado.
     *
     * Quien llama debe hacerlo FUERA de cualquier transaccion: el
     * `DatabaseMiddleware` abre un pool de UNA conexion por peticion, y
     * retenerla durante toda la llamada a Google es la regla que el SPEC 27 no
     * puede romper.
     *
     * @throws ServiceUnavailableException 503 si falta `GEMINI_API_KEY`.
     * @throws BadGatewayException 502 si Gemini falla o devuelve algo invalido.
     */
    async generarResumenDeLote(payload: ResumenLotePayload): Promise<string> {
        const apiKey = (this.config.get<string>('GEMINI_API_KEY') ?? '').trim();
        if (!apiKey) {
            this.logger.error(
                'GEMINI_API_KEY ausente o vacia: la generacion de resumenes esta apagada',
            );
            throw new ServiceUnavailableException(GeminiService.MSG_SIN_CONFIGURAR);
        }

        const modelo =
            (this.config.get<string>('GEMINI_MODEL') ?? '').trim() ||
            GeminiService.MODELO_POR_DEFECTO;

        const cuerpo = await this.generateContent<RespuestaGemini>(
            modelo,
            apiKey,
            construirPeticionResumen(payload),
        );

        const candidato = cuerpo?.candidates?.[0];

        // Septima regla, fuera de las seis del SPEC 27: si el modelo agoto
        // maxOutputTokens, el markdown viene cortado a media vineta. Pasaria
        // las otras seis —no esta vacio, no excede 2000 y no trae HTML— y se
        // guardaria truncado como registro permanente, que es justo lo que el
        // spec dice querer evitar cuando rechaza truncar por longitud.
        if (candidato?.finishReason === 'MAX_TOKENS') {
            this.logger.error(
                'Gemini corto la respuesta por maxOutputTokens; el markdown vendria truncado',
            );
            throw new BadGatewayException(GeminiService.MSG_NO_VALIDA);
        }

        const partes = candidato?.content?.parts ?? [];
        const crudo = partes.map((parte) => parte?.text ?? '').join('');

        return this.validarSalida(crudo);
    }

    /**
     * Una vuelta del chat (SPEC 28): manda la conversacion y devuelve lo que el
     * modelo decidio, que es una de dos cosas y nunca las dos a medias.
     *
     * - `tipo: 'herramientas'` — pidio ejecutar una o varias funciones. El
     *   despachador valida los argumentos contra el contexto del servidor y
     *   vuelve a llamar aqui con los resultados. Que el modelo lo haya pedido no
     *   lo hace legitimo.
     * - `tipo: 'texto'` — la respuesta final, ya en markdown.
     *
     * `sinHerramientas` es la vuelta de cierre del bucle: el modelo queda
     * impedido de pedir nada mas y tiene que redactar con lo que ya hay en
     * `contents`. Quien llama la usa cuando se le acabo el presupuesto de
     * vueltas y la ultima siguio pidiendo datos, para no tirar unas consultas
     * que ya se hicieron y ya se pagaron. Devuelve `tipo: 'texto'` en la
     * practica siempre, pero el contrato no cambia y quien llama sigue teniendo
     * que contemplar el otro caso.
     *
     * Quien llama debe hacerlo FUERA de cualquier transaccion, por la misma
     * razon que el resumen: el `DatabaseMiddleware` abre un pool de UNA conexion
     * por peticion y retenerla durante la latencia de Google la deja bloqueada.
     *
     * Lanza igual que `generarResumenDeLote`, y eso es deliberado: aqui no se
     * traduce nada. El SPEC 28 quiere 200 con texto de disculpa ante cualquier
     * fallo, pero eso es decision del repositorio del chat, que es quien sabe
     * que al otro lado hay un supervisor mirando una pantalla y no un
     * desarrollador leyendo un codigo de estado.
     *
     * @throws ServiceUnavailableException 503 si falta `GEMINI_API_KEY`.
     * @throws BadGatewayException 502 si Gemini falla o devuelve algo invalido.
     */
    async conversar(
        contexto: ContextoChat,
        contents: ContenidoGemini[],
        sinHerramientas = false,
    ): Promise<TurnoGemini> {
        const apiKey = (this.config.get<string>('GEMINI_API_KEY') ?? '').trim();
        if (!apiKey) {
            this.logger.error(
                'GEMINI_API_KEY ausente o vacia: el chat de consultas esta apagado',
            );
            throw new ServiceUnavailableException(GeminiService.MSG_SIN_CONFIGURAR);
        }

        const modelo =
            (this.config.get<string>('GEMINI_CHAT_MODEL') ?? '').trim() ||
            GeminiService.MODELO_CHAT_POR_DEFECTO;

        const cuerpo = await this.generateContent<RespuestaGemini>(
            modelo,
            apiKey,
            construirPeticionChat(contexto, contents, sinHerramientas),
            GeminiService.MSG_CHAT_NO_RESPONDIO,
        );

        const candidato = cuerpo?.candidates?.[0];
        const partes = (candidato?.content?.parts ?? []) as ParteGemini[];

        // El orden importa: las llamadas a funcion se miran ANTES que
        // finishReason y antes que el texto. Un turno que pide herramientas
        // puede traer ademas un texto de relleno —"déjame revisarlo"— que no es
        // la respuesta final y que no debe salir a pantalla.
        const llamadas: LlamadaHerramienta[] = (candidato?.content?.parts ?? [])
            .flatMap((parte) => (parte?.functionCall ? [parte.functionCall] : []))
            .filter((llamada) => !!llamada.name)
            .map((llamada) => ({
                nombre: String(llamada.name),
                argumentos: llamada.args ?? {},
            }));

        if (llamadas.length > 0) {
            return { tipo: 'herramientas', llamadas, partes };
        }

        // Sin llamadas, el turno es la respuesta final, asi que un corte por
        // maxOutputTokens la deja partida a media tabla. El mismo argumento del
        // SPEC 27: no se trunca lo que ya venia truncado, se descarta.
        if (candidato?.finishReason === 'MAX_TOKENS') {
            this.logger.error(
                'Gemini corto la respuesta del chat por maxOutputTokens; el markdown vendria truncado',
            );
            throw new BadGatewayException(GeminiService.MSG_CHAT_NO_VALIDO);
        }

        const crudo = (candidato?.content?.parts ?? [])
            .map((parte) => parte?.text ?? '')
            .join('');

        return { tipo: 'texto', texto: this.validarSalidaChat(crudo), partes };
    }

    /**
     * El POST a `:generateContent` y nada mas: timeout, red, estado y parseo.
     *
     * Extraido en el SPEC 28 sin cambiar una sola condicion, porque lo comparten
     * el resumen y el chat. Lo que NO hace es interpretar la respuesta: quien
     * llama decide que es una salida valida, que hacer con `finishReason` y si
     * lo que viene es texto o una llamada a funcion.
     *
     * Siempre falla con 502. El chat del SPEC 28 no quiere ese codigo —un
     * supervisor lee un 502 como que la aplicacion esta caida—, asi que lo
     * atrapa arriba y responde 200 con un texto de disculpa. La traduccion es de
     * quien llama, no de aqui.
     *
     * `mensajeDeFallo` existe porque el texto del 502 del resumen es parte de su
     * respuesta publica y no se puede tocar, pero decir "no se pudo generar el
     * resumen" en el log de un turno de chat manda a buscar un resumen que no
     * existe. Lo vimos la primera vez que el chat fallo de verdad.
     *
     * @throws BadGatewayException 502 si Gemini no responde, responde != 2xx o
     * responde algo que no es JSON.
     */
    private async generateContent<T>(
        modelo: string,
        apiKey: string,
        cuerpoPeticion: unknown,
        mensajeDeFallo: string = GeminiService.MSG_NO_RESPONDIO,
    ): Promise<T> {
        const timeoutMs = this.resolverTimeout();

        // La clave viaja en cabecera y no como ?key= para que no acabe en logs
        // de acceso, historiales de proxy ni en el texto de un error con la URL.
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;

        const controlador = new AbortController();
        const temporizador = setTimeout(() => controlador.abort(), timeoutMs);

        let respuesta: Response;
        try {
            respuesta = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey,
                },
                body: JSON.stringify(cuerpoPeticion),
                signal: controlador.signal,
            });
        } catch (error) {
            const abortada = controlador.signal.aborted;
            this.logger.error(
                abortada
                    ? `Gemini no respondio en ${timeoutMs} ms (modelo ${modelo})`
                    : `Error de red llamando a Gemini (modelo ${modelo}): ${(error as Error)?.message}`,
            );
            throw new BadGatewayException(mensajeDeFallo);
        } finally {
            clearTimeout(temporizador);
        }

        if (!respuesta.ok) {
            const detalle = await respuesta.text().catch(() => '');
            this.logger.error(
                `Gemini respondio ${respuesta.status} (modelo ${modelo}): ${detalle.slice(0, 500)}`,
            );
            throw new BadGatewayException(mensajeDeFallo);
        }

        try {
            return (await respuesta.json()) as T;
        } catch {
            this.logger.error('Gemini respondio 200 con un cuerpo que no es JSON');
            throw new BadGatewayException(mensajeDeFallo);
        }
    }

    /**
     * `GEMINI_TIMEOUT_MS` es opcional. Un valor no numerico, cero o negativo cae
     * al defecto; un 1 es valido y aborta casi al instante, que es justo lo que
     * el plan del spec usa para provocar el 502 de timeout.
     */
    private resolverTimeout(): number {
        const crudo = this.config.get<string>('GEMINI_TIMEOUT_MS');
        const valor = Number(crudo);
        return Number.isFinite(valor) && valor > 0
            ? valor
            : GeminiService.TIMEOUT_POR_DEFECTO_MS;
    }

    /**
     * Las seis reglas del SPEC 27, en este orden.
     *
     * NINGUNA colapsa los saltos de linea a un espacio. La version en texto
     * plano de este spec lo hacia y era correcto para un parrafo; aqui seria
     * destructivo, porque los '\n' SON la estructura del markdown. Lo que queda
     * es normalizacion: unificar finales de linea y recortar el exceso de
     * lineas en blanco.
     *
     * Tampoco se valida la ESTRUCTURA —cuantas vinetas hay, si falta el parrafo
     * de apertura, si hay un '#'—: son instrucciones de estilo y comprobarlas
     * exigiria un parser de markdown en el backend para un dato que solo se
     * muestra. Y no se valida un minimo de longitud: un resumen correcto de 800
     * caracteres se guarda.
     */
    private validarSalida(texto: string): string {
        const limpio = texto
            .trim() // 1
            .replace(/\r\n?/g, '\n') // 2
            .replace(/\n{3,}/g, '\n\n'); // 3

        if (!limpio) {
            this.logger.error('Gemini devolvio una respuesta vacia');
            throw new BadGatewayException(GeminiService.MSG_NO_VALIDA); // 4
        }

        if (limpio.length > GeminiService.MAX_CARACTERES) {
            this.logger.error(
                `Gemini devolvio ${limpio.length} caracteres, por encima del maximo de ${GeminiService.MAX_CARACTERES}`,
            );
            throw new BadGatewayException(GeminiService.MSG_NO_VALIDA); // 5
        }

        if (GeminiService.ETIQUETA_HTML.test(limpio)) {
            // Segunda de las tres barreras contra la inyeccion de prompt por
            // nombre_lote, variedad_o_talla o el nombre del cliente. Se rechaza
            // entero: una salida que desobedecio no es una salida a la que
            // haya que quitarle un trozo, es una que hay que volver a pedir.
            this.logger.error(
                'Gemini devolvio una etiqueta HTML dentro del resumen; se descarta la respuesta',
            );
            throw new BadGatewayException(GeminiService.MSG_NO_VALIDA); // 6
        }

        return limpio;
    }

    /**
     * Las mismas reglas del resumen sobre el markdown del chat, con dos
     * diferencias y ninguna es de estilo.
     *
     * La primera es el tope, 4000 en vez de 2000, porque aqui el formato admite
     * tablas. La segunda es a donde va a parar el rechazo: el resumen se guarda
     * como registro permanente de un lote y por eso vuelve un 502 que alguien
     * tiene que mirar; esto se pinta en una pantalla de chat, asi que el
     * repositorio atrapa la excepcion y responde 200 invitando a repetir.
     *
     * El rechazo de etiquetas HTML se mantiene tal cual, y aqui pesa mas que
     * alli: el chat recibe nombres de lote, de cliente y de persona en cada
     * consulta, que es el vector de inyeccion que el SPEC 27 ya documento.
     */
    private validarSalidaChat(texto: string): string {
        const limpio = texto
            .trim()
            .replace(/\r\n?/g, '\n')
            .replace(/\n{3,}/g, '\n\n');

        if (!limpio) {
            this.logger.error('Gemini devolvio un turno de chat vacio');
            throw new BadGatewayException(GeminiService.MSG_CHAT_NO_VALIDO);
        }

        if (limpio.length > GeminiService.MAX_CARACTERES_CHAT) {
            this.logger.error(
                `Gemini devolvio ${limpio.length} caracteres en el chat, por encima del maximo de ${GeminiService.MAX_CARACTERES_CHAT}`,
            );
            throw new BadGatewayException(GeminiService.MSG_CHAT_NO_VALIDO);
        }

        if (GeminiService.ETIQUETA_HTML.test(limpio)) {
            this.logger.error(
                'Gemini devolvio una etiqueta HTML dentro del chat; se descarta la respuesta',
            );
            throw new BadGatewayException(GeminiService.MSG_CHAT_NO_VALIDO);
        }

        return limpio;
    }
}
