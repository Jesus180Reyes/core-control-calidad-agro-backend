import { DatabaseService } from 'src/database/database.service';
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Database } from 'src/database/types/types';
import { CreatePesajeDto } from '../dto/create-pesaje.dto';
import { RechazarPesajeDto } from '../dto/rechazar-pesaje.dto';
import { FiltrosPesajesLoteDto } from '../dto/filtros-pesajes-lote.dto';
import { FiltrosHistorialDto } from '../dto/filtros-historial.dto';

@Injectable()
export class PesajesRepository {
    constructor(private readonly dbService: DatabaseService) { }

    get db() {
        return this.dbService.client;
    }

    async getPesajesByLote(loteId: number, filtros: FiltrosPesajesLoteDto) {
        let query = this.db
            .selectFrom('pesajes')
            .leftJoin(
                'estados_calidad',
                'estados_calidad.id',
                'pesajes.estado_calidad_id',
            )
            .leftJoin('usuarios', 'usuarios.id', 'pesajes.usuario_id')
            .select([
                'pesajes.id',
                'pesajes.lote_id',
                'pesajes.peso_bruto',
                'pesajes.tara',
                'pesajes.peso_neto',
                'pesajes.fuera_de_rango',
                'estados_calidad.codigo as estado_calidad_codigo',
                'estados_calidad.nombre as estado_calidad',
                'usuarios.complete_name as usuario',
                'pesajes.dispositivo_identificador',
                'pesajes.secuencia_dispositivo',
                'pesajes.created_at',
            ])
            .where('pesajes.lote_id', '=', loteId)
            .where('pesajes.isActive', '=', 1);

        if (filtros.usuario_id !== undefined) {
            query = query.where('pesajes.usuario_id', '=', filtros.usuario_id);
        }

        if (filtros.estado_calidad_id !== undefined) {
            query = query.where(
                'pesajes.estado_calidad_id',
                '=',
                filtros.estado_calidad_id,
            );
        }

        if (filtros.fuera_de_rango !== undefined) {
            query = query.where(
                'pesajes.fuera_de_rango',
                '=',
                sql<boolean>`${filtros.fuera_de_rango}`,
            );
        }

        if (filtros.nombre !== undefined) {
            query = query.where(
                'usuarios.complete_name',
                'like',
                `%${filtros.nombre}%`,
            );
        }

        if (filtros.desde !== undefined) {
            query = query.where('pesajes.created_at', '>=', filtros.desde);
        }

        if (filtros.hasta !== undefined) {
            query = query.where(
                'pesajes.created_at',
                '<',
                sql<Date>`DATE_ADD(${filtros.hasta}, INTERVAL 1 DAY)`,
            );
        }

        const pesajes = await query
            .orderBy('pesajes.created_at', 'desc')
            .execute();

        return pesajes;
    }

    async getHistorialByUsuario(userId: number, filtros: FiltrosHistorialDto) {
        let query = this.db
            .selectFrom('pesajes')
            .leftJoin(
                'estados_calidad',
                'estados_calidad.id',
                'pesajes.estado_calidad_id',
            )
            .leftJoin('lotes', 'lotes.id', 'pesajes.lote_id')
            .leftJoin('clientes', 'clientes.id', 'lotes.cliente_id')
            .leftJoin('unidades_medida', 'unidades_medida.id', 'lotes.unidad_medida_id')
            .select([
                'pesajes.id',
                'pesajes.lote_id',
                'lotes.nombre_lote as nombre_lote',
                'unidades_medida.nombre as unidad_medida',
                'clientes.nombre as cliente',
                'pesajes.peso_bruto',
                'pesajes.tara',
                'pesajes.peso_neto',
                'pesajes.fuera_de_rango',
                'estados_calidad.codigo as estado_calidad_codigo',
                'estados_calidad.nombre as estado_calidad',
                'pesajes.dispositivo_identificador',
                'pesajes.secuencia_dispositivo',
                'pesajes.created_at',
            ])
            .where('pesajes.usuario_id', '=', userId)
            .where('pesajes.isActive', '=', 1);

        if (filtros.lote_id !== undefined) {
            query = query.where('pesajes.lote_id', '=', filtros.lote_id);
        }

        if (filtros.cliente_id !== undefined) {
            query = query.where('lotes.cliente_id', '=', filtros.cliente_id);
        }

        if (filtros.estado_calidad_id !== undefined) {
            query = query.where(
                'pesajes.estado_calidad_id',
                '=',
                filtros.estado_calidad_id,
            );
        }

        if (filtros.fuera_de_rango !== undefined) {
            query = query.where(
                'pesajes.fuera_de_rango',
                '=',
                sql<boolean>`${filtros.fuera_de_rango}`,
            );
        }

        if (filtros.nombre !== undefined) {
            query = query.where(
                'lotes.nombre_lote',
                'like',
                `%${filtros.nombre}%`,
            );
        }

        if (filtros.desde !== undefined) {
            query = query.where('pesajes.created_at', '>=', filtros.desde);
        }

        if (filtros.hasta !== undefined) {
            query = query.where(
                'pesajes.created_at',
                '<',
                sql<Date>`DATE_ADD(${filtros.hasta}, INTERVAL 1 DAY)`,
            );
        }

        const pesajes = await query
            .orderBy('pesajes.created_at', 'desc')
            .execute();

        return pesajes;
    }

