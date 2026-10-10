import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MetricasService } from './metricas.service';
import { FiltrosMetricasCalidadDto } from './dto/filtros-metricas-calidad.dto';

@ApiTags('metricas')
@ApiBearerAuth()
@Controller('metricas')
export class MetricasController {
    constructor(private readonly metricasService: MetricasService) { }

    @Get('calidad')
    @ApiOperation({
        summary: 'Metricas de calidad de pesajes',
        description:
            'Indicadores de calidad de los pesajes de un periodo, calculados al vuelo: total, ' +
            'fuera de rango, desviacion frente al peso ideal, veredictos del aprobador y ' +
            'anulaciones, mas la distribucion por estado de calidad y el desglose por cliente. ' +
            'Sin desde ni hasta el periodo son los ultimos 30 dias, hoy incluido, segun el reloj ' +
            'de MySQL; con un solo extremo el otro se completa para formar 30 dias, y la ' +
            'respuesta trae siempre el periodo aplicado. hasta es inclusivo de todo el dia. ' +
            'A diferencia de los filtros de pesajes, un filtro invalido responde 400 en lugar de ' +
            'ignorarse, igual que desde posterior a hasta; un param desconocido se descarta. ' +
            'La desviacion es relativa al peso_ideal de cada lote, en %, y tiene signo: positiva ' +
            'es pesar por encima del ideal. Los porcentajes valen null cuando no hay datos. ' +
            'Cuenta los pesajes activos de cualquier lote y cliente, rechazados incluidos; los ' +
            'pesajes sin lote no cuentan. Abierto a cualquier usuario autenticado: no valida ' +
            'cliente_operador, asi que devuelve las metricas de todos los clientes, y ' +
            '?usuario_id permite consultar las de cualquier operador.',
    })
    async getMetricasCalidad(@Query() filtros: FiltrosMetricasCalidadDto) {
        const metricas = await this.metricasService.getMetricasCalidad(filtros);
        return {
            ok: true,
            msg: 'Metricas de calidad obtenidas correctamente',
            metricas,
        };
    }
}
