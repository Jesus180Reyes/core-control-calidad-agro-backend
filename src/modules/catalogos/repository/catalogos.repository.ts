import { DatabaseService } from 'src/database/database.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class CatalogosRepository {
    constructor(private readonly dbService: DatabaseService) { }

    get db() {
        return this.dbService.client;
    }

    async getProductos() {
        const productos = await this.db
            .selectFrom('productos')
            .select(['id', 'nombre'])
            .where('isActive', '=', 1)
            .orderBy('nombre', 'asc')
            .execute();
        return productos;
    }

    async getUsuarios() {
        const usuarios = await this.db
            .selectFrom('usuarios')
            .select(['id', 'complete_name as nombre'])
            .where('isActive', '=', 1)
            .orderBy('complete_name', 'asc')
            .execute();
        return usuarios;
    }
}
