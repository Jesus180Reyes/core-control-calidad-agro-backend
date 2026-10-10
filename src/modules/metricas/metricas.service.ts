import { Injectable } from '@nestjs/common';
import { MetricasRepository } from './repository/metricas.repository';
import { FiltrosMetricasCalidadDto } from './dto/filtros-metricas-calidad.dto';

@Injectable()
export class MetricasService {
    constructor(private readonly metricasRepository: MetricasRepository) { }

    async getMetricasCalidad(filtros: FiltrosMetricasCalidadDto) {
        return await this.metricasRepository.getMetricasCalidad(filtros);
    }
}
