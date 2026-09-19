import { Injectable, Logger } from '@nestjs/common';
import { RawBuilder, SelectQueryBuilder, sql } from 'kysely';
import { DatabaseService } from 'src/database/database.service';
import { GeminiService, LlamadaHerramienta } from 'src/ia/gemini.service';
import {
    ContenidoGemini,
    ContextoChat,
    construirContents,
} from 'src/ia/prompts/chat.prompt';
import { PreguntarDto } from '../dto/preguntar.dto';

/**
 * Lo que una herramienta le devuelve al modelo. Es JSON plano: no hay tipo
 * comun porque cada herramienta responde una forma distinta, y forzarlas a una
 * envoltura unica solo anadiria ruido al contexto que viaja a Google.
 *
 * Una herramienta NUNCA lanza. Un id que no existe, un argumento que no vale o
 * una busqueda sin resultados devuelven `{ error }` o `{ aviso }` y el modelo
 * lo explica en su respuesta. Lanzar aqui seria un 500 en una pantalla de chat.
 */
type ResultadoHerramienta = Record<string, unknown>;

/**
 * Los tres estados de lote que el chat distingue, que no son los de la columna
 * `estado`.
 *
 * `estado = 'cerrado'` significa tres cosas distintas —rechazado, aprobado a la
 * espera del aprobador, o finalizado— y la columna sola no las separa, asi que
 * el vocabulario del chat es por etapa y no por columna. Es el mismo problema
 * que la tabla de discriminadores de CLAUDE.md describe.
 */
type EstadoDeLote = 'abierto' | 'finalizado' | 'pendiente_aprobacion';

/**
 * La ventana relativa que el modelo puede pedir. Se resuelve SIEMPRE en MySQL
 * con `CURDATE()`, nunca en Node y menos en el modelo: el reloj que cuenta es
 * el mismo con el que `NOW()` escribio los `created_at`.
 */
type Periodo = 'hoy' | 'esta_semana' | 'este_mes';

/**
 * Los filtros que comparten las dos herramientas de pesajes. Cada una usa los
 * suyos —`usuario_id` solo tiene sentido en la de un lote, `cliente_id` solo en
 * la de una persona— pero la coercion es la misma, asi que el tipo es uno.
 *
 * `limite` no es opcional: si el modelo no lo manda, el coercionador ya puso el
 * default de 10. Que sea obligatorio aqui evita que una herramienta nueva se
 * olvide de aplicarlo y devuelva la tabla entera.
 */
interface FiltrosDePesajes {
    lote_id?: number;
    cliente_id?: number;
    usuario_id?: number;
    estado_calidad_id?: number;
    fuera_de_rango?: boolean;
    nombre?: string;
    desde?: string;
    hasta?: string;
    periodo?: Periodo;
    limite: number;
}

/** Las dos fronteras de una ventana temporal, ya como SQL. */
interface Ventana {
    desde?: RawBuilder<Date>;
    hasta?: RawBuilder<Date>;
    descripcion?: string;
}

/**
 * El chat de consultas (SPEC 28).
 *
 * Como el resto del proyecto, la logica vive aqui y no en el servicio. Tres
 * cosas propias de este repositorio que conviene saber antes de tocarlo:
 *
 * - **Nada ocurre dentro de una transaccion.** El `DatabaseMiddleware` abre un
 *   pool de UNA conexion por peticion, y retenerla durante la latencia de
 *   Google es justo lo que el SPEC 27 prohibio.
 * - **Las consultas son propias y duplican a proposito** las de
 *   `LotesRepository` y `PesajesRepository`. Inyectar esos repositorios
 *   obligaria a exportarlos y acoplaria los modulos; el costo aceptado es que
 *   si alguien corrige un redondeo en un sitio, el otro se queda atras en
 *   silencio.
 * - **Ninguna herramienta escribe.** El despachador no conoce una sola funcion
 *   de escritura, asi que aunque el modelo alucine un `rechazar_lote` no hay
 *   nada detras que despachar. Es la segunda barrera; la primera esta en el
 *   prompt. Con doce escrituras abiertas a cualquier autenticado en este
 *   proyecto, la segunda no es paranoia.
 */
@Injectable()
export class ChatRepository {
    private readonly logger = new Logger(ChatRepository.name);

    /** Cuantas filas devuelve una consulta que no pidio cantidad. */
    private static readonly LIMITE_POR_DEFECTO = 10;
    /** Tope duro. El modelo puede pedir 500; se le dan 50. */
    private static readonly LIMITE_MAXIMO = 50;
    /**
     * Cuantas filas ve el modelo como maximo, pida lo que pida. Va aparte del
     * tope anterior porque son dos cosas distintas: aquel acota la consulta,
     * este acota el contexto que viaja a Google en cada vuelta. Cuando se
     * recorta, el resultado lleva siempre el total, para que la respuesta pueda
     * decir "20 de 137" y no dar a entender que 20 son todos.
     */
    private static readonly MAX_FILAS_MODELO = 20;
    /** Coincidencias que devuelve `buscar_persona` antes de pedir afinar. */
    private static readonly MAX_COINCIDENCIAS = 10;

    /**
     * Vueltas del bucle, es decir llamadas a Gemini por turno.
     *
     * Tres alcanzan para la cadena mas larga que el chat necesita —resolver un
     * nombre, consultar con el id, redactar— y son a la vez el tope de gasto de
     * un turno. Un modelo que se atasca pidiendo la misma funcion una y otra vez
     * se para aqui, no cuando se acaba la paciencia de quien pregunta.
     */
    private static readonly MAX_VUELTAS = 3;

    /**
     * Los dos textos con los que el turno se rinde. Son markdown valido porque
     * es lo que el frontend renderiza, y son 200 y no un 5xx por decision del
     * SPEC 28: al otro lado hay un supervisor en una pantalla de chat, y un
     * codigo de error ahi se lee como que la aplicacion esta caida.
     *
     * Estan separados porque invitan a cosas distintas: uno a repetir tal cual,
     * el otro a preguntar de otra forma.
     */
    private static readonly TEXTO_DISCULPA =
        'No pude resolver la consulta en este momento. Vuelve a intentarlo en unos segundos.';
    private static readonly TEXTO_NO_CONVERGE =
        'Me enrede consultando los datos y no llegue a una respuesta. Prueba a preguntarlo de otra forma, nombrando el lote, el cliente o la persona.';

    constructor(
        private readonly dbService: DatabaseService,
        private readonly gemini: GeminiService,
    ) { }

    get db() {
        return this.dbService.client;
    }

