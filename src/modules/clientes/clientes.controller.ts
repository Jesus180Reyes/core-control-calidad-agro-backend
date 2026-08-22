import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ClientesService } from './clientes.service';

@Controller('clientes')
export class ClientesController {
    constructor(private readonly clientesService: ClientesService) { }

    @Get()
    async findAll() {
        const clientes = await this.clientesService.findAll();
        return {
            ok: true,
            msg: 'Clientes obtenidos correctamente',
            clientes,
        };
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number) {
        const cliente = await this.clientesService.findOne(id);
        return {
            ok: true,
            msg: 'Cliente obtenido correctamente',
            cliente,
        };
    }
}
