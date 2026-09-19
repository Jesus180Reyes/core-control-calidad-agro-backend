import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
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

    /**
     * Tres ejemplos para la pantalla vacia, con nombres de la cartera de quien
     * entra. Sin IA y sin llamar a Gemini: abrir el chat no cuesta una llamada.
     *
     * `sugerencias` es una ruta literal y en este controller no hay ningun
     * `@Get(':id')` pelado, asi que la trampa del `:id` que documenta CLAUDE.md
     * no aplica aqui. Si algun dia se anade uno, va despues de esta.
     */
    @Get('sugerencias')
    async sugerencias(@Req() req: Request) {
        const { userId } = req.user as { userId: number };
        const sugerencias = await this.chatService.sugerencias(userId);
        return {
            ok: true,
            msg: 'Sugerencias',
            sugerencias,
        };
    }
}
