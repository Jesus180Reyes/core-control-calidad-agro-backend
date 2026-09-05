import { createZodDto } from "nestjs-zod";
import z from "zod";

// Fecha como texto 'YYYY-MM-DD': convertirla a Date la desplazaria a UTC y
// mysql2 la reserializaria en la zona local del proceso, corriendo el filtro
// varias horas respecto de created_at.
const fechaSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => {
        const fecha = new Date(`${v}T00:00:00Z`);
        return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(v);
    })
    .optional()
    .catch(undefined);

const filtrosPesajesLoteSchema = z.object({
    usuario_id: z.coerce.number().int().positive().optional().catch(undefined),
    estado_calidad_id: z.coerce.number().int().positive().optional().catch(undefined),
    fuera_de_rango: z.union([
        z.enum(['true', 'false']).transform((v) => (v === 'true' ? 1 : 0)),
        z.union([z.literal(0), z.literal(1)]),
    ]).optional().catch(undefined),
    desde: fechaSchema,
    hasta: fechaSchema,
});

export class FiltrosPesajesLoteDto extends createZodDto(filtrosPesajesLoteSchema) { }
