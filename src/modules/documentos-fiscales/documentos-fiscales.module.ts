import { Module } from '@nestjs/common';
import { DocumentosFiscalesService } from './documentos-fiscales.service';
import { DocumentosFiscalesController } from './documentos-fiscales.controller';
import { DocumentosFiscalesRepository } from './repository/documentos-fiscales.repository';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  controllers: [DocumentosFiscalesController],
  providers: [DocumentosFiscalesService, DocumentosFiscalesRepository],
  imports: [DatabaseModule],
})
export class DocumentosFiscalesModule { }
