import { DatabaseService } from 'src/database/database.service';
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Kysely } from 'kysely';
import { Database } from 'src/database/types/types';
import { CreateLoteDto } from '../dto/create-lote.dto';

@Injectable()
export class LotesRepository {
    constructor(private readonly dbService: DatabaseService) { }

    get db() {
        return this.dbService.client;
    }

    async getLotesByCliente(clienteId: number, usuarioId: number) {
        await this.validateVinculoOperador(clienteId, usuarioId, this.db);

        const lotes = await this.db
            .selectFrom('lotes')
            .leftJoin('productos', 'productos.id', 'lotes.producto_id')
            .leftJoin('unidades_medida', 'unidades_medida.id', 'lotes.unidad_medida_id')
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
                'lotes.created_at',
            ])
            .where('lotes.cliente_id', '=', clienteId)
            .orderBy('lotes.created_at', 'desc')
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
                    created_by: userId,
                })
                .executeTakeFirstOrThrow(
                    () => new BadRequestException('Error al crear el lote'),
                );

            return Number(result.insertId);
        });
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
            .executeTakeFirst();

        if (existente) {
            throw new BadRequestException(
                `El lote '${nombreLote}' ya esta registrado para este cliente`,
            );
        }
    }
}
