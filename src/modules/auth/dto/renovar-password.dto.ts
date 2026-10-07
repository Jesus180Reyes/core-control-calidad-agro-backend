import { createZodDto } from "nestjs-zod";
import z from "zod";

const renovarPasswordSchema = z
    .object({
        username: z
            .string()
            .min(2, 'El nombre de usuario debe tener al menos 2 caracteres'),
        password_actual: z
            .string()
            .min(8, 'La contraseña debe tener al menos 8 caracteres'),
        password_nueva: z
            .string()
            .min(8, 'La nueva contraseña debe tener al menos 8 caracteres')
            .regex(/[A-Z]/, 'La nueva contraseña debe tener al menos una mayúscula')
            .regex(/[0-9]/, 'La nueva contraseña debe tener al menos un número'),
    });

export class RenovarPasswordDto extends createZodDto(renovarPasswordSchema) { }
