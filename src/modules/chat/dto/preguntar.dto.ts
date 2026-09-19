import { createZodDto } from 'nestjs-zod';
import z from 'zod';

/**
 * Un turno del historial. Solo viajan los de `usuario` y `asistente`: los
 * resultados de herramientas de turnos anteriores no se reenvian nunca, porque
 * caducan —un resultado guardado dice lo que era verdad hace tres turnos— y
 * porque repetirlos multiplica el contexto en cada vuelta.
 *
 * El tope de 4000 caracteres por mensaje es el mismo que `GeminiService` acepta
 * como salida del chat, asi que un turno que el backend produjo siempre cabe de
 * vuelta.
 */
const mensajeSchema = z.object({
    rol: z.enum(['usuario', 'asistente'], { error: 'Rol invalido' }),
    contenido: z
        .string({ error: 'Contenido requerido' })
        .trim()
        .min(1, 'El contenido no puede estar vacio')
        .max(4000, 'El contenido no puede exceder los 4000 caracteres'),
});

/**
 * Cuerpo de `POST /chat`.
 *
 * El historial lo manda el frontend en cada peticion y el backend se queda con
 * los ULTIMOS 10 mensajes, asi que aqui no se limita cuantos llegan: recortar
 * es de `construirContents`, no del DTO, y devolver un 400 por tener una
 * conversacion larga seria un error del backend disfrazado de validacion.
 *
 * El historial que viaja por el cliente es falsificable. No se mitiga aqui sino
 * en el despachador, que valida cada id contra el contexto que el servidor
 * resolvio por SQL: un historial forjado logra como mucho que el modelo
 * *intente* algo.
 *
 * Ninguna clave usa `.catch()`: esto no es un DTO de filtros, es el cuerpo de
 * una escritura, y un mensaje vacio tiene que responder 400 y no colarse como
 * `undefined`. El unico `.transform()` de aqui es el `.trim()`, que es
 * idempotente y por tanto sobrevive a la doble pasada de pipes globales que
 * documenta CLAUDE.md.
 */
const preguntarSchema = z.object({
    mensaje: z
        .string({ error: 'Mensaje requerido' })
        .trim()
        .min(1, 'El mensaje no puede estar vacio')
        .max(500, 'El mensaje no puede exceder los 500 caracteres'),
    conversacion: z
        .uuid('La conversacion debe ser un UUID')
        .optional(),
    historial: z.array(mensajeSchema).optional(),
});

export class PreguntarDto extends createZodDto(preguntarSchema) { }
