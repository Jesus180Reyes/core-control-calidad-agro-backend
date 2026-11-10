import { Injectable } from '@nestjs/common';
import { ParametrosRepository } from './repository/parametros.repository';

@Injectable()
export class ParametrosService {
    constructor(private readonly parametrosRepository: ParametrosRepository) { }

    async obtener(nombre: string) {
        return await this.parametrosRepository.obtenerParametro(nombre);
    }
}
