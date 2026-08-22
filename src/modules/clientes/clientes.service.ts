import { Injectable } from '@nestjs/common';
import { ClientesRepository } from './repository/clientes.repository';

@Injectable()
export class ClientesService {
    constructor(private readonly clientesRepository: ClientesRepository) { }

    async findAll() {
        return await this.clientesRepository.getAllClientes();
    }

    async findOne(id: number) {
        return await this.clientesRepository.getClienteById(id);
    }
}
