import { createZodDto } from "nestjs-zod";
import z from "zod";
import { paginacionShape } from "src/schemas/paginacion.schema";
import { fechaISO } from "src/schemas/fecha.schema";

const fechaSchema = fechaISO().optional().catch(undefined);

const filtrosHistorialSchema = z.object({
    lote_id: z.coerce.number().int().positive().optional().catch(undefined),
    cliente_id: z.coerce.number().int().positive().optional().catch(undefined),
    estado_calidad_id: z.coerce.number().int().positive().optional().catch(undefined),
    fuera_de_rango: z.union([
        z.enum(['true', 'false']).transform((v) => (v === 'true' ? 1 : 0)),
        z.union([z.literal(0), z.literal(1)]),
    ]).optional().catch(undefined),
    nombre: z.string().trim().min(1).optional().catch(undefined),
    desde: fechaSchema,
    hasta: fechaSchema,
    ...paginacionShape,
});

export class FiltrosHistorialDto extends createZodDto(filtrosHistorialSchema) { }
