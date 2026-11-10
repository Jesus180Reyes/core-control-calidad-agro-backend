import { createZodDto } from "nestjs-zod";
import z from "zod";

const obtenerParametroSchema = z.object({
    nombre: z.string().trim().min(1, 'El nombre del parametro no puede ir vacio').max(100, 'El nombre del parametro no puede exceder los 100 caracteres'),
});

export class ObtenerParametroDto extends createZodDto(obtenerParametroSchema) { }
