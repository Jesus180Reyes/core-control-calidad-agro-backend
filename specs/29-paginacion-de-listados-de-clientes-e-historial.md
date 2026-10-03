# SPEC 29 — Paginación de listados de clientes e historial

> **Status:** Implemented
> **Depends on:** SPEC 01 (crea `GET /clientes`), SPEC 08 (crea `GET /clientes/all`), SPEC 15 (crea `GET /pesajes/historial`), SPEC 16 (define la convención de query params que la paginación sigue), SPEC 17 (filtros de `GET /clientes/all`, que conviven con la paginación), SPEC 22 (Swagger, donde hay que actualizar dos descripciones)
> **Date:** 2026-10-03
> **Objective:** Agregar paginación opcional por `?pagina` y `?limite` a `GET /clientes/all`, `GET /clientes` y `GET /pesajes/historial`, devolviendo una clave hermana `paginacion` solo cuando se pagina.

---

## Why this spec exists

Ninguna lectura del proyecto tiene paginación ni límite, y varios specs anteriores lo registraron como diferido. Estas tres son las listas que más crecen y las que el frontend pinta como tabla: todos los clientes, la cartera y el historial de pesajes de quien entra.

Este spec toma tres decisiones que conviene tener claras antes de leer el resto.

**La primera: la paginación es opcional.** Sin `?pagina` ni `?limite` la respuesta es **byte-idéntica** a la de hoy. Es la misma regla que los SPEC 16 y 17 aplicaron a sus filtros, y por la misma razón: no romper ningún frontend que ya consume estas rutas. El costo, aceptado, es que pedir la lista completa sigue siendo posible.

**La segunda: un parámetro de paginación nunca produce un 400.** Un valor ilegible se ignora y un límite excesivo se topa, en los tres endpoints por igual. Es la convención del SPEC 16. Hay que notarlo en `GET /clientes/all`, porque ahí sus filtros **sí** devuelven 400 desde el SPEC 17: en esa ruta conviven dos políticas, y la de la paginación es la permisiva.

**La tercera: no se agrega desempate por `id` al orden.** Paginar con `LIMIT`/`OFFSET` sobre un orden con empates es inestable, y se acepta a conciencia (ver Risks). El orden de las tres rutas queda exactamente como está.

---

## Scope

**In:**

- Query params opcionales `pagina` y `limite` en `GET /clientes/all`, `GET /clientes` y `GET /pesajes/historial`.
- Paginación por offset: `LIMIT limite OFFSET (pagina - 1) * limite`.
- Una consulta `COUNT` adicional por petición paginada, para devolver `total` y `total_paginas`.
- Clave `paginacion` en la respuesta, presente **solo** cuando se pagina.
- Esquema compartido en `src/schemas/paginacion.schema.ts`.
- DTO nuevo `src/modules/clientes/dto/paginacion-clientes.dto.ts` para `GET /clientes`, que hoy no acepta query params.
- Actualizar las descripciones Swagger de `GET /clientes` y `GET /pesajes/historial`, que hoy dicen "no acepta ningún query param" y "Sin paginación".
- Actualizar `CLAUDE.md` en los puntos que afirman que ninguna lectura tiene paginación.

**Out of scope (for future specs):**

- Paginación en cualquier otra lectura: `GET /pesajes/byLote/:loteId`, las cuatro `GET /lotes/cliente/:clienteId*`, `GET /documentos-fiscales`, los tres `catalogos`.
- Paginación por cursor (keyset).
- Desempate por `id` en el orden de las tres rutas.
- Filtros en `GET /clientes`: sigue sin aceptar ninguno. Solo gana los dos params de paginación.
- Hacer obligatoria la paginación o imponer un límite por defecto a las peticiones sin parámetros.
- Cabeceras HTTP de paginación (`X-Total-Count`, `Link`).
- Las herramientas del chat del SPEC 28. `ChatRepository` tiene sus propias copias de estas consultas y no se tocan.
- Unificar la política de 400 de los filtros de `GET /clientes/all` con la del SPEC 16.

---

## Data model

