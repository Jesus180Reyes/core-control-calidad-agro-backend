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
import { ClientesService } from './clientes.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { RechazarClienteDto } from './dto/rechazar-cliente.dto';
import { FiltrosClientesDto } from './dto/filtros-clientes.dto';

@Controller('clientes')
export class ClientesController {
    constructor(private readonly clientesService: ClientesService) { }

    @Get('all')
    async findAllGlobal(@Query() filtros: FiltrosClientesDto) {
        const clientes = await this.clientesService.findAllGlobal(filtros);
        return {
            ok: true,
            msg: 'Clientes obtenidos correctamente',
            clientes,
        };
    }

    @Get()
    async findAll(@Req() req: Request) {
        const { userId } = req.user as { userId: number };
        const clientes = await this.clientesService.findAll(userId);
        return {
            ok: true,
            msg: 'Clientes obtenidos correctamente',
            clientes,
        };
    }

    @Post()
    @HttpCode(201)
    async create(@Body() dto: CreateClienteDto, @Req() req: Request) {
        const { userId } = req.user as { userId: number };
        const cliente = await this.clientesService.create(dto, userId);
        return {
            ok: true,
            msg: 'Cliente creado correctamente',
            cliente,
        };
    }

    @Patch(':id/rechazar')
    async rechazar(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: RechazarClienteDto,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const rechazado = await this.clientesService.rechazar(id, dto, userId);
        return {
            ok: rechazado,
            msg: 'Cliente rechazado correctamente',
        };
    }
}
