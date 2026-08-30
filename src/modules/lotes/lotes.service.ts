import { Injectable } from '@nestjs/common';
import { LotesRepository } from './repository/lotes.repository';
import { CreateLoteDto } from './dto/create-lote.dto';

@Injectable()
export class LotesService {
    constructor(private readonly lotesRepository: LotesRepository) { }

    async findAllByCliente(clienteId: number, userId: number) {
        return await this.lotesRepository.getLotesByCliente(clienteId, userId);
    }

    async create(dto: CreateLoteDto, userId: number) {
        return await this.lotesRepository.createLote(dto, userId);
    }
    async findAllLotesByCliente(clienteId: number) {
        return await this.lotesRepository.getAllLotesByCliente(clienteId);
    }
}