    /**
     * Un turno de conversacion.
     *
     * El orden es el del SPEC 28 y cada paso esta donde esta por una razon:
     *
     * 1. El contexto se resuelve por SQL, sin IA. Es lo que el despachador usa
     *    despues para no creerse lo que proponga el modelo.
     * 2. El bucle, con tope de tres vueltas. Cada vuelta es una llamada a
     *    Gemini que o pide herramientas o entrega el texto final.
     * 3. Ese texto es la respuesta.
     *
     * **Nada de esto ocurre dentro de una transaccion.** El `DatabaseMiddleware`
     * abre un pool de UNA conexion por peticion y retenerla durante la latencia
     * de Google es la regla que el SPEC 27 fijo. Aqui pesa mas que alli: un
     * turno puede llamar tres veces.
     *
     * **Siempre devuelve un string y nunca lanza.** Un 503 por falta de clave,
     * un 502 por timeout, un modelo que no converge o una consulta que revienta
     * acaban en un texto de disculpa. El unico codigo que este endpoint sabe
     * devolver es 200.
     *
     * TODO(SPEC 28, paso 12): tope diario y registro en `chat_log`.
     */
    async responder(dto: PreguntarDto, usuarioId: number): Promise<string> {
        // 1. El contexto, por SQL y sin IA.
        const contexto = await this.contextoDe(usuarioId);

        const contents = construirContents(dto.mensaje, dto.historial);
        const usadas: LlamadaHerramienta[] = [];

        // 2. El bucle. Se sale por el texto; agotar las vueltas es rendirse.
        let respuesta = ChatRepository.TEXTO_NO_CONVERGE;

        try {
            for (let vuelta = 1; vuelta <= ChatRepository.MAX_VUELTAS; vuelta++) {
                const turno = await this.gemini.conversar(contexto, contents);

                if (turno.tipo === 'texto') {
                    respuesta = turno.texto;
                    break;
                }

                // El turno del modelo se reenvia TAL CUAL antes de los
                // resultados. No es ceremonia: el protocolo exige que la
                // peticion de la funcion siga en la conversacion cuando llega su
                // respuesta, y sin esto Gemini vuelve a pedir lo mismo hasta
                // agotar las tres vueltas.
                contents.push({ role: 'model', parts: turno.partes });

                const respuestas: ContenidoGemini['parts'] = [];
                for (const llamada of turno.llamadas) {
                    const resultado = await this.despachar(llamada, contexto);
                    usadas.push(llamada);
                    respuestas.push({
                        functionResponse: {
                            name: llamada.nombre,
                            response: resultado,
                        },
                    });
                }

                contents.push({ role: 'user', parts: respuestas });
            }

            if (respuesta === ChatRepository.TEXTO_NO_CONVERGE) {
                this.logger.warn(
                    `El turno no convergio en ${ChatRepository.MAX_VUELTAS} vueltas (usuario ${usuarioId})`,
                );
            }
        } catch (error) {
            // Aqui se traduce lo que `GeminiService` lanza: el 503 sin clave y
            // el 502 de red, timeout o salida invalida. Tambien cae aqui una
            // consulta que fallo de verdad, que es lo unico que las herramientas
            // no convierten en texto por su cuenta.
            this.logger.error(
                `El turno de chat fallo (usuario ${usuarioId}): ${(error as Error)?.message}`,
            );
            respuesta = ChatRepository.TEXTO_DISCULPA;
        }

        this.logger.debug(
            usadas.length === 0
                ? `Turno sin herramientas (usuario ${usuarioId})`
                : `Herramientas usadas (usuario ${usuarioId}): ${usadas.map((u) => u.nombre).join(', ')}`,
        );

        return respuesta;
    }

    /**
     * Lo que el servidor sabe antes de hablar con nadie: quien pregunta y que
     * clientes tiene en su cartera.
     *
     * Le sirve al modelo para resolver "mi cliente" sin preguntar, y sobre todo
     * le sirve al despachador, que compara contra esto lo que el modelo propone.
     * La cartera vacia es normal y no se trata como error: un aprobador o un
     * ADMIN no tienen ninguna fila en `cliente_operador`, y esa es exactamente
     * la razon por la que el SPEC 28 no filtra el chat por cartera.
     *
     * Si el usuario del token ya no existe, el turno sigue con un nombre
     * generico en vez de fallar, igual que `GET /pesajes/historial` responde
     * 200 con lista vacia en ese caso.
     */
    private async contextoDe(usuarioId: number): Promise<ContextoChat> {
        const usuario = await this.db
            .selectFrom('usuarios')
            .select(['id', 'complete_name'])
            .where('id', '=', usuarioId)
            .executeTakeFirst();

        const clientes = await this.db
            .selectFrom('clientes')
            .innerJoin(
                'cliente_operador',
                'cliente_operador.cliente_id',
                'clientes.id',
            )
            .select(['clientes.id', 'clientes.nombre'])
            .where('cliente_operador.usuario_id', '=', usuarioId)
            .where('clientes.isActive', '=', 1)
            .orderBy('clientes.nombre', 'asc')
            .execute();

        return {
            usuario: {
                id: usuarioId,
                nombre: usuario?.complete_name ?? 'Usuario',
            },
            clientes,
        };
    }

    // ---------------------------------------------------------------------
    // Despachador
    // ---------------------------------------------------------------------

    /**
     * Ejecuta lo que el modelo propuso, despues de validarlo.
     *
     * **Nunca confia en lo que llego.** Que el modelo lo haya pedido no lo hace
     * legitimo: los argumentos vienen de un texto que genero un modelo a partir
     * de, entre otras cosas, nombres de lote y de cliente que alguien escribio
     * por API. Cada valor pasa por un coercionador que solo deja salir el tipo
     * esperado, los ids inexistentes responden con texto y el nombre de la
     * funcion se compara contra esta lista cerrada.
     *
     * No valida `cliente_operador`, igual que las ocho consultas que despacha:
     * es la decision del SPEC 28 y esta razonada alli —los aprobadores y los
     * ADMIN no tienen filas en esa tabla y el chat les saldria vacio—.
     */
    async despachar(
        llamada: LlamadaHerramienta,
        contexto: ContextoChat,
    ): Promise<ResultadoHerramienta> {
        const args = llamada.argumentos ?? {};

        switch (llamada.nombre) {
            case 'buscar_persona':
                return await this.buscarPersona(this.aTexto(args.texto));

            case 'mis_clientes':
                return await this.misClientes(contexto.usuario.id);

            case 'lotes_de_cliente':
                return await this.lotesDeCliente(
                    this.aEntero(args.cliente_id),
                    this.aEstadoDeLote(args.estado),
                    this.aLimite(args.limite),
                );

            case 'metricas_de_lote':
                return await this.metricasDeLote(this.aEntero(args.lote_id));

            case 'pesajes_de_lote':
                return await this.pesajesDeLote(
                    this.aEntero(args.lote_id),
                    this.aFiltrosDePesajes(args),
                );

            case 'pesajes_de_usuario':
                return await this.pesajesDeUsuario(
                    this.aEntero(args.usuario_id),
                    this.aFiltrosDePesajes(args),
                );

            case 'resumen_del_lote':
                return await this.resumenDelLote(this.aEntero(args.lote_id));

            case 'detalle_de_pesaje':
                return await this.detalleDePesaje(this.aEntero(args.pesaje_id));

            default:
                // Incluye el caso que importa: una funcion de escritura que el
                // modelo se invento. No existe, no se despacha y se registra.
                this.logger.warn(
                    `El modelo pidio una herramienta que no existe: '${llamada.nombre}'`,
                );
                return {
                    error: `No existe la consulta '${llamada.nombre}'. Solo puedo consultar informacion, nunca modificarla.`,
                };
        }
    }

    // ---------------------------------------------------------------------
    // Herramienta 1: buscar_persona
    // ---------------------------------------------------------------------

