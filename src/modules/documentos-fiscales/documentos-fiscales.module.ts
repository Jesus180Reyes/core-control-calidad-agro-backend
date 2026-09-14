import { Module } from '@nestjs/common';
import { DocumentosFiscalesService } from './documentos-fiscales.service';
import { DocumentosFiscalesController } from './documentos-fiscales.controller';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  controllers: [DocumentosFiscalesController],
  providers: [DocumentosFiscalesService],
  imports: [DatabaseModule],
})
export class DocumentosFiscalesModule { }
