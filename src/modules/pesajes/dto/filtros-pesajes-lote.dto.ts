import { createZodDto } from "nestjs-zod";
import z from "zod";

const filtrosPesajesLoteSchema = z.object({
    usuario_id: z.coerce.number().int().positive().optional().catch(undefined),
    estado_calidad_id: z.coerce.number().int().positive().optional().catch(undefined),
    fuera_de_rango: z.union([
        z.enum(['true', 'false']).transform((v) => (v === 'true' ? 1 : 0)),
        z.union([z.literal(0), z.literal(1)]),
    ]).optional().catch(undefined),
    desde: z.coerce.date().optional(),
    hasta: z.coerce.date().optional(),
});

export class FiltrosPesajesLoteDto extends createZodDto(filtrosPesajesLoteSchema) { }
