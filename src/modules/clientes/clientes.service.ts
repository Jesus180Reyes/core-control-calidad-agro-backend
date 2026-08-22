import { Injectable } from '@nestjs/common';
import { ClientesRepository } from './repository/clientes.repository';
import { CreateClienteDto } from './dto/create-cliente.dto';

@Injectable()
export class ClientesService {
    constructor(private readonly clientesRepository: ClientesRepository) { }

    async findAll(userId: number) {
        return await this.clientesRepository.getAllClientesByOperador(userId);
    }

    async findOne(id: number) {
        return await this.clientesRepository.getClienteById(id);
    }

    async create(dto: CreateClienteDto, userId: number) {
        const clienteId = await this.clientesRepository.createCliente(dto, userId);

        if (dto.usuario_ids && dto.usuario_ids.length > 0) {
            await this.clientesRepository.linkOperadores(clienteId, dto.usuario_ids);
        }

        return clienteId;
    }
}
