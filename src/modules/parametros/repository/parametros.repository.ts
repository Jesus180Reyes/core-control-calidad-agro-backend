import { DatabaseService } from 'src/database/database.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ParametrosRepository {
    constructor(private readonly dbService: DatabaseService) { }

    get db() {
        return this.dbService.client;
    }
}
