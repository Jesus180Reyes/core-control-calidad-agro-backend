import { Injectable } from '@nestjs/common';
import { CatalogosRepository } from './repository/catalogos.repository';
import { FiltrosUsuariosDto } from './dto/filtros-usuarios.dto';

@Injectable()
export class CatalogosService {
    constructor(private readonly catalogosRepository: CatalogosRepository) { }

    async findProductos() {
        return await this.catalogosRepository.getProductos();
    }

    async findUsuarios(filtros: FiltrosUsuariosDto) {
        return await this.catalogosRepository.getUsuarios(filtros);
    }

    async findOperadores() {
        return await this.catalogosRepository.getOperadores();
    }

    async findUnidadesMedida() {
        return await this.catalogosRepository.getUnidadesMedida();
    }

    async findEstadosCalidad() {
        return await this.catalogosRepository.getEstadosCalidad();
    }

    async findOrigenes() {
        return await this.catalogosRepository.getOrigenes();
    }

    async findDestinos() {
        return await this.catalogosRepository.getDestinos();
    }

    async findRoles() {
        return await this.catalogosRepository.getRoles();
    }
}
