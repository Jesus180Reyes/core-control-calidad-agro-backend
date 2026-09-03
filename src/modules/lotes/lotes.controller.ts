import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { LotesService } from './lotes.service';
import { CreateLoteDto } from './dto/create-lote.dto';
import { RechazarLoteDto } from './dto/rechazar-lote.dto';

@Controller('lotes')
export class LotesController {
    constructor(private readonly lotesService: LotesService) { }

    @Get('cliente/:clienteId')
    async findAllByCliente(
        @Param('clienteId', ParseIntPipe) clienteId: number,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const lotes = await this.lotesService.findAllByCliente(clienteId, userId);
        return {
            ok: !!lotes,
            msg: 'Lotes obtenidos correctamente',
            lotes,
        };
    }
    @Get('cliente/:clienteId/all')
    async findAllLotesByCliente(
        @Param('clienteId', ParseIntPipe) clienteId: number,
    ) {
        const lotes = await this.lotesService.findAllLotesByCliente(clienteId);
        return {
            ok: !!lotes,
            msg: 'Lotes obtenidos correctamente',
            lotes,
        };
    }

    @Post()
    @HttpCode(201)
    async create(@Body() dto: CreateLoteDto, @Req() req: Request) {
        const { userId } = req.user as { userId: number };
        const lote = await this.lotesService.create(dto, userId);
        return {
            ok: !!lote,
            msg: 'Lote creado correctamente',
        };
    }

    @Patch(':id/rechazar')
    async rechazar(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: RechazarLoteDto,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const rechazado = await this.lotesService.rechazar(id, dto, userId);
        return {
            ok: rechazado,
            msg: 'Lote rechazado correctamente',
        };
    }

    @Patch(':id/aprobar')
    async aprobar(
        @Param('id', ParseIntPipe) id: number,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const aprobado = await this.lotesService.aprobar(id, userId);
        return {
            ok: aprobado,
            msg: 'Lote aprobado correctamente',
        };
    }
}
