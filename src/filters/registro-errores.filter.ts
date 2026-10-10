import { ArgumentsHost, Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

// Registrado solo como APP_FILTER en AppModule. No agregarlo tambien con
// app.useGlobalFilters en main.ts: cada error se guardaria dos veces.
@Catch()
export class RegistroErroresFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    super.catch(exception, host);
  }
}
