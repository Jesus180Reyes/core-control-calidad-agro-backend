import { BadGatewayException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely } from 'kysely';
import { DatabaseService } from 'src/database/database.service';
import { Database } from 'src/database/types/types';
import { GeminiService, TurnoGemini } from 'src/ia/gemini.service';
import { PreguntarDto } from '../dto/preguntar.dto';
import { ChatRepository } from './chat.repository';

/**
 * Evals del chat (SPEC 28), con las respuestas de Gemini SIMULADAS.
 *
 * Lo que estas pruebas cubren y lo que deliberadamente no, porque confundirlo
 * es peor que no tenerlas: cubren el despachador, los defaults, los topes, la
 * validacion de argumentos y el turno sin herramientas. **No miden si el modelo
 * elige la herramienta correcta**, que era el argumento original para tenerlas;
 * eso exigiria llamar a la API de verdad, que cuesta dinero por corrida y
 * hereda el ~21% de 503 que el SPEC 27 midio. El ajuste del prompt sigue siendo
 * manual.
 */

/** Una llamada a un metodo del doble, para poder afirmar sobre ella despues. */
interface LlamadaRegistrada {
    metodo: string;
    args: unknown[];
}

/**
 * Un doble de Kysely que encadena cualquier metodo y responde por cola.
 *
 * Kysely es un constructor de consultas fluido, asi que el doble solo tiene que
 * devolverse a si mismo hasta que alguien llama a un terminal —`execute`,
 * `executeTakeFirst`, `executeTakeFirstOrThrow`—, y ahi entrega el siguiente
 * valor de la cola. Es fragil ante un cambio de orden de las consultas, y eso es
 * a proposito: el orden de las consultas de un turno es parte de lo que se esta
 * probando.
 */
const crearDb = (cola: unknown[]) => {
    const llamadas: LlamadaRegistrada[] = [];
    const terminales = new Set([
        'execute',
        'executeTakeFirst',
        'executeTakeFirstOrThrow',
    ]);

    const proxy: unknown = new Proxy(
        {},
        {
            get: (_destino, propiedad) => {
                if (typeof propiedad !== 'string') return undefined;

                return (...args: unknown[]) => {
                    llamadas.push({ metodo: propiedad, args });

                    if (terminales.has(propiedad)) {
                        const siguiente = cola.shift();
                        if (siguiente instanceof Error) {
                            return Promise.reject(siguiente);
                        }
                        return Promise.resolve(siguiente);
                    }

                    return proxy;
                };
            },
        },
    );

    return { db: proxy as Kysely<Database>, llamadas };
};

const crearRepositorio = (
    cola: unknown[],
    conversar: jest.Mock,
    limiteDiario?: string,
) => {
    const { db, llamadas } = crearDb(cola);

    const repo = new ChatRepository(
        { client: db } as unknown as DatabaseService,
        { conversar } as unknown as GeminiService,
        {
            get: (clave: string) =>
                clave === 'CHAT_LIMITE_DIARIO' ? limiteDiario : undefined,
        } as unknown as ConfigService,
    );

    return { repo, llamadas };
};

/** Acceso a los privados. TypeScript lo permite por indice y es lo que toca aqui. */
const privado = (repo: ChatRepository) =>
    repo as unknown as Record<string, (...args: unknown[]) => unknown>;

const pregunta = (mensaje: string, extra: Partial<PreguntarDto> = {}) =>
    ({ mensaje, ...extra });

const turnoDeTexto = (texto: string): TurnoGemini => ({
    tipo: 'texto',
    texto,
    partes: [{ text: texto }],
});

const turnoDeHerramienta = (
    nombre: string,
    argumentos: Record<string, unknown> = {},
): TurnoGemini => ({
    tipo: 'herramientas',
    llamadas: [{ nombre, argumentos }],
    partes: [{ functionCall: { name: nombre, args: argumentos } }],
});

/** El contexto del turno: sin turnos gastados hoy, un usuario y un cliente. */
const colaDeArranque = (turnosDeHoy = 0) => [
    { total: turnosDeHoy },
    { id: 7, complete_name: 'Ana Supervisora' },
    [{ id: 3, nombre: 'Agroexport' }],
];

