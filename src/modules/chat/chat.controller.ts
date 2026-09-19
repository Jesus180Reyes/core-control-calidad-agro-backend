import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ChatService } from './chat.service';
import { PreguntarDto } from './dto/preguntar.dto';

@ApiTags('chat')
@ApiBearerAuth()
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
    @ApiOperation({
        summary: 'Un turno de conversacion sobre lotes y pesajes',
        description:
            'Responde en lenguaje natural preguntas sobre lotes, pesajes, clientes y operadores. ' +
            'El modelo no consulta la base: elige entre ocho funciones de SOLO LECTURA y el backend ' +
            'decide si las ejecuta, asi que desde aqui no se puede aprobar, rechazar, finalizar ni ' +
            'registrar nada. ' +
            'respuesta es MARKDOWN CRUDO, con saltos de linea reales, igual que POST /lotes/{id}/resumen: ' +
            'el frontend lo renderiza SIN habilitar el modo HTML de su paquete de markdown. ' +
            'Responde 200 siempre que el token sea valido: si Gemini falla, si el turno no converge o ' +
            'si se agoto el limite diario del usuario, devuelve 200 con un texto que lo explica, nunca ' +
            'un 502 ni un 503. ' +
            'Del historial solo se reenvian los ultimos 10 mensajes, y nunca resultados de herramientas ' +
            'de turnos anteriores. ' +
            'NO valida el vinculo cliente_operador: cualquier usuario autenticado puede preguntar por ' +
            'los lotes y pesajes de cualquier cliente. ' +
            'Cada turno queda registrado en chat_log y cuenta contra CHAT_LIMITE_DIARIO.',
    })
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
    @ApiOperation({
        summary: 'Tres preguntas de ejemplo para la pantalla vacia del chat',
        description:
            'Tres frases construidas con una consulta a la cartera del usuario del token. ' +
            'NO llama a Gemini y no cuesta nada: abrir el chat no consume una consulta ni ' +
            'cuenta contra el limite diario. ' +
            'Con cartera, los ejemplos nombran clientes reales del que llama; con la cartera vacia ' +
            '—el caso normal de un aprobador o un ADMIN, que no tienen filas en cliente_operador— ' +
            'devuelve tres ejemplos genericos. Nunca responde 404 ni lista vacia: siempre son tres.',
    })
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
