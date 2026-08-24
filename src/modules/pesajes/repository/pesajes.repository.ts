import { DatabaseService } from 'src/database/database.service';
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Kysely } from 'kysely';
import { Database } from 'src/database/types/types';
import { CreatePesajeDto } from '../dto/create-pesaje.dto';

@Injectable()
export class PesajesRepository {
    constructor(private readonly dbService: DatabaseService) { }

    get db() {
        return this.dbService.client;
    }

    async createPesaje(data: CreatePesajeDto, userId: number) {
        const {
            lote_id,
            estado_calidad_id,
            peso_bruto,
            tara,
            dispositivo_identificador,
            secuencia_dispositivo,
        } = data;

        return await this.db.transaction().execute(async (trx) => {
            const lote = await this.validateLoteAbierto(lote_id, trx);
            await this.validateVinculoOperador(lote.cliente_id, userId, trx);
            await this.validateEstadoCalidad(estado_calidad_id, trx);

            const peso_neto = peso_bruto - tara;
            const fuera_de_rango =
                peso_neto < Number(lote.peso_minimo) ||
                peso_neto > Number(lote.peso_maximo);

            const result = await trx
                .insertInto('pesajes')
                .values({
                    lote_id,
                    usuario_id: userId,
                    estado_calidad_id,
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

    private async validateEstadoCalidad(
        estadoCalidadId: number,
        db: Kysely<Database>,
    ) {
        return await db
            .selectFrom('estados_calidad')
            .select(['id', 'nombre'])
            .where('id', '=', estadoCalidadId)
            .executeTakeFirstOrThrow(
                () =>
                    new BadRequestException(
                        `El estado de calidad con id '${estadoCalidadId}' no existe`,
                    ),
            );
    }
}
