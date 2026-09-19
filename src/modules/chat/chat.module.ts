import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatRepository } from './repository/chat.repository';
import { DatabaseModule } from 'src/database/database.module';
import { IaModule } from 'src/ia/ia.module';

@Module({
  controllers: [ChatController],
  providers: [ChatService, ChatRepository],
  imports: [DatabaseModule, IaModule],
})
export class ChatModule { }
