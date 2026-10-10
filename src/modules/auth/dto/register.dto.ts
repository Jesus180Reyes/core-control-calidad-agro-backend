import { createZodDto } from "nestjs-zod";
import z from "zod";

const registerSchema = z
    .object({
        username: z
            .string()
            .min(2, 'El nombre de usuario debe tener al menos 2 caracteres')
            .max(20, 'El nombre de usuario no puede exceder 20 caracteres'),
        complete_name: z
            .string()
            .min(2, 'El nombre debe tener al menos 2 caracteres')
            .max(100, 'El nombre no puede exceder 100 caracteres')
            .trim(),
        rol: z.number(),
        cedula: z.string(),


    });

export class RegisterUserDto extends createZodDto(registerSchema) { }
