import { DatabaseService } from 'src/database/database.service';
import { Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class PermisosRepository {
    constructor(private readonly dbService: DatabaseService) { }

    get db() {
        return this.dbService.client;
    }

    async getPermisosByUsuarioId(usuarioId: number): Promise<string[]> {
        const usuario = await this.db
            .selectFrom('usuarios')
            .select('rol_id')
            .where('id', '=', usuarioId)
            .executeTakeFirstOrThrow(
                () => new NotFoundException('Usuario no encontrado'),
            );

        const permisos = await this.db
            .selectFrom('permisos')
            .innerJoin(
                'catalogo_permisos',
                'catalogo_permisos.id',
                'permisos.permiso_id',
            )
            .select('catalogo_permisos.codigo')
            .where('permisos.rol_id', '=', usuario.rol_id)
            .where('permisos.isActive', '=', 1)
            .where('catalogo_permisos.isActive', '=', 1)
            .execute();

        return permisos.map((permiso) => permiso.codigo);
    }
}
