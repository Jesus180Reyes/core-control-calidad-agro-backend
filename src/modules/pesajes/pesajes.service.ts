import { Injectable } from '@nestjs/common';
import { PesajesRepository } from './repository/pesajes.repository';
import { CreatePesajeDto } from './dto/create-pesaje.dto';
import { RechazarPesajeDto } from './dto/rechazar-pesaje.dto';
import { FiltrosPesajesLoteDto } from './dto/filtros-pesajes-lote.dto';
import { FiltrosHistorialDto } from './dto/filtros-historial.dto';

@Injectable()
export class PesajesService {
    constructor(private readonly pesajesRepository: PesajesRepository) { }

    async findAllByLote(loteId: number, filtros: FiltrosPesajesLoteDto) {
        return await this.pesajesRepository.getPesajesByLote(loteId, filtros);
    }

    async findHistorial(userId: number, filtros: FiltrosHistorialDto) {
        return await this.pesajesRepository.getHistorialByUsuario(
            userId,
            filtros,
        );
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
