import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AppService } from './app.service';

// Resto del boilerplate de NestJS: no es parte del contrato de la API, asi que
// se oculta de Swagger. La ruta sigue existiendo y sigue exigiendo token.
@ApiExcludeController()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  async getHello(): Promise<string> {
    return await this.appService.getHello();
  }
}
