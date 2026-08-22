import { Module, NestModule, MiddlewareConsumer, Global } from '@nestjs/common';
import { DatabaseMiddleware } from './middlewares/database.middleware';
import { DatabaseService } from './database.service';
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(DatabaseMiddleware).forRoutes('*');
  }
}
