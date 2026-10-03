import z from "zod";

export const LIMITE_POR_DEFECTO = 20;
export const LIMITE_MAXIMO = 100;

/**
 * `?pagina` y `?limite` (SPEC 29). Se componen en el objeto de cada DTO de
 * lectura con `...paginacionShape`.
 *
 * Ninguno produce un 400: un valor ilegible (`abc`, `0`, `-1`, `2.5`, vacio)
 * se ignora con `.catch(undefined)`, la convencion del SPEC 16. Un `limite`
 * mayor que `LIMITE_MAXIMO` no se ignora: se topa, porque es legible y pide
 * pocas filas; ignorarlo devolveria la lista completa.
 *
 * El `.transform()` de `limite` tiene que seguir siendo idempotente: el pipe
 * global corre dos veces y la segunda pasada recibe lo que devolvio la
 * primera. Entra un numero y sale un numero (`100` -> `100`); si alguna vez
 * cambia el tipo de salida, el `.catch()` descartara el campo en silencio.
 */
export const paginacionShape = {
    pagina: z.coerce.number().int().positive().optional().catch(undefined),
    limite: z.coerce
        .number()
        .int()
        .positive()
        .transform((v) => Math.min(v, LIMITE_MAXIMO))
        .optional()
        .catch(undefined),
};
