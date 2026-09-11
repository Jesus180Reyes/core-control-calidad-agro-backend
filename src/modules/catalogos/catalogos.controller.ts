import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CatalogosService } from './catalogos.service';

@ApiTags('catalogos')
@ApiBearerAuth()
@Controller('catalogos')
export class CatalogosController {
    constructor(private readonly catalogosService: CatalogosService) { }

    @Get('productos')
    @ApiOperation({
        summary: 'Productos activos',
        description:
            'Lista de referencia para selectores. Cada elemento es { id, nombre }. ' +
            'La clave del payload es data, no productos: los tres endpoints de catalogos ' +
            'comparten una misma forma de respuesta. Filtra isActive = 1 y ordena por nombre. ' +
            'Abierto a cualquier usuario autenticado.',
    })
    async findProductos() {
        const data = await this.catalogosService.findProductos();
        return {
            ok: true,
            msg: 'Productos obtenidos correctamente',
            data,
        };
    }

    @Get('usuarios')
    @ApiOperation({
        summary: 'Usuarios activos',
        description:
            'Lista de referencia para selectores, usada al vincular operadores a un cliente. ' +
            'Cada elemento es { id, nombre }, con complete_name aliasado a nombre. ' +
            'La clave del payload es data. Devuelve TODOS los usuarios activos, sin filtro de ' +
            'rol y sin filtro por cliente_operador: un OPERADOR ve tambien las cuentas ADMIN.',
    })
    async findUsuarios() {
        const data = await this.catalogosService.findUsuarios();
        return {
            ok: true,
            msg: 'Usuarios obtenidos correctamente',
            data,
        };
    }

    @Get('unidades-medida')
    @ApiOperation({
        summary: 'Unidades de medida',
        description:
            'Lista de referencia para selectores. Cada elemento es { id, nombre } y la clave ' +
            'del payload es data. La tabla no tiene columna isActive, asi que va sin filtrar. ' +
            'Abierto a cualquier usuario autenticado.',
    })
    async findUnidadesMedida() {
        const data = await this.catalogosService.findUnidadesMedida();
        return {
            ok: true,
            msg: 'Unidades de medida obtenidas correctamente',
            data,
        };
    }
}
