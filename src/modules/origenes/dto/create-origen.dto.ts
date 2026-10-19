import { createZodDto } from "nestjs-zod";
import z from "zod";

// SPEC 43: los maximos son los largos de las columnas (STRICT_TRANS_TABLES haria
// un 500 de MySQL). direccion y telefono no aceptan null ni cadena vacia: si no
// se tienen, no se mandan. Un cliente_id en el cuerpo se descarta, como cualquier
// clave desconocida: el catalogo es global.
const createOrigenSchema = z.object({
    nombre: z.string().trim().min(1, 'El nombre no puede ir vacio').max(150, 'El nombre no puede exceder los 150 caracteres'),
    direccion: z.string().trim().min(1, 'La direccion no puede ir vacia').max(255, 'La direccion no puede exceder los 255 caracteres').optional(),
    telefono: z.string().trim().min(1, 'El telefono no puede ir vacio').max(20, 'El telefono no puede exceder los 20 caracteres').optional(),
});

export class CreateOrigenDto extends createZodDto(createOrigenSchema) { }
