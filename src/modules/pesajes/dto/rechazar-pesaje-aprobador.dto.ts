import { createZodDto } from "nestjs-zod";
import z from "zod";

// SPEC 47: el rechazo del aprobador exige el destino del producto. La anulacion
// del operador sigue con RechazarPesajeDto, sin destino.
const rechazarPesajeAprobadorSchema = z.object({
    motivo: z.string({ error: 'Motivo requerido' }).min(5, 'El motivo de rechazo debe tener al menos 5 caracteres').max(255, 'El motivo no puede exceder los 255 caracteres'),
    destino_id: z
        .number()
        .int('El destino_id debe ser un id valido')
        .positive('El destino_id debe ser un id valido'),
});

export class RechazarPesajeAprobadorDto extends createZodDto(rechazarPesajeAprobadorSchema) { }
