import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request } from 'express';
import { Insertable } from 'kysely';
import { LogErroresTable } from 'src/database/types/types';

// TEXT mide bytes y un caracter utf8mb4 ocupa hasta 4: 15000 caracteres
// caben siempre. Con STRICT_TRANS_TABLES un valor largo haria fallar el INSERT.
const MAX_METODO = 10;
const MAX_RUTA = 500;
const MAX_MENSAJE = 1000;
const MAX_STACK = 15000;
const MAX_ENTORNO = 20;

// Registrado solo como APP_FILTER en AppModule. No agregarlo tambien con
// app.useGlobalFilters en main.ts: cada error se guardaria dos veces.
@Catch()
export class RegistroErroresFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    super.catch(exception, host);

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    if (status < 500) return;

    const req = host.switchToHttp().getRequest<Request>();
    this.armarFila(exception, status, req);
  }

  private armarFila(
    exception: unknown,
    status: number,
    req: Request,
  ): Insertable<LogErroresTable> {
    const esError = exception instanceof Error;
    const user = req.user as { userId: number } | undefined;
    const entorno = process.env.NODE_ENV;

    return {
      status,
      metodo: this.truncar(req.method ?? '', MAX_METODO),
      ruta: this.truncar(req.originalUrl ?? '', MAX_RUTA),
      mensaje: this.truncar(
        esError ? exception.message : String(exception),
        MAX_MENSAJE,
      ),
      stack:
        esError && exception.stack
          ? this.truncar(exception.stack, MAX_STACK)
          : null,
      usuario_id: user?.userId ?? null,
      entorno: entorno ? this.truncar(entorno, MAX_ENTORNO) : null,
    };
  }

  private truncar(valor: string, max: number): string {
    return valor.length > max ? valor.slice(0, max) : valor;
  }
}