Este spec no agrega tablas ni columnas, y no aplica DDL.

### Query params

| Param | Tipo | Válido | Inválido |
| --- | --- | --- | --- |
| `pagina` | entero ≥ 1 | se usa | `abc`, `0`, `-1`, `2.5`, vacío → se ignora |
| `limite` | entero ≥ 1 | se usa; si pasa de **100** se topa a **100** | `abc`, `0`, `-1`, `2.5`, vacío → se ignora |

Constantes, en `src/schemas/paginacion.schema.ts`:

```ts
export const LIMITE_POR_DEFECTO = 20;
export const LIMITE_MAXIMO = 100;
```

### Cuándo se pagina

- Se pagina si **al menos uno** de los dos params llega válido tras el pipe.
- El que falte toma su default: `pagina = 1`, `limite = 20`.
- Si los dos faltan o los dos son inválidos, **no se pagina**: misma respuesta que hoy, sin consulta `COUNT` y sin clave `paginacion`.

### Esquema compartido

`src/schemas/paginacion.schema.ts` exporta un objeto de forma Zod con `pagina` y `limite`. Cada uno es `z.coerce.number().int().positive()` con `.optional().catch(undefined)`. `limite` lleva además un `.transform()` que topa a `LIMITE_MAXIMO`.

Ese transform es **idempotente** y tiene que seguir siéndolo. El pipe global se ejecuta dos veces (ver `CLAUDE.md`), así que la segunda pasada recibe `100` y devuelve `100`. No cambia el tipo: entra un número y sale un número.

Los tres DTOs lo componen así:

- `FiltrosClientesDto` suma `pagina` y `limite` a sus cuatro filtros. Los filtros siguen **sin** `.catch()` y siguen dando 400; la paginación lleva `.catch()` y nunca da 400.
- `FiltrosHistorialDto` suma `pagina` y `limite` a sus siete filtros.
- `PaginacionClientesDto`, nuevo, contiene solo `pagina` y `limite`.

### Respuesta

Sin paginar, idéntica a hoy:

```ts
{ ok, msg, clientes }   // o pesajes
```

Paginando:

```ts
{
  ok, msg,
  clientes,             // o pesajes: solo las filas de la página
  paginacion: {
    pagina: number,        // la pedida, aunque esté fuera de rango
    limite: number,        // el efectivo, ya topado
    total: number,         // filas que cumplen los filtros, sin LIMIT
    total_paginas: number  // Math.ceil(total / limite); 0 si total es 0
  }
}
```

Una página por encima de la última responde **200** con el array vacío y la `paginacion` real. Por ejemplo, `?pagina=99` sobre 45 filas con `limite=20` da `{ pagina: 99, limite: 20, total: 45, total_paginas: 3 }`.

### El `COUNT`

- Aplica **exactamente** los mismos `JOIN` y `WHERE` que la consulta de filas, sin `ORDER BY` ni `LIMIT`.
- Vuelve del driver como `string | number` (`BIGINT`): envolver en `Number()`.
- Va **antes** de la consulta de filas, en la misma conexión, y fuera de cualquier transacción porque las dos son lecturas.
- Implica reestructurar los tres métodos del repositorio: hoy encadenan `.select()` antes de los `.where()`. Hay que construir primero una base con `JOIN` + `WHERE` y derivar de ella las dos consultas.

---

## Implementation plan