    /**
     * Resuelve un nombre a ids, que es el primer paso de casi toda consulta.
     *
     * Busca en las dos tablas donde hay nombres —`usuarios` y `clientes`—
     * porque el supervisor no distingue: "los pesajes de Carlos" y "los lotes de
     * Agroexport" son la misma frase para el.
     *
     * No restringe a la cartera de quien pregunta, y eso es coherente con lo que
     * ya existe: `GET /catalogos/usuarios` devuelve el id y el nombre de TODOS
     * los usuarios activos a cualquier autenticado. La regla se aplica donde
     * esta el dato, no donde esta el nombre.
     *
     * Los clientes rechazados SI aparecen, marcados. Es el criterio de
     * `GET /pesajes/historial`, la unica lectura del proyecto que los muestra:
     * esconderlos haria que una pregunta por pesajes de hace dos meses no
     * encontrara a nadie.
     */
    private async buscarPersona(texto?: string): Promise<ResultadoHerramienta> {
        if (!texto) {
            return { error: 'Falta el nombre a buscar.' };
        }

        const patron = `%${texto}%`;

        const personas = await this.db
            .selectFrom('usuarios')
            .select(['usuarios.id', 'usuarios.complete_name as nombre'])
            .where('usuarios.complete_name', 'like', patron)
            .where('usuarios.isActive', '=', 1)
            .orderBy('usuarios.complete_name', 'asc')
            .limit(ChatRepository.MAX_COINCIDENCIAS)
            .execute();

        const clientes = await this.db
            .selectFrom('clientes')
            .select(['clientes.id', 'clientes.nombre', 'clientes.isActive'])
            .where('clientes.nombre', 'like', patron)
            .orderBy('clientes.nombre', 'asc')
            .limit(ChatRepository.MAX_COINCIDENCIAS)
            .execute();

        // Los dos totales van aparte de las dos listas por la regla de los
        // defaults: cuando se muestran menos filas de las que hay, se dice
        // cuantas hay. Sin el total, diez coincidencias se leen como todas.
        const totalPersonas = await this.db
            .selectFrom('usuarios')
            .select((eb) => eb.fn.countAll().as('total'))
            .where('usuarios.complete_name', 'like', patron)
            .where('usuarios.isActive', '=', 1)
            .executeTakeFirst();

        const totalClientes = await this.db
            .selectFrom('clientes')
            .select((eb) => eb.fn.countAll().as('total'))
            .where('clientes.nombre', 'like', patron)
            .executeTakeFirst();

        const cuantasPersonas = Number(totalPersonas?.total ?? 0);
        const cuantosClientes = Number(totalClientes?.total ?? 0);

        if (cuantasPersonas === 0 && cuantosClientes === 0) {
            return {
                buscado: texto,
                personas: [],
                clientes: [],
                aviso: `No hay ninguna persona ni cliente cuyo nombre contenga '${texto}'.`,
            };
        }

        return {
            buscado: texto,
            personas: personas.map((p) => ({ id: p.id, nombre: p.nombre })),
            total_personas: cuantasPersonas,
            clientes: clientes.map((c) => ({
                id: c.id,
                nombre: c.nombre,
                estado: c.isActive === 1 ? 'activo' : 'rechazado',
            })),
            total_clientes: cuantosClientes,
        };
    }

    // ---------------------------------------------------------------------
    // Herramienta 2: mis_clientes
    // ---------------------------------------------------------------------

    /**
     * La cartera de quien pregunta, transcrita de `getAllClientesByOperador`.
     *
     * Devuelve tres campos de los seis del endpoint original: se caen
     * `codigo_exportacion`, `telefono` y `direccion_planta`. No es simplificar
     * por gusto —el SPEC 28 promete que ni RTN, ni direccion, ni telefono, ni
     * nada fiscal entra en ninguna de las ocho herramientas, y todo lo que entra
     * aqui viaja a Google—.
     *
     * Puede devolver cero filas sin que sea un error: un aprobador o un ADMIN no
     * tienen ninguna fila en `cliente_operador`. Esa es justamente la razon por
     * la que el resto de herramientas no filtran por cartera.
     */
    private async misClientes(usuarioId: number): Promise<ResultadoHerramienta> {
        const clientes = await this.db
            .selectFrom('clientes')
            .innerJoin(
                'cliente_operador',
                'cliente_operador.cliente_id',
                'clientes.id',
            )
            .leftJoin('productos', 'productos.id', 'clientes.producto_id')
            .select([
                'clientes.id',
                'clientes.nombre',
                'productos.nombre as producto',
            ])
            .where('cliente_operador.usuario_id', '=', usuarioId)
            .where('clientes.isActive', '=', 1)
            .orderBy('clientes.nombre', 'asc')
            .execute();

        if (clientes.length === 0) {
            return {
                clientes: [],
                total: 0,
                aviso:
                    'Quien pregunta no tiene ningun cliente asignado en su cartera. ' +
                    'Es lo normal para un aprobador o un administrador: puede consultar ' +
                    'cualquier cliente por su nombre con buscar_persona.',
            };
        }

        return { clientes, total: clientes.length };
    }

    // ---------------------------------------------------------------------
    // Herramienta 3: lotes_de_cliente
    // ---------------------------------------------------------------------

