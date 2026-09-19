import {
    BadGatewayException,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from './gemini.service';
import { ContextoChat } from './prompts/chat.prompt';

/**
 * Evals de `conversar()` con la respuesta de Gemini SIMULADA (SPEC 28).
 *
 * Se simula `fetch`, no el servicio: asi se prueba lo que de verdad puede
 * fallar —como se lee el cuerpo, que se considera una salida valida y en que se
 * convierte un fallo—, que es justo la frontera donde el SPEC 27 se llevo los
 * sustos. Lo que no se prueba aqui, porque haria falta la API real, es si el
 * modelo elige bien la herramienta.
 */

const CONTEXTO: ContextoChat = {
    usuario: { id: 7, nombre: 'Ana Supervisora' },
    clientes: [{ id: 3, nombre: 'Agroexport' }],
};

const CONTENTS = [{ role: 'user' as const, parts: [{ text: 'hola' }] }];

const crearServicio = (valores: Record<string, string> = {}) =>
    new GeminiService({
        get: (clave: string) => valores[clave],
    } as unknown as ConfigService);

/** Una respuesta 200 de la API con el cuerpo que se le pase. */
const respuestaOk = (cuerpo: unknown) =>
    ({
        ok: true,
        status: 200,
        json: () => Promise.resolve(cuerpo),
        text: () => Promise.resolve(JSON.stringify(cuerpo)),
    }) as unknown as Response;

const respuestaError = (status: number) =>
    ({
        ok: false,
        status,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('UNAVAILABLE: high demand'),
    }) as unknown as Response;

const conClave = { GEMINI_API_KEY: 'clave-de-prueba' };

let fetchSimulado: jest.Mock;

beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    fetchSimulado = jest.fn();
    global.fetch = fetchSimulado;
});

afterEach(() => jest.restoreAllMocks());

describe('GeminiService.conversar / configuracion', () => {
    it('sin GEMINI_API_KEY no llama a nadie y avisa de que no esta configurado', async () => {
        const servicio = crearServicio();

        await expect(servicio.conversar(CONTEXTO, CONTENTS)).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
        expect(fetchSimulado).not.toHaveBeenCalled();
    });

    it('usa GEMINI_CHAT_MODEL y no el modelo de los resumenes', async () => {
        const servicio = crearServicio({
            ...conClave,
            GEMINI_MODEL: 'modelo-de-resumenes',
            GEMINI_CHAT_MODEL: 'modelo-de-chat',
        });
        fetchSimulado.mockResolvedValue(
            respuestaOk({ candidates: [{ content: { parts: [{ text: 'Hola.' }] } }] }),
        );

        await servicio.conversar(CONTEXTO, CONTENTS);

        const url = (fetchSimulado.mock.calls[0] as string[])[0];
        expect(url).toContain('modelo-de-chat');
        expect(url).not.toContain('modelo-de-resumenes');
    });

    it('la clave viaja en cabecera y nunca en la URL', async () => {
        const servicio = crearServicio(conClave);
        fetchSimulado.mockResolvedValue(
            respuestaOk({ candidates: [{ content: { parts: [{ text: 'Hola.' }] } }] }),
        );

        await servicio.conversar(CONTEXTO, CONTENTS);

        const [url, opciones] = fetchSimulado.mock.calls[0] as [
            string,
            { headers: Record<string, string> },
        ];
        // Si acabara en la URL, terminaria en cualquier log de acceso o en el
        // texto de un error que arrastre la direccion.
        expect(url).not.toContain('clave-de-prueba');
        expect(opciones.headers['x-goog-api-key']).toBe('clave-de-prueba');
    });
});

