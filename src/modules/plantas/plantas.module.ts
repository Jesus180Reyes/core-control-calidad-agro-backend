import { Module } from '@nestjs/common';
import { PlantasService } from './plantas.service';
import { PlantasController } from './plantas.controller';
import { PlantasRepository } from './repository/plantas.repository';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  controllers: [PlantasController],
  providers: [PlantasService, PlantasRepository],
  imports: [DatabaseModule],
})
export class PlantasModule { }
