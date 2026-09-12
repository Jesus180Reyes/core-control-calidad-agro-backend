# SPEC 24 — Listado de lotes finalizados de un cliente

> **Status:** Implemented
> **Depends on:** SPEC 02 (crea el módulo `lotes` y sus lecturas), SPEC 13 (escribe `aprobado_por`/`aprobado_en`), SPEC 20 (escribe la etapa `FINALIZADO` y el par `finalizado_por`/`finalizado_en`), SPEC 22 (Swagger, donde hay que documentar la ruta nueva)
> **Date:** 2026-09-12
> **Objective:** Agregar `GET /lotes/cliente/:clienteId/all/finalizados`, que lista los lotes en la etapa `FINALIZADO` de un cliente con los 10 campos de siempre más quién los aprobó y quién los finalizó, para que el trabajo terminado deje de ser invisible por la API.

---

## Why this spec exists

El SPEC 20 cerró el flujo de etapas y, sin quererlo, hizo desaparecer el resultado. Un lote finalizado no sale en **ninguna** lectura de `lotes`: las dos rutas `cliente/...` filtran `estado = 'abierto'` y la bandeja del aprobador filtra `etapa_id = 2`, que ya no es la etapa del lote. Lo único que queda del lote terminado son sus pesajes, a través de `GET /pesajes/byLote/:loteId` y `GET /pesajes/historial`, y para llamar al primero hay que conocer el `lote_id` de memoria.

El SPEC 20 lo dejó anotado como decisión, no como olvido: una lectura de lotes finalizados iba en su propio spec. Este es ese spec.

Tres cosas conviene tener claras antes de leer el resto.

**La primera: es la primera lectura del proyecto que devuelve columnas de auditoría.** Hoy `aprobado_por`, `aprobado_en`, `finalizado_por` y `finalizado_en` se escriben y no se leen por ningún endpoint: quién firmó un lote y cuándo solo se puede responder entrando a MySQL. En un listado de lotes terminados esa es justamente la información que se busca, así que las cuatro columnas viajan, con los dos ids resueltos a nombre por dos joins a `usuarios`.

**La segunda: la etapa se resuelve por `codigo`, nunca por un id hardcodeado.** La bandeja del aprobador —`getAllLotesByClienteForApprover`— filtra `etapa_id = 2` a mano, y `CLAUDE.md` la señala desde el SPEC 19 como el contraejemplo de la convención. Esta ruta no lo repite: hace un `SELECT` a `etapas` por `codigo = 'FINALIZADO'` y filtra por el id que devuelva, al precio de una consulta extra por petición.

**La tercera: no valida el vínculo `cliente_operador`.** Es la decimosexta ruta que se lo salta, y aquí el argumento es quién la usa: el aprobador que finalizó el lote y un `ADMIN` no tienen ninguna fila en `cliente_operador`, así que validar cerraría la pantalla justo a quien la necesita. Queda para el futuro `PermissionsGuard`, como las otras quince.

---

## Scope

**In:**

- Nuevo método `getLotesFinalizadosByCliente(clienteId)` en `src/modules/lotes/repository/lotes.repository.ts`.
- Nuevo método `findAllLotesFinalizadosByCliente(clienteId)` en `src/modules/lotes/lotes.service.ts`, pass-through al repositorio.
- Nuevo handler `@Get('cliente/:clienteId/all/finalizados')` en `src/modules/lotes/lotes.controller.ts`, con `@Param('clienteId', ParseIntPipe)`, declarado **después** de `@Get('cliente/:clienteId/all/approver')` y antes del `@Post()`.
- Nuevo endpoint `GET /lotes/cliente/:clienteId/all/finalizados`, protegido solo por el `JwtAuthGuard` global.
- La etapa se resuelve llamando al `resolveEtapa('FINALIZADO', this.db)` que ya existe en el repositorio; el filtro usa el id que devuelva.
- La consulta reusa los **tres `LEFT JOIN`** de las lecturas existentes —`productos`, `unidades_medida`, `etapas`— y agrega **dos más a `usuarios`**, uno por cada par de auditoría.
- Devuelve **14 campos**: los 10 de las tres lecturas hermanas, más `aprobado_por`, `aprobado_en`, `finalizado_por` y `finalizado_en`.
- Ordena por `lotes.finalizado_en DESC`.
- Respuesta `200` con la forma `{ ok, msg, lotes }`, misma clave que las tres rutas hermanas.
- `@ApiOperation` y `@ApiParam` en el handler, siguiendo el estilo del SPEC 22: resumen, descripción y nada de `@ApiResponse`.
- Actualizar `CLAUDE.md`: el endpoint nuevo, los conteos que cambian y el hecho de que la frase "un lote finalizado no aparece en ninguna lectura" deja de ser cierta.

