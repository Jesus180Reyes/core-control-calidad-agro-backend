import { Injectable } from '@nestjs/common';
import { ParametrosRepository } from './repository/parametros.repository';

@Injectable()
export class ParametrosService {
    constructor(private readonly parametrosRepository: ParametrosRepository) { }
}
