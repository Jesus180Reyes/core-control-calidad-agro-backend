import { DatabaseService } from 'src/database/database.service';
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Database } from 'src/database/types/types';
import { CreateDocumentoFiscalDto } from '../dto/create-documento-fiscal.dto';
import { FiltrosDocumentosFiscalesDto } from '../dto/filtros-documentos-fiscales.dto';
import { CompletarDocumentoFiscalDto } from '../dto/completar-documento-fiscal.dto';
import { AnularDocumentoFiscalDto } from '../dto/anular-documento-fiscal.dto';

type PaisConfig = {
    id: number;
    nombre: string;
    moneda: string;
    patron_numero: string | null;
    patron_autorizacion: string | null;
    requiere_autorizacion: number;
    isActive: number;
};

type LoteFacturable = {
    id: number;
    nombre_lote: string;
    cliente_id: number;
    finalizado_por: number | null;
};

@Injectable()
export class DocumentosFiscalesRepository {
    constructor(private readonly dbService: DatabaseService) { }

    get db() {
        return this.dbService.client;
    }

    async getDocumentosFiscales(filtros: FiltrosDocumentosFiscalesDto) {
        let query = this.db
            .selectFrom('documentos_fiscales')
            .innerJoin('clientes', 'clientes.id', 'documentos_fiscales.cliente_id')
            .innerJoin(
                'paises_config',
                'paises_config.id',
                'documentos_fiscales.pais_id',
            )
            .select([
                'documentos_fiscales.id',
                'documentos_fiscales.tipo_documento',
                'documentos_fiscales.numero_completo',
                'documentos_fiscales.autorizacion',
                'documentos_fiscales.fecha_emision',
                'documentos_fiscales.moneda',
                'documentos_fiscales.tipo_cambio',
                'documentos_fiscales.importe_exento',
                'documentos_fiscales.importe_exonerado',
                'documentos_fiscales.total',
                'documentos_fiscales.referencia_exencion',
                'documentos_fiscales.pais_destino',
                'documentos_fiscales.documento_aduanero',
                'documentos_fiscales.archivo_url',
                'documentos_fiscales.cliente_id',
                'clientes.nombre as cliente',
                'clientes.rtn as cliente_rtn',
                'paises_config.codigo_pais as pais',
                'documentos_fiscales.created_at',
            ])
            .where('documentos_fiscales.isActive', '=', 1);

        if (filtros.cliente_id !== undefined) {
            query = query.where(
                'documentos_fiscales.cliente_id',
                '=',
                filtros.cliente_id,
            );
        }

        if (filtros.desde !== undefined) {
            query = query.where(
                'documentos_fiscales.fecha_emision',
                '>=',
                filtros.desde,
            );
        }

        // fecha_emision es DATE, no DATETIME, asi que el <= ya incluye todo el
        // dia y no hace falta el DATE_ADD que usan los filtros de pesajes.
        if (filtros.hasta !== undefined) {
            query = query.where(
                'documentos_fiscales.fecha_emision',
                '<=',
                filtros.hasta,
            );
        }

        const documentos = await query
            .orderBy('documentos_fiscales.fecha_emision', 'desc')
            .orderBy('documentos_fiscales.id', 'desc')
            .execute();

        return documentos;
    }