**Out of scope (for future specs):**

- **`GET /lotes/:id`.** Decisión explícita: este spec abre solo el listado. El detalle de un lote por id sigue sin existir, y con él la trampa de ruta que describe `CLAUDE.md`.
- **`GET /clientes/:id`.** Igual que arriba, y ya estaba fuera del SPEC 21.
- **Listar lotes rechazados**, y cualquier listado de lotes cerrados que no estén en `FINALIZADO`.
- **Un listado global de finalizados**, sin `clienteId`. Esta ruta es por cliente, como sus tres hermanas.
- **Query params y filtros de cualquier tipo**, incluidos `?desde` y `?hasta` sobre `finalizado_en`. Los filtros de `lotes` son del SPEC 18, que sigue en `Draft`.
- **Paginación y límite.** No los tiene ninguna lectura del proyecto.
- **Agregados del lote**: total de kilos, conteo de pesajes por estado de calidad, cuántos fuera de rango, cuántos aprobados. El cierre como cómputo sigue sin existir y es su propio spec.
- **`resumen_ia`.** Ninguna lectura de `lotes` lo expone y esta tampoco.
- **Devolver los pesajes del lote** dentro de la respuesta. Para eso ya está `GET /pesajes/byLote/:loteId`.
- **La terna de rechazo** `motivo_rechazo`/`rechazado_por`/`rechazado_en` como campos. En un lote finalizado son siempre `null`.
- **Los ids crudos** `aprobado_por` y `finalizado_por`. Viajan resueltos a nombre, no como número.
- **Agregar la auditoría a las tres lecturas existentes.** `GET /lotes/cliente/:clienteId`, `/all` y `/all/approver` no cambian ni un campo.
- **Arreglar el `etapa_id = 2` hardcodeado** de `getAllLotesByClienteForApprover`. Sigue donde está; este spec solo evita repetirlo.
- **Deshacer una finalización** o reabrir un lote.
- Validar el vínculo `cliente_operador`, exigir un rol, o un `PermissionsGuard`.
- Sembrar filas en `catalogo_permisos` o en `permisos`.
- DDL de cualquier tipo, y cambios a `src/database/types/types.ts`.
- Cambios a cualquier endpoint de `pesajes`, `clientes`, `auth`, `permisos` o `catalogos`.
- Tests de cualquier tipo: el proyecto sigue sin un solo `*.spec.ts`.

---

## Data model

**Este spec no introduce estructuras de datos.** No hay DDL, no hay tabla nueva, no hay columna nueva, `src/database/types/types.ts` no cambia y no se agrega ninguna variable de entorno. Todas las columnas que se leen ya existen: `lotes.aprobado_por` y `lotes.aprobado_en` desde el SPEC 13, `lotes.finalizado_por` y `lotes.finalizado_en` desde el SPEC 20.

### Archivos

| Archivo | Cambio |
| --- | --- |
| `src/modules/lotes/repository/lotes.repository.ts` | Método nuevo `getLotesFinalizadosByCliente` |
| `src/modules/lotes/lotes.service.ts` | Método nuevo `findAllLotesFinalizadosByCliente`, pass-through |
| `src/modules/lotes/lotes.controller.ts` | Handler nuevo `@Get('cliente/:clienteId/all/finalizados')` con sus decoradores de Swagger |
| `CLAUDE.md` | Endpoint nuevo, conteos y la consecuencia sobre la visibilidad del lote finalizado |