    /**
     * Los lotes de un cliente en uno de los tres estados que el chat distingue.
     *
     * Reune las tres consultas de referencia en una, porque las tres son la
     * misma con otro filtro:
     *
     * - `abierto` — `estado = 'abierto'`, como `getLotesByCliente`.
     * - `pendiente_aprobacion` — `estado = 'cerrado'` en la etapa CLIENTE_FINAL,
     *   la bandeja del aprobador.
     * - `finalizado` — la etapa FINALIZADO, como `getLotesFinalizadosByCliente`.
     *
     * **Resuelve las dos etapas por su `codigo`, nunca por un id.** Esto es una
     * decision y no un descuido: `getAllLotesByClienteForApprover` lleva un
     * `etapa_id = 2` escrito a mano que CLAUDE.md senala como contraejemplo, y
     * copiarlo aqui heredaria su fallo silencioso —en un ambiente donde
     * CLIENTE_FINAL no sea el id 2, la consulta responde datos equivocados sin
     * error—. El costo es una consulta mas por llamada.
     *
     * `estado = 'cerrado'` no distingue por si solo: significa rechazado,
     * aprobado o finalizado. Por eso los dos estados cerrados se piden siempre
     * por etapa y nunca por `estado` a secas.
     */
    private async lotesDeCliente(
        clienteId?: number,
        estado: EstadoDeLote = 'abierto',
        limite: number = ChatRepository.LIMITE_POR_DEFECTO,
    ): Promise<ResultadoHerramienta> {
        if (clienteId === undefined) {
            return { error: 'Falta el id del cliente.' };
        }

        const cliente = await this.db
            .selectFrom('clientes')
            .select(['id', 'nombre', 'isActive'])
            .where('id', '=', clienteId)
            .executeTakeFirst();

        if (!cliente) {
            return { error: `No existe ningun cliente con id ${clienteId}.` };
        }

        // Los dos filtros que definen el estado, calculados una vez y aplicados
        // igual a la consulta y al conteo. Si divergen, el total miente.
        let estadoColumna: 'abierto' | 'cerrado' | undefined;
        let etapaId: number | undefined;

        if (estado === 'abierto') {
            estadoColumna = 'abierto';
        } else {
            const codigo = estado === 'finalizado' ? 'FINALIZADO' : 'CLIENTE_FINAL';
            const etapa = await this.db
                .selectFrom('etapas')
                .select(['id'])
                .where('codigo', '=', codigo)
                .executeTakeFirst();

            if (!etapa) {
                return {
                    error: `La etapa '${codigo}' no esta configurada en esta base de datos, asi que no puedo listar esos lotes.`,
                };
            }

            etapaId = etapa.id;
            if (estado === 'pendiente_aprobacion') estadoColumna = 'cerrado';
        }

        const filas = Math.min(limite, ChatRepository.MAX_FILAS_MODELO);

        let consulta = this.db
            .selectFrom('lotes')
            .leftJoin('productos', 'productos.id', 'lotes.producto_id')
            .leftJoin(
                'unidades_medida',
                'unidades_medida.id',
                'lotes.unidad_medida_id',
            )
            .leftJoin('etapas', 'etapas.id', 'lotes.etapa_id')
            .leftJoin('usuarios as aprobador', 'aprobador.id', 'lotes.aprobado_por')
            .leftJoin(
                'usuarios as finalizador',
                'finalizador.id',
                'lotes.finalizado_por',
            )
            .select([
                'lotes.id',
                'lotes.nombre_lote',
                'lotes.variedad_o_talla',
                'productos.nombre as producto',
                'unidades_medida.nombre as unidad_medida',
                'lotes.peso_minimo',
                'lotes.peso_ideal',
                'lotes.peso_maximo',
                'lotes.estado',
                'etapas.nombre as etapa',
                'aprobador.complete_name as aprobado_por',
                'lotes.aprobado_en',
                'finalizador.complete_name as finalizado_por',
                'lotes.finalizado_en',
            ])
            .where('lotes.cliente_id', '=', clienteId);

        let conteo = this.db
            .selectFrom('lotes')
            .select((eb) => eb.fn.countAll().as('total'))
            .where('lotes.cliente_id', '=', clienteId);

        if (estadoColumna !== undefined) {
            consulta = consulta.where('lotes.estado', '=', estadoColumna);
            conteo = conteo.where('lotes.estado', '=', estadoColumna);
        }
        if (etapaId !== undefined) {
            consulta = consulta.where('lotes.etapa_id', '=', etapaId);
            conteo = conteo.where('lotes.etapa_id', '=', etapaId);
        }

        // Un listado de trabajo terminado se ordena por cuando termino, que es
        // lo que hace el SPEC 24; el resto, por cuando empezo.
        const lotes =
            estado === 'finalizado'
                ? await consulta.orderBy('lotes.finalizado_en', 'desc').limit(filas).execute()
                : await consulta.orderBy('lotes.created_at', 'desc').limit(filas).execute();

        const total = Number((await conteo.executeTakeFirst())?.total ?? 0);

        if (total === 0) {
            return {
                cliente: cliente.nombre,
                estado_consultado: estado,
                lotes: [],
                total: 0,
                aviso: `El cliente ${cliente.nombre} no tiene ningun lote ${this.enPalabras(estado)}.`,
            };
        }

        return {
            cliente: cliente.nombre,
            cliente_rechazado: cliente.isActive !== 1,
            estado_consultado: estado,
            total,
            mostrados: lotes.length,
            lotes: lotes.map((lote) => ({
                id: lote.id,
                nombre_lote: lote.nombre_lote,
                variedad_o_talla: lote.variedad_o_talla,
                producto: lote.producto,
                unidad_medida: lote.unidad_medida,
                rango_peso: {
                    minimo: this.dosDecimales(lote.peso_minimo),
                    ideal: this.dosDecimales(lote.peso_ideal),
                    maximo: this.dosDecimales(lote.peso_maximo),
                },
                etapa: lote.etapa,
                // La terna de auditoria solo tiene sentido donde esta escrita.
                // En un lote abierto los cuatro campos son null y meterlos en el
                // contexto es pagar tokens por nada.
                ...(estado === 'finalizado'
                    ? {
                        aprobado_por: lote.aprobado_por,
                        aprobado_en: this.fechaHora(lote.aprobado_en),
                        finalizado_por: lote.finalizado_por,
                        finalizado_en: this.fechaHora(lote.finalizado_en),
                    }
                    : {}),
            })),
        };
    }

    // ---------------------------------------------------------------------
    // Herramienta 4: metricas_de_lote
    // ---------------------------------------------------------------------

    /**
     * Los agregados de un lote, transcritos de `getMetricasLote` y
     * `getEstadosCalidadLote` (SPEC 27).
     *
     * **Todo llega calculado, incluido `porcentaje_fuera_de_rango`.** Es la
     * duplicacion que el SPEC 28 acepta con los ojos abiertos, y el redondeo de
     * ese porcentaje es justo el que el SPEC 27 documenta: cuando se le pidio al
     * modelo, devolvio 21.42 donde 3 de 14 son 21.43.
     *
     * Cuenta solo pesajes con `isActive = 1`, como las dos consultas originales:
     * un pesaje anulado no suma al peso total de un lote.
     */
    private async metricasDeLote(loteId?: number): Promise<ResultadoHerramienta> {
        if (loteId === undefined) {
            return { error: 'Falta el id del lote.' };
        }

        const lote = await this.datosDelLote(loteId);
        if (!lote) {
            return { error: `No existe ningun lote con id ${loteId}.` };
        }

        const fila = await this.db
            .selectFrom('pesajes')
            .select([
                sql<number | string>`COUNT(*)`.as('activos'),
                sql<number | string>`COALESCE(SUM(peso_neto), 0)`.as('total'),
                sql<number | string>`COALESCE(AVG(peso_neto), 0)`.as('promedio'),
                sql<number | string>`COALESCE(MIN(peso_neto), 0)`.as('minimo'),
                sql<number | string>`COALESCE(MAX(peso_neto), 0)`.as('maximo'),
                sql<number | string>`COALESCE(SUM(fuera_de_rango = 1), 0)`.as(
                    'fuera_de_rango',
                ),
                sql<number | string>`COALESCE(SUM(aprobado = 1), 0)`.as('aprobados'),
                sql<number | string>`COALESCE(SUM(aprobado = 0), 0)`.as('rechazados'),
            ])
            .where('lote_id', '=', loteId)
            .where('isActive', '=', 1)
            .executeTakeFirstOrThrow();

        const activos = Number(fila.activos);

        if (activos === 0) {
            return {
                lote: lote.nombre_lote,
                cliente: lote.cliente,
                aviso: `El lote ${lote.nombre_lote} no tiene ningun pesaje activo, asi que no hay cifras que calcular. Puede que los hayan anulado todos.`,
            };
        }

        const fueraDeRango = Number(fila.fuera_de_rango);

        const estados = await this.db
            .selectFrom('pesajes')
            .innerJoin(
                'estados_calidad',
                'estados_calidad.id',
                'pesajes.estado_calidad_id',
            )
            .select([
                'estados_calidad.nombre as estado',
                sql<number | string>`COUNT(*)`.as('cantidad'),
            ])
            .where('pesajes.lote_id', '=', loteId)
            .where('pesajes.isActive', '=', 1)
            .groupBy('estados_calidad.nombre')
            .orderBy('cantidad', 'desc')
            .execute();

        return {
            lote: lote.nombre_lote,
            cliente: lote.cliente,
            producto: lote.producto,
            variedad_o_talla: lote.variedad_o_talla,
            unidad_medida: lote.unidad_medida,
            rango_peso: {
                minimo: this.dosDecimales(lote.peso_minimo),
                ideal: this.dosDecimales(lote.peso_ideal),
                maximo: this.dosDecimales(lote.peso_maximo),
            },
            estado: lote.estado,
            etapa: lote.etapa,
            pesajes: {
                activos,
                peso_neto_total: this.dosDecimales(fila.total),
                peso_neto_promedio: this.dosDecimales(fila.promedio),
                peso_neto_minimo: this.dosDecimales(fila.minimo),
                peso_neto_maximo: this.dosDecimales(fila.maximo),
                fuera_de_rango: fueraDeRango,
                // Calculado aqui por la misma razon que en el SPEC 27: al modelo
                // se le prohibe calcular, asi que si no viene resuelto no tiene
                // mas remedio que desobedecer una de las dos reglas.
                porcentaje_fuera_de_rango: this.dosDecimales(
                    (fueraDeRango * 100) / activos,
                ),
                aprobados_por_aprobador: Number(fila.aprobados),
                rechazados_por_aprobador: Number(fila.rechazados),
                sin_revisar_por_aprobador:
                    activos - Number(fila.aprobados) - Number(fila.rechazados),
            },
            estados_calidad: estados.map((e) => ({
                estado: e.estado,
                cantidad: Number(e.cantidad),
            })),
        };
    }