    async createDocumentoFiscal(data: CreateDocumentoFiscalDto, userId: number) {
        const {
            pais_id,
            cliente_id,
            tipo_documento,
            numero_completo,
            autorizacion,
            fecha_emision,
            moneda,
            tipo_cambio,
            importe_exento,
            importe_exonerado,
            total,
            referencia_exencion,
            pais_destino,
            impuestos,
            lotes,
        } = data;

        return await this.db.transaction().execute(async (trx) => {
            const pais = await this.resolvePais(pais_id, trx);
            this.validateFormatoNumero(numero_completo, pais);
            this.validateAutorizacion(autorizacion, pais);
            await this.validateClienteActivo(cliente_id, trx);
            await this.validateNumeroDisponible(pais.id, numero_completo, trx);
            const lotesFacturables = await this.validateLotesExistenYSonDelCliente(
                lotes.map((l) => l.lote_id),
                cliente_id,
                trx,
            );
            this.validateLotesFinalizados(lotesFacturables);
            await this.validateLotesNoFacturados(
                lotes.map((l) => l.lote_id),
                trx,
            );
            this.validateTotalesCuadran(
                total,
                importe_exento,
                importe_exonerado,
                impuestos,
            );

            const result = await trx
                .insertInto('documentos_fiscales')
                .values({
                    pais_id: pais.id,
                    cliente_id,
                    tipo_documento,
                    numero_completo,
                    autorizacion: autorizacion ?? null,
                    fecha_emision,
                    moneda: moneda ?? pais.moneda,
                    tipo_cambio,
                    importe_exento,
                    importe_exonerado,
                    total,
                    referencia_exencion: referencia_exencion ?? null,
                    pais_destino: pais_destino ?? null,
                    created_by: userId,
                })
                .executeTakeFirstOrThrow(
                    () =>
                        new BadRequestException('Error al registrar el documento fiscal'),
                );

            const documentoId = Number(result.insertId);

            if (impuestos && impuestos.length > 0) {
                await trx
                    .insertInto('documento_fiscal_impuesto')
                    .values(
                        impuestos.map((impuesto) => ({
                            documento_id: documentoId,
                            tarifa: impuesto.tarifa,
                            base_gravada: impuesto.base_gravada,
                            impuesto: impuesto.impuesto,
                        })),
                    )
                    .execute();
            }

            await trx
                .insertInto('documento_fiscal_lote')
                .values(
                    lotes.map((lote) => ({
                        documento_id: documentoId,
                        lote_id: lote.lote_id,
                        cantidad: lote.cantidad,
                        unidad_medida_id: lote.unidad_medida_id ?? null,
                    })),
                )
                .execute();

            return documentoId;
        });
    }

    /**
     * El endpoint de auditoria: la cabecera, su pais, sus impuestos, sus lotes y
     * la trazabilidad de cada lote. Devuelve el documento aunque este anulado —
     * al reves que el SPEC 21 con los pesajes — porque una lectura que existe
     * para auditar no puede esconder justo lo que el auditor busca.
     */
    async getDocumentoFiscalById(documentoId: number) {
        const documento = await this.db
            .selectFrom('documentos_fiscales')
            .innerJoin('clientes', 'clientes.id', 'documentos_fiscales.cliente_id')
            .innerJoin(
                'paises_config',
                'paises_config.id',
                'documentos_fiscales.pais_id',
            )
            .leftJoin(
                'usuarios as anulador',
                'anulador.id',
                'documentos_fiscales.anulado_por',
            )
            .select([
                'documentos_fiscales.id',
                'documentos_fiscales.tipo_documento',
                'documentos_fiscales.numero_completo',
                'documentos_fiscales.autorizacion',
                'documentos_fiscales.fecha_emision',
                'documentos_fiscales.moneda',
                'documentos_fiscales.tipo_cambio',
                'documentos_fiscales.importe_exento',
                'documentos_fiscales.importe_exonerado',
                'documentos_fiscales.total',
                'documentos_fiscales.referencia_exencion',
                'documentos_fiscales.pais_destino',
                'documentos_fiscales.documento_aduanero',
                'documentos_fiscales.archivo_url',
                'documentos_fiscales.cliente_id',
                'clientes.nombre as cliente',
                'clientes.rtn as cliente_rtn',
                'documentos_fiscales.isActive',
                'documentos_fiscales.motivo_anulacion',
                'anulador.complete_name as anulado_por',
                'documentos_fiscales.anulado_en',
                'documentos_fiscales.created_at',
                'paises_config.codigo_pais',
                'paises_config.etiqueta_autorizacion',
                'paises_config.etiqueta_identificacion',
            ])
            .where('documentos_fiscales.id', '=', documentoId)
            .executeTakeFirst();

        if (!documento) {
            throw new NotFoundException(
                `El documento fiscal con id '${documentoId}' no existe`,
            );
        }

        const {
            codigo_pais,
            etiqueta_autorizacion,
            etiqueta_identificacion,
            ...cabecera
        } = documento;

        const impuestos = await this.db
            .selectFrom('documento_fiscal_impuesto')
            .select(['tarifa', 'base_gravada', 'impuesto'])
            .where('documento_id', '=', documentoId)
            .orderBy('tarifa', 'asc')
            .execute();

        const lotes = await this.db
            .selectFrom('documento_fiscal_lote')
            .innerJoin('lotes', 'lotes.id', 'documento_fiscal_lote.lote_id')
            .leftJoin('productos', 'productos.id', 'lotes.producto_id')
            .leftJoin(
                'unidades_medida',
                'unidades_medida.id',
                'lotes.unidad_medida_id',
            )
            .leftJoin(
                'unidades_medida as unidad_facturada',
                'unidad_facturada.id',
                'documento_fiscal_lote.unidad_medida_id',
            )
            .leftJoin('usuarios as aprobador', 'aprobador.id', 'lotes.aprobado_por')
            .leftJoin(
                'usuarios as finalizador',
                'finalizador.id',
                'lotes.finalizado_por',
            )
            .select([
                'documento_fiscal_lote.lote_id',
                'documento_fiscal_lote.cantidad',
                'unidad_facturada.nombre as unidad_medida_facturada',
                'lotes.nombre_lote',
                'lotes.variedad_o_talla',
                'productos.nombre as producto',
                'unidades_medida.nombre as unidad_medida',
                'aprobador.complete_name as aprobado_por',
                'lotes.aprobado_en',
                'finalizador.complete_name as finalizado_por',
                'lotes.finalizado_en',
            ])
            .where('documento_fiscal_lote.documento_id', '=', documentoId)
            .orderBy('documento_fiscal_lote.id', 'asc')
            .execute();

        const resumenPesajes = await this.resumirPesajes(
            lotes.map((lote) => Number(lote.lote_id)),
        );

        return {
            ...cabecera,
            pais: {
                codigo_pais,
                etiqueta_autorizacion,
                etiqueta_identificacion,
            },
            impuestos,
            lotes: lotes.map((lote) => {
                const resumen = resumenPesajes.get(Number(lote.lote_id));
                return {
                    ...lote,
                    pesajes_activos: resumen?.pesajes_activos ?? 0,
                    peso_neto_total: resumen?.peso_neto_total ?? 0,
                };
            }),
        };
    }

