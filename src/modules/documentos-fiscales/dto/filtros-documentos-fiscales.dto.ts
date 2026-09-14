import { createZodDto } from "nestjs-zod";
import z from "zod";
import { fechaISO } from "src/schemas/fecha.schema";

// Convencion del SPEC 16: todo campo es .optional().catch(undefined), asi que
// un valor invalido se ignora y la consulta corre sin el. Ningun filtro
// produce 400. z.coerce.number() es la unica transformacion y es idempotente,
// que es lo que exige el ZodValidationPipe registrado dos veces.
const filtrosDocumentosFiscalesSchema = z.object({
    cliente_id: z.coerce.number().int().positive().optional().catch(undefined),
    desde: fechaISO().optional().catch(undefined),
    hasta: fechaISO().optional().catch(undefined),
});

export class FiltrosDocumentosFiscalesDto extends createZodDto(filtrosDocumentosFiscalesSchema) { }
