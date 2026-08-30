import { Injectable } from '@nestjs/common';
import { CatalogosRepository } from './repository/catalogos.repository';

@Injectable()
export class CatalogosService {
    constructor(private readonly catalogosRepository: CatalogosRepository) { }

    async findProductos() {
        return await this.catalogosRepository.getProductos();
    }

    async findUsuarios() {
        return await this.catalogosRepository.getUsuarios();
    }

    async findUnidadesMedida() {
        return await this.catalogosRepository.getUnidadesMedida();
    }
}
