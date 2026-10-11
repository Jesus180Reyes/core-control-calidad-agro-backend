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

    async getOperadores() {
        const operadores = await this.db
            .selectFrom('usuarios')
            .innerJoin('roles', 'roles.id', 'usuarios.rol_id')
            .select(['usuarios.id', 'usuarios.complete_name as nombre'])
            .where('usuarios.isActive', '=', 1)
            .where('roles.nombre', '=', 'OPERADOR')
            .orderBy('usuarios.complete_name', 'asc')
            .execute();
        return operadores;
    }

    async getUnidadesMedida() {
        const unidades = await this.db
            .selectFrom('unidades_medida')
            .select(['id', 'nombre'])
            .orderBy('nombre', 'asc')
            .execute();
        return unidades;
    }
}
