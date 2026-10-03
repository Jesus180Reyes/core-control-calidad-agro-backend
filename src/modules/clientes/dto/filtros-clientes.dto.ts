import { createZodDto } from "nestjs-zod";
import z from "zod";
import { paginacionShape } from "src/schemas/paginacion.schema";

// Los cuatro filtros no llevan .catch() y un valor invalido da 400; la
// paginacion si lo lleva y nunca da 400 (SPEC 29). Dos politicas en un DTO.
const filtrosClientesSchema = z.object({
    nombre: z.string().trim().min(1).optional(),
    producto_id: z.coerce.number().int().positive().optional(),
    codigo_exportacion: z.string().trim().min(1).optional(),
    rtn: z.string().trim().min(1).optional(),
    ...paginacionShape,
});

export class FiltrosClientesDto extends createZodDto(filtrosClientesSchema) { }