    /**
     * El conteo de pesajes activos y la suma de su peso neto, por lote: el
     * respaldo fisico de lo que declara el documento. Una sola consulta
     * agrupada, no una por lote.
     */
    private async resumirPesajes(loteIds: number[]) {
        if (loteIds.length === 0) {
            return new Map<number, { pesajes_activos: number; peso_neto_total: number }>();
        }

        const filas = await this.db
            .selectFrom('pesajes')
            .select((eb) => [
                'pesajes.lote_id',
                eb.fn.count('pesajes.id').as('pesajes_activos'),
                eb.fn.sum('pesajes.peso_neto').as('peso_neto_total'),
            ])
            .where('pesajes.lote_id', 'in', loteIds)
            .where('pesajes.isActive', '=', 1)
            .groupBy('pesajes.lote_id')
            .execute();

        return new Map(
            filas.map((fila) => [
                Number(fila.lote_id),
                {
                    pesajes_activos: Number(fila.pesajes_activos),
                    peso_neto_total: Number(fila.peso_neto_total ?? 0),
                },
            ]),
        );
    }

    /**
     * La unica escritura del modulo que no es de auditoria ni de ciclo de vida:
     * el documento aduanero llega despues de la factura, cuando cierra aduana.
     * Cada campo se escribe una sola vez.
     */
    async completarDocumentoFiscal(
        documentoId: number,
        data: CompletarDocumentoFiscalDto,
    ) {
        const { documento_aduanero, archivo_url } = data;

        return await this.db.transaction().execute(async (trx) => {
            const documento = await this.validateDocumentoActivo(documentoId, trx);
            this.validateCampoDisponible(
                documento,
                'documento_aduanero',
                documento_aduanero,
            );
            this.validateCampoDisponible(documento, 'archivo_url', archivo_url);

            await trx
                .updateTable('documentos_fiscales')
                .set({
                    ...(documento_aduanero !== undefined ? { documento_aduanero } : {}),
                    ...(archivo_url !== undefined ? { archivo_url } : {}),
                })
                .where('id', '=', documentoId)
                .execute();

            return true;
        });
    }

