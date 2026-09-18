import { createZodDto } from "nestjs-zod";
import z from "zod";

const finalizarLoteSchema = z.object({
    firma_aprobador: z.string({ error: 'Firma del aprobador requerida' })
        .max(500000, 'La firma no puede exceder los 500000 caracteres')
        .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/, 'La firma debe ser un data URL de PNG en base64'),
});

export class FinalizarLoteDto extends createZodDto(finalizarLoteSchema) { }
