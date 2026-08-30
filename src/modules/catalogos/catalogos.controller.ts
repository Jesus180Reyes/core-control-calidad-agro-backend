import { Controller, Get } from '@nestjs/common';
import { CatalogosService } from './catalogos.service';

@Controller('catalogos')
export class CatalogosController {
    constructor(private readonly catalogosService: CatalogosService) { }

    @Get('productos')
    async findProductos() {
        const data = await this.catalogosService.findProductos();
        return {
            ok: true,
            msg: 'Productos obtenidos correctamente',
            data,
        };
    }

    @Get('usuarios')
    async findUsuarios() {
        const data = await this.catalogosService.findUsuarios();
        return {
            ok: true,
            msg: 'Usuarios obtenidos correctamente',
            data,
        };
    }

    @Get('unidades-medida')
    async findUnidadesMedida() {
        const data = await this.catalogosService.findUnidadesMedida();
        return {
            ok: true,
            msg: 'Unidades de medida obtenidas correctamente',
            data,
        };
    }
}