    /**
     * Anulacion logica. NO borra las filas hijas: se anula el documento, no se
     * destruye la evidencia. Como validateLotesNoFacturados filtra isActive = 1,
     * anular libera los lotes — pero no el numero, que el UNIQUE sigue ocupando.
     */
    async anularDocumentoFiscal(
        documentoId: number,
        data: AnularDocumentoFiscalDto,
        userId: number,
    ) {
        const { motivo } = data;

        return await this.db.transaction().execute(async (trx) => {
            await this.validateDocumentoActivo(documentoId, trx);

            await trx
                .updateTable('documentos_fiscales')
                .set({
                    isActive: 0,
                    motivo_anulacion: motivo,
                    anulado_por: userId,
                    anulado_en: sql<Date>`NOW()`,
                })
                .where('id', '=', documentoId)
                .execute();

            return true;
        });
    }

    private async validateDocumentoActivo(
        documentoId: number,
        db: Kysely<Database>,
    ) {
        const documento = await db
            .selectFrom('documentos_fiscales')
            .select([
                'id',
                'numero_completo',
                'isActive',
                'documento_aduanero',
                'archivo_url',
            ])
            .where('id', '=', documentoId)
            .executeTakeFirstOrThrow(
                () =>
                    new BadRequestException(
                        `El documento fiscal con id '${documentoId}' no existe`,
                    ),
            );

        if (!documento.isActive) {
            throw new BadRequestException(
                `El documento '${documento.numero_completo}' ya fue anulado`,
            );
        }

        return documento;
    }

    private validateCampoDisponible(
        documento: {
            numero_completo: string;
            documento_aduanero: string | null;
            archivo_url: string | null;
        },
        campo: 'documento_aduanero' | 'archivo_url',
        valor: string | undefined,
    ) {
        if (valor === undefined) return;

        if (documento[campo] !== null) {
            throw new BadRequestException(
                `El campo ${campo} del documento '${documento.numero_completo}' ya fue completado`,
            );
        }
    }

    /**
     * Con pais_id resuelve esa fila; sin el, el unico pais activo. Con dos o
     * mas activos exige el campo en vez de elegir en silencio.
     */
    private async resolvePais(
        paisId: number | undefined,
        db: Kysely<Database>,
    ): Promise<PaisConfig> {
        const columnas = [
            'id',
            'nombre',
            'moneda',
            'patron_numero',
            'patron_autorizacion',
            'requiere_autorizacion',
            'isActive',
        ] as const;

        if (paisId !== undefined) {
            const pais = await db
                .selectFrom('paises_config')
                .select(columnas)
                .where('id', '=', paisId)
                .executeTakeFirstOrThrow(
                    () =>
                        new BadRequestException(`El pais con id '${paisId}' no existe`),
                );

            if (!pais.isActive) {
                throw new BadRequestException(`El pais '${pais.nombre}' no esta activo`);
            }

            return pais;
        }

        const activos = await db
            .selectFrom('paises_config')
            .select(columnas)
            .where('isActive', '=', 1)
            .limit(2)
            .execute();

        if (activos.length === 0) {
            throw new BadRequestException(
                'No hay ningun pais activo configurado en paises_config',
            );
        }

        if (activos.length > 1) {
            throw new BadRequestException(
                'Hay mas de un pais activo: el campo pais_id es requerido',
            );
        }

        return activos[0];
    }

    /**
     * El formato del numero depende del pais, asi que se valida aqui y no en el
     * DTO: Zod no consulta la base. patron_numero en NULL significa no validar.
     */
    private validateFormatoNumero(numeroCompleto: string, pais: PaisConfig) {
        if (pais.patron_numero === null) return;

        if (!this.coincide(numeroCompleto, pais.patron_numero, 'patron_numero')) {
            throw new BadRequestException(
                `El numero '${numeroCompleto}' no tiene el formato que exige ${pais.nombre}`,
            );
        }
    }

    private validateAutorizacion(
        autorizacion: string | undefined,
        pais: PaisConfig,
    ) {
        if (!pais.requiere_autorizacion) return;

        if (autorizacion === undefined) {
            throw new BadRequestException(
                `El campo autorizacion es requerido para ${pais.nombre}`,
            );
        }

        if (
            pais.patron_autorizacion !== null &&
            !this.coincide(autorizacion, pais.patron_autorizacion, 'patron_autorizacion')
        ) {
            throw new BadRequestException(
                `La autorizacion '${autorizacion}' no tiene el formato que exige ${pais.nombre}`,
            );
        }
    }

    /**
     * Los patrones se siembran a mano en paises_config, asi que uno mal escrito
     * es un 400 con nombre y no un 500 sin explicacion.
     */
    private coincide(valor: string, patron: string, columna: string) {
        try {
            return new RegExp(patron).test(valor);
        } catch {
            throw new BadRequestException(
                `El ${columna} configurado para este pais no es una expresion regular valida`,
            );
        }
    }