beforeEach(() => {
    // El repositorio registra por Logger en los caminos de fallo, que es
    // justamente lo que varias de estas pruebas provocan.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('ChatRepository / coercion de argumentos', () => {
    const { repo } = crearRepositorio([], jest.fn());
    const p = privado(repo);

    it('topa el limite en 50 aunque el modelo pida 500', () => {
        expect(p.aLimite(500)).toBe(50);
    });

    it('cae en 10 filas cuando no se pide cantidad', () => {
        expect(p.aLimite(undefined)).toBe(10);
    });

    it('acepta una cantidad razonable y descarta las imposibles', () => {
        expect(p.aLimite('7')).toBe(7);
        expect(p.aLimite(-1)).toBe(10);
        expect(p.aLimite(2.5)).toBe(10);
        expect(p.aLimite('siete')).toBe(10);
    });

    it('acepta el id como numero y como cadena, y rechaza el resto', () => {
        expect(p.aEntero(12)).toBe(12);
        expect(p.aEntero('12')).toBe(12);
        expect(p.aEntero(0)).toBeUndefined();
        expect(p.aEntero(-3)).toBeUndefined();
        expect(p.aEntero(1.5)).toBeUndefined();
        expect(p.aEntero('doce')).toBeUndefined();
        expect(p.aEntero(null)).toBeUndefined();
    });

    it('rechaza un dia que no existe aunque tenga la forma correcta', () => {
        expect(p.aFecha('2026-02-28')).toBe('2026-02-28');
        expect(p.aFecha('2026-02-30')).toBeUndefined();
        expect(p.aFecha('28/02/2026')).toBeUndefined();
    });

    it('lee el booleano en las dos formas en que llega', () => {
        expect(p.aBooleano(true)).toBe(true);
        expect(p.aBooleano('false')).toBe(false);
        expect(p.aBooleano('quizas')).toBeUndefined();
        expect(p.aBooleano(1)).toBeUndefined();
    });

    it('no interpreta un estado de lote que no esta en la lista', () => {
        expect(p.aEstadoDeLote('finalizado')).toBe('finalizado');
        // 'cerrado' significa tres cosas distintas en esta base: adivinar cual
        // es exactamente la suposicion silenciosa que el spec prohibe.
        expect(p.aEstadoDeLote('cerrado')).toBeUndefined();
    });

    it('no interpreta un periodo que no esta en la lista', () => {
        expect(p.aPeriodo('esta_semana')).toBe('esta_semana');
        expect(p.aPeriodo('ayer')).toBeUndefined();
    });

    it('traduce el tri-estado de aprobado sin confundir null con rechazado', () => {
        expect(p.revision(null)).toBe('pendiente');
        expect(p.revision(true)).toBe('aprobado');
        expect(p.revision(false)).toBe('rechazado');
    });
});

describe('ChatRepository / ventana temporal', () => {
    const { repo } = crearRepositorio([], jest.fn());
    const p = privado(repo);

    const ventana = (filtros: Record<string, unknown>) =>
        p.ventanaDelPeriodo({ limite: 10, ...filtros }) as {
            desde?: unknown;
            hasta?: unknown;
            descripcion?: string;
        };

    it('sin fecha ni periodo no acota ningun dia', () => {
        expect(ventana({})).toEqual({});
    });

    it('resuelve hoy con las dos fronteras', () => {
        const resultado = ventana({ periodo: 'hoy' });
        expect(resultado.desde).toBeDefined();
        expect(resultado.hasta).toBeDefined();
        expect(resultado.descripcion).toBe('solo los de hoy');
    });

    it('la semana empieza el lunes y el mes el dia 1', () => {
        expect(ventana({ periodo: 'esta_semana' }).descripcion).toBe(
            'desde el lunes de esta semana',
        );
        expect(ventana({ periodo: 'este_mes' }).descripcion).toBe(
            'desde el dia 1 de este mes',
        );
    });

    it('una fecha explicita gana al periodo y lo descarta entero', () => {
        const resultado = ventana({ desde: '2026-09-01', periodo: 'hoy' });
        expect(resultado.descripcion).toBe('desde el 2026-09-01');
        expect(resultado.hasta).toBeUndefined();
    });
});

