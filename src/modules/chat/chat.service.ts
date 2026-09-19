import { Injectable } from '@nestjs/common';
import { ChatRepository } from './repository/chat.repository';
import { PreguntarDto } from './dto/preguntar.dto';

@Injectable()
export class ChatService {
    constructor(private readonly chatRepository: ChatRepository) { }

    async preguntar(dto: PreguntarDto, userId: number) {
        return await this.chatRepository.responder(dto, userId);
    }
}
