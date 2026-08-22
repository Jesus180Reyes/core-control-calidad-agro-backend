import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ClientesService } from './clientes.service';
import { CreateClienteDto } from './dto/create-cliente.dto';

@Controller('clientes')
export class ClientesController {
    constructor(private readonly clientesService: ClientesService) { }

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

}