    // ---------------------------------------------------------------------
    // Herramienta 5: pesajes_de_lote
    // ---------------------------------------------------------------------

    /**
     * Los pesajes de un lote, transcrito de `getPesajesByLote` con los seis
     * filtros del SPEC 16 y el `periodo` que anade este spec.
     *
     * Devuelve menos columnas que el endpoint y no por ahorrar codigo: cada
     * columna viaja a Google en cada vuelta, y los datos del lote —nombre,
     * rango, unidad— se dicen UNA vez en la cabecera en vez de repetirse en las
     * veinte filas.
     *
     * `isActive = 1` se aplica siempre y ningun argumento puede levantarlo, como
     * en el endpoint: los pesajes anulados no se listan. Que un pesaje anulado
     * exista solo se sabe preguntando por su id.
     */
    private async pesajesDeLote(
        loteId: number | undefined,
        filtros: FiltrosDePesajes,
    ): Promise<ResultadoHerramienta> {
        if (loteId === undefined) {
            return { error: 'Falta el id del lote.' };
        }

        const lote = await this.datosDelLote(loteId);
        if (!lote) {
            return { error: `No existe ningun lote con id ${loteId}.` };
        }

        const ventana = this.ventanaDelPeriodo(filtros);

        let consulta = this.db
            .selectFrom('pesajes')
            .leftJoin(
                'estados_calidad',
                'estados_calidad.id',
                'pesajes.estado_calidad_id',
            )
            .leftJoin('usuarios', 'usuarios.id', 'pesajes.usuario_id')
            .select([
                'pesajes.id',
                'pesajes.peso_bruto',
                'pesajes.tara',
                'pesajes.peso_neto',
                'pesajes.fuera_de_rango',
                'estados_calidad.nombre as estado_calidad',
                'usuarios.complete_name as registrado_por',
                'pesajes.created_at',
                'pesajes.aprobado',
            ])
            .where('pesajes.lote_id', '=', loteId)
            .where('pesajes.isActive', '=', 1);

        if (filtros.usuario_id !== undefined) {
            consulta = consulta.where('pesajes.usuario_id', '=', filtros.usuario_id);
        }
        if (filtros.estado_calidad_id !== undefined) {
            consulta = consulta.where(
                'pesajes.estado_calidad_id',
                '=',
                filtros.estado_calidad_id,
            );
        }
        if (filtros.fuera_de_rango !== undefined) {
            consulta = consulta.where(
                'pesajes.fuera_de_rango',
                '=',
                sql<boolean>`${filtros.fuera_de_rango ? 1 : 0}`,
            );
        }
        if (filtros.nombre !== undefined) {
            // El unico texto que esta consulta alcanza es el nombre de quien
            // peso, igual que en el endpoint. Ojo: filtra por una columna que
            // llega por LEFT JOIN, asi que deja fuera los pesajes sin usuario.
            consulta = consulta.where(
                'usuarios.complete_name',
                'like',
                `%${filtros.nombre}%`,
            );
        }
        if (ventana.desde !== undefined) {
            consulta = consulta.where('pesajes.created_at', '>=', ventana.desde);
        }
        if (ventana.hasta !== undefined) {
            consulta = consulta.where('pesajes.created_at', '<', ventana.hasta);
        }

        const total = await this.contarFiltrados(consulta);
        const filas = Math.min(filtros.limite, ChatRepository.MAX_FILAS_MODELO);
        const pesajes = await consulta
            .orderBy('pesajes.created_at', 'desc')
            .limit(filas)
            .execute();

        const cabecera = {
            lote: lote.nombre_lote,
            cliente: lote.cliente,
            unidad_medida: lote.unidad_medida,
            rango_peso: {
                minimo: this.dosDecimales(lote.peso_minimo),
                ideal: this.dosDecimales(lote.peso_ideal),
                maximo: this.dosDecimales(lote.peso_maximo),
            },
            filtros_aplicados: this.filtrosEnPalabras(filtros, ventana),
        };

        if (total === 0) {
            return {
                ...cabecera,
                pesajes: [],
                total: 0,
                aviso: `No hay ningun pesaje activo del lote ${lote.nombre_lote} con esos criterios. Los pesajes anulados no se listan; si hace falta, se puede consultar uno concreto por su id.`,
            };
        }

        return {
            ...cabecera,
            total,
            mostrados: pesajes.length,
            pesajes: pesajes.map((p) => ({
                id: Number(p.id),
                peso_bruto: this.dosDecimales(p.peso_bruto),
                tara: this.dosDecimales(p.tara),
                peso_neto: this.dosDecimales(p.peso_neto),
                fuera_de_rango: !!p.fuera_de_rango,
                estado_calidad: p.estado_calidad,
                registrado_por: p.registrado_por,
                registrado_en: this.fechaHora(p.created_at),
                revision_del_aprobador: this.revision(p.aprobado),
            })),
        };
    }

    // ---------------------------------------------------------------------
    // Herramienta 6: pesajes_de_usuario
    // ---------------------------------------------------------------------

