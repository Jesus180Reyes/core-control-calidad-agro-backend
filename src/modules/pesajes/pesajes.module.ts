import { Module } from '@nestjs/common';
import { PesajesService } from './pesajes.service';
import { PesajesController } from './pesajes.controller';
import { PesajesRepository } from './repository/pesajes.repository';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  controllers: [PesajesController],
  providers: [PesajesService, PesajesRepository],
  imports: [DatabaseModule],
})
export class PesajesModule { }
