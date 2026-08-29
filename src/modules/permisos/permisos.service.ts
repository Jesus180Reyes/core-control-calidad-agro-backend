import { Injectable } from '@nestjs/common';
import { PermisosRepository } from './repository/permisos.repository';

@Injectable()
export class PermisosService {
    constructor(private readonly permisosRepository: PermisosRepository) { }

    async findMisPermisos(userId: number) {
        return await this.permisosRepository.getPermisosByUsuarioId(userId);
    }
}
