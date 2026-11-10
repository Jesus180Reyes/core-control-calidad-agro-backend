import { DatabaseService } from 'src/database/database.service';
import { Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class ParametrosRepository {
    constructor(private readonly dbService: DatabaseService) { }

    get db() {
        return this.dbService.client;
    }

    async obtenerParametro(nombre: string) {
        const parametro = await this.db
            .selectFrom('parametros')
            .select(['clave', 'valor'])
            .where('clave', '=', nombre)
            .where('isActive', '=', 1)
            .executeTakeFirst();

        if (!parametro) {
            throw new NotFoundException('Parametro no encontrado');
        }

        return parametro;
    }
}
