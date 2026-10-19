import { Injectable } from '@nestjs/common';
import { OrigenesRepository } from './repository/origenes.repository';
import { CreateOrigenDto } from './dto/create-origen.dto';

@Injectable()
export class OrigenesService {
    constructor(private readonly origenesRepository: OrigenesRepository) { }

    async create(dto: CreateOrigenDto, userId: number) {
        return await this.origenesRepository.createOrigen(dto, userId);
    }
}