    private async validateClienteActivo(
        clienteId: number,
        db: Kysely<Database>,
    ) {
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

    /**
     * No filtra isActive: el UNIQUE (pais_id, numero_completo) tampoco lo hace,
     * asi que anular un documento no libera su numero. Esto solo da el mensaje
     * legible antes de que MySQL responda con el error de la restriccion.
     */
    private async validateNumeroDisponible(
        paisId: number,
        numeroCompleto: string,
        db: Kysely<Database>,
    ) {
        const existente = await db
            .selectFrom('documentos_fiscales')
            .select('id')
            .where('pais_id', '=', paisId)
            .where('numero_completo', '=', numeroCompleto)
            .executeTakeFirst();

        if (existente) {
            throw new BadRequestException(
                `El documento '${numeroCompleto}' ya esta registrado para este pais`,
            );
        }
    }

    private async validateLotesExistenYSonDelCliente(
        loteIds: number[],
        clienteId: number,
        db: Kysely<Database>,
    ): Promise<LoteFacturable[]> {
        const lotes = await db
            .selectFrom('lotes')
            .select(['id', 'nombre_lote', 'cliente_id', 'finalizado_por'])
            .where('id', 'in', loteIds)
            .execute();

        const encontrados = new Set(lotes.map((lote) => Number(lote.id)));
        const faltante = loteIds.find((id) => !encontrados.has(id));

        if (faltante !== undefined) {
            throw new BadRequestException(`El lote con id '${faltante}' no existe`);
        }

        const ajeno = lotes.find((lote) => lote.cliente_id !== clienteId);

        if (ajeno) {
            throw new BadRequestException(
                `El lote '${ajeno.nombre_lote}' no pertenece al cliente con id '${clienteId}'`,
            );
        }

        return lotes;
    }

    /**
     * No mira motivo_rechazo: el SPEC 20 congela el lote al finalizarlo, asi que
     * finalizado_por IS NOT NULL ya implica que no esta rechazado.
     */
    private validateLotesFinalizados(lotes: LoteFacturable[]) {
        const sinFinalizar = lotes.find((lote) => lote.finalizado_por === null);

        if (sinFinalizar) {
            throw new BadRequestException(
                `El lote '${sinFinalizar.nombre_lote}' no esta finalizado`,
            );
        }
    }

    /**
     * Filtra isActive = 1, asi que anular un documento libera sus lotes para
     * volver a facturarlos en el documento correcto.
     */
    private async validateLotesNoFacturados(
        loteIds: number[],
        db: Kysely<Database>,
    ) {
        const facturado = await db
            .selectFrom('documento_fiscal_lote')
            .innerJoin(
                'documentos_fiscales',
                'documentos_fiscales.id',
                'documento_fiscal_lote.documento_id',
            )
            .select([
                'documento_fiscal_lote.lote_id',
                'documentos_fiscales.numero_completo',
            ])
            .where('documento_fiscal_lote.lote_id', 'in', loteIds)
            .where('documentos_fiscales.isActive', '=', 1)
            .executeTakeFirst();

        if (facturado) {
            throw new BadRequestException(
                `El lote con id '${facturado.lote_id}' ya esta facturado en el documento '${facturado.numero_completo}'`,
            );
        }
    }

    /**
     * Compara en centavos para no arrastrar el error del punto flotante. La
     * tolerancia es de un centavo, por el redondeo del documento impreso.
     */
    private validateTotalesCuadran(
        total: number,
        importeExento: number,
        importeExonerado: number,
        impuestos: { base_gravada: number; impuesto: number }[] | undefined,
    ) {
        const centavos = (valor: number) => Math.round(valor * 100);

        const sumaImpuestos = (impuestos ?? []).reduce(
            (acumulado, fila) =>
                acumulado + centavos(fila.base_gravada) + centavos(fila.impuesto),
            0,
        );

        const esperado =
            centavos(importeExento) + centavos(importeExonerado) + sumaImpuestos;

        if (Math.abs(esperado - centavos(total)) > 1) {
            throw new BadRequestException(
                `El total no cuadra con la suma de importes: se esperaba ${(esperado / 100).toFixed(2)} y se recibio ${total.toFixed(2)}`,
            );
        }
    }
}
