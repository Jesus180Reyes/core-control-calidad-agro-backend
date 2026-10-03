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

/** Lo que devuelve la clave `paginacion` de la respuesta. */
export interface Paginacion {
    pagina: number;
    limite: number;
    total: number;
    total_paginas: number;
}

/**
 * Decide si una peticion se pagina y con que valores. Basta con que uno de
 * los dos params haya sobrevivido al pipe; el que falte toma su default.
 * Devuelve `null` si no llego ninguno, y entonces la lectura se comporta
 * exactamente como antes del SPEC 29: sin `COUNT`, sin `LIMIT` y sin clave
 * `paginacion`.
 */
export const resolverPaginacion = (params: {
    pagina?: number;
    limite?: number;
}) => {
    if (params.pagina === undefined && params.limite === undefined) {
        return null;
    }

    const pagina = params.pagina ?? 1;
    const limite = params.limite ?? LIMITE_POR_DEFECTO;

    return { pagina, limite, offset: (pagina - 1) * limite };
};

/**
 * Arma la clave `paginacion`. `pagina` es la pedida aunque este fuera de
 * rango, para que el frontend vea su error contra `total_paginas`.
 */
export const construirPaginacion = (
    { pagina, limite }: { pagina: number; limite: number },
    total: number,
): Paginacion => ({
    pagina,
    limite,
    total,
    total_paginas: Math.ceil(total / limite),
});