1. Crear `src/schemas/paginacion.schema.ts` con las dos constantes y la forma Zod de `pagina` y `limite`. Sin conectar a nada todavía.
2. `GET /pesajes/historial`: sumar la paginación a `FiltrosHistorialDto` y reestructurar `getHistorialByUsuario` en base + `COUNT` + filas. El repositorio devuelve las filas y, solo si se pagina, el objeto `paginacion`. El controller agrega la clave únicamente cuando existe. Prueba manual: sin params la respuesta es idéntica a la de antes; `?pagina=1&limite=5` devuelve 5 filas y `paginacion`.
3. `GET /clientes/all`: sumar la paginación a `FiltrosClientesDto` y reestructurar `getAllClientes` de la misma forma. Prueba manual: `?pagina=abc&producto_id=abc` responde 400 por `producto_id`, nunca por `pagina`.
4. `GET /clientes`: crear `PaginacionClientesDto`, agregar `@Query()` al handler `findAll` y pasar el DTO por servicio y repositorio hasta `getAllClientesByOperador`. Prueba manual: `?nombre=agro` sigue ignorándose.
5. Actualizar las descripciones `@ApiOperation` de `GET /clientes` (ya no es "NO acepta ningún query param") y `GET /pesajes/historial` (ya no es "Sin paginación"). Agregar a las tres la frase sobre paginación opcional, el tope de 100 y el array vacío fuera de rango. Ninguna `@ApiResponse`, como el resto del proyecto.
6. Actualizar `CLAUDE.md`: la tabla de endpoints de `clientes` y `pesajes`, y las menciones a "No pagination" y "Pagination, which no read in the project has".

---

## Acceptance criteria

- [X] `GET /clientes/all` sin params responde byte-idéntico a antes de este spec y sin clave `paginacion`.
- [X] `GET /clientes` sin params responde byte-idéntico a antes de este spec y sin clave `paginacion`.
- [X] `GET /pesajes/historial` sin params responde byte-idéntico a antes de este spec y sin clave `paginacion`.
- [X] `?pagina=1&limite=5` en cada una de las tres rutas devuelve como máximo 5 filas y una clave `paginacion` con `pagina: 1` y `limite: 5`.
- [X] `paginacion.total` coincide con la cantidad de filas que devuelve la misma ruta sin paginar y con los mismos filtros.
- [X] La concatenación de todas las páginas de `?limite=5` contiene la misma cantidad de filas que la respuesta sin paginar.
- [X] `?pagina=2` sin `limite` pagina con `limite: 20`.
- [X] `?limite=10` sin `pagina` devuelve la página 1.
- [X] `?limite=500` responde 200 con `paginacion.limite: 100`.
- [X] `?pagina=abc`, `?pagina=0`, `?pagina=-1` y `?limite=0` responden 200, nunca 400, en las tres rutas.
- [X] `?pagina=abc&limite=abc` responde igual que sin params: sin clave `paginacion`.
- [X] `?pagina=99` sobre una lista de menos de 99 páginas responde 200 con el array vacío y `total`/`total_paginas` reales.
- [X] Una lista vacía paginada responde `total: 0` y `total_paginas: 0`.
- [X] `GET /clientes/all?producto_id=abc&pagina=1` sigue respondiendo 400 por `producto_id`.
- [X] `GET /clientes/all?nombre=x&pagina=1&limite=5` aplica el filtro y la paginación a la vez, y `total` cuenta solo las filas filtradas.
- [X] `GET /pesajes/historial?pagina=1&usuario_id=<otro>` sigue devolviendo solo los pesajes del usuario del token.
- [X] `GET /clientes?nombre=agro&pagina=1` ignora `nombre` y pagina la cartera completa.
- [X] Las tres rutas muestran `pagina` y `limite` como query params en `/docs`.
- [X] Las herramientas del chat (`POST /chat`) devuelven lo mismo que antes de este spec.
- [X] `npm run lint` pasa sin errores.
- [X] `npm run test` pasa.

---

## Decisions

