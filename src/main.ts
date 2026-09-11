import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { ZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const reflector = app.get(Reflector);
  // app.setGlobalPrefix('api/v1');

  app.enableCors();

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Core Control Calidad Agro API')
      .setDescription(
        'API de control de calidad para lotes de exportacion agricola. ' +
        'Cubre el flujo de pesajes contra un rango de tolerancia y el ciclo de ' +
        'vida de un lote: EN_PROCESO, CLIENTE_FINAL, RECHAZADO y FINALIZADO.',
      )
      .setVersion('1.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addTag('auth', 'Login y registro de usuarios')
      .addTag('catalogos', 'Listas de referencia para selectores')
      .addTag('clientes', 'Clientes y su cartera por operador')
      .addTag('lotes', 'Lotes y su avance por las etapas del flujo')
      .addTag('pesajes', 'Pesajes individuales contra un lote')
      .addTag('permisos', 'Permisos del rol del usuario autenticado')
      .build();

    const document = cleanupOpenApiDoc(
      SwaggerModule.createDocument(app, config),
    );

    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    logger.log('📚 Swagger disponible en /docs');
  }

  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalGuards(new JwtAuthGuard(reflector)); // Guard global en la instancia
  app.enableShutdownHooks();
  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  logger.log(`🚀 Servidor corriendo en puerto ${port}`);
}
bootstrap();
