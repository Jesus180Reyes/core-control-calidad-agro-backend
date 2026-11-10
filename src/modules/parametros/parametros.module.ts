import { Module } from '@nestjs/common';
import { ParametrosService } from './parametros.service';
import { ParametrosController } from './parametros.controller';
import { InfoController } from './info.controller';
import { ParametrosRepository } from './repository/parametros.repository';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  controllers: [ParametrosController, InfoController],
  providers: [ParametrosService, ParametrosRepository],
  imports: [DatabaseModule],
})
export class ParametrosModule { }