**Ningún archivo nuevo, ningún DTO, ningún módulo nuevo.** `lotes.module.ts` no cambia.

### Los 14 campos de la respuesta

| Campo | Origen | Nota |
| --- | --- | --- |
| `id` | `lotes.id` | |
| `nombre_lote` | `lotes.nombre_lote` | |
| `variedad_o_talla` | `lotes.variedad_o_talla` | nullable |
| `producto` | `productos.nombre` | `LEFT JOIN` |
| `unidad_medida` | `unidades_medida.nombre` | `LEFT JOIN` |
| `peso_minimo` | `lotes.peso_minimo` | decimal, viaja como llega del driver |
| `peso_ideal` | `lotes.peso_ideal` | ídem |
| `peso_maximo` | `lotes.peso_maximo` | ídem |
| `estado` | `lotes.estado` | siempre `'cerrado'` aquí |
| `etapa` | `etapas.nombre` | siempre la fila `FINALIZADO` |
| `aprobado_por` | `usuarios.complete_name` del aprobador | **campo nuevo**, `LEFT JOIN` con alias |
| `aprobado_en` | `lotes.aprobado_en` | **campo nuevo** |
| `finalizado_por` | `usuarios.complete_name` del finalizador | **campo nuevo**, `LEFT JOIN` con alias |
| `finalizado_en` | `lotes.finalizado_en` | **campo nuevo** |

Los 10 primeros son exactamente los de `getLotesByCliente`, `getAllLotesByCliente` y `getAllLotesByClienteForApprover`, con los mismos alias y en el mismo orden. Los cuatro nuevos van al final.

**Los dos `*_por` viajan como nombre, no como id.** Es la misma convención que `productos.nombre as producto`. El id del usuario no viaja en ningún campo.

**Los pesos no se coercionan.** Las tres lecturas existentes devuelven `peso_minimo`, `peso_ideal` y `peso_maximo` tal como los entrega el driver, y esta hace lo mismo para que la forma siga siendo intercambiable. No se agrega `Number()` aquí ni allá.

**Las fechas no se mapean.** `aprobado_en` y `finalizado_en` salen tal cual y Nest las serializa; no hay conversión de formato ni de zona horaria.

### La consulta

```ts
// src/modules/lotes/repository/lotes.repository.ts
async getLotesFinalizadosByCliente(clienteId: number) {
  const etapa = await this.resolveEtapa('FINALIZADO', this.db);

  return await this.db
    .selectFrom('lotes')
    .leftJoin('productos', 'productos.id', 'lotes.producto_id')
    .leftJoin('unidades_medida', 'unidades_medida.id', 'lotes.unidad_medida_id')
    .leftJoin('etapas', 'etapas.id', 'lotes.etapa_id')
    .leftJoin('usuarios as aprobador', 'aprobador.id', 'lotes.aprobado_por')
    .leftJoin('usuarios as finalizador', 'finalizador.id', 'lotes.finalizado_por')
    .select([/* los 14 campos */])
    .where('lotes.cliente_id', '=', clienteId)
    .where('lotes.etapa_id', '=', etapa.id)
    .orderBy('lotes.finalizado_en', 'desc')
    .execute();
}
```

Cuatro reglas de esa consulta:

- **Los dos joins a `usuarios` son `LEFT`, no `INNER`.** Un `INNER` escondería el lote entero si el usuario que lo firmó fue borrado, y este listado no puede perder filas por eso.
- **Los dos joins llevan alias** (`aprobador`, `finalizador`) porque la misma tabla entra dos veces.
- **No se filtra `estado = 'cerrado'`.** La etapa `FINALIZADO` solo la escribe `finalizarLote`, que exige el lote cerrado, así que la condición sería redundante.
- **No se filtra `motivo_rechazo IS NULL`.** Un lote rechazado no está en la etapa `FINALIZADO`, y las dos escrituras que ponen `RECHAZADO` sacan al lote de esta lista por construcción.