describe('GeminiService.conversar / que devuelve', () => {
    it('reconoce una llamada a funcion con sus argumentos', async () => {
        const servicio = crearServicio(conClave);
        fetchSimulado.mockResolvedValue(
            respuestaOk({
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    functionCall: {
                                        name: 'metricas_de_lote',
                                        args: { lote_id: 12 },
                                    },
                                },
                            ],
                        },
                    },
                ],
            }),
        );

        const turno = await servicio.conversar(CONTEXTO, CONTENTS);

        expect(turno.tipo).toBe('herramientas');
        if (turno.tipo !== 'herramientas') return;
        expect(turno.llamadas).toEqual([
            { nombre: 'metricas_de_lote', argumentos: { lote_id: 12 } },
        ]);
        // Las partes vuelven tal cual para que el bucle pueda reenviarlas.
        expect(turno.partes).toHaveLength(1);
    });

    it('un texto de relleno junto a la llamada no se toma por respuesta', async () => {
        const servicio = crearServicio(conClave);
        fetchSimulado.mockResolvedValue(
            respuestaOk({
                candidates: [
                    {
                        content: {
                            parts: [
                                { text: 'Dejame revisarlo...' },
                                { functionCall: { name: 'mis_clientes', args: {} } },
                            ],
                        },
                    },
                ],
            }),
        );

        const turno = await servicio.conversar(CONTEXTO, CONTENTS);

        expect(turno.tipo).toBe('herramientas');
    });

    it('normaliza el markdown sin aplastar los saltos de linea', async () => {
        const servicio = crearServicio(conClave);
        fetchSimulado.mockResolvedValue(
            respuestaOk({
                candidates: [
                    {
                        content: {
                            parts: [{ text: '  Resumen\r\n\r\n\r\n\r\n- Una fila  ' }],
                        },
                    },
                ],
            }),
        );

        const turno = await servicio.conversar(CONTEXTO, CONTENTS);

        expect(turno.tipo).toBe('texto');
        if (turno.tipo !== 'texto') return;
        // Los '\n' SON la estructura del markdown: se recortan los sobrantes,
        // nunca se convierten en espacios.
        expect(turno.texto).toBe('Resumen\n\n- Una fila');
    });
});

describe('GeminiService.conversar / que rechaza', () => {
    const esperarBadGateway = async (cuerpo: unknown) => {
        const servicio = crearServicio(conClave);
        fetchSimulado.mockResolvedValue(respuestaOk(cuerpo));

        await expect(servicio.conversar(CONTEXTO, CONTENTS)).rejects.toBeInstanceOf(
            BadGatewayException,
        );
    };

    it('un 503 de Google', async () => {
        const servicio = crearServicio(conClave);
        fetchSimulado.mockResolvedValue(respuestaError(503));

        await expect(servicio.conversar(CONTEXTO, CONTENTS)).rejects.toBeInstanceOf(
            BadGatewayException,
        );
    });

    it('un fallo de red', async () => {
        const servicio = crearServicio(conClave);
        fetchSimulado.mockRejectedValue(new Error('ECONNRESET'));

        await expect(servicio.conversar(CONTEXTO, CONTENTS)).rejects.toBeInstanceOf(
            BadGatewayException,
        );
    });

    it('una respuesta vacia', async () => {
        await esperarBadGateway({ candidates: [{ content: { parts: [] } }] });
    });

    it('una etiqueta HTML dentro del markdown', async () => {
        await esperarBadGateway({
            candidates: [
                { content: { parts: [{ text: 'Resumen <script>alert(1)</script>' }] } },
            ],
        });
    });

    it('un texto cortado por maxOutputTokens', async () => {
        await esperarBadGateway({
            candidates: [
                {
                    content: { parts: [{ text: '| Lote | Peso |\n| PICO' }] },
                    finishReason: 'MAX_TOKENS',
                },
            ],
        });
    });

    it('pero un MAX_TOKENS junto a una llamada a funcion no es un fallo', async () => {
        const servicio = crearServicio(conClave);
        fetchSimulado.mockResolvedValue(
            respuestaOk({
                candidates: [
                    {
                        content: {
                            parts: [{ functionCall: { name: 'mis_clientes', args: {} } }],
                        },
                        finishReason: 'MAX_TOKENS',
                    },
                ],
            }),
        );

        const turno = await servicio.conversar(CONTEXTO, CONTENTS);

        // El corte afectaria al texto, y aqui no hay texto que entregar: hay una
        // funcion que ejecutar y otra vuelta por delante.
        expect(turno.tipo).toBe('herramientas');
    });

    it('un menor que suelto NO se confunde con HTML', async () => {
        const servicio = crearServicio(conClave);
        fetchSimulado.mockResolvedValue(
            respuestaOk({
                candidates: [
                    { content: { parts: [{ text: 'El promedio quedo < 20.00 lb.' }] } },
                ],
            }),
        );

        const turno = await servicio.conversar(CONTEXTO, CONTENTS);

        expect(turno.tipo).toBe('texto');
    });
});
