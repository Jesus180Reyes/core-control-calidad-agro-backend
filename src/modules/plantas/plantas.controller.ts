import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlantasService } from './plantas.service';

@ApiTags('Plantas')
@ApiBearerAuth()
@Controller('plantas')
export class PlantasController {
    constructor(private readonly plantasService: PlantasService) { }

    @Get('en-vivo')
    @ApiOperation({
        summary: 'Foto de la planta en vivo para el Mirador',
        description:
            'Devuelve en una sola lectura los clientes activos con sus lotes vigentes y los KPIs del dia. ' +
            'Pensado para que el Mirador la pida cada 1 a 2 minutos; no guarda estado entre llamadas. ' +
            'Cada lote trae una etapa del tablero derivada de etapas.codigo: EN_PROCESO -> en-pesaje y ' +
            'CLIENTE_FINAL -> por-aprobar entran siempre; FINALIZADO -> finalizado entra 7 dias desde ' +
            'finalizado_en; RECHAZADO -> rechazado entra 5 minutos desde rechazado_en. Un lote fuera de su ' +
            'ventana, con etapa_id en NULL o de un cliente con isActive = 0 no aparece, y un cliente sin ' +
            'lotes en la foto tampoco. No hay casilla de despacho y no se leen documentos fiscales. ' +
            'Por lote: bultos, bultos_fuera_rango y peso_neto_total cuentan todos sus pesajes activos, y ' +
            'ultimos_pesajes trae los 10 activos de mayor id, ordenados por id descendente. Los KPIs ' +
            'cubren todos los pesajes activos de hoy (CURDATE()) de la planta; pct_en_rango_hoy es null ' +
            'si no hubo pesajes. Muestra la planta entera: no filtra por cliente_operador y no tiene ' +
            'fila de permiso, asi que cualquier usuario autenticado la ve.',
    })
    async findPlantaEnVivo() {
        const planta = await this.plantasService.findPlantaEnVivo();
        return {
            ok: true,
            msg: 'Planta obtenida correctamente',
            planta,
        };
    }
}