### `resolveEtapa` en una lectura

`resolveEtapa` es un método privado que ya existe y recibe el `Kysely` por parámetro porque las escrituras le pasan la `trx`. Aquí se le pasa `this.db`, sin transacción: es una lectura y no hay nada que aislar.

Su fallo es un `BadRequestException`. Es decir: si la fila `FINALIZADO` no está en `etapas`, este `GET` responde **400**, no 500 ni 200 con lista vacía. Es el mismo comportamiento que ya tienen los cinco `PATCH` que resuelven etapa, y se acepta por coherencia.

### Lo que cambia en los conteos

| Conteo | Antes | Después |
| --- | --- | --- |
| Rutas que mapea Nest | 26 | **27** |
| Rutas del módulo `lotes` | 8 | **9** |
| Operaciones en `/docs-json` | 25 | **26** |
| Claves en `paths` | 24 | **25** |
| Rutas que se saltan `validateVinculoOperador` | 15 | **16** |
| Lecturas abiertas a cualquier autenticado | 15 | **16** |
| Filas en `catalogo_permisos` / `permisos` | 9 / 14 | **9 / 14**, sin cambio |

---

## Implementation plan

1. Anotar el punto de partida. Arrancar con `npm run start:dev` y confirmar las **26** rutas del log. Preparar el dato de prueba: en MySQL, identificar un cliente con al menos un lote en la etapa `FINALIZADO`; si no hay ninguno, llevar un lote por el flujo completo (`POST /lotes` → `POST /pesajes` → `PATCH /lotes/:id/aprobar` → `PATCH /pesajes/:id/aprobar/byApprover` → `PATCH /lotes/:id/finalizar/byApprover`). Guardar la respuesta de las tres rutas `cliente/...` para ese cliente y confirmar que **ninguna** lista el lote finalizado.
2. Agregar `getLotesFinalizadosByCliente` a `LotesRepository`, con los cinco joins, los 14 campos, el filtro por la etapa resuelta y el orden por `finalizado_en DESC`. Verificación: `npm run build` pasa.
3. Agregar `findAllLotesFinalizadosByCliente` a `LotesService` como pass-through. Verificación: `npm run build` pasa.
4. Agregar el handler `@Get('cliente/:clienteId/all/finalizados')` a `LotesController`, justo después del de `/all/approver`, devolviendo `{ ok: !!lotes, msg: 'Lotes obtenidos correctamente', lotes }`. Verificación: el log arranca con **27** rutas y `lotes` con **9**.
5. Verificación funcional con el cliente del paso 1: la ruta nueva devuelve el lote finalizado, con `etapa` igual a la fila `FINALIZADO`, `estado` igual a `'cerrado'` y los cuatro campos de auditoría poblados con nombres y fechas.
6. Verificación de los bordes, uno por uno: un cliente sin lotes finalizados devuelve `200` con `[]`; un `clienteId` que no existe devuelve `200` con `[]` —esta ruta no valida el cliente, igual que sus hermanas—; un `clienteId` no numérico devuelve `400` del `ParseIntPipe`; y sin token devuelve `401`.
7. Verificación de que el aislamiento se mantiene: un lote **aprobado y no finalizado** del mismo cliente **no** sale en la lista nueva y **sí** sigue saliendo en `/all/approver`; un lote **rechazado** no sale en ninguna de las dos; un lote **abierto** sigue saliendo solo en las dos primeras.
8. Verificación de no regresión: llamar a las tres rutas `cliente/...` existentes y confirmar que devuelven exactamente los mismos 10 campos y las mismas filas que en el paso 1.
9. Agregar `@ApiOperation` y `@ApiParam` al handler nuevo. Verificación: `/docs` muestra la ruta bajo el tag `lotes` con su descripción, y `/docs-json` tiene **26** operaciones en **25** claves de `paths`.
10. `npm run lint` y `npm run build` sin errores nuevos.
11. Actualizar `CLAUDE.md`:
    - El endpoint nuevo en la tabla de `lotes`, con sus 14 campos y su orden.
    - Que la frase "después de finalizar, el lote está en **ninguna** lectura de `lotes`", repetida desde el SPEC 20, **ya no es cierta**.
    - Que es la primera lectura que devuelve columnas de auditoría, y que `rechazado_por`/`rechazado_en` siguen sin ser legibles por la API.
    - Los conteos nuevos: 27 rutas, `lotes` 9, 26 operaciones en 25 claves, 16 rutas sin `validateVinculoOperador`.
    - Que esta ruta resuelve la etapa por `codigo` y que el `etapa_id = 2` de `/all/approver` sigue hardcodeado, sin tocar.
    - Que sigue sin haber `GET /lotes/:id` ni `GET /clientes/:id`.

