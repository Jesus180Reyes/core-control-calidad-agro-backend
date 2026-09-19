import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { GeminiService } from 'src/ia/gemini.service';
import { PreguntarDto } from '../dto/preguntar.dto';

/**
 * El chat de consultas (SPEC 28).
 *
 * Como el resto del proyecto, la logica vive aqui y no en el servicio. Dos
 * cosas propias de este repositorio que conviene saber antes de tocarlo:
 *
 * - **Nada ocurre dentro de una transaccion.** El `DatabaseMiddleware` abre un
 *   pool de UNA conexion por peticion, y retenerla durante la latencia de
 *   Google es justo lo que el SPEC 27 prohibio.
 * - **Las consultas son propias y duplican a proposito** las de
 *   `LotesRepository` y `PesajesRepository`. Inyectar esos repositorios
 *   obligaria a exportarlos y acoplaria los modulos; el costo aceptado es que
 *   si alguien corrige un redondeo en un sitio, el otro se queda atras en
 *   silencio.
 */
@Injectable()
export class ChatRepository {
    constructor(
        private readonly dbService: DatabaseService,
        private readonly gemini: GeminiService,
    ) { }

    get db() {
        return this.dbService.client;
    }

    /**
     * Un turno de conversacion.
     *
     * Devuelve markdown crudo, la misma forma que `POST /lotes/:id/resumen`: un
     * string con saltos de linea reales que el frontend renderiza sin habilitar
     * el modo HTML de su paquete de markdown.
     *
     * TODO(SPEC 28, pasos 7 a 12): contexto por SQL, bucle de herramientas con
     * su despachador, tope diario y registro en `chat_log`. Hoy responde un
     * texto fijo y no llama a Gemini.
     */
    responder(dto: PreguntarDto, usuarioId: number): Promise<string> {
        void this.db;
        void this.gemini;
        void dto;
        void usuarioId;

        return Promise.resolve('El chat todavia no esta conectado al modelo.');
    }
}
