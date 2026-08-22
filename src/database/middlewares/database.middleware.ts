import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';
import { Database } from '../types/types';

@Injectable()
export class DatabaseMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const db = new Kysely<Database>({
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

    req['db'] = db;
    res.on('finish', () => {
      void db
        .destroy()
        .catch((err) => console.error('Error cerrando Kysely:', err));
    });

    next();
  }
}
