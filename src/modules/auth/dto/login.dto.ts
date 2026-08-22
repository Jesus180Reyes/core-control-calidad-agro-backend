
import { createZodDto } from "nestjs-zod";
import z from "zod";

const loginSchema = z
    .object({
        username: z
            .string()
            .min(2, 'El nombre de usuario debe tener al menos 2 caracteres'),
        password: z
            .string()
            .min(8, 'La contraseña debe tener al menos 8 caracteres'),

    });

export class LoginUserDto extends createZodDto(loginSchema) { }