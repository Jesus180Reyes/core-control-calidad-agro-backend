import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DocumentosFiscalesService } from './documentos-fiscales.service';
import { CreateDocumentoFiscalDto } from './dto/create-documento-fiscal.dto';

@ApiTags('documentos-fiscales')
@ApiBearerAuth()
@Controller('documentos-fiscales')
export class DocumentosFiscalesController {
    constructor(
        private readonly documentosFiscalesService: DocumentosFiscalesService,
    ) { }

    @Post()
    @HttpCode(201)
    async create(@Body() dto: CreateDocumentoFiscalDto, @Req() req: Request) {
        const { userId } = req.user as { userId: number };
        const documento_id = await this.documentosFiscalesService.create(
            dto,
            userId,
        );
        return {
            ok: !!documento_id,
            msg: 'Documento fiscal registrado correctamente',
            documento_id,
        };
    }
}
