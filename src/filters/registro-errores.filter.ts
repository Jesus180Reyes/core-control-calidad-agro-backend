import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request } from 'express';
import { Insertable, Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';
import { Database, LogErroresTable } from 'src/database/types/types';

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
  private readonly logger = new Logger(RegistroErroresFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    super.catch(exception, host);

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    if (status < 500) return;

    const req = host.switchToHttp().getRequest<Request>();
    // Sin await: el INSERT no retrasa la respuesta, que ya salio.
    void this.registrar(exception, status, req);
  }

  // Conexion propia y de un solo uso, no req['db']: DatabaseMiddleware la
  // destruye en 'finish' y puede ser justo la conexion que fallo. Registrar
  // un error nunca relanza: si algo falla, queda solo en consola.
  private async registrar(exception: unknown, status: number, req: Request) {
    let db: Kysely<Database> | undefined;
    try {
      const fila = this.armarFila(exception, status, req);
      db = new Kysely<Database>({
        dialect: new MysqlDialect({
          pool: createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            connectionLimit: 1,
            waitForConnections: true,
          }),
        }),
      });
      await db.insertInto('log_errores').values(fila).execute();
    } catch (err) {
      this.logger.error(
        `No se pudo registrar el error en log_errores: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (db) {
        await db.destroy().catch(() => undefined);
      }
    }
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
