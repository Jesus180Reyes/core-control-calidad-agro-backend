import { Module } from '@nestjs/common';
import { LotesService } from './lotes.service';
import { LotesController } from './lotes.controller';
import { LotesRepository } from './repository/lotes.repository';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  controllers: [LotesController],
  providers: [LotesService, LotesRepository],
  imports: [DatabaseModule],
})
export class LotesModule { }
