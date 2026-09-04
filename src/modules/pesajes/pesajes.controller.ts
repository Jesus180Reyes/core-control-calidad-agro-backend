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
import type { Request } from 'express';
import { PesajesService } from './pesajes.service';
import { CreatePesajeDto } from './dto/create-pesaje.dto';
import { RechazarPesajeDto } from './dto/rechazar-pesaje.dto';
import { FiltrosPesajesLoteDto } from './dto/filtros-pesajes-lote.dto';
import { FiltrosHistorialDto } from './dto/filtros-historial.dto';

@Controller('pesajes')
export class PesajesController {
    constructor(private readonly pesajesService: PesajesService) { }

    @Get('historial')
    async findHistorial(
        @Query() filtros: FiltrosHistorialDto,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const pesajes = await this.pesajesService.findHistorial(userId, filtros);
        return {
            ok: !!pesajes,
            msg: 'Historial de pesajes obtenido correctamente',
            pesajes,
        };
    }

    @Get('byLote/:loteId')
    async findAllByLote(
        @Param('loteId', ParseIntPipe) loteId: number,
        @Query() filtros: FiltrosPesajesLoteDto,
    ) {
        const pesajes = await this.pesajesService.findAllByLote(loteId, filtros);
        return {
            ok: !!pesajes,
            msg: 'Pesajes obtenidos correctamente',
            pesajes,
        };
    }

    @Post()
    @HttpCode(201)
    async create(@Body() dto: CreatePesajeDto, @Req() req: Request) {
        const { userId } = req.user as { userId: number };
        const pesaje = await this.pesajesService.create(dto, userId);
        return {
            ok: !!pesaje,
            msg: 'Pesaje guardado correctamente',
            pesaje,
        };
    }

    @Patch(':id/rechazar')
    async rechazar(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: RechazarPesajeDto,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const rechazado = await this.pesajesService.rechazar(id, dto, userId);
        return {
            ok: rechazado,
            msg: 'Pesaje rechazado correctamente',
        };
    }
}
