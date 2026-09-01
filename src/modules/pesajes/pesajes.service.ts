import { Injectable } from '@nestjs/common';
import { PesajesRepository } from './repository/pesajes.repository';
import { CreatePesajeDto } from './dto/create-pesaje.dto';
import { RechazarPesajeDto } from './dto/rechazar-pesaje.dto';

@Injectable()
export class PesajesService {
    constructor(private readonly pesajesRepository: PesajesRepository) { }

    async findAllByLote(loteId: number) {
        return await this.pesajesRepository.getPesajesByLote(loteId);
    }

    async create(dto: CreatePesajeDto, userId: number) {
        return await this.pesajesRepository.createPesaje(dto, userId);
    }

    async rechazar(pesajeId: number, dto: RechazarPesajeDto, userId: number) {
        return await this.pesajesRepository.rechazarPesaje(
            pesajeId,
            dto,
            userId,
        );
    }
}
