import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ParametrosService } from './parametros.service';
import { ObtenerParametroDto } from './dto/obtener-parametro.dto';

@ApiTags('parametros')
@ApiBearerAuth()
@Controller('parametros')
export class ParametrosController {
    constructor(private readonly parametrosService: ParametrosService) { }

    @Get()
    @ApiOperation({
        summary: 'Obtener un parametro del tenant',
        description:
            'Devuelve una clave de la tabla parametros (datos de la empresa del tenant: ' +
            'EMPRESA_NOMBRE_COMERCIAL, EMPRESA_RAZON_SOCIAL, EMPRESA_RTN, EMPRESA_DIRECCION, ' +
            'EMPRESA_TELEFONO, EMPRESA_CORREO, EMPRESA_SITIO_WEB) como { clave, valor }. ' +
            'valor es siempre texto o null: null significa que la clave existe pero nadie la ' +
            'completo. La busqueda no distingue mayusculas ni tildes. ' +
            'Sin nombre, vacio o de mas de 100 caracteres responde 400; una clave que no ' +
            'existe o esta inactiva responde 404 "Parametro no encontrado". ' +
            'Los valores se cargan solo a mano en MySQL: no hay ruta de escritura. ' +
            'NO valida el vinculo cliente_operador ni el rol: cualquier usuario autenticado ' +
            'lee cualquier clave, por eso la tabla nunca guarda secretos.',
    })
    @ApiQuery({
        name: 'nombre',
        required: true,
        description: 'Clave del parametro, por ejemplo EMPRESA_RTN',
        example: 'EMPRESA_NOMBRE_COMERCIAL',
    })
    async obtener(@Query() query: ObtenerParametroDto) {
        const parametro = await this.parametrosService.obtener(query.nombre);
        return {
            ok: true,
            msg: 'Parametro obtenido correctamente',
            parametro,
        };
    }
}
