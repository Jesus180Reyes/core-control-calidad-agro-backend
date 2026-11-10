import { DatabaseService } from 'src/database/database.service';
import { Injectable, NotFoundException } from '@nestjs/common';

const CLAVE_APP = 'APP_NOMBRE';
const CLAVE_EMPRESA = 'EMPRESA_NOMBRE_COMERCIAL';

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

    async obtenerInfoPublica() {
        const filas = await this.db
            .selectFrom('parametros')
            .select(['clave', 'valor'])
            .where('clave', 'in', [CLAVE_APP, CLAVE_EMPRESA])
            .where('isActive', '=', 1)
            .execute();

        const valorDe = (clave: string) =>
            filas.find((fila) => fila.clave === clave)?.valor ?? null;

        return {
            app: valorDe(CLAVE_APP),
            empresa: valorDe(CLAVE_EMPRESA),
        };
    }
}
