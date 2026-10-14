import { createZodDto } from "nestjs-zod";
import z from "zod";

const editarOperadoresClienteSchema = z
    .object({
        usuario_ids: z
            .array(z.number().int().positive('El usuario_id debe ser un id valido'), { error: 'Usuarios a vincular requeridos' })
            .min(1, 'Debe vincular al menos un usuario')
            .refine(
                (ids) => new Set(ids).size === ids.length,
                'No se permiten usuarios repetidos',
            ),
    });

export class EditarOperadoresClienteDto extends createZodDto(editarOperadoresClienteSchema) { }
