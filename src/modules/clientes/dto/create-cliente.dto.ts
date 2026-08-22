import { createZodDto } from "nestjs-zod";
import z from "zod";

const createClienteSchema = z
    .object({
        nombre: z.string().min(1, 'El nombre es requerido'),
        rtn: z.string().min(1, 'El RTN es requerido'),
        codigo_exportacion: z.string().optional(),
        correo_contacto: z.string().optional(),
        telefono: z.string().optional(),
        direccion_planta: z.string().optional(),
        ubicacionLongitud: z.string().optional(),
        ubicacionLatitude: z.string().optional(),
        usuario_ids: z.array(z.number()).optional(),
    });

export class CreateClienteDto extends createZodDto(createClienteSchema) { }
