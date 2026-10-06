import { Injectable } from '@nestjs/common';
import { PlantasRepository } from './repository/plantas.repository';

@Injectable()
export class PlantasService {
    constructor(private readonly plantasRepository: PlantasRepository) { }

    async findPlantaEnVivo() {
        return await this.plantasRepository.getPlantaEnVivo();
    }
}
