import { Controller } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ParametrosService } from './parametros.service';

@ApiTags('parametros')
@ApiBearerAuth()
@Controller('parametros')
export class ParametrosController {
    constructor(private readonly parametrosService: ParametrosService) { }
}
