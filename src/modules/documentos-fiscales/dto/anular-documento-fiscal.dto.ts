import { createZodDto } from "nestjs-zod";
import z from "zod";

const anularDocumentoFiscalSchema = z.object({
    motivo: z.string({ error: 'Motivo requerido' }).min(5, 'El motivo de anulacion debe tener al menos 5 caracteres').max(255, 'El motivo no puede exceder los 255 caracteres'),
});

export class AnularDocumentoFiscalDto extends createZodDto(anularDocumentoFiscalSchema) { }