---

## Acceptance criteria

- [ ] La app arranca, `npm run build` pasa y `npm run lint` no introduce errores nuevos.
- [ ] El log de Nest mapea **27** rutas, con el reparto `auth` 2, `catalogos` 3, `clientes` 4, `lotes` **9**, `permisos` 1, `pesajes` 7, más `GET /`.
- [ ] `GET /lotes/cliente/:clienteId/all/finalizados` responde **200** con la forma `{ ok, msg, lotes }`.
- [ ] Cada elemento de `lotes` tiene exactamente **14** claves: las 10 de `GET /lotes/cliente/:clienteId` más `aprobado_por`, `aprobado_en`, `finalizado_por` y `finalizado_en`.
- [ ] Las 10 primeras claves tienen los mismos nombres y el mismo orden que en las tres lecturas existentes.
- [ ] `aprobado_por` y `finalizado_por` traen el **nombre completo** del usuario, no un id numérico.
- [ ] Un lote en la etapa `FINALIZADO` del cliente aparece en la lista.
- [ ] Un lote **aprobado pero no finalizado** del mismo cliente **no** aparece, y sigue apareciendo en `GET /lotes/cliente/:clienteId/all/approver`.
- [ ] Un lote **rechazado** no aparece.
- [ ] Un lote **abierto** no aparece, y sigue apareciendo en `GET /lotes/cliente/:clienteId` y en `/all`.
- [ ] La lista viene ordenada por `finalizado_en` descendente.
- [ ] Un cliente sin lotes finalizados responde **200** con `lotes: []`, no 404.
- [ ] Un `clienteId` inexistente responde **200** con `lotes: []`.
- [ ] Un `clienteId` no numérico responde **400** del `ParseIntPipe`.
- [ ] Sin token, la ruta responde **401**.
- [ ] Un usuario **sin** fila en `cliente_operador` para ese cliente responde **200**, no 403.
- [ ] La etapa se filtra resolviendo `etapas` por `codigo = 'FINALIZADO'`: **no** hay ningún `etapa_id` numérico literal en el método nuevo.
- [ ] Los dos joins a `usuarios` son `LEFT JOIN` con alias distintos.
- [ ] `GET /lotes/cliente/:clienteId`, `/all` y `/all/approver` devuelven exactamente los mismos campos y filas que antes de este spec.
- [ ] `getAllLotesByClienteForApprover` sigue con su `where('lotes.etapa_id', '=', 2)` intacto.
- [ ] El handler nuevo está declarado **después** de `@Get('cliente/:clienteId/all/approver')` en `LotesController`.
- [ ] El handler nuevo tiene `@ApiOperation` con resumen y descripción, y `@ApiParam` para `clienteId`.
- [ ] No se agregó ningún `@ApiResponse` en ninguna parte.
- [ ] `/docs-json` tiene **26** operaciones en **25** claves de `paths`.
- [ ] No se creó ningún archivo nuevo: los únicos archivos de código tocados son el repositorio, el servicio y el controller de `lotes`.
- [ ] No se creó ningún DTO y no se agregó ningún query param.
- [ ] `src/database/types/types.ts` no cambió y no se aplicó ningún DDL.
- [ ] `catalogo_permisos` sigue con **9** filas y `permisos` con **14**.
- [ ] Ningún endpoint de `pesajes`, `clientes`, `auth`, `permisos` o `catalogos` cambió.
- [ ] `README.md` no cambió.
- [ ] `CLAUDE.md` documenta el endpoint, sus 14 campos, los conteos nuevos y que el lote finalizado ya no es invisible.

