import { Controller } from '@nestjs/common';
import { MetricasService } from './metricas.service';

@Controller('metricas')
export class MetricasController {
    constructor(private readonly metricasService: MetricasService) { }
}