    /**
     * Los pesajes que registro una persona, con los siete filtros del SPEC 16.
     *
     * Es `getHistorialByUsuario` con OTRO `userId`, y ahi esta lo que hay que
     * entender antes de tocarla: el endpoint del SPEC 15 garantiza que nadie
     * puede pedir el historial de otro porque no hay donde escribir su id —el
     * SPEC 16 le dio siete parametros y le nego `?usuario_id` justo para no
     * romperlo—. **Esta herramienta si recibe ese id, y por tanto no tiene esa
     * garantia.** No es un descuido: el SPEC 28 decide que el chat queda abierto
     * a cualquier autenticado, con la misma razon del SPEC 24, y lo registra
     * como riesgo aceptado. No copiar esto a un endpoint nuevo.
     *
     * Hereda lo que el historial deliberadamente NO filtra: no mira
     * `lotes.estado` ni `clientes.isActive`, asi que es el unico sitio del chat
     * donde salen el nombre de un lote cerrado y el de un cliente rechazado.
     */
    private async pesajesDeUsuario(
        usuarioId: number | undefined,
        filtros: FiltrosDePesajes,
    ): Promise<ResultadoHerramienta> {
        if (usuarioId === undefined) {
            return { error: 'Falta el id de la persona.' };
        }

        const persona = await this.db
            .selectFrom('usuarios')
            .select(['id', 'complete_name'])
            .where('id', '=', usuarioId)
            .executeTakeFirst();

        if (!persona) {
            return { error: `No existe ninguna persona con id ${usuarioId}.` };
        }

        const ventana = this.ventanaDelPeriodo(filtros);

        let consulta = this.db
            .selectFrom('pesajes')
            .leftJoin(
                'estados_calidad',
                'estados_calidad.id',
                'pesajes.estado_calidad_id',
            )
            .leftJoin('lotes', 'lotes.id', 'pesajes.lote_id')
            .leftJoin('clientes', 'clientes.id', 'lotes.cliente_id')
            .leftJoin(
                'unidades_medida',
                'unidades_medida.id',
                'lotes.unidad_medida_id',
            )
            .select([
                'pesajes.id',
                'pesajes.lote_id',
                'lotes.nombre_lote',
                'clientes.nombre as cliente',
                'unidades_medida.nombre as unidad_medida',
                'pesajes.peso_neto',
                'pesajes.fuera_de_rango',
                'estados_calidad.nombre as estado_calidad',
                'pesajes.created_at',
                'pesajes.aprobado',
            ])
            .where('pesajes.usuario_id', '=', usuarioId)
            .where('pesajes.isActive', '=', 1);

        if (filtros.lote_id !== undefined) {
            consulta = consulta.where('pesajes.lote_id', '=', filtros.lote_id);
        }
        if (filtros.cliente_id !== undefined) {
            consulta = consulta.where('lotes.cliente_id', '=', filtros.cliente_id);
        }
        if (filtros.estado_calidad_id !== undefined) {
            consulta = consulta.where(
                'pesajes.estado_calidad_id',
                '=',
                filtros.estado_calidad_id,
            );
        }
        if (filtros.fuera_de_rango !== undefined) {
            consulta = consulta.where(
                'pesajes.fuera_de_rango',
                '=',
                sql<boolean>`${filtros.fuera_de_rango ? 1 : 0}`,
            );
        }
        if (filtros.nombre !== undefined) {
            // Filtra el nombre del LOTE, no el de la persona, igual que el
            // endpoint: la persona ya viene fijada por el id.
            consulta = consulta.where(
                'lotes.nombre_lote',
                'like',
                `%${filtros.nombre}%`,
            );
        }
        if (ventana.desde !== undefined) {
            consulta = consulta.where('pesajes.created_at', '>=', ventana.desde);
        }
        if (ventana.hasta !== undefined) {
            consulta = consulta.where('pesajes.created_at', '<', ventana.hasta);
        }

        const total = await this.contarFiltrados(consulta);
        const filas = Math.min(filtros.limite, ChatRepository.MAX_FILAS_MODELO);
        const pesajes = await consulta
            .orderBy('pesajes.created_at', 'desc')
            .limit(filas)
            .execute();

        const cabecera = {
            persona: persona.complete_name,
            filtros_aplicados: this.filtrosEnPalabras(filtros, ventana),
        };

        if (total === 0) {
            return {
                ...cabecera,
                pesajes: [],
                total: 0,
                aviso: `${persona.complete_name} no tiene ningun pesaje activo con esos criterios. Los pesajes anulados no se listan.`,
            };
        }

        return {
            ...cabecera,
            total,
            mostrados: pesajes.length,
            pesajes: pesajes.map((p) => ({
                id: Number(p.id),
                lote_id: p.lote_id,
                lote: p.nombre_lote,
                cliente: p.cliente,
                peso_neto: this.dosDecimales(p.peso_neto),
                unidad_medida: p.unidad_medida,
                fuera_de_rango: !!p.fuera_de_rango,
                estado_calidad: p.estado_calidad,
                registrado_en: this.fechaHora(p.created_at),
                revision_del_aprobador: this.revision(p.aprobado),
            })),
        };
    }

    // ---------------------------------------------------------------------
    // Herramienta 7: resumen_del_lote
    // ---------------------------------------------------------------------

    /**
     * El resumen de cierre que el SPEC 27 guardo en `lotes.resumen_ia`.
     *
     * **Lee, nunca genera.** Un lote sin resumen responde que no lo tiene: el
     * chat no puede acabar gastando una llamada a Gemini por dentro de otra, y
     * menos sin que nadie lo haya pedido. Generarlo sigue siendo
     * `POST /lotes/:id/resumen`.
     *
     * Lo que devuelve es el markdown crudo tal cual se guardo. El modelo lo
     * tiene prohibido reformatear, asi que lo que se ve en el chat es
     * exactamente lo mismo que ve quien abre el resumen del lote.
     */
    private async resumenDelLote(loteId?: number): Promise<ResultadoHerramienta> {
        if (loteId === undefined) {
            return { error: 'Falta el id del lote.' };
        }

        const lote = await this.db
            .selectFrom('lotes')
            .select(['id', 'nombre_lote', 'resumen_ia', 'finalizado_por'])
            .where('id', '=', loteId)
            .executeTakeFirst();

        if (!lote) {
            return { error: `No existe ningun lote con id ${loteId}.` };
        }

        if (lote.resumen_ia === null) {
            return {
                lote: lote.nombre_lote,
                resumen: null,
                aviso:
                    lote.finalizado_por === null
                        ? `El lote ${lote.nombre_lote} todavia no esta finalizado, y el resumen solo se genera al cerrarlo.`
                        : `El lote ${lote.nombre_lote} esta finalizado pero nadie ha generado su resumen todavia.`,
            };
        }

        return { lote: lote.nombre_lote, resumen: lote.resumen_ia };
    }

    // ---------------------------------------------------------------------
    // Herramienta 8: detalle_de_pesaje
    // ---------------------------------------------------------------------