---

## Decisions

- **Sí:** solo el listado. Decisión explícita del usuario. Resuelve el caso real —"quiero ver los lotes terminados de este cliente"— sin abrir la caja del detalle por id.
- **No:** `GET /lotes/:id` en este spec. Se descarta pese a ser la deuda que el SPEC 21 dejó anotada: arrastra la trampa de ruta del `:id`, la decisión de 404 contra 400 y la pregunta de qué lotes puede leer. Va en su propio spec.
- **Sí:** el path es `/lotes/cliente/:clienteId/all/finalizados`. Decisión explícita del usuario. Cuarta ruta de la familia `cliente/...`, calcada de `/all/approver`, donde el `/all` ya significa "sin validar el vínculo".
- **Sí:** los 10 campos de siempre más las dos parejas de auditoría. Decisión explícita del usuario. Es la primera vez que la API responde quién firmó un lote y cuándo, que es la información que se busca en un listado de terminados.
- **No:** la terna de rechazo como campos. Se descarta: en un lote finalizado `motivo_rechazo`, `rechazado_por` y `rechazado_en` son siempre `null`, porque un lote congelado ya no se puede rechazar. Serían tres claves muertas en cada elemento.
- **No:** los ids crudos `aprobado_por` y `finalizado_por`. Viajan resueltos a nombre, como `producto` y `unidad_medida`. El frontend pinta un nombre, no un número.
- **Sí:** la etapa se resuelve por `codigo = 'FINALIZADO'`. Decisión explícita del usuario. Es la convención que siguen las cinco escrituras y evita repetir el error que `CLAUDE.md` señala desde el SPEC 19. Cuesta un `SELECT` extra por petición y se acepta.
- **No:** filtrar por `finalizado_por IS NOT NULL`, que ahorraría esa consulta. Se descarta: dependería de una columna de auditoría para decidir el estado del negocio, y el estado del negocio es la etapa.
- **No:** las dos condiciones a la vez. Se descarta: si alguna fila tuviera las dos señales desalineadas, la escondería sin avisar.
- **No:** arreglar el `etapa_id = 2` hardcodeado de `/all/approver`. Se descarta como en el SPEC 19: cambiar esa ruta es tocar un endpoint que funciona, dentro de un spec que solo agrega otro.
- **Sí:** ordena por `finalizado_en DESC`. Decisión explícita del usuario. Se aparta del `created_at DESC` de las tres hermanas porque en una lista de terminados la fecha que importa es la del cierre.
- **Sí:** no valida `cliente_operador`. Decisión explícita del usuario. Consecuencia asumida y documentada: es la decimosexta ruta abierta, y cualquier autenticado lista los lotes finalizados de cualquier cliente. El argumento es que el aprobador y un `ADMIN` no tienen filas en `cliente_operador` y son justo quienes abren esta pantalla.
- **No:** sembrar una fila en `catalogo_permisos` y `permisos`. Decimotercer spec seguido que se salta la regla del SPEC 06, con el mismo argumento del SPEC 09: sin `PermissionsGuard` la fila no cambia nada, y el día que exista habrá que decidir las dieciséis rutas juntas, no esta sola.
- **No:** query params. Se descarta: los filtros de `lotes` son del SPEC 18, que sigue en `Draft`. Agregarlos aquí sería expandir un spec ajeno por la puerta de atrás.
- **No:** paginación. No la tiene ninguna lectura del proyecto y este spec no es el lugar para estrenarla.
- **No:** agregados del lote —kilos totales, conteo por estado de calidad, fuera de rango—. Se descarta: es el "cierre como cómputo" que todos los specs difieren desde el SPEC 12 y merece uno propio.
- **Sí:** los pesos viajan sin `Number()`, como en las tres lecturas hermanas. Coercionar aquí y no allá rompería la intercambiabilidad de la forma.
- **Sí:** si falta la fila `FINALIZADO` en `etapas`, la ruta responde 400. Es lo que hace `resolveEtapa` y es coherente con los cinco `PATCH` que ya lo usan.
- **Sí:** los joins a `usuarios` son `LEFT`. Un `INNER` haría desaparecer el lote entero si el usuario que lo firmó ya no está, y perder filas en un listado de auditoría es peor que devolver un nombre `null`.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **La ruta es abierta y lista los lotes terminados de cualquier cliente.** Con un `clienteId` secuencial, cualquier autenticado recorre la producción cerrada de toda la planta, ahora con nombres de quién firmó qué. | Aceptado por decisión, como las otras quince rutas abiertas. Documentado en `CLAUDE.md` y en Decisions. La salida es el `PermissionsGuard`, que sigue sin dueño desde el SPEC 06. |
| **`finalizado_en` es nullable**, así que un lote movido a la etapa `FINALIZADO` a mano en MySQL, sin escribir el par de auditoría, sale en la lista con `finalizado_por` y `finalizado_en` en `null` y MySQL lo manda al fondo del `ORDER BY ... DESC`. | Sin mitigar en código, y es deliberado: la etapa es la fuente de verdad. Queda anotado en `CLAUDE.md` como el precio de filtrar por etapa y no por la columna de auditoría. |
| **La consulta extra a `etapas`** convierte esta lectura en dos viajes a la base, sobre un pool de una sola conexión por petición. | Aceptado: es el mismo coste que ya pagan los cinco `PATCH` que resuelven etapa, y la tabla `etapas` tiene cuatro filas. |
| **Dos joins más a `usuarios` sobre una tabla sin índice conocido en `aprobado_por` ni `finalizado_por`.** Con muchos lotes por cliente la consulta se degrada antes que sus tres hermanas. | Sin mitigar. No hay tooling de índices en el repo y el volumen actual no lo justifica. Anotado por si el listado crece. |
| **El SPEC 18, todavía en `Draft`, planea filtros para `lotes`.** Si se implementa después, tendrá que decidir si esta cuarta ruta también los acepta. | Anotado aquí y en `CLAUDE.md`: esta ruta nace **sin** query params, y ampliarla es trabajo del spec de filtros, no de este. |
| **Un lote finalizado deja de estar en `/all/approver` y pasa a estar aquí**, así que un frontend que use la bandeja del aprobador como "lotes cerrados" va a ver desaparecer filas sin explicación si no llama también a la ruta nueva. | Documentado en la descripción de Swagger de las dos rutas y en `CLAUDE.md`. |

---

## What is **not** in this spec

- `GET /lotes/:id` y `GET /clientes/:id`.
- Listar lotes rechazados, o cerrados fuera de la etapa `FINALIZADO`.
- Un listado global de finalizados, sin `clienteId`.
- Query params, filtros, paginación y límite.
- Agregados del lote, `resumen_ia` y cualquier forma de cierre como cómputo.
- Devolver los pesajes del lote dentro de la respuesta.
- La terna de rechazo y los ids crudos de los usuarios como campos.
- Cambiar un solo campo de `GET /lotes/cliente/:clienteId`, `/all` o `/all/approver`.
- Arreglar el `etapa_id = 2` hardcodeado de la bandeja del aprobador.
- Deshacer una finalización o reabrir un lote.
- Validar `cliente_operador`, el `PermissionsGuard`, `@Permisos()` y cualquier enforcement de permisos.
- Sembrar filas en `catalogo_permisos` o en `permisos`.
- DDL, y cambios a `src/database/types/types.ts`.
- Tests de cualquier tipo.

Cada uno de estos, si se necesita, va en su propio spec.
