import { Module } from '@nestjs/common';
import { CatalogosService } from './catalogos.service';
import { CatalogosController } from './catalogos.controller';
import { CatalogosRepository } from './repository/catalogos.repository';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  controllers: [CatalogosController],
  providers: [CatalogosService, CatalogosRepository],
  imports: [DatabaseModule],
})
export class CatalogosModule { }
