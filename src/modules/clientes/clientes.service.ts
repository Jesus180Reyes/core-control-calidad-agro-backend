import { Injectable } from '@nestjs/common';
import { ClientesRepository } from './repository/clientes.repository';
import { CreateClienteDto } from './dto/create-cliente.dto';

@Injectable()
export class ClientesService {
    constructor(private readonly clientesRepository: ClientesRepository) { }

    async findAll(userId: number) {
        return await this.clientesRepository.getAllClientesByOperador(userId);
    }

    async findAllGlobal() {
        return await this.clientesRepository.getAllClientes();
    }


    async create(dto: CreateClienteDto, userId: number) {
        return await this.clientesRepository.createCliente(dto, userId);
    }
}
