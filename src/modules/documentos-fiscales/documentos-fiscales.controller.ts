import { Controller } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DocumentosFiscalesService } from './documentos-fiscales.service';

@ApiTags('documentos-fiscales')
@ApiBearerAuth()
@Controller('documentos-fiscales')
export class DocumentosFiscalesController {
    constructor(
        private readonly documentosFiscalesService: DocumentosFiscalesService,
    ) { }
}
