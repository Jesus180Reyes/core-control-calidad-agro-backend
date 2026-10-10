import { createZodDto } from "nestjs-zod";
import z from "zod";

const validarPinSchema = z.object({
    pin: z.string({ error: 'PIN requerido' }).regex(/^\d{4}$/, 'El PIN debe tener 4 digitos'),
});

export class ValidarPinDto extends createZodDto(validarPinSchema) { }
