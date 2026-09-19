import { Injectable } from '@nestjs/common';
import { LotesRepository } from './repository/lotes.repository';
import { CreateLoteDto } from './dto/create-lote.dto';
import { RechazarLoteDto } from './dto/rechazar-lote.dto';
import { FinalizarLoteDto } from './dto/finalizar-lote.dto';

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
    async findAllLotesByClienteForApprover(clienteId: number) {
        return await this.lotesRepository.getAllLotesByClienteForApprover(clienteId);
    }
    async findAllLotesFinalizadosByCliente(clienteId: number) {
        return await this.lotesRepository.getLotesFinalizadosByCliente(clienteId);
    }

    async rechazar(loteId: number, dto: RechazarLoteDto, userId: number) {
        return await this.lotesRepository.rechazarLote(loteId, dto, userId);
    }

    async rechazarByApprover(
        loteId: number,
        dto: RechazarLoteDto,
        userId: number,
    ) {
        return await this.lotesRepository.rechazarLoteForApprover(
            loteId,
            dto,
            userId,
        );
    }

    async aprobar(loteId: number, userId: number) {
        return await this.lotesRepository.aprobarLote(loteId, userId);
    }

    async finalizar(loteId: number, dto: FinalizarLoteDto, userId: number) {
        return await this.lotesRepository.finalizarLote(loteId, dto, userId);
    }

    async generarResumen(loteId: number) {
        return await this.lotesRepository.generarResumenLote(loteId);
    }

    async obtenerResumen(loteId: number) {
        return await this.lotesRepository.getResumenLote(loteId);
    }

}
