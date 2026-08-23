import { createZodDto } from "nestjs-zod";
import z from "zod";

const createLoteSchema = z
    .object({
        cliente_id: z.number({ error: 'Cliente requerido' }).int().positive('El cliente_id debe ser un id valido'),
        nombre_lote: z.string({ error: 'Nombre de lote requerido' }).min(1, 'El nombre del lote es requerido'),
        producto_id: z.number({ error: 'Producto requerido' }).int().positive('El producto_id debe ser un id valido'),
        unidad_medida_id: z.number({ error: 'Unidad de medida requerida' }).int().positive('El unidad_medida_id debe ser un id valido'),
        peso_minimo: z.number({ error: 'Peso minimo requerido' }).positive('El peso minimo debe ser mayor a 0'),
        peso_ideal: z.number({ error: 'Peso ideal requerido' }).positive('El peso ideal debe ser mayor a 0'),
        peso_maximo: z.number({ error: 'Peso maximo requerido' }).positive('El peso maximo debe ser mayor a 0'),
        variedad_o_talla: z.string().optional(),
    })
    .refine((data) => data.peso_minimo <= data.peso_ideal, {
        error: 'El peso minimo no puede ser mayor al peso ideal',
        path: ['peso_minimo'],
    })
    .refine((data) => data.peso_ideal <= data.peso_maximo, {
        error: 'El peso ideal no puede ser mayor al peso maximo',
        path: ['peso_ideal'],
    });

export class CreateLoteDto extends createZodDto(createLoteSchema) { }
