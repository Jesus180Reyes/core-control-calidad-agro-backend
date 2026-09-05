import { createZodDto } from "nestjs-zod";
import z from "zod";

const filtrosClientesSchema = z.object({
    nombre: z.string().trim().min(1).optional(),
    producto_id: z.coerce.number().int().positive().optional(),
    codigo_exportacion: z.string().trim().min(1).optional(),
    rtn: z.string().trim().min(1).optional(),
});

export class FiltrosClientesDto extends createZodDto(filtrosClientesSchema) { }
