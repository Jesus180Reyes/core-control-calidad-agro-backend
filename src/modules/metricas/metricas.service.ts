import { Injectable } from '@nestjs/common';
import { MetricasRepository } from './repository/metricas.repository';

@Injectable()
export class MetricasService {
    constructor(private readonly metricasRepository: MetricasRepository) { }
}
