import { DatabaseService } from "src/database/database.service";
import { Injectable } from "@nestjs/common";

@Injectable()
export class ClientesRepository {
    constructor(
        private readonly dbService: DatabaseService,
    ) { }

    get db() {
        return this.dbService.client;
    }

    async getAllClientes() {
        const clientes = await this.db
            .selectFrom('clientes')
            .selectAll()
            .where('isActive', '=', 1)
            .orderBy('nombre', 'asc')
            .execute();
        return clientes;
    }

    async getClienteById(id: number) {
        const cliente = await this.db
            .selectFrom('clientes')
            .selectAll()
            .where('id', '=', id)
            .where('isActive', '=', 1)
            .executeTakeFirstOrThrow();


        return cliente;
    }
}
