import { createZodDto } from "nestjs-zod";
import z from "zod";
import { paginacionShape } from "src/schemas/paginacion.schema";

// GET /clientes acepta solo paginacion (SPEC 29). Los filtros de
// GET /clientes/all no entran: el SPEC 17 decidio que la cartera no los tiene,
// y cualquier otro query param se descarta aqui sin error.
const paginacionClientesSchema = z.object({
    ...paginacionShape,
});

export class PaginacionClientesDto extends createZodDto(paginacionClientesSchema) { }
