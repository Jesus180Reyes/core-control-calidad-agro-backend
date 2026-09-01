import { DatabaseService } from 'src/database/database.service';
import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateClienteDto } from '../dto/create-cliente.dto';
import { Kysely } from 'kysely';
import { Database } from 'src/database/types/types';

@Injectable()
export class ClientesRepository {
    constructor(private readonly dbService: DatabaseService) { }

    get db() {
        return this.dbService.client;
    }

    async getAllClientesByOperador(usuarioId: number) {
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
                'clientes.codigo_exportacion',
                'clientes.telefono',
                'clientes.direccion_planta',
            ])
            .where('cliente_operador.usuario_id', '=', usuarioId)
            .where('clientes.isActive', '=', 1)
            .orderBy('clientes.nombre', 'asc')
            .execute();
        return clientes;
    }

    async getAllClientes() {
        const clientes = await this.db
            .selectFrom('clientes')
            .leftJoin('productos', 'productos.id', 'clientes.producto_id')
            .select([
                'clientes.id',
                'clientes.nombre',
                'productos.nombre as producto',
                'clientes.codigo_exportacion',
                'clientes.telefono',
                'clientes.direccion_planta',
            ])
            .where('clientes.isActive', '=', 1)
            .orderBy('clientes.created_at', 'asc')
            .execute();
        return clientes;
    }

    async createCliente(data: CreateClienteDto, userId: number) {
        const {
            nombre,
            rtn,
            producto_id,
            codigo_exportacion,
            correo_contacto,
            telefono,
            direccion_planta,
            ubicacionLongitud,
            ubicacionLatitude,
            usuario_ids,
        } = data;

        return await this.db.transaction().execute(async (trx) => {
            await this.validateRtnDisponible(rtn, trx);
            await this.validateCodigoExportacionDisponible(codigo_exportacion, trx);
            await this.validateProducto(producto_id, trx);

            const result = await trx
                .insertInto('clientes')
                .values({
                    nombre,
                    rtn,
                    producto_id,
                    codigo_exportacion,
                    correo_contacto,
                    telefono,
                    direccion_planta,
                    ubicacionLongitud,
                    ubicacionLatitude,
                    created_by: userId,
                })
                .executeTakeFirstOrThrow(
                    () => new BadRequestException('Error al crear el cliente'),
                );

            const clienteId = Number(result.insertId);
            await this.linkOperadores(clienteId, usuario_ids, trx);
            return clienteId;
        });
    }

    private async linkOperadores(
        clienteId: number,
        usuarioIds: number[],
        db: Kysely<Database>,
    ) {
        await db
            .insertInto('cliente_operador')
            .values(
                usuarioIds.map((usuarioId) => ({
                    cliente_id: clienteId,
                    usuario_id: usuarioId,
                })),
            )
            .execute();
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

    private async validateRtnDisponible(rtn: string, db: Kysely<Database>) {
        const existente = await db
            .selectFrom('clientes')
            .select('id')
            .where('rtn', '=', rtn)
            .where('isActive', '=', 1)
            .executeTakeFirst();

        if (existente) {
            throw new BadRequestException(`El RTN '${rtn}' ya esta registrado`);
        }
    }

    private async validateCodigoExportacionDisponible(
        codigoExportacion: string,
        db: Kysely<Database>,
    ) {
        const existente = await db
            .selectFrom('clientes')
            .select('id')
            .where('codigo_exportacion', '=', codigoExportacion)
            .where('isActive', '=', 1)
            .executeTakeFirst();

        if (existente) {
            throw new BadRequestException(
                `El codigo de exportacion '${codigoExportacion}' ya esta registrado`,
            );
        }
    }

    private async validateClienteActivo(clienteId: number, db: Kysely<Database>) {
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
                `El cliente con id '${clienteId}' ya fue rechazado`,
            );
        }

        return cliente;
    }
}
