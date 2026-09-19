import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ChatService } from './chat.service';
import { PreguntarDto } from './dto/preguntar.dto';

@Controller('chat')
export class ChatController {
    constructor(private readonly chatService: ChatService) { }

    /**
     * 200 y no 201: un turno de conversacion no crea ningun recurso que el
     * cliente pueda volver a pedir. Mismo criterio y mismo `@HttpCode(200)` que
     * `POST /lotes/:id/resumen`.
     */
    @Post()
    @HttpCode(200)
    async preguntar(@Body() dto: PreguntarDto, @Req() req: Request) {
        const { userId } = req.user as { userId: number };
        const respuesta = await this.chatService.preguntar(dto, userId);
        return {
            ok: true,
            msg: 'Consulta resuelta',
            respuesta,
        };
    }
}
