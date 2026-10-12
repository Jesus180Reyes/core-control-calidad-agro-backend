import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';
import { Database } from '../types/types';
import { fijarZonaHorariaSesion, opcionesZonaHoraria } from '../zona-horaria';

@Injectable()
export class DatabaseMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const db = new Kysely<Database>({
      dialect: new MysqlDialect({
        pool: createPool({
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT) || 3306,
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
          connectionLimit: 1,
          waitForConnections: true,
          ...opcionesZonaHoraria,
        }),
        onCreateConnection: fijarZonaHorariaSesion,
      }),
    });

    req['db'] = db;
    res.on('finish', () => {
      void db
        .destroy()
        .catch((err) => console.error('Error cerrando Kysely:', err));
    });

    next();
  }
}
