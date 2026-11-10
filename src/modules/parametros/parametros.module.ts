import { Module } from '@nestjs/common';
import { ParametrosService } from './parametros.service';
import { ParametrosController } from './parametros.controller';
import { ParametrosRepository } from './repository/parametros.repository';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  controllers: [ParametrosController],
  providers: [ParametrosService, ParametrosRepository],
  imports: [DatabaseModule],
})
export class ParametrosModule { }
