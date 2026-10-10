import { Module } from '@nestjs/common';
import { MetricasService } from './metricas.service';
import { MetricasController } from './metricas.controller';
import { MetricasRepository } from './repository/metricas.repository';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  controllers: [MetricasController],
  providers: [MetricasService, MetricasRepository],
  imports: [DatabaseModule],
})
export class MetricasModule { }
