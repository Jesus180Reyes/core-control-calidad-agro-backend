import { createZodDto } from "nestjs-zod";
import z from "zod";

// SPEC 41: rtn y codigo_exportacion no estan en el schema a proposito; Zod los
// descarta si llegan. Ningun campo es nullable: un dato se reemplaza, nunca se vacia.
// Los maximos son los largos de las columnas (direccion_planta es TEXT: 65535 bytes / 4).
const editarClienteSchema = z
    .object({
        nombre: z.string().trim().min(1, 'El nombre no puede ir vacio').max(100, 'El nombre no puede exceder los 100 caracteres').optional(),
        producto_id: z.number().int().positive('El producto_id debe ser un id valido').optional(),
        correo_contacto: z.email('El correo_contacto no es un correo valido').max(100, 'El correo_contacto no puede exceder los 100 caracteres').optional(),
        telefono: z.string().trim().min(1, 'El telefono no puede ir vacio').max(20, 'El telefono no puede exceder los 20 caracteres').optional(),
        direccion_planta: z.string().trim().min(1, 'La direccion_planta no puede ir vacia').max(16383, 'La direccion_planta no puede exceder los 16383 caracteres').optional(),
        ubicacionLongitud: z.string().trim().min(1, 'La ubicacionLongitud no puede ir vacia').max(100, 'La ubicacionLongitud no puede exceder los 100 caracteres').optional(),
        ubicacionLatitude: z.string().trim().min(1, 'La ubicacionLatitude no puede ir vacia').max(100, 'La ubicacionLatitude no puede exceder los 100 caracteres').optional(),
        constancia_exonerado: z.string().trim().min(1, 'La constancia_exonerado no puede ir vacia').max(50, 'La constancia_exonerado no puede exceder los 50 caracteres').optional(),
    })
    .refine(
        (body) => Object.values(body).some((valor) => valor !== undefined),
        'Debe enviar al menos un campo a editar',
    );

export class EditarClienteDto extends createZodDto(editarClienteSchema) { }
