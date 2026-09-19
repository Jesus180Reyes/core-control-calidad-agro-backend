import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from 'src/database/database.service';
import { GeminiService, LlamadaHerramienta } from 'src/ia/gemini.service';
import { ContextoChat } from 'src/ia/prompts/chat.prompt';
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
     * Devuelve markdown crudo, la misma forma que `POST /lotes/:id/resumen`: un
     * string con saltos de linea reales que el frontend renderiza sin habilitar
     * el modo HTML de su paquete de markdown.
     *
     * TODO(SPEC 28, pasos 10 y 12): bucle de herramientas, tope diario y
     * registro en `chat_log`. Hoy responde un texto fijo y no llama a Gemini.
     */
    responder(dto: PreguntarDto, usuarioId: number): Promise<string> {
        void this.gemini;
        void dto;
        void usuarioId;

        return Promise.resolve('El chat todavia no esta conectado al modelo.');
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
            // Tri-estado, no booleano: null es "el aprobador todavia no lo ha
            // revisado", que no es lo mismo que "no aprobado".
            revision_del_aprobador:
                pesaje.aprobado === null
                    ? 'pendiente'
                    : pesaje.aprobado
                        ? 'aprobado'
                        : 'rechazado',
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
