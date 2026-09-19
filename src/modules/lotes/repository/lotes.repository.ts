import { DatabaseService } from 'src/database/database.service';
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Database } from 'src/database/types/types';
import { CreateLoteDto } from '../dto/create-lote.dto';
import { RechazarLoteDto } from '../dto/rechazar-lote.dto';
import { FinalizarLoteDto } from '../dto/finalizar-lote.dto';
import { GeminiService } from 'src/ia/gemini.service';
import { ResumenLotePayload } from 'src/ia/prompts/resumen-lote.prompt';

@Injectable()
export class LotesRepository {
    constructor(
        private readonly dbService: DatabaseService,
        private readonly gemini: GeminiService,
    ) { }

    get db() {
        return this.dbService.client;
    }

    async getLotesByCliente(clienteId: number, usuarioId: number) {
        await this.validateVinculoOperador(clienteId, usuarioId, this.db);

        const lotes = await this.db
            .selectFrom('lotes')
            .leftJoin('productos', 'productos.id', 'lotes.producto_id')
            .leftJoin('unidades_medida', 'unidades_medida.id', 'lotes.unidad_medida_id')
            .leftJoin('etapas', 'etapas.id', 'lotes.etapa_id')
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
            ])
            .where('lotes.cliente_id', '=', clienteId)
            .where('lotes.estado', '=', 'abierto')
            .orderBy('lotes.created_at', 'desc')
            .execute();
        return lotes;
    }
    async getAllLotesByCliente(clienteId: number) {

        const lotes = await this.db
            .selectFrom('lotes')
            .leftJoin('productos', 'productos.id', 'lotes.producto_id')
            .leftJoin('unidades_medida', 'unidades_medida.id', 'lotes.unidad_medida_id')
            .leftJoin('etapas', 'etapas.id', 'lotes.etapa_id')
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
            ])
            .where('lotes.cliente_id', '=', clienteId)
            .where('lotes.estado', '=', 'abierto')
            .orderBy('lotes.created_at', 'desc')
            .execute();
        return lotes;
    }
    async getAllLotesByClienteForApprover(clienteId: number) {
        const lotes = await this.db
            .selectFrom('lotes')
            .leftJoin('productos', 'productos.id', 'lotes.producto_id')
            .leftJoin('unidades_medida', 'unidades_medida.id', 'lotes.unidad_medida_id')
            .leftJoin('etapas', 'etapas.id', 'lotes.etapa_id')
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
            ])
            .where('lotes.cliente_id', '=', clienteId)
            .where('lotes.estado', '=', 'cerrado')
            .where('lotes.etapa_id', '=', 2)
            .orderBy('lotes.created_at', 'desc')
            .execute();
        return lotes;
    }

    async getLotesFinalizadosByCliente(clienteId: number) {
        const etapa = await this.resolveEtapa('FINALIZADO', this.db);

        const lotes = await this.db
            .selectFrom('lotes')
            .leftJoin('productos', 'productos.id', 'lotes.producto_id')
            .leftJoin('unidades_medida', 'unidades_medida.id', 'lotes.unidad_medida_id')
            .leftJoin('etapas', 'etapas.id', 'lotes.etapa_id')
            .leftJoin('usuarios as aprobador', 'aprobador.id', 'lotes.aprobado_por')
            .leftJoin('usuarios as finalizador', 'finalizador.id', 'lotes.finalizado_por')
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
            .where('lotes.cliente_id', '=', clienteId)
            .where('lotes.etapa_id', '=', etapa.id)
            .orderBy('lotes.finalizado_en', 'desc')
            .execute();
        return lotes;
    }

    async createLote(data: CreateLoteDto, userId: number) {
        const {
            cliente_id,
            nombre_lote,
            producto_id,
            unidad_medida_id,
            peso_minimo,
            peso_ideal,
            peso_maximo,
            variedad_o_talla,
        } = data;

        return await this.db.transaction().execute(async (trx) => {
            await this.validateCliente(cliente_id, trx);
            await this.validateVinculoOperador(cliente_id, userId, trx);
            await this.validateProducto(producto_id, trx);
            await this.validateUnidadMedida(unidad_medida_id, trx);
            await this.validateNombreLoteDisponible(cliente_id, nombre_lote, trx);

            const result = await trx
                .insertInto('lotes')
                .values({
                    cliente_id,
                    nombre_lote,
                    producto_id,
                    unidad_medida_id,
                    peso_minimo,
                    peso_ideal,
                    peso_maximo,
                    variedad_o_talla,
                    estado: 'abierto',
                    etapa_id: 1,
                    created_by: userId,
                })
                .executeTakeFirstOrThrow(
                    () => new BadRequestException('Error al crear el lote'),
                );

            return Number(result.insertId);
        });
    }

    async rechazarLote(
        loteId: number,
        data: RechazarLoteDto,
        userId: number,
    ) {
        const { motivo } = data;

        return await this.db.transaction().execute(async (trx) => {
            await this.validateLoteAbierto(loteId, trx);
            const etapa = await this.resolveEtapaRechazado(trx);

            await trx
                .updateTable('lotes')
                .set({
                    estado: 'cerrado',
                    etapa_id: etapa.id,
                    cerrado_en: sql<Date>`NOW()`,
                    motivo_rechazo: motivo,
                    rechazado_por: userId,
                    rechazado_en: sql<Date>`NOW()`,
                })
                .where('id', '=', loteId)
                .execute();

            return true;
        });
    }

    async rechazarLoteForApprover(
        loteId: number,
        data: RechazarLoteDto,
        userId: number,
    ) {
        const { motivo } = data;

        return await this.db.transaction().execute(async (trx) => {
            await this.validateLoteEnClienteFinal(loteId, trx);
            const etapa = await this.resolveEtapaRechazado(trx);
            await trx
                .updateTable('lotes')
                .set({
                    etapa_id: etapa.id,
                    motivo_rechazo: motivo,
                    rechazado_por: userId,
                    rechazado_en: sql<Date>`NOW()`,
                })
                .where('id', '=', loteId)
                .execute();

            return true;
        });
    }

    async aprobarLote(loteId: number, userId: number) {
        return await this.db.transaction().execute(async (trx) => {
            const lote = await this.validateLoteAbierto(loteId, trx);
            await this.validateEtapaEnProceso(lote, trx);
            await this.validateLoteTienePesajes(lote, trx);
            const etapa = await this.resolveEtapa('CLIENTE_FINAL', trx);

            await trx
                .updateTable('lotes')
                .set({
                    estado: 'cerrado',
                    etapa_id: etapa.id,
                    cerrado_en: sql<Date>`NOW()`,
                    aprobado_por: userId,
                    aprobado_en: sql<Date>`NOW()`,
                })
                .where('id', '=', loteId)
                .execute();

            return true;
        });
    }

    async finalizarLote(
        loteId: number,
        dto: FinalizarLoteDto,
        userId: number,
    ) {
        return await this.db.transaction().execute(async (trx) => {
            await this.validateLoteNoFinalizado(loteId, trx);
            const lote = await this.validateLoteEnClienteFinal(loteId, trx);
            await this.validateLoteTienePesajes(lote, trx);
            await this.validatePesajesRevisados(lote, trx);
            const etapa = await this.resolveEtapa('FINALIZADO', trx);

            await trx
                .updateTable('lotes')
                .set({
                    etapa_id: etapa.id,
                    finalizado_por: userId,
                    finalizado_en: sql<Date>`NOW()`,
                    firma_aprobador: dto.firma_aprobador,
                })
                .where('id', '=', loteId)
                .execute();

            return true;
        });
    }

    /**
     * Genera el resumen de un lote finalizado y lo guarda (SPEC 27).
     *
     * **El orden importa y define donde vive la transaccion.** La llamada HTTP
     * ocurre FUERA de toda transaccion: `DatabaseMiddleware` abre un pool de UNA
     * conexion por peticion, y retenerla mientras responde Google es la regla
     * que este spec no puede romper. La transaccion envuelve solo la
     * relectura y el UPDATE de una columna.
     *
     * **Es idempotente:** un lote que ya tiene `resumen_ia` devuelve el que
     * tiene, sin llamar a Gemini y sin tocar la columna, en vez del 400 con que
     * respondia el SPEC 27 original. Sigue escribiendose UNA sola vez —nada
     * sobrescribe un resumen— y el tope de gasto sigue siendo el mismo: una
     * llamada por lote, pase el que pase.
     */
    async generarResumenLote(loteId: number) {
        // 1. Validaciones, fuera de transaccion.
        const lote = await this.validateLoteExiste(loteId, this.db);

        // Si ya hay resumen, esto se comporta como el GET y termina aqui.
        // Va ANTES que el resto de validadores a proposito: un lote que ya
        // tiene resumen se lee siempre, sin que su estado actual lo impida.
        if (lote.resumen_ia !== null) return lote.resumen_ia;

        this.validateLoteFinalizado(lote);
        await this.validateLoteTienePesajesActivos(lote, this.db);

        // 2. Las cifras, fuera de transaccion. El modelo redacta, no calcula.
        const datos = await this.getDatosLote(loteId);
        const pesajes = await this.getMetricasLote(loteId);
        const estados_calidad = await this.getEstadosCalidadLote(loteId);

        const payload: ResumenLotePayload = {
            lote: datos.nombre_lote,
            cliente: datos.cliente,
            producto: datos.producto,
            variedad_o_talla: datos.variedad_o_talla,
            unidad_medida: datos.unidad_medida,
            rango_peso: {
                minimo: Number(datos.peso_minimo),
                ideal: Number(datos.peso_ideal),
                maximo: Number(datos.peso_maximo),
            },
            pesajes,
            estados_calidad,
            aprobado_en: this.fechaEnLetra(datos.aprobado_en),
            finalizado_en: this.fechaEnLetra(datos.finalizado_en),
        };

        // 3. El fetch. Fuera de transaccion, insisto.
        const resumen = await this.gemini.generarResumenDeLote(payload);

        // 4. Ahora si: releer con el trx y escribir.
        return await this.db.transaction().execute(async (trx) => {
            // Segunda pasada. Cierra la ventana de carrera que abren los
            // segundos del paso 3: dos peticiones simultaneas sobre el mismo
            // lote pasan las dos el paso 1, y la segunda en llegar aqui
            // devuelve el resumen de la primera en vez de pisarlo. El resumen
            // que esta llamada le pidio a Gemini se descarta.
            const actual = await trx
                .selectFrom('lotes')
                .select('resumen_ia')
                .where('id', '=', loteId)
                .executeTakeFirstOrThrow(
                    () =>
                        new NotFoundException(`El lote con id '${loteId}' no existe`),
                );

            if (actual.resumen_ia !== null) return actual.resumen_ia;

            await trx
                .updateTable('lotes')
                .set({ resumen_ia: resumen })
                .where('id', '=', loteId)
                .execute();

            return resumen;
        });
    }

    /**
     * Lectura del resumen ya escrito (SPEC 27).
     *
     * Dos condiciones y nada mas: 404 si el lote no existe, y `null` si existe
     * y nadie le pidio el resumen. NO valida el estado del lote —uno abierto o
     * rechazado responde 200 con null— porque una lectura no tiene que explicar
     * por que un campo esta vacio; eso es trabajo del POST. Mismo criterio que
     * `GET /pesajes/:id` del SPEC 21, cuya unica condicion es el id.
     */
    async getResumenLote(loteId: number) {
        const lote = await this.validateLoteExiste(loteId, this.db);
        return lote.resumen_ia;
    }

    /**
     * Los datos del lote que viajan al prompt, con cliente, producto y unidad
     * resueltos a nombre.
     *
     * Consulta aparte de `validateLoteExiste` a proposito: aquel se queda en lo
     * minimo para poder reutilizarse desde la lectura sin arrastrar tres joins.
     * **Nada de `selectAll()`**: `firma_aprobador` son cientos de KB y
     * `resumen_ia` no pinta nada en su propio prompt.
     */
    private async getDatosLote(loteId: number) {
        return await this.db
            .selectFrom('lotes')
            .innerJoin('clientes', 'clientes.id', 'lotes.cliente_id')
            .leftJoin('productos', 'productos.id', 'lotes.producto_id')
            .leftJoin(
                'unidades_medida',
                'unidades_medida.id',
                'lotes.unidad_medida_id',
            )
            .select([
                'lotes.nombre_lote',
                'lotes.variedad_o_talla',
                'lotes.peso_minimo',
                'lotes.peso_ideal',
                'lotes.peso_maximo',
                'lotes.aprobado_en',
                'lotes.finalizado_en',
                'clientes.nombre as cliente',
                'productos.nombre as producto',
                'unidades_medida.nombre as unidad_medida',
            ])
            .where('lotes.id', '=', loteId)
            .executeTakeFirstOrThrow(
                () => new NotFoundException(`El lote con id '${loteId}' no existe`),
            );
    }

    private static readonly MESES = [
        'enero',
        'febrero',
        'marzo',
        'abril',
        'mayo',
        'junio',
        'julio',
        'agosto',
        'septiembre',
        'octubre',
        'noviembre',
        'diciembre',
    ];

    /**
     * '11 de septiembre de 2026'. Se formatea aqui, no en el prompt: dejar que
     * el modelo traduzca un ISO a un nombre de mes es una cifra mas que podria
     * equivocar, a cambio de nada. La instruccion de sistema le manda copiar
     * las fechas tal como llegan.
     */
    private fechaEnLetra(valor: Date | string | null): string | null {
        if (valor === null) return null;

        const fecha = valor instanceof Date ? valor : new Date(valor);
        if (Number.isNaN(fecha.getTime())) return null;

        return `${fecha.getDate()} de ${LotesRepository.MESES[fecha.getMonth()]} de ${fecha.getFullYear()}`;
    }

    /**
     * Existencia del lote (SPEC 27). **Responde 404, no 400.**
     *
     * Es el unico validador de escritura del proyecto que lanza `NotFound`: los
     * cuatro `PATCH` de este mismo archivo usan 400 para "no existe". La
     * distincion es deliberada y es la que establecio el SPEC 21 —el recurso no
     * esta ahi, frente a su estado no sirve— y por eso los otros tres
     * validadores de abajo si son 400.
     *
     * Devuelve lo minimo para validar, sin joins, para que la lectura
     * `GET /lotes/:id/resumen` pueda reutilizarlo sin arrastrar nada mas.
     */
    private async validateLoteExiste(loteId: number, db: Kysely<Database>) {
        return await db
            .selectFrom('lotes')
            .select(['id', 'nombre_lote', 'resumen_ia', 'finalizado_por'])
            .where('id', '=', loteId)
            .executeTakeFirstOrThrow(
                () => new NotFoundException(`El lote con id '${loteId}' no existe`),
            );
    }

    /**
     * Solo se resume un lote FINALIZADO: es el unico punto del ciclo donde el
     * dato esta completo —el SPEC 20 exige todos los pesajes revisados para
     * finalizar— y congelado, porque a partir de ahi el lote no admite ninguna
     * escritura mas.
     *
     * Se comprueba con `finalizado_por IS NOT NULL`, la senal canonica de la
     * tabla discriminadora de CLAUDE.md, y NO resolviendo la fila FINALIZADO de
     * `etapas`: ahorra una consulta y evita el 400 por "la etapa no existe" que
     * arrastra `resolveEtapa`.
     */
    private validateLoteFinalizado(lote: {
        nombre_lote: string;
        finalizado_por: number | null;
    }) {
        if (lote.finalizado_por === null) {
            throw new BadRequestException(
                `El lote '${lote.nombre_lote}' no esta finalizado. Solo se puede resumir un lote finalizado`,
            );
        }
    }

    /**
     * Sin pesajes activos no hay nada que resumir, y los agregados saldrian
     * todos en cero.
     *
     * Es casi gemelo de `validateLoteTienePesajes`, que usan `aprobarLote` y
     * `finalizarLote`; se separa porque el mensaje es otro —aquel habla de
     * pesajes registrados y este de pesajes que resumir— y unificarlos
     * cambiaria el texto de un error ya publicado por el SPEC 13.
     */
    private async validateLoteTienePesajesActivos(
        lote: { id: number; nombre_lote: string },
        db: Kysely<Database>,
    ) {
        const pesaje = await db
            .selectFrom('pesajes')
            .select('id')
            .where('lote_id', '=', lote.id)
            .where('isActive', '=', 1)
            .limit(1)
            .executeTakeFirst();

        if (!pesaje) {
            throw new BadRequestException(
                `El lote '${lote.nombre_lote}' no tiene pesajes activos que resumir`,
            );
        }
    }

    /**
     * Metricas agregadas de los pesajes activos del lote (SPEC 27).
     *
     * UNA consulta fija, no una por pesaje: el tamano del prompt no depende del
     * tamano del lote, asi que un lote de 5 pesajes y uno de 500 producen el
     * mismo numero de tokens. Y el modelo recibe cifras ya calculadas, que es
     * lo que hace el resumen verificable.
     *
     * `SUM(aprobado = 1)` y `SUM(aprobado = 0)` cuentan por separado y NO suman
     * `activos` cuando hay pesajes sin revisar. En un lote finalizado eso no
     * puede pasar —el SPEC 20 lo exige para finalizar— pero el SQL no lo asume.
     */
    private async getMetricasLote(loteId: number) {
        const fila = await this.db
            .selectFrom('pesajes')
            .select([
                sql<number | string>`COUNT(*)`.as('activos'),
                sql<number | string>`COALESCE(SUM(peso_neto), 0)`.as(
                    'peso_neto_total',
                ),
                sql<number | string>`COALESCE(AVG(peso_neto), 0)`.as(
                    'peso_neto_promedio',
                ),
                sql<number | string>`COALESCE(MIN(peso_neto), 0)`.as(
                    'peso_neto_minimo',
                ),
                sql<number | string>`COALESCE(MAX(peso_neto), 0)`.as(
                    'peso_neto_maximo',
                ),
                sql<number | string>`COALESCE(SUM(fuera_de_rango = 1), 0)`.as(
                    'fuera_de_rango',
                ),
                sql<number | string>`COALESCE(SUM(aprobado = 1), 0)`.as(
                    'aprobados_por_aprobador',
                ),
                sql<number | string>`COALESCE(SUM(aprobado = 0), 0)`.as(
                    'rechazados_por_aprobador',
                ),
            ])
            .where('lote_id', '=', loteId)
            .where('isActive', '=', 1)
            .executeTakeFirstOrThrow();

        // Todo con Number(): las columnas DECIMAL de MySQL vuelven como
        // `string | number` y SUM()/AVG()/COUNT() tambien.
        const activos = Number(fila.activos);
        const fueraDeRango = Number(fila.fuera_de_rango);

        return {
            activos,
            peso_neto_total: this.dosDecimales(fila.peso_neto_total),
            // El AVG llega con la precision de MySQL —22.557142857— y el modelo
            // tendria que redondearlo. Se redondea aqui para que no calcule.
            peso_neto_promedio: this.dosDecimales(fila.peso_neto_promedio),
            peso_neto_minimo: this.dosDecimales(fila.peso_neto_minimo),
            peso_neto_maximo: this.dosDecimales(fila.peso_neto_maximo),
            fuera_de_rango: fueraDeRango,
            // Se calcula aqui, no en el prompt: la instruccion pide decir que
            // proporcion representan y a la vez prohibe calcular. Sin este
            // campo el modelo desobedece una de las dos, y cuando se probo
            // devolvio 21.42 donde 3 de 14 son 21.43.
            porcentaje_fuera_de_rango:
                activos === 0 ? 0 : this.dosDecimales((fueraDeRango * 100) / activos),
            aprobados_por_aprobador: Number(fila.aprobados_por_aprobador),
            rechazados_por_aprobador: Number(fila.rechazados_por_aprobador),
        };
    }

    /**
     * Conteo de pesajes activos por estado de calidad, el mas frecuente primero.
     * Segunda y ultima consulta de agregados: tampoco depende del numero de
     * pesajes, solo del numero de estados distintos.
     */
    private async getEstadosCalidadLote(loteId: number) {
        const filas = await this.db
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

        return filas.map((f) => ({
            estado: f.estado,
            cantidad: Number(f.cantidad),
        }));
    }

    /** Redondeo a dos decimales, la precision con la que se pesa. */
    private dosDecimales(valor: number | string): number {
        return Math.round(Number(valor) * 100) / 100;
    }

    private async validateLoteAbierto(loteId: number, db: Kysely<Database>) {
        const lote = await db
            .selectFrom('lotes')
            .select([
                'id',
                'nombre_lote',
                'cliente_id',
                'estado',
                'cerrado_en',
                'etapa_id',
            ])
            .where('id', '=', loteId)
            .executeTakeFirstOrThrow(
                () => new BadRequestException(`El lote con id '${loteId}' no existe`),
            );

        if (lote.estado !== 'abierto' || lote.cerrado_en !== null) {
            throw new BadRequestException(
                `El lote '${lote.nombre_lote}' no esta abierto`,
            );
        }

        return lote;
    }

    private async validateLoteEnClienteFinal(
        loteId: number,
        db: Kysely<Database>,
    ) {
        const lote = await db
            .selectFrom('lotes')
            .select([
                'id',
                'nombre_lote',
                'cliente_id',
                'estado',
                'cerrado_en',
                'etapa_id',
                'motivo_rechazo',
            ])
            .where('id', '=', loteId)
            .executeTakeFirstOrThrow(
                () => new BadRequestException(`El lote con id '${loteId}' no existe`),
            );

        if (lote.motivo_rechazo !== null) {
            throw new BadRequestException(
                `El lote '${lote.nombre_lote}' ya fue rechazado`,
            );
        }

        if (lote.estado !== 'cerrado') {
            throw new BadRequestException(
                `El lote '${lote.nombre_lote}' no esta cerrado`,
            );
        }

        const clienteFinal = await this.resolveEtapa('CLIENTE_FINAL', db);

        if (lote.etapa_id !== clienteFinal.id) {
            throw new BadRequestException(
                `El lote '${lote.nombre_lote}' no esta en la etapa CLIENTE_FINAL`,
            );
        }

        return lote;
    }

    private async validateLoteNoFinalizado(
        loteId: number,
        db: Kysely<Database>,
    ) {
        const lote = await db
            .selectFrom('lotes')
            .select(['id', 'nombre_lote', 'etapa_id'])
            .where('id', '=', loteId)
            .executeTakeFirstOrThrow(
                () => new BadRequestException(`El lote con id '${loteId}' no existe`),
            );

        const finalizado = await this.resolveEtapa('FINALIZADO', db);

        if (lote.etapa_id === finalizado.id) {
            throw new BadRequestException(
                `El lote '${lote.nombre_lote}' ya fue finalizado`,
            );
        }

        return lote;
    }

    private async validateEtapaEnProceso(
        lote: { nombre_lote: string; etapa_id: number | null },
        db: Kysely<Database>,
    ) {
        const enProceso = await this.resolveEtapa('EN_PROCESO', db);

        if (lote.etapa_id !== enProceso.id) {
            throw new BadRequestException(
                `El lote '${lote.nombre_lote}' no esta en la etapa EN_PROCESO`,
            );
        }

        return enProceso;
    }

    private async validateLoteTienePesajes(
        lote: { id: number; nombre_lote: string },
        db: Kysely<Database>,
    ) {
        const pesaje = await db
            .selectFrom('pesajes')
            .select('id')
            .where('lote_id', '=', lote.id)
            .where('isActive', '=', 1)
            .limit(1)
            .executeTakeFirst();

        if (!pesaje) {
            throw new BadRequestException(
                `El lote '${lote.nombre_lote}' no tiene pesajes registrados`,
            );
        }
    }

    private async validatePesajesRevisados(
        lote: { id: number; nombre_lote: string },
        db: Kysely<Database>,
    ) {
        const pesaje = await db
            .selectFrom('pesajes')
            .select('id')
            .where('lote_id', '=', lote.id)
            .where('isActive', '=', 1)
            .where('aprobado', 'is', null)
            .limit(1)
            .executeTakeFirst();

        if (pesaje) {
            throw new BadRequestException(
                `El lote '${lote.nombre_lote}' tiene pesajes sin revisar por el aprobador`,
            );
        }
    }

    private async resolveEtapaRechazado(db: Kysely<Database>) {
        return await db
            .selectFrom('etapas')
            .select(['id', 'codigo'])
            .where('codigo', '=', 'RECHAZADO')
            .executeTakeFirstOrThrow(
                () =>
                    new BadRequestException(
                        `La etapa con codigo 'RECHAZADO' no existe`,
                    ),
            );
    }

    private async resolveEtapa(codigo: string, db: Kysely<Database>) {
        return await db
            .selectFrom('etapas')
            .select(['id', 'codigo'])
            .where('codigo', '=', codigo)
            .executeTakeFirstOrThrow(
                () =>
                    new BadRequestException(
                        `La etapa con codigo '${codigo}' no existe`,
                    ),
            );
    }

    private async validateVinculoOperador(
        clienteId: number,
        usuarioId: number,
        db: Kysely<Database>,
    ) {
        const vinculo = await db
            .selectFrom('cliente_operador')
            .select('id')
            .where('cliente_id', '=', clienteId)
            .where('usuario_id', '=', usuarioId)
            .executeTakeFirst();

        if (!vinculo) {
            throw new ForbiddenException(
                `No tiene acceso al cliente con id '${clienteId}'`,
            );
        }
    }

    private async validateCliente(clienteId: number, db: Kysely<Database>) {
        const cliente = await db
            .selectFrom('clientes')
            .select(['id', 'nombre', 'isActive'])
            .where('id', '=', clienteId)
            .executeTakeFirstOrThrow(
                () =>
                    new BadRequestException(
                        `El cliente con id '${clienteId}' no existe`,
                    ),
            );

        if (cliente.isActive === 0) {
            throw new BadRequestException(
                `El cliente '${cliente.nombre}' no esta activo`,
            );
        }

        return cliente;
    }

    private async validateProducto(productoId: number, db: Kysely<Database>) {
        const producto = await db
            .selectFrom('productos')
            .select(['id', 'nombre', 'isActive'])
            .where('id', '=', productoId)
            .executeTakeFirstOrThrow(
                () =>
                    new BadRequestException(
                        `El producto con id '${productoId}' no existe`,
                    ),
            );

        if (producto.isActive === 0) {
            throw new BadRequestException(
                `El producto '${producto.nombre}' no esta activo`,
            );
        }

        return producto;
    }

    private async validateUnidadMedida(
        unidadMedidaId: number,
        db: Kysely<Database>,
    ) {
        return await db
            .selectFrom('unidades_medida')
            .select(['id', 'nombre'])
            .where('id', '=', unidadMedidaId)
            .executeTakeFirstOrThrow(
                () =>
                    new BadRequestException(
                        `La unidad de medida con id '${unidadMedidaId}' no existe`,
                    ),
            );
    }

    private async validateNombreLoteDisponible(
        clienteId: number,
        nombreLote: string,
        db: Kysely<Database>,
    ) {
        const existente = await db
            .selectFrom('lotes')
            .select('id')
            .where('cliente_id', '=', clienteId)
            .where('nombre_lote', '=', nombreLote)
            .where('motivo_rechazo', 'is', null)
            .executeTakeFirst();

        if (existente) {
            throw new BadRequestException(
                `El lote '${nombreLote}' ya esta registrado para este cliente`,
            );
        }
    }
}
