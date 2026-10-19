import { Module } from '@nestjs/common';
import { OrigenesService } from './origenes.service';
import { OrigenesController } from './origenes.controller';
import { OrigenesRepository } from './repository/origenes.repository';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  controllers: [OrigenesController],
  providers: [OrigenesService, OrigenesRepository],
  imports: [DatabaseModule],
})
export class OrigenesModule { }
