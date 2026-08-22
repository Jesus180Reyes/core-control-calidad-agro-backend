import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const reflector = app.get(Reflector);
  // app.setGlobalPrefix('api/v1');

  app.enableCors();

  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalGuards(new JwtAuthGuard(reflector)); // Guard global en la instancia
  app.enableShutdownHooks();
  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  logger.log(`🚀 Servidor corriendo en puerto ${port}`);
}
bootstrap();