- **Sí:** paginación opcional, con respuesta byte-idéntica sin params. **No:** obligatoria con default, que rompe a todo frontend que hoy consume la lista completa. Es la regla de los SPEC 16 y 17.
- **Sí:** offset con `pagina` + `limite`. **No:** `offset` + `limit` crudos, porque obligan al frontend a calcular el desplazamiento. **No:** cursor, porque no permite saltar a una página ni dar un total barato, y se complica con el orden por `nombre` de `GET /clientes`.
- **Sí:** nombres en español, `pagina` y `limite`, como el resto de los query params del proyecto (`desde`, `hasta`, `nombre`).
- **Sí:** clave hermana `paginacion` solo cuando se pagina. **No:** incluirla siempre, que rompe la respuesta byte-idéntica. **No:** cabeceras HTTP, porque ningún endpoint del proyecto transporta datos por cabecera y habría que exponerlas por CORS.
- **Sí:** el array conserva su clave (`clientes`, `pesajes`). Así un frontend que no conoce la paginación sigue leyendo la misma clave.
- **Sí:** un param de paginación inválido se ignora, en las tres rutas. **No:** 400, que contradice el SPEC 16. **No:** política por endpoint, que haría que `?pagina=abc` respondiera distinto según la ruta.
- **Sí:** un `limite` excesivo se **topa** a 100 en vez de ignorarse. Es un valor legible con una intención clara, y ignorarlo devolvería la lista completa, justo lo contrario de lo pedido.
- **Sí:** 20 por defecto y 100 de tope.
- **Sí:** basta un param válido para paginar, y el otro toma su default. **No:** exigir los dos, porque olvidar uno devolvería la lista completa sin aviso.
- **Sí:** `COUNT` en cada petición paginada. Es lo que permite `total` y `total_paginas`, que la paginación por offset promete.
- **Sí:** página fuera de rango → 200 con array vacío y la paginación real. **No:** recortar a la última página, que oculta el error del cliente y obliga a contar antes de consultar.
- **No:** desempate por `id` en el orden. Decisión explícita: el orden de las tres rutas queda como está. El costo está en Risks.
- **Sí:** esquema compartido en `src/schemas/`, el directorio que el SPEC 25 creó para esto. **No:** copiar el bloque en cada DTO, que es exactamente la deuda que `CLAUDE.md` ya señala para `fechaISO` en `pesajes`.
- **Sí:** `GET /clientes` gana un `@Query()` solo con paginación. **No:** darle también los filtros de `/all`. El SPEC 17 decidió que la cartera no los tiene, y eso no se reabre aquí.
- **No:** tocar `ChatRepository`. Sus herramientas ya tienen tope propio (10 por defecto, 50 de tope) y copias propias de las consultas.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Sin desempate por `id`, dos filas con el mismo `created_at` (o el mismo `nombre` en `GET /clientes`) pueden intercambiar posición entre consultas. Una fila puede salir en dos páginas, o en ninguna | Aceptado a conciencia. Es más probable en `GET /pesajes/historial`, donde varios pesajes pueden caer en el mismo segundo. Si el frontend lo reporta, la solución es agregar `id` como segundo criterio, en un spec propio |
| Un registro insertado o rechazado entre dos peticiones desplaza el offset, y la página siguiente repite o salta una fila | Aceptado; es inherente a la paginación por offset. El cursor quedó fuera de alcance |
| El `COUNT` y la consulta de filas no van en una transacción, así que `total` puede no coincidir con las filas de un instante a otro | Aceptado. Son dos lecturas, y bajo esta carga la ventana es mínima |
| En `GET /clientes/all` conviven dos políticas: un filtro inválido da 400 y un param de paginación inválido se ignora | Documentado en la descripción Swagger y en `CLAUDE.md`. Unificarlas es su propio spec |
| La paginación es opcional, así que pedir la lista completa sigue siendo posible y sigue sin límite | Aceptado: es el precio de no romper los frontends actuales. Hacerla obligatoria es su propio spec |
| El `.transform()` de `limite` deja de ser idempotente si alguien cambia el tipo de salida, y la doble ejecución del pipe lo descarta en silencio | El esquema lo documenta en un comentario, como pide `CLAUDE.md` para todo `.transform()` |

---

## What is **not** in this spec

- Paginación en `GET /pesajes/byLote/:loteId`, en las cuatro `GET /lotes/cliente/:clienteId*`, en `GET /documentos-fiscales` y en los `catalogos`.
- Paginación por cursor.
- Desempate por `id` en el orden.
- Filtros en `GET /clientes`.
- Paginación obligatoria o límite por defecto sin params.
- Cabeceras HTTP de paginación.
- Cambios en las herramientas del chat.
- Unificar la política de 400 de los filtros de `GET /clientes/all`.

Cada una, si llega, va en su propio spec.
