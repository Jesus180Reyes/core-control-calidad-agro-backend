import { createZodDto } from "nestjs-zod";
import z from "zod";

const filtrosHistorialSchema = z.object({
    lote_id: z.coerce.number().int().positive().optional().catch(undefined),
    cliente_id: z.coerce.number().int().positive().optional().catch(undefined),
    estado_calidad_id: z.coerce.number().int().positive().optional().catch(undefined),
    // La union con 0|1 hace el schema idempotente: el ZodValidationPipe global corre dos veces
    // (APP_PIPE + useGlobalPipes) y la segunda pasada recibe el valor ya convertido a tinyint.
    fuera_de_rango: z.union([
        z.enum(['true', 'false']).transform((v) => (v === 'true' ? 1 : 0)),
        z.union([z.literal(0), z.literal(1)]),
    ]).optional().catch(undefined),
    nombre: z.string().trim().min(1).optional().catch(undefined),
    desde: z.iso.date().optional().catch(undefined),
    hasta: z.iso.date().optional().catch(undefined),
});

export class FiltrosHistorialDto extends createZodDto(filtrosHistorialSchema) { }
