import { createZodDto } from "nestjs-zod";
import z from "zod";

/**
 * Body de POST /auth/refresh (spec 50). Solo exige un string no vacio: si es
 * un JWT valido, de quien y si esta vencido lo decide el repositorio con
 * `JWT_REFRESH_SECRET`, que responde 401 en cualquier fallo de firma.
 */
const refreshTokenSchema = z
    .object({
        refreshToken: z
            .string({ error: 'El refreshToken es obligatorio' })
            .min(1, 'El refreshToken es obligatorio'),
    });

export class RefreshTokenDto extends createZodDto(refreshTokenSchema) { }
