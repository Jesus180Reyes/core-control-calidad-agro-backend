import { Module } from '@nestjs/common';
import { PermisosService } from './permisos.service';
import { PermisosController } from './permisos.controller';
import { PermisosRepository } from './repository/permisos.repository';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  controllers: [PermisosController],
  providers: [PermisosService, PermisosRepository],
  imports: [DatabaseModule],
})
export class PermisosModule { }
