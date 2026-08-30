import { createZodDto } from "nestjs-zod";
import z from "zod";

const createClienteSchema = z
    .object({
        nombre: z.string().min(1, 'El nombre es requerido'),
        rtn: z.string().min(1, 'El RTN es requerido'),
        producto_id: z.number({ error: 'Producto requerido' }).int().positive('El producto_id debe ser un id valido'),
        codigo_exportacion: z.string({ error: 'Codigo de exportacion requerido' }),
        correo_contacto: z.email().optional(),
        telefono: z.string().optional(),
        direccion_planta: z.string().optional(),
        ubicacionLongitud: z.string().optional(),
        ubicacionLatitude: z.string().optional(),
        usuario_ids: z
            .array(z.number().int().positive('El usuario_id debe ser un id valido'), { error: 'Usuarios a vincular requeridos' })
            .min(1, 'Debe vincular al menos un usuario'),
    });

export class CreateClienteDto extends createZodDto(createClienteSchema) { }
