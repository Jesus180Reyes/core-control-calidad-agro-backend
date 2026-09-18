import { Module } from '@nestjs/common';
import { GeminiService } from './gemini.service';

/**
 * Modulo de integracion con IA (SPEC 27).
 *
 * Sin `imports`: `ConfigModule` ya esta registrado como global en `AppModule`,
 * y `GeminiService` no necesita nada mas. No se registra en `AppModule`: lo
 * importa quien lo consume, que hoy es solo `LotesModule`.
 */
@Module({
    providers: [GeminiService],
    exports: [GeminiService],
})
export class IaModule { }
