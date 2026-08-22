import { Module } from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { ClientesController } from './clientes.controller';
import { ClientesRepository } from './repository/clientes.repository';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  controllers: [ClientesController],
  providers: [ClientesService, ClientesRepository],
  imports: [DatabaseModule],
})
export class ClientesModule { }
