import { createZodDto } from "nestjs-zod";
import z from "zod";
import { fechaISO } from "src/schemas/fecha.schema";

const idSchema = z.coerce.number().int().positive().optional().catch(undefined);
const fechaSchema = fechaISO().optional().catch(undefined);

const filtrosLotesFinalizadosSchema = z.object({
    nombre: z.string().trim().min(1).optional().catch(undefined),
    producto_id: idSchema,
    origen_id: idSchema,
    finalizado_por: idSchema,
    desde: fechaSchema,
    hasta: fechaSchema,
});

export class FiltrosLotesFinalizadosDto extends createZodDto(filtrosLotesFinalizadosSchema) { }
