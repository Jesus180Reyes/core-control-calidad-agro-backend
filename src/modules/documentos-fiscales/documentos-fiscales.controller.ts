import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Query,
    Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DocumentosFiscalesService } from './documentos-fiscales.service';
import { CreateDocumentoFiscalDto } from './dto/create-documento-fiscal.dto';
import { FiltrosDocumentosFiscalesDto } from './dto/filtros-documentos-fiscales.dto';
import { CompletarDocumentoFiscalDto } from './dto/completar-documento-fiscal.dto';
import { AnularDocumentoFiscalDto } from './dto/anular-documento-fiscal.dto';

@ApiTags('documentos-fiscales')
@ApiBearerAuth()
@Controller('documentos-fiscales')
export class DocumentosFiscalesController {
    constructor(
        private readonly documentosFiscalesService: DocumentosFiscalesService,
    ) { }

    @Get()
    async findAll(@Query() filtros: FiltrosDocumentosFiscalesDto) {
        const documentos = await this.documentosFiscalesService.findAll(filtros);
        return {
            ok: !!documentos,
            msg: 'Documentos fiscales obtenidos correctamente',
            documentos,
        };
    }

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

    @Patch(':id/completar')
    async completar(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: CompletarDocumentoFiscalDto,
    ) {
        await this.documentosFiscalesService.completar(id, dto);
        return {
            ok: true,
            msg: 'Documento fiscal completado correctamente',
        };
    }

    @Patch(':id/anular')
    async anular(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: AnularDocumentoFiscalDto,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        await this.documentosFiscalesService.anular(id, dto, userId);
        return {
            ok: true,
            msg: 'Documento fiscal anulado correctamente',
        };
    }
}
