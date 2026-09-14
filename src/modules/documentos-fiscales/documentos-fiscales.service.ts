import { Injectable } from '@nestjs/common';
import { DocumentosFiscalesRepository } from './repository/documentos-fiscales.repository';
import { CreateDocumentoFiscalDto } from './dto/create-documento-fiscal.dto';
import { FiltrosDocumentosFiscalesDto } from './dto/filtros-documentos-fiscales.dto';
import { CompletarDocumentoFiscalDto } from './dto/completar-documento-fiscal.dto';
import { AnularDocumentoFiscalDto } from './dto/anular-documento-fiscal.dto';

@Injectable()
export class DocumentosFiscalesService {
    constructor(
        private readonly documentosFiscalesRepository: DocumentosFiscalesRepository,
    ) { }

    async findAll(filtros: FiltrosDocumentosFiscalesDto) {
        return await this.documentosFiscalesRepository.getDocumentosFiscales(
            filtros,
        );
    }

    async create(dto: CreateDocumentoFiscalDto, userId: number) {
        return await this.documentosFiscalesRepository.createDocumentoFiscal(
            dto,
            userId,
        );
    }

    async completar(documentoId: number, dto: CompletarDocumentoFiscalDto) {
        return await this.documentosFiscalesRepository.completarDocumentoFiscal(
            documentoId,
            dto,
        );
    }

    async anular(
        documentoId: number,
        dto: AnularDocumentoFiscalDto,
        userId: number,
    ) {
        return await this.documentosFiscalesRepository.anularDocumentoFiscal(
            documentoId,
            dto,
            userId,
        );
    }
}