describe('ChatRepository / despachador', () => {
    const contexto = {
        usuario: { id: 7, nombre: 'Ana Supervisora' },
        clientes: [{ id: 3, nombre: 'Agroexport' }],
    };

    it('no conoce ninguna herramienta de escritura', async () => {
        const { repo, llamadas } = crearRepositorio([], jest.fn());

        const resultado = (await repo.despachar(
            { nombre: 'rechazar_lote', argumentos: { lote_id: 12 } },
            contexto,
        )) as { error: string };

        expect(resultado.error).toContain('rechazar_lote');
        expect(resultado.error).toContain('nunca modificarla');
        // Lo que de verdad importa: no toco la base.
        expect(llamadas).toHaveLength(0);
    });

    it('un id inexistente responde con texto, no revienta', async () => {
        const { repo } = crearRepositorio([undefined], jest.fn());

        const resultado = (await repo.despachar(
            { nombre: 'detalle_de_pesaje', argumentos: { pesaje_id: 999 } },
            contexto,
        )) as { error: string };

        expect(resultado.error).toBe('No existe ningun pesaje con id 999.');
    });

    it('un argumento obligatorio que falta no llega a consultar', async () => {
        const { repo, llamadas } = crearRepositorio([], jest.fn());

        const resultado = (await repo.despachar(
            { nombre: 'detalle_de_pesaje', argumentos: {} },
            contexto,
        )) as { error: string };

        expect(resultado.error).toBe('Falta el id del pesaje.');
        expect(llamadas).toHaveLength(0);
    });

    it('un cliente inexistente responde con texto', async () => {
        const { repo } = crearRepositorio([undefined], jest.fn());

        const resultado = (await repo.despachar(
            { nombre: 'lotes_de_cliente', argumentos: { cliente_id: 4242 } },
            contexto,
        )) as { error: string };

        expect(resultado.error).toBe('No existe ningun cliente con id 4242.');
    });

    it('una cartera vacia no es un error', async () => {
        const { repo } = crearRepositorio([[]], jest.fn());

        const resultado = (await repo.despachar(
            { nombre: 'mis_clientes', argumentos: {} },
            contexto,
        )) as { total: number; aviso: string };

        expect(resultado.total).toBe(0);
        expect(resultado.aviso).toContain('buscar_persona');
    });

    it('encuentra un lote por su nombre, que es la pregunta mas natural del dominio', async () => {
        // Sin esto, "como va el lote X" obligaba al modelo a barrer
        // lotes_de_cliente cliente por cliente y se comia las tres vueltas.
        const { repo } = crearRepositorio(
            [
                [], // usuarios
                [], // clientes
                [
                    {
                        id: 41,
                        nombre_lote: 'BILLS2026',
                        cliente_id: 39,
                        cliente: 'Agroexport',
                        estado: 'abierto',
                        etapa: 'EN PROCESO',
                    },
                ],
                { total: 0 }, // total usuarios
                { total: 0 }, // total clientes
                { total: 1 }, // total lotes
            ],
            jest.fn(),
        );

        const resultado = (await repo.despachar(
            { nombre: 'buscar_persona', argumentos: { texto: 'BILLS2026' } },
            contexto,
        )) as { lotes: { id: number }[]; total_lotes: number };

        expect(resultado.total_lotes).toBe(1);
        expect(resultado.lotes[0].id).toBe(41);
    });

    it('un nombre que no existe en ninguna de las tres tablas lo dice', async () => {
        const { repo } = crearRepositorio(
            [[], [], [], { total: 0 }, { total: 0 }, { total: 0 }],
            jest.fn(),
        );

        const resultado = (await repo.despachar(
            { nombre: 'buscar_persona', argumentos: { texto: 'NO_EXISTE' } },
            contexto,
        )) as { aviso: string };

        expect(resultado.aviso).toContain('NO_EXISTE');
        expect(resultado.aviso).toContain('lote');
    });

    it('un pesaje anulado no devuelve sus pesos, devuelve su motivo', async () => {
        const { repo } = crearRepositorio(
            [{ id: 5, isActive: 0, motivo_rechazo: 'Tara mal puesta' }],
            jest.fn(),
        );

        const resultado = (await repo.despachar(
            { nombre: 'detalle_de_pesaje', argumentos: { pesaje_id: 5 } },
            contexto,
        )) as { anulado: boolean; error: string; peso_neto?: number };

        expect(resultado.anulado).toBe(true);
        expect(resultado.error).toContain('Tara mal puesta');
        expect(resultado.peso_neto).toBeUndefined();
    });
});

