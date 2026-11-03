import { createZodDto } from "nestjs-zod";
import z from "zod";

const filtrosUsuariosSchema = z.object({
    nombre: z.string().trim().min(1).optional(),
    cedula: z.string().trim().min(1).optional(),
    rol_id: z.coerce.number().int().positive().optional(),
});

export class FiltrosUsuariosDto extends createZodDto(filtrosUsuariosSchema) { }
