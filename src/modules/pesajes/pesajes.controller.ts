import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Post,
    Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PesajesService } from './pesajes.service';
import { CreatePesajeDto } from './dto/create-pesaje.dto';

@Controller('pesajes')
export class PesajesController {
    constructor(private readonly pesajesService: PesajesService) { }

    @Get('byLote/:loteId')
    async findAllByLote(
        @Param('loteId', ParseIntPipe) loteId: number,
    ) {
        const pesajes = await this.pesajesService.findAllByLote(loteId);
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
}
