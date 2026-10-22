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

    @Get('operadores')
    @ApiOperation({
        summary: 'Usuarios activos con rol OPERADOR',
        description:
            'Lista de referencia para selectores: vincular operadores a un cliente y filtrar ' +
            'por usuario. Cada elemento es { id, nombre }, con complete_name aliasado a nombre. ' +
            'La clave del payload es data. Filtra isActive = 1 y el rol OPERADOR por ' +
            'roles.nombre, y ordena por nombre. Abierto a cualquier usuario autenticado, sin ' +
            'filtro por cliente_operador.',
    })
    async findOperadores() {
        const data = await this.catalogosService.findOperadores();
        return {
            ok: true,
            msg: 'Operadores obtenidos correctamente',
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

    @Get('estados-calidad')
    @ApiOperation({
        summary: 'Estados de calidad',
        description:
            'Lista de referencia para el selector del filtro ?estado_calidad_id de ' +
            'GET /pesajes/byLote/:loteId y GET /pesajes/historial. Cada elemento es { id, nombre } ' +
            'y la clave del payload es data. Devuelve todas las filas, sin filtro (la tabla no ' +
            'tiene columna isActive), ordenadas por id. Abierto a cualquier usuario autenticado, ' +
            'sin filtro por cliente_operador.',
    })
    async findEstadosCalidad() {
        const data = await this.catalogosService.findEstadosCalidad();
        return {
            ok: true,
            msg: 'Estados de calidad obtenidos correctamente',
            data,
        };
    }

    @Get('origenes')
    @ApiOperation({
        summary: 'Origenes activos',
        description:
            'Lista de referencia para el selector de origen de POST /lotes. Cada elemento es ' +
            '{ id, nombre } y la clave del payload es data. El catalogo es global: lista TODOS ' +
            'los origenes activos de todos los clientes, no solo los que usa un cliente. ' +
            'Filtra isActive = 1 y ordena por nombre. Abierto a cualquier usuario autenticado, ' +
            'sin filtro por cliente_operador.',
    })
    async findOrigenes() {
        const data = await this.catalogosService.findOrigenes();
        return {
            ok: true,
            msg: 'Origenes obtenidos correctamente',
            data,
        };
    }

    @Get('destinos')
    @ApiOperation({
        summary: 'Destinos activos',
        description:
            'Lista de referencia para el selector de destino_id de ' +
            'PATCH /pesajes/{id}/rechazar/byApprover: a donde va el producto que el aprobador ' +
            'rechaza (mercado local, desecho...). Cada elemento es { id, nombre } y la clave del ' +
            'payload es data. Filtra isActive = 1 y ordena por nombre. Los destinos se cargan a ' +
            'mano en la base, no hay endpoint para crearlos. Abierto a cualquier usuario ' +
            'autenticado, sin filtro por cliente_operador.',
    })
    async findDestinos() {
        const data = await this.catalogosService.findDestinos();
        return {
            ok: true,
            msg: 'Destinos obtenidos correctamente',
            data,
        };
    }
}
