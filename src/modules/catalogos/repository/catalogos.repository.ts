import { DatabaseService } from 'src/database/database.service';
import { Injectable } from '@nestjs/common';
import { FiltrosUsuariosDto } from '../dto/filtros-usuarios.dto';

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

    async getUsuarios(filtros: FiltrosUsuariosDto) {
        let query = this.db
            .selectFrom('usuarios')
            .innerJoin('roles', 'roles.id', 'usuarios.rol_id')
            .select([
                'usuarios.id',
                'usuarios.complete_name as nombre',
                'usuarios.cedula',
                'roles.nombre as rol',
            ])
            .where('usuarios.isActive', '=', 1);

        if (filtros.nombre !== undefined) {
            query = query.where('usuarios.complete_name', 'like', `%${filtros.nombre}%`);
        }
        if (filtros.cedula !== undefined) {
            query = query.where('usuarios.cedula', '=', filtros.cedula);
        }
        if (filtros.rol_id !== undefined) {
            query = query.where('usuarios.rol_id', '=', filtros.rol_id);
        }

        const usuarios = await query
            .orderBy('usuarios.complete_name', 'asc')
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

    async getEstadosCalidad() {
        const estados = await this.db
            .selectFrom('estados_calidad')
            .select(['id', 'nombre'])
            .orderBy('id', 'asc')
            .execute();
        return estados;
    }

    async getOrigenes() {
        const origenes = await this.db
            .selectFrom('origenes')
            .select(['id', 'nombre'])
            .where('isActive', '=', 1)
            .orderBy('nombre', 'asc')
            .execute();
        return origenes;
    }

    async getDestinos() {
        const destinos = await this.db
            .selectFrom('destinos')
            .select(['id', 'nombre'])
            .where('isActive', '=', 1)
            .orderBy('nombre', 'asc')
            .execute();
        return destinos;
    }

    async getRoles() {
        const roles = await this.db
            .selectFrom('roles')
            .select(['id', 'nombre'])
            .orderBy('nombre', 'asc')
            .execute();
        return roles;
    }
}
