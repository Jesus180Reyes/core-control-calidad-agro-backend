import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  // app.setGlobalPrefix('api/v1');

  app.enableCors();

  if (process.env.NODE_ENV === 'development') {
    const config = new DocumentBuilder()
      .setTitle('Core Control Calidad Agro API')
      .setDescription(
        'API de control de calidad para lotes de exportacion agricola.'
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

  // El ZodValidationPipe y el JwtAuthGuard globales se registran solo en
  // AppModule (APP_PIPE / APP_GUARD). Registrarlos tambien aqui validaba cada
  // DTO dos veces y rompia cualquier .transform() que cambie el tipo.
  app.enableShutdownHooks();
  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  logger.log(`🚀 Servidor corriendo en puerto ${port}`);
}
bootstrap();
