import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/decorators/public.decorator';
import { ParametrosService } from './parametros.service';

@ApiTags('info')
@Controller('info')
export class InfoController {
    constructor(private readonly parametrosService: ParametrosService) { }

    @Public()
    @Get()
    @ApiOperation({
        summary: 'Obtener la app y la empresa del tenant (publico)',
        description:
            'Ruta PUBLICA: no requiere token. Responde exactamente { app, empresa }, sin ok ni msg. ' +
            'Solo expone dos claves de la tabla parametros, fijas en el codigo: ' +
            'app sale de APP_NOMBRE y empresa de EMPRESA_NOMBRE_COMERCIAL. Ninguna otra clave ' +
            '(RTN, razon social, telefono, correo...) es accesible sin token; para esas esta ' +
            'GET /parametros con JWT. No recibe parametros: cualquier query se ignora. ' +
            'Cada campo es texto o null: null si la clave esta vacia, inactiva o no existe, ' +
            'y la ruta responde 200 igual. ' +
            'NO es un chequeo de salud: no devuelve status y no responde 503; si MySQL falla, ' +
            'responde un 500 generico.',
    })
    async obtener() {
        return await this.parametrosService.obtenerInfoPublica();
    }
}
