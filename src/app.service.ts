import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database/database.service';

@Injectable()
export class AppService {
  constructor(private readonly db: DatabaseService) {}
  async getHello(): Promise<string> {
    const users = await this.db.client
      .selectFrom('usuarios')
      .selectAll()
      .execute();

    return `Hello, ${users.map((user) => user.complete_name).join(', ')}!`;
  }
}
