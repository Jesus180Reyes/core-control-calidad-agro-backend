import { createZodDto } from "nestjs-zod";
import z from "zod";

const createPesajeSchema = z.object({
    lote_id: z.number({ error: 'Lote requerido' }).int().positive('El lote_id debe ser un id valido'),
    peso_bruto: z.number({ error: 'Peso bruto requerido' }).positive('El peso bruto debe ser mayor a 0'),
    tara: z.number({ error: 'La tara debe ser un numero' }).nonnegative('La tara no puede ser negativa').default(0),
    dispositivo_identificador: z.string().optional(),
    secuencia_dispositivo: z.number({ error: 'La secuencia del dispositivo debe ser un numero' }).int().positive('La secuencia del dispositivo debe ser mayor a 0').optional(),
});

export class CreatePesajeDto extends createZodDto(createPesajeSchema) { }