describe('ChatRepository / el turno', () => {
    it('devuelve el markdown del modelo cuando el turno converge', async () => {
        const conversar = jest
            .fn()
            .mockResolvedValue(turnoDeTexto('El lote **PICOLO2026** va bien.'));
        const { repo } = crearRepositorio(
            [...colaDeArranque(), undefined],
            conversar,
        );

        const respuesta = await repo.responder(pregunta('como va el lote'), 7);

        expect(respuesta).toBe('El lote **PICOLO2026** va bien.');
    });

    it('registra el turno sin herramientas con herramientas en NULL', async () => {
        const conversar = jest.fn().mockResolvedValue(turnoDeTexto('No puedo.'));
        const { repo, llamadas } = crearRepositorio(
            [...colaDeArranque(), undefined],
            conversar,
        );

        await repo.responder(pregunta('cual es la raiz cuadrada de 20'), 7);

        const values = llamadas.find((l) => l.metodo === 'values');
        expect(values).toBeDefined();
        expect((values?.args[0] as { herramientas: string | null }).herramientas).
            toBeNull();
    });

    it('registra que herramientas se usaron cuando las hubo', async () => {
        const conversar = jest
            .fn()
            .mockResolvedValueOnce(turnoDeHerramienta('mis_clientes'))
            .mockResolvedValueOnce(turnoDeTexto('Tienes un cliente.'));
        const { repo, llamadas } = crearRepositorio(
            [...colaDeArranque(), [{ id: 3, nombre: 'Agroexport' }], undefined],
            conversar,
        );

        await repo.responder(pregunta('cuales son mis clientes'), 7);

        const values = llamadas.find((l) => l.metodo === 'values');
        const guardado = values?.args[0] as { herramientas: string | null };
        expect(guardado.herramientas).toContain('mis_clientes');
    });

    it('reenvia el turno del modelo antes de los resultados de las herramientas', async () => {
        const conversar = jest
            .fn()
            .mockResolvedValueOnce(turnoDeHerramienta('mis_clientes'))
            .mockResolvedValueOnce(turnoDeTexto('Listo.'));
        const { repo } = crearRepositorio(
            [...colaDeArranque(), [], undefined],
            conversar,
        );

        await repo.responder(pregunta('mis clientes'), 7);

        // Sin el turno 'model' por delante, Gemini vuelve a pedir la misma
        // funcion hasta agotar las vueltas. Es el error que mas facil se cuela.
        const contents = (conversar.mock.calls[1] as unknown[])[1] as {
            role: string;
            parts: Record<string, unknown>[];
        }[];

        expect(contents[contents.length - 2].role).toBe('model');
        expect(contents[contents.length - 1].role).toBe('user');
        expect(contents[contents.length - 1].parts[0]).toHaveProperty(
            'functionResponse',
        );
    });

    it('agotadas las vueltas, redacta con lo ya consultado en vez de tirarlo', async () => {
        // El fallo que motivo la vuelta de cierre: las tres vueltas se van en
        // pedir datos —resolver la persona, resolver el cliente, pedir los
        // pesajes— y el turno moria con esos datos dentro de `contents`, ya
        // consultados y ya pagados. La cuarta llamada va sin herramientas.
        const conversar = jest
            .fn()
            .mockResolvedValueOnce(turnoDeHerramienta('mis_clientes'))
            .mockResolvedValueOnce(turnoDeHerramienta('mis_clientes'))
            .mockResolvedValueOnce(turnoDeHerramienta('mis_clientes'))
            .mockResolvedValueOnce(turnoDeTexto('Son 2 clientes.'));
        const { repo } = crearRepositorio(
            [...colaDeArranque(), [], [], [], undefined],
            conversar,
        );

        const respuesta = await repo.responder(pregunta('dame algo'), 7);

        expect(conversar).toHaveBeenCalledTimes(4);
        // Las tres del bucle con herramientas; la de cierre sin ellas.
        expect(conversar.mock.calls[2][2]).toBeFalsy();
        expect(conversar.mock.calls[3][2]).toBe(true);
        expect(respuesta).toBe('Son 2 clientes.');
    });

    it('se rinde si la vuelta de cierre tampoco redacta', async () => {
        const conversar = jest
            .fn()
            .mockResolvedValue(turnoDeHerramienta('mis_clientes'));
        const { repo } = crearRepositorio(
            [...colaDeArranque(), [], [], [], undefined],
            conversar,
        );

        const respuesta = await repo.responder(pregunta('dame algo'), 7);

        expect(conversar).toHaveBeenCalledTimes(4);
        expect(respuesta).toContain('no llegue a una respuesta');
    });

    it('un fallo de Gemini responde con disculpa y nunca lanza', async () => {
        const conversar = jest
            .fn()
            .mockRejectedValue(new BadGatewayException('Gemini no respondio'));
        const { repo } = crearRepositorio(
            [...colaDeArranque(), undefined],
            conversar,
        );

        const respuesta = await repo.responder(pregunta('como va el lote 3'), 7);

        expect(respuesta).toContain('Vuelve a intentarlo');
    });

    it('un fallo al escribir en chat_log no impide responder', async () => {
        const conversar = jest.fn().mockResolvedValue(turnoDeTexto('Todo bien.'));
        const { repo } = crearRepositorio(
            [...colaDeArranque(), new Error('chat_log no existe')],
            conversar,
        );

        const respuesta = await repo.responder(pregunta('hola'), 7);

        expect(respuesta).toBe('Todo bien.');
    });

    it('agotado el limite diario no llama a Gemini', async () => {
        const conversar = jest.fn();
        const { repo } = crearRepositorio(
            [{ total: 20 }],
            conversar,
            undefined, // sin variable: manda el defecto de 20
        );

        const respuesta = await repo.responder(pregunta('otra mas'), 7);

        expect(conversar).not.toHaveBeenCalled();
        expect(respuesta).toContain('limite de 20 consultas por dia');
    });

    it('respeta el limite configurado por variable de entorno', async () => {
        const conversar = jest.fn();
        const { repo } = crearRepositorio([{ total: 3 }], conversar, '3');

        const respuesta = await repo.responder(pregunta('otra mas'), 7);

        expect(conversar).not.toHaveBeenCalled();
        expect(respuesta).toContain('limite de 3 consultas por dia');
    });

    it('un limite de 0 no apaga el tope, cae al defecto', async () => {
        const conversar = jest.fn().mockResolvedValue(turnoDeTexto('Hola.'));
        const { repo } = crearRepositorio(
            [{ total: 5 }, ...colaDeArranque().slice(1), undefined],
            conversar,
            '0',
        );

        const respuesta = await repo.responder(pregunta('hola'), 7);

        // Con 5 turnos gastados y el defecto de 20, el turno pasa.
        expect(respuesta).toBe('Hola.');
    });
});

describe('ChatRepository / sugerencias', () => {
    it('nombra clientes reales de la cartera de quien llama', async () => {
        const { repo } = crearRepositorio(
            [
                [
                    { nombre: 'Agroexport' },
                    { nombre: 'Bananera del Sur' },
                ],
            ],
            jest.fn(),
        );

        const sugerencias = await repo.sugerencias(7);

        expect(sugerencias).toHaveLength(3);
        expect(sugerencias[0]).toContain('Agroexport');
        expect(sugerencias[1]).toContain('Bananera del Sur');
    });

    it('con la cartera vacia devuelve tres ejemplos genericos', async () => {
        const { repo } = crearRepositorio([[]], jest.fn());

        const sugerencias = await repo.sugerencias(7);

        expect(sugerencias).toHaveLength(3);
        expect(sugerencias.join(' ')).not.toContain('undefined');
    });
});
