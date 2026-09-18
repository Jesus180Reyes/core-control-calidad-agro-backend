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

/** Solo la parte de la respuesta de Gemini que consumimos. */
interface RespuestaGemini {
    candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
    }[];
}

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
    private static readonly TIMEOUT_POR_DEFECTO_MS = 20000;

    /** Tope duro de la salida. No se trunca: se rechaza y se vuelve a pedir. */
    private static readonly MAX_CARACTERES = 2000;

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
                body: JSON.stringify(construirPeticionResumen(payload)),
                signal: controlador.signal,
            });
        } catch (error) {
            const abortada = controlador.signal.aborted;
            this.logger.error(
                abortada
                    ? `Gemini no respondio en ${timeoutMs} ms (modelo ${modelo})`
                    : `Error de red llamando a Gemini (modelo ${modelo}): ${(error as Error)?.message}`,
            );
            throw new BadGatewayException(GeminiService.MSG_NO_RESPONDIO);
        } finally {
            clearTimeout(temporizador);
        }

        if (!respuesta.ok) {
            const detalle = await respuesta.text().catch(() => '');
            this.logger.error(
                `Gemini respondio ${respuesta.status} (modelo ${modelo}): ${detalle.slice(0, 500)}`,
            );
            throw new BadGatewayException(GeminiService.MSG_NO_RESPONDIO);
        }

        let cuerpo: RespuestaGemini;
        try {
            cuerpo = (await respuesta.json()) as RespuestaGemini;
        } catch {
            this.logger.error('Gemini respondio 200 con un cuerpo que no es JSON');
            throw new BadGatewayException(GeminiService.MSG_NO_RESPONDIO);
        }

        const partes = cuerpo?.candidates?.[0]?.content?.parts ?? [];
        const crudo = partes.map((parte) => parte?.text ?? '').join('');

        return this.validarSalida(crudo);
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
}
