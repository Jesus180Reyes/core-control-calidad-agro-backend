import { createZodDto } from "nestjs-zod";
import z from "zod";

const fechaSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => {
        const fecha = new Date(`${v}T00:00:00Z`);
        return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(v);
    })
    .optional()
    .catch(undefined);

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
});

export class FiltrosHistorialDto extends createZodDto(filtrosHistorialSchema) { }
