import { Injectable } from '@nestjs/common';
import { PesajesRepository } from './repository/pesajes.repository';
import { CreatePesajeDto } from './dto/create-pesaje.dto';

@Injectable()
export class PesajesService {
    constructor(private readonly pesajesRepository: PesajesRepository) { }

    async findAllByCliente(clienteId: number, userId: number) {
        return await this.pesajesRepository.getPesajesByCliente(clienteId, userId);
    }

    async create(dto: CreatePesajeDto, userId: number) {
        return await this.pesajesRepository.createPesaje(dto, userId);
    }
}
