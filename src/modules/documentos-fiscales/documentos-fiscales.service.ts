import { Injectable } from '@nestjs/common';
import { DocumentosFiscalesRepository } from './repository/documentos-fiscales.repository';
import { CreateDocumentoFiscalDto } from './dto/create-documento-fiscal.dto';

@Injectable()
export class DocumentosFiscalesService {
    constructor(
        private readonly documentosFiscalesRepository: DocumentosFiscalesRepository,
    ) { }

    async create(dto: CreateDocumentoFiscalDto, userId: number) {
        return await this.documentosFiscalesRepository.createDocumentoFiscal(
            dto,
            userId,
        );
    }
}
