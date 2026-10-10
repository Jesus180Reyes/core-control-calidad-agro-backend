import { createZodDto } from "nestjs-zod";
import z from "zod";
import { fechaISO } from "src/schemas/fecha.schema";

// SPEC 35 rompe a proposito la convencion del SPEC 16: ningun campo lleva
// .catch(undefined), asi que un valor invalido responde 400 en lugar de
// ignorarse. Un dashboard que muestra "todo" porque un id mal escrito se
// descarto en silencio es peor que un error visible. Un param desconocido
// sigue sin dar 400: Zod lo descarta.
// z.coerce.number() es la unica transformacion y es idempotente, que es lo que
// exige el ZodValidationPipe registrado dos veces.
const filtrosMetricasCalidadSchema = z
    .object({
        desde: fechaISO('La fecha desde').optional(),
        hasta: fechaISO('La fecha hasta').optional(),
        cliente_id: z.coerce.number().int().positive().optional(),
        usuario_id: z.coerce.number().int().positive().optional(),
    })
    .refine(
        // 'YYYY-MM-DD' se ordena igual como texto que como fecha.
        (f) => !f.desde || !f.hasta || f.desde <= f.hasta,
        { message: 'La fecha desde no puede ser posterior a la fecha hasta', path: ['desde'] },
    );

export class FiltrosMetricasCalidadDto extends createZodDto(filtrosMetricasCalidadSchema) { }
