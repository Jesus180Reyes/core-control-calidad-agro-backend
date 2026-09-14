import { createZodDto } from "nestjs-zod";
import z from "zod";

const completarDocumentoFiscalSchema = z
    .object({
        documento_aduanero: z.string().trim().min(1, 'El documento aduanero no puede ir vacio').max(50, 'El documento aduanero no puede exceder los 50 caracteres').optional(),
        archivo_url: z.string().trim().min(1, 'El archivo_url no puede ir vacio').max(255, 'El archivo_url no puede exceder los 255 caracteres').optional(),
    })
    .refine(
        (body) => body.documento_aduanero !== undefined || body.archivo_url !== undefined,
        'Debe enviar documento_aduanero, archivo_url o ambos',
    );

export class CompletarDocumentoFiscalDto extends createZodDto(completarDocumentoFiscalSchema) { }