    /**
     * Un pesaje por su id, transcrito de `getPesajeById` (SPEC 21).
     *
     * Dos diferencias con el endpoint, y las dos son porque aqui no hay codigos
     * de estado que devolver: un id inexistente responde con texto en vez de un
     * 404, y un pesaje anulado responde con texto en vez de un 400 —con el mismo
     * `motivo_rechazo` dentro, que sigue siendo el unico sitio de la API donde
     * ese campo se lee—.
     *
     * Se conserva la comparacion `isActive === 0` y no `!== 1`, igual que en el
     * endpoint: la columna admite NULL y una fila asi se considera activa.
     * Divergir aqui haria que el chat y la pantalla contaran cosas distintas del
     * mismo pesaje.
     */
    private async detalleDePesaje(
        pesajeId?: number,
    ): Promise<ResultadoHerramienta> {
        if (pesajeId === undefined) {
            return { error: 'Falta el id del pesaje.' };
        }

        const pesaje = await this.db
            .selectFrom('pesajes')
            .leftJoin(
                'estados_calidad',
                'estados_calidad.id',
                'pesajes.estado_calidad_id',
            )
            .leftJoin('usuarios', 'usuarios.id', 'pesajes.usuario_id')
            .leftJoin('lotes', 'lotes.id', 'pesajes.lote_id')
            .leftJoin(
                'unidades_medida',
                'unidades_medida.id',
                'lotes.unidad_medida_id',
            )
            .leftJoin('etapas', 'etapas.id', 'lotes.etapa_id')
            .select([
                'pesajes.id',
                'pesajes.lote_id',
                'lotes.nombre_lote',
                'lotes.variedad_o_talla',
                'unidades_medida.nombre as unidad_medida',
                'lotes.peso_minimo',
                'lotes.peso_ideal',
                'lotes.peso_maximo',
                'lotes.estado as lote_estado',
                'etapas.nombre as lote_etapa',
                'pesajes.peso_bruto',
                'pesajes.tara',
                'pesajes.peso_neto',
                'pesajes.fuera_de_rango',
                'estados_calidad.nombre as estado_calidad',
                'usuarios.complete_name as registrado_por',
                'pesajes.created_at',
                'pesajes.aprobado',
                'pesajes.isActive',
                'pesajes.motivo_rechazo',
            ])
            .where('pesajes.id', '=', pesajeId)
            .executeTakeFirst();

        if (!pesaje) {
            return { error: `No existe ningun pesaje con id ${pesajeId}.` };
        }

        if (pesaje.isActive === 0) {
            return {
                id: Number(pesaje.id),
                anulado: true,
                error: pesaje.motivo_rechazo
                    ? `El pesaje ${pesajeId} esta anulado. Motivo: ${pesaje.motivo_rechazo}`
                    : `El pesaje ${pesajeId} esta anulado.`,
            };
        }

        return {
            id: Number(pesaje.id),
            lote_id: pesaje.lote_id,
            lote: pesaje.nombre_lote,
            variedad_o_talla: pesaje.variedad_o_talla,
            unidad_medida: pesaje.unidad_medida,
            rango_peso_del_lote: {
                minimo: this.dosDecimales(pesaje.peso_minimo),
                ideal: this.dosDecimales(pesaje.peso_ideal),
                maximo: this.dosDecimales(pesaje.peso_maximo),
            },
            lote_estado: pesaje.lote_estado,
            lote_etapa: pesaje.lote_etapa,
            peso_bruto: this.dosDecimales(pesaje.peso_bruto),
            tara: this.dosDecimales(pesaje.tara),
            peso_neto: this.dosDecimales(pesaje.peso_neto),
            fuera_de_rango: !!pesaje.fuera_de_rango,
            estado_calidad: pesaje.estado_calidad,
            registrado_por: pesaje.registrado_por,
            registrado_en: this.fechaHora(pesaje.created_at),
            revision_del_aprobador: this.revision(pesaje.aprobado),
        };
    }

    // ---------------------------------------------------------------------
    // Coercion de argumentos y formato
    // ---------------------------------------------------------------------

    /**
     * Un entero positivo o nada.
     *
     * Acepta el numero y tambien la cadena, porque un modelo manda `"12"` con
     * la misma naturalidad que `12` aunque la declaracion diga INTEGER. Lo que
     * no pasa de aqui es un decimal, un cero, un negativo ni un `"doce"`.
     */
    private aEntero(valor: unknown): number | undefined {
        if (typeof valor !== 'number' && typeof valor !== 'string') return undefined;

        const numero = Number(valor);
        return Number.isInteger(numero) && numero > 0 ? numero : undefined;
    }

    /**
     * Uno de los tres estados del vocabulario del chat, o `undefined` para que
     * caiga el default de `abierto`.
     *
     * Un valor que no este en la lista NO se interpreta: se ignora y la consulta
     * responde los lotes abiertos. Adivinar que 'cerrado' quiere decir
     * 'pendiente_aprobacion' es exactamente el tipo de suposicion silenciosa que
     * el spec prohibe.
     */
    private aEstadoDeLote(valor: unknown): EstadoDeLote | undefined {
        return valor === 'abierto' ||
            valor === 'finalizado' ||
            valor === 'pendiente_aprobacion'
            ? valor
            : undefined;
    }

    /** El estado en palabras, para las frases de "no hay nada que mostrar". */
    private enPalabras(estado: EstadoDeLote): string {
        if (estado === 'abierto') return 'abierto';
        if (estado === 'finalizado') return 'finalizado';
        return 'cerrado a la espera del aprobador';
    }

    /**
     * Identificacion de un lote: como se llama, de quien es y con que rango se
     * pesa. La comparte `metricas_de_lote` con las herramientas de pesajes, que
     * necesitan lo mismo para encabezar su respuesta.
     *
     * **Nada de `selectAll()`**, por la misma razon que en `LotesRepository`:
     * `firma_aprobador` son cientos de KB y `resumen_ia` no pinta nada aqui.
     * Ademas, aqui el coste no es solo de memoria: todo lo que se seleccione
     * acaba viajando a Google.
     */
    private async datosDelLote(loteId: number) {
        return await this.db
            .selectFrom('lotes')
            .innerJoin('clientes', 'clientes.id', 'lotes.cliente_id')
            .leftJoin('productos', 'productos.id', 'lotes.producto_id')
            .leftJoin(
                'unidades_medida',
                'unidades_medida.id',
                'lotes.unidad_medida_id',
            )
            .leftJoin('etapas', 'etapas.id', 'lotes.etapa_id')
            .select([
                'lotes.id',
                'lotes.nombre_lote',
                'lotes.variedad_o_talla',
                'clientes.nombre as cliente',
                'productos.nombre as producto',
                'unidades_medida.nombre as unidad_medida',
                'lotes.peso_minimo',
                'lotes.peso_ideal',
                'lotes.peso_maximo',
                'lotes.estado',
                'etapas.nombre as etapa',
            ])
            .where('lotes.id', '=', loteId)
            .executeTakeFirst();
    }

    /**
     * Los filtros de pesajes, todos coercionados de golpe.
     *
     * Un argumento invalido se **ignora**, nunca se interpreta y nunca es un
     * error: es la regla del SPEC 16 —ningun filtro puede producir un 400— con
     * el matiz que aqui la hace todavia mas necesaria, que del otro lado no hay
     * un frontend con una errata sino un modelo generando texto. El riesgo
     * conocido es el mismo de alli: un filtro descartado devuelve una lista que
     * parece filtrada y no lo esta. Se compensa diciendo en la respuesta que
     * filtros se aplicaron de verdad.
     */
    private aFiltrosDePesajes(args: Record<string, unknown>): FiltrosDePesajes {
        return {
            lote_id: this.aEntero(args.lote_id),
            cliente_id: this.aEntero(args.cliente_id),
            usuario_id: this.aEntero(args.usuario_id),
            estado_calidad_id: this.aEntero(args.estado_calidad_id),
            fuera_de_rango: this.aBooleano(args.fuera_de_rango),
            nombre: this.aTexto(args.nombre),
            desde: this.aFecha(args.desde),
            hasta: this.aFecha(args.hasta),
            periodo: this.aPeriodo(args.periodo),
            limite: this.aLimite(args.limite),
        };
    }

