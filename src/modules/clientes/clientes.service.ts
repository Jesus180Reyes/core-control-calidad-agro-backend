import { Injectable } from '@nestjs/common';
import { ClientesRepository } from './repository/clientes.repository';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { RechazarClienteDto } from './dto/rechazar-cliente.dto';
import { FiltrosClientesDto } from './dto/filtros-clientes.dto';

@Injectable()
export class ClientesService {
    constructor(private readonly clientesRepository: ClientesRepository) { }

    async findAll(userId: number) {
        return await this.clientesRepository.getAllClientesByOperador(userId);
    }

    async findAllGlobal(filtros: FiltrosClientesDto) {
        return await this.clientesRepository.getAllClientes(filtros);
    }


    async create(dto: CreateClienteDto, userId: number) {
        return await this.clientesRepository.createCliente(dto, userId);
    }

    async rechazar(clienteId: number, dto: RechazarClienteDto, userId: number) {
        return await this.clientesRepository.rechazarCliente(
            clienteId,
            dto,
            userId,
        );
    }
}
