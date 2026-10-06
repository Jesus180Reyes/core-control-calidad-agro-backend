import { Controller, Get } from '@nestjs/common';
import { PlantasService } from './plantas.service';

@Controller('plantas')
export class PlantasController {
    constructor(private readonly plantasService: PlantasService) { }

    @Get('en-vivo')
    async findPlantaEnVivo() {
        const planta = await this.plantasService.findPlantaEnVivo();
        return {
            ok: true,
            msg: 'Planta obtenida correctamente',
            planta,
        };
    }
}
