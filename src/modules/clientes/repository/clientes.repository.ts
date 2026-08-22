import { DatabaseService } from "src/database/database.service";
import { Injectable } from "@nestjs/common";
import { CreateClienteDto } from "../dto/create-cliente.dto";

@Injectable()
export class ClientesRepository {
    constructor(
        private readonly dbService: DatabaseService,
    ) { }

    get db() {
        return this.dbService.client;
    }

    async getAllClientesByOperador(usuarioId: number) {
        const clientes = await this.db
            .selectFrom('clientes')
            .innerJoin('cliente_operador', 'cliente_operador.cliente_id', 'clientes.id')
            .select([
                'clientes.id',
                'clientes.nombre',
                'clientes.rtn',
                'clientes.codigo_exportacion',
                'clientes.correo_contacto',
                'clientes.telefono',
                'clientes.direccion_planta',
                'clientes.ubicacionLongitud',
                'clientes.ubicacionLatitude',
            ])
            .where('cliente_operador.usuario_id', '=', usuarioId)
            .where('clientes.isActive', '=', 1)
            .orderBy('clientes.nombre', 'asc')
            .execute();
        return clientes;
    }



    async createCliente(data: CreateClienteDto, userId: number) {
        const {
            nombre,
            rtn,
            codigo_exportacion,
            correo_contacto,
            telefono,
            direccion_planta,
            ubicacionLongitud,
            ubicacionLatitude,
        } = data;

        const result = await this.db
            .insertInto('clientes')
            .values({
                nombre,
                rtn,
                codigo_exportacion,
                correo_contacto,
                telefono,
                direccion_planta,
                ubicacionLongitud,
                ubicacionLatitude,
                created_by: userId,
            })
            .executeTakeFirstOrThrow();

        return Number(result.insertId);
    }

    async linkOperadores(clienteId: number, usuarioIds: number[]) {
        await this.db
            .insertInto('cliente_operador')
            .values(
                usuarioIds.map((usuarioId) => ({
                    cliente_id: clienteId,
                    usuario_id: usuarioId,
                })),
            )
            .execute();
    }
}