    async createPesaje(data: CreatePesajeDto, userId: number) {
        const {
            lote_id,
            peso_bruto,
            tara,
            dispositivo_identificador,
            secuencia_dispositivo,
        } = data;

        return await this.db.transaction().execute(async (trx) => {
            const lote = await this.validateLoteAbierto(lote_id, trx);
            await this.validateVinculoOperador(lote.cliente_id, userId, trx);

            const peso_neto = peso_bruto - tara;
            const fuera_de_rango =
                peso_neto < Number(lote.peso_minimo) ||
                peso_neto > Number(lote.peso_maximo);

            const estadoCalidad = await this.resolveEstadoCalidad(
                peso_neto,
                lote,
                trx,
            );

            const result = await trx
                .insertInto('pesajes')
                .values({
                    lote_id,
                    usuario_id: userId,
                    estado_calidad_id: estadoCalidad.id,
                    peso_bruto,
                    peso_neto,
                    tara,
                    dispositivo_identificador,
                    secuencia_dispositivo,
                    fuera_de_rango,
                })
                .executeTakeFirstOrThrow(
                    () => new BadRequestException('Error al guardar el pesaje'),
                );

            return {
                id: Number(result.insertId),
                peso_neto,
                fuera_de_rango,
            };
        });
    }

    async rechazarPesaje(
        pesajeId: number,
        data: RechazarPesajeDto,
        userId: number,
    ) {
        const { motivo } = data;

        return await this.db.transaction().execute(async (trx) => {
            const pesaje = await this.validatePesajeActivo(pesajeId, trx);

            if (pesaje.lote_id === null) {
                throw new BadRequestException(
                    `El pesaje con id '${pesajeId}' no tiene un lote asociado`,
                );
            }

            await this.validateLoteAbierto(pesaje.lote_id, trx);

            await trx
                .updateTable('pesajes')
                .set({
                    isActive: 0,
                    motivo_rechazo: motivo,
                    rechazado_por: userId,
                    rechazado_en: sql<Date>`NOW()`,
                })
                .where('id', '=', pesajeId)
                .execute();

            return true;
        });
    }

    private async validateLote(loteId: number, db: Kysely<Database>) {
        return await db
            .selectFrom('lotes')
            .select(['id', 'nombre_lote', 'cliente_id'])
            .where('id', '=', loteId)
            .executeTakeFirstOrThrow(
                () => new BadRequestException(`El lote con id '${loteId}' no existe`),
            );
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
                'peso_minimo',
                'peso_maximo',
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

    private async validatePesajeActivo(pesajeId: number, db: Kysely<Database>) {
        const pesaje = await db
            .selectFrom('pesajes')
            .select(['id', 'lote_id', 'isActive'])
            .where('id', '=', pesajeId)
            .executeTakeFirstOrThrow(
                () =>
                    new BadRequestException(
                        `El pesaje con id '${pesajeId}' no existe`,
                    ),
            );

        if (pesaje.isActive === 0) {
            throw new BadRequestException(
                `El pesaje con id '${pesajeId}' ya fue rechazado`,
            );
        }

        return pesaje;
    }

    private async resolveEstadoCalidad(
        pesoNeto: number,
        lote: { peso_minimo: string | number; peso_maximo: string | number },
        db: Kysely<Database>,
    ) {
        const pesoMinimo = Number(lote.peso_minimo);
        const pesoMaximo = Number(lote.peso_maximo);

        const codigo = this.resolveCodigoEstadoCalidad(
            pesoNeto,
            pesoMinimo,
            pesoMaximo,
        );

        return await db
            .selectFrom('estados_calidad')
            .select(['id', 'codigo'])
            .where('codigo', '=', codigo)
            .executeTakeFirstOrThrow(
                () =>
                    new BadRequestException(
                        `El estado de calidad con codigo '${codigo}' no existe`,
                    ),
            );
    }

    private resolveCodigoEstadoCalidad(
        pesoNeto: number,
        pesoMinimo: number,
        pesoMaximo: number,
    ) {
        if (pesoNeto < pesoMinimo) {
            return 'MINIMO';
        }

        if (pesoNeto > pesoMaximo) {
            return 'MAXIMO';
        }

        return 'IDEAL';
    }
}