    /**
     * La ventana temporal, resuelta a SQL.
     *
     * Dos reglas. **Una fecha explicita gana al periodo**: si el usuario dijo
     * una fecha concreta, esa manda y el `periodo` se descarta entero, sin
     * mezclarlos. Y **el periodo se calcula en MySQL**, con `CURDATE()`, nunca
     * en Node: el reloj que decide que es "hoy" tiene que ser el mismo con el
     * que `NOW()` escribio los `created_at`, y el del proceso de Node puede
     * estar en otra zona.
     *
     * `hasta` es siempre exclusivo con `DATE_ADD(..., INTERVAL 1 DAY)`, que es
     * como el SPEC 16 incluye el dia entero pese a que `created_at` es DATETIME.
     * "esta semana" empieza el lunes —`WEEKDAY()` devuelve 0 ese dia— y "este
     * mes" el dia 1, no hace 30 dias.
     */
    private ventanaDelPeriodo(filtros: FiltrosDePesajes): Ventana {
        if (filtros.desde !== undefined || filtros.hasta !== undefined) {
            const partes: string[] = [];
            if (filtros.desde) partes.push(`desde el ${filtros.desde}`);
            if (filtros.hasta) partes.push(`hasta el ${filtros.hasta} incluido`);

            return {
                desde:
                    filtros.desde !== undefined
                        ? sql<Date>`${filtros.desde}`
                        : undefined,
                hasta:
                    filtros.hasta !== undefined
                        ? sql<Date>`DATE_ADD(${filtros.hasta}, INTERVAL 1 DAY)`
                        : undefined,
                descripcion: partes.join(' '),
            };
        }

        switch (filtros.periodo) {
            case 'hoy':
                return {
                    desde: sql<Date>`CURDATE()`,
                    hasta: sql<Date>`DATE_ADD(CURDATE(), INTERVAL 1 DAY)`,
                    descripcion: 'solo los de hoy',
                };
            case 'esta_semana':
                return {
                    desde: sql<Date>`DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)`,
                    descripcion: 'desde el lunes de esta semana',
                };
            case 'este_mes':
                return {
                    desde: sql<Date>`DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
                    descripcion: 'desde el dia 1 de este mes',
                };
            default:
                return {};
        }
    }

    /**
     * `COUNT(*)` sobre la MISMA consulta, con sus joins y sus filtros, antes de
     * aplicarle el orden y el limite.
     *
     * Es un `clearSelect()` y no una consulta escrita aparte a proposito: dos
     * consultas gemelas se desincronizan al primer filtro que alguien anada solo
     * en una, y entonces el total miente —"20 de 5"— con toda la autoridad de un
     * numero. Aqui es imposible que difieran porque son la misma.
     */
    private async contarFiltrados<DB, TB extends keyof DB, O>(
        consulta: SelectQueryBuilder<DB, TB, O>,
    ): Promise<number> {
        const fila = await consulta
            .clearSelect()
            .clearOrderBy()
            .select(sql<number | string>`COUNT(*)`.as('total'))
            .executeTakeFirst();

        // El tipo de salida es generico, asi que Kysely no puede saber que
        // acabamos de dejar una sola columna; la asercion es solo para eso.
        const total = (fila as { total?: number | string } | undefined)?.total;

        return Number(total ?? 0);
    }

    /**
     * Los filtros que de verdad se aplicaron, en una frase.
     *
     * Existe por la regla que gobierna toda la tabla de defaults: **cuando se
     * asume algo, se dice en voz alta**. El modelo no puede saber que su
     * `?fuera_de_rango: "quizas"` se cayo en la coercion, asi que se le dice lo
     * que quedo en pie y el lo traslada a la respuesta.
     */
    private filtrosEnPalabras(
        filtros: FiltrosDePesajes,
        ventana: Ventana,
    ): string {
        const partes: string[] = [
            `los ${Math.min(filtros.limite, ChatRepository.MAX_FILAS_MODELO)} mas recientes`,
        ];

        if (ventana.descripcion) partes.push(ventana.descripcion);
        if (filtros.fuera_de_rango === true) partes.push('solo fuera de rango');
        if (filtros.fuera_de_rango === false) partes.push('solo dentro de rango');
        if (filtros.nombre) partes.push(`que contengan '${filtros.nombre}'`);

        return partes.join(', ');
    }

    /**
     * El tri-estado de `pesajes.aprobado` en palabras.
     *
     * `null` es "nadie lo ha revisado", que NO es lo mismo que rechazado. La
     * columna vuelve de MySQL como 0/1, asi que se compara por verdad y nunca
     * con `=== false`, que compilaria y dejaria pasar un 0.
     */
    private revision(aprobado: boolean | null): string {
        if (aprobado === null) return 'pendiente';
        return aprobado ? 'aprobado' : 'rechazado';
    }

    /** `true`/`false`, y tambien las cadenas, que es como a veces llegan. */
    private aBooleano(valor: unknown): boolean | undefined {
        if (typeof valor === 'boolean') return valor;
        if (valor === 'true') return true;
        if (valor === 'false') return false;
        return undefined;
    }

    /**
     * Una fecha `'YYYY-MM-DD'` que exista de verdad.
     *
     * El `refine` de la forma no basta: `2026-02-30` encaja con la expresion
     * regular y no es un dia. Es el mismo par regex + comprobacion que
     * `fechaISO` en `src/schemas/`, escrito aqui porque aquello valida un DTO y
     * esto valida lo que propuso un modelo.
     */
    private aFecha(valor: unknown): string | undefined {
        if (typeof valor !== 'string') return undefined;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return undefined;

        const fecha = new Date(`${valor}T00:00:00Z`);
        return !Number.isNaN(fecha.getTime()) &&
            fecha.toISOString().startsWith(valor)
            ? valor
            : undefined;
    }

    /** Uno de los tres periodos, o nada. Un valor raro no se interpreta. */
    private aPeriodo(valor: unknown): Periodo | undefined {
        return valor === 'hoy' || valor === 'esta_semana' || valor === 'este_mes'
            ? valor
            : undefined;
    }

    /** Texto no vacio y acotado. El tope corta un argumento absurdo, no un nombre. */
    private aTexto(valor: unknown): string | undefined {
        if (typeof valor !== 'string') return undefined;

        const limpio = valor.trim().slice(0, 100);
        return limpio.length > 0 ? limpio : undefined;
    }

    /**
     * La cantidad de filas, con los dos topes del spec.
     *
     * Ausente o invalida cae en 10. Por encima de 50 se recorta a 50 pase lo que
     * pase, que es el criterio de aceptacion: el modelo puede pedir 500 y se
     * lleva 50.
     */
    private aLimite(valor: unknown): number {
        const pedido = this.aEntero(valor);
        if (pedido === undefined) return ChatRepository.LIMITE_POR_DEFECTO;

        return Math.min(pedido, ChatRepository.LIMITE_MAXIMO);
    }

    /** Redondeo a dos decimales, la precision con la que se pesa. */
    private dosDecimales(valor: number | string | null): number | null {
        if (valor === null) return null;

        const numero = Number(valor);
        return Number.isFinite(numero) ? Math.round(numero * 100) / 100 : null;
    }

    /**
     * Fecha y hora en `dd/mm/aaaa hh:mm`.
     *
     * Diverge del `fechaEnLetra` del SPEC 27 —"19 de septiembre de 2026"— a
     * proposito: alli hay una fecha suelta dentro de un parrafo, aqui hay
     * veinte en una tabla. El modelo tiene prohibido reformatearlas, asi que la
     * forma que sale de aqui es la que ve el supervisor.
     */
    private fechaHora(valor: Date | string | null): string | null {
        if (valor === null) return null;

        const fecha = valor instanceof Date ? valor : new Date(valor);
        if (Number.isNaN(fecha.getTime())) return null;

        const dd = String(fecha.getDate()).padStart(2, '0');
        const mm = String(fecha.getMonth() + 1).padStart(2, '0');
        const hh = String(fecha.getHours()).padStart(2, '0');
        const mi = String(fecha.getMinutes()).padStart(2, '0');

        return `${dd}/${mm}/${fecha.getFullYear()} ${hh}:${mi}`;
    }
}
