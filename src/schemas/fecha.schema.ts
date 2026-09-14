import z from "zod";

/**
 * Fecha 'YYYY-MM-DD' que se queda como texto: convertirla a Date la
 * desplazaria a UTC y mysql2 la reserializaria en la zona local del proceso,
 * corriendo el dia respecto de la columna contra la que se compara.
 *
 * Devuelve el esquema base, sin politica: cada DTO decide si el campo es
 * obligatorio o si es un filtro que se ignora cuando viene invalido
 * (`.optional().catch(undefined)`, la convencion del SPEC 16).
 */
export const fechaISO = (campo = 'La fecha') =>
    z
        .string({ error: `${campo} es requerida` })
        .regex(/^\d{4}-\d{2}-\d{2}$/, `${campo} debe tener el formato YYYY-MM-DD`)
        .refine((v) => {
            const fecha = new Date(`${v}T00:00:00Z`);
            return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(v);
        }, `${campo} no es una fecha valida`);
