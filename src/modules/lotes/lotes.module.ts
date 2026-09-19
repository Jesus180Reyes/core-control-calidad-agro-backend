import { Module } from '@nestjs/common';
import { LotesService } from './lotes.service';
import { LotesController } from './lotes.controller';
import { LotesRepository } from './repository/lotes.repository';
import { DatabaseModule } from 'src/database/database.module';
import { IaModule } from 'src/ia/ia.module';

@Module({
  controllers: [LotesController],
  providers: [LotesService, LotesRepository],
  imports: [DatabaseModule, IaModule],
})
export class LotesModule { }
