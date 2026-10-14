# SPEC 42 — Gestión de operadores vinculados a un cliente

> **Status:** Approved
> **Depends on:** SPEC 01 (tabla `cliente_operador` y `usuario_ids` en `POST /clientes`), SPEC 11 (`validateClienteActivo`), SPEC 22 (convención de Swagger), SPEC 39 (filtro de operadores activos por rol `OPERADOR`)
> **Date:** 2026-10-14
> **Objective:** Agregar `GET /clientes/:id/operadores`, que lista los operadores vinculados a un cliente, y `PATCH /clientes/:id/operadores`, que reemplaza ese conjunto de vínculos por la lista enviada.

---

## Why this spec exists

Hoy el vínculo `cliente_operador` solo se crea en `POST /clientes` (spec 01). Después no se puede agregar ni quitar un operador por API: se hace a mano en MySQL. El spec 01 dejó esto fuera de alcance a propósito, y `CLAUDE.md` lo lista como trabajo diferido ("endpoints to manage `cliente_operador` links after a client is created").

El vínculo decide qué clientes ve cada operador en `GET /clientes`. Este spec permite cambiarlo desde la pantalla de edición del cliente: primero se leen los operadores vinculados para preseleccionarlos, después se guarda la lista final.

---

## Scope

**In:**

- Nueva ruta `GET /clientes/:id/operadores` en `ClientesController`, con `ParseIntPipe` en `:id`.
  - Responde `{ ok, msg, operadores }`, donde cada elemento es exactamente `{ id, nombre }`.
  - Solo lista usuarios vinculados con `isActive = 1` y rol `OPERADOR`, el mismo filtro que `GET /catalogos/operadores` (spec 39). Ordena por `complete_name` ASC.
  - **400** si el cliente no existe o está rechazado.
- Nueva ruta `PATCH /clientes/:id/operadores` en `ClientesController`, con `ParseIntPipe` en `:id`.
  - Cuerpo `{ usuario_ids: number[] }`, mínimo 1 elemento, sin repetidos.
  - **Reemplazo total**: la lista enviada pasa a ser el conjunto final de vínculos del cliente. Se insertan los ids que faltan, se borran los vínculos que no vienen y los que ya estaban quedan intactos (conservan su `created_at`).
  - Los vínculos se quitan con **`DELETE` físico** en `cliente_operador`.
  - Cada `usuario_id` solo se valida en su **existencia**: **400** si alguno no está en `usuarios`. No se valida `isActive` ni rol.
  - **400** si el cliente no existe o está rechazado.
  - Responde `{ ok, msg }` sin payload, **200** aunque el conjunto no cambie.
- Nuevo DTO `EditarOperadoresClienteDto`.
- Ambas rutas abiertas a cualquier usuario autenticado, sin `validateVinculoOperador` y sin fila de permiso.
- Swagger: `@ApiOperation` con summary y descripción, y `@ApiParam` en `:id`, en las dos rutas.
- Corregir la descripción de Swagger de `POST /clientes`, que dice que no hay endpoints para gestionar el vínculo después de crear el cliente.
- `CLAUDE.md` actualizado.

**Out of scope (for future specs):**

- Validar el rol o el `isActive` de los `usuario_ids`, en este endpoint o en `POST /clientes`.
- Dejar un cliente sin operadores (`usuario_ids: []`).
- Rutas separadas para agregar o quitar un solo operador.
- Borrado lógico o auditoría de vínculos (`isActive`, `desvinculado_por`, `desvinculado_en` en `cliente_operador`).
- Escribir `updated_at` o `actualizado_por` en `clientes` al cambiar los vínculos.
- Restringir las rutas por rol, validar `cliente_operador` o sembrar una fila de permiso.
- Listar desde el lado del usuario los clientes vinculados a un operador.
- Corregir el resto de la descripción de Swagger de `POST /clientes` y la de `PATCH /clientes/:id/rechazar` (lo del RTN reutilizable, que el spec 41 ya dejó fuera).
- Paginación o filtros en el `GET`.

---

## Data model

Este spec **no aplica DDL** y no cambia `src/database/types/types.ts`. Reusa `cliente_operador` (spec 01), `usuarios` y `roles`.

`cliente_operador` no tiene `isActive`, así que quitar un vínculo es un `DELETE FROM`. Es el **primer `DELETE FROM` del proyecto**. Su `UNIQUE (cliente_id, usuario_id)` permite volver a vincular al mismo usuario después.

### DTO

`src/modules/clientes/dto/editar-operadores-cliente.dto.ts`:

```ts
const editarOperadoresClienteSchema = z.object({
    usuario_ids: z
        .array(z.number().int().positive('El usuario_id debe ser un id valido'), {
            error: 'Usuarios a vincular requeridos',
        })
        .min(1, 'Debe vincular al menos un usuario')
        .refine(
            (ids) => new Set(ids).size === ids.length,
            'No se permiten usuarios repetidos',
        ),
});
```

- Mismas reglas de elemento y de mínimo que `usuario_ids` en `create-cliente.dto.ts`.
- Un id repetido responde **400** `No se permiten usuarios repetidos`. No se deduplica en silencio.

### Lectura

`ClientesRepository.getOperadoresByCliente(clienteId)`, sin transacción:

1. `validateClienteActivo(clienteId, this.db)`: 400 si no existe o si `isActive = 0`. Ya existe (spec 11).
2. Consulta:

```ts
selectFrom('cliente_operador')
  .innerJoin('usuarios', 'usuarios.id', 'cliente_operador.usuario_id')
  .innerJoin('roles', 'roles.id', 'usuarios.rol_id')
  .select(['usuarios.id', 'usuarios.complete_name as nombre'])
  .where('cliente_operador.cliente_id', '=', clienteId)
  .where('usuarios.isActive', '=', 1)
  .where('roles.nombre', '=', 'OPERADOR')
  .orderBy('usuarios.complete_name', 'asc')
```

- El filtro de usuario es el mismo de `GET /catalogos/operadores`. Así la preselección del front es siempre un subconjunto del catálogo del selector.
- Un vínculo a un usuario inactivo o con otro rol existe en la tabla pero **no se devuelve**.

### Escritura

`ClientesRepository.editarOperadoresCliente(clienteId, dto)`, en una transacción:

1. `validateClienteActivo(clienteId, trx)`.
2. `validateUsuariosExisten(usuario_ids, trx)`, nuevo validador privado: `SELECT id FROM usuarios WHERE id IN (...)`. Si falta alguno, 400 `El usuario con id 'X' no existe`, con el primer id que falte en el orden enviado.
3. Leer los `usuario_id` actuales del cliente en `cliente_operador`.
4. `DELETE FROM cliente_operador WHERE cliente_id = ? AND usuario_id NOT IN (usuario_ids)`.
5. `INSERT` en `cliente_operador` de los ids enviados que no estaban vinculados. Si no hay ninguno, no se ejecuta el `INSERT`.
6. Devuelve `true`.

- El `DELETE` también borra vínculos que el `GET` no muestra (usuarios inactivos o de otro rol), porque no vienen en la lista. Ver Risks.
- No escribe nada en `clientes`.
- No recibe `userId`: no hay columna donde escribirlo.

### Respuestas

`GET /clientes/12/operadores` (**200**):

```json
{
  "ok": true,
  "msg": "Operadores del cliente obtenidos correctamente",
  "operadores": [
    { "id": 4, "nombre": "Juan Pérez" },
    { "id": 7, "nombre": "María López" }
  ]
}
```

Un cliente sin operadores activos vinculados responde **200** con `operadores: []`.

`PATCH /clientes/12/operadores` con `{ "usuario_ids": [4, 9] }` (**200**):

```json
{
  "ok": true,
  "msg": "Operadores del cliente actualizados correctamente"
}
```

Errores:

| Caso | Ruta | Código | Mensaje |
| --- | --- | --- | --- |
| Sin token | ambas | 401 | — |
| `:id` no numérico | ambas | 400 | `ParseIntPipe` |
| Cliente no existe | ambas | 400 | `El cliente con id 'X' no existe` |
| Cliente rechazado | ambas | 400 | `El cliente con id 'X' ya fue rechazado` |
| `usuario_ids` ausente o no es arreglo | `PATCH` | 400 | `Usuarios a vincular requeridos` |
| `usuario_ids: []` | `PATCH` | 400 | `Debe vincular al menos un usuario` |
| Elemento no entero positivo | `PATCH` | 400 | `El usuario_id debe ser un id valido` |
| Ids repetidos | `PATCH` | 400 | `No se permiten usuarios repetidos` |
| Usuario no existe | `PATCH` | 400 | `El usuario con id 'X' no existe` |

### Rutas

Ninguna de las dos choca con las rutas existentes de `ClientesController`:

- `@Get(':id/operadores')` tiene dos segmentos y `@Get('all')` uno. No es la trampa del `@Get(':id')` pelado.
- `@Patch(':id/operadores')` y `@Patch(':id/rechazar')` tienen literales distintos detrás del parámetro. `@Patch(':id')` tiene un solo segmento.

La posición de los handlers no carga peso.

### Conteo de rutas

| | Antes | Después |
| --- | --- | --- |
| Rutas de `clientes` | 5 | **7** |
| Rutas que mapea Nest | 45 | **47** |
| Operaciones en `/docs-json` | 44 | **46** |
| Claves de `paths` | 41 | **42** |

`/clientes/{id}/operadores` es **una** clave nueva de `paths` que agrupa el `GET` y el `PATCH`.

### Archivos

| Archivo | Cambio |
| --- | --- |
| `src/modules/clientes/dto/editar-operadores-cliente.dto.ts` | Nuevo `EditarOperadoresClienteDto`. |
| `src/modules/clientes/repository/clientes.repository.ts` | Nuevos `getOperadoresByCliente()`, `editarOperadoresCliente()` y el validador privado `validateUsuariosExisten()`. Reusa `validateClienteActivo`. |
| `src/modules/clientes/clientes.service.ts` | Nuevos pass-through `findOperadores()` y `editarOperadores()`. |
| `src/modules/clientes/clientes.controller.ts` | Nuevos handlers `@Get(':id/operadores')` y `@Patch(':id/operadores')` con `@ApiOperation` y `@ApiParam`. Descripción de `POST /clientes` corregida. |
| `CLAUDE.md` | Fila de `clientes`, conteos de rutas, escrituras y lecturas abiertas, endpoints que no validan `cliente_operador`, el primer `DELETE FROM` y la lista de diferidos. |

---

## Implementation plan

1. Crear `editar-operadores-cliente.dto.ts` con el schema del modelo de datos. Todavía nadie lo usa.
2. Agregar `getOperadoresByCliente()` a `ClientesRepository`, con `validateClienteActivo` y la consulta del modelo de datos.
3. Agregar `findOperadores()` a `ClientesService` y `@Get(':id/operadores')` a `ClientesController`, que responde `{ ok: true, msg: 'Operadores del cliente obtenidos correctamente', operadores }`. El `@ApiOperation` dice:
   - que cada elemento es `{ id, nombre }`;
   - que solo lista operadores activos con rol `OPERADOR`, como `GET /catalogos/operadores`, y que un vínculo a otro usuario existe pero no se muestra;
   - que un cliente inexistente o rechazado responde 400;
   - que no valida `cliente_operador`: cualquier usuario autenticado lee los vínculos de cualquier cliente.

   Prueba manual: con un cliente creado con `usuario_ids: [X, Y]`, responde esos dos operadores.
4. Agregar `validateUsuariosExisten()` y `editarOperadoresCliente()` a `ClientesRepository`, con la transacción, el `DELETE` y el `INSERT` del modelo de datos.
5. Agregar `editarOperadores()` a `ClientesService` y `@Patch(':id/operadores')` a `ClientesController`, que responde `{ ok: true, msg: 'Operadores del cliente actualizados correctamente' }`. El `@ApiOperation` dice:
   - que la lista enviada **reemplaza** el conjunto completo de vínculos: lo que no viene se borra;
   - que exige al menos un id y no admite repetidos;
   - que solo valida que cada usuario exista, no su rol ni si está activo;
   - que un vínculo que el `GET` no muestra también se borra si no viene en la lista;
   - que un cliente inexistente o rechazado responde 400;
   - que no valida `cliente_operador`: cualquier usuario autenticado puede cambiar los operadores de cualquier cliente, incluido vincularse a sí mismo.

   Prueba manual: cambiar `[X, Y]` por `[Y, Z]` y confirmar en MySQL que la fila de `Y` conserva su `created_at`, la de `X` desapareció y la de `Z` es nueva. Confirmar que `GET /clientes` con el token de `X` ya no trae al cliente y con el de `Z` sí.
6. Corregir la descripción de Swagger de `POST /clientes`: quitar la frase "Esa es la unica forma de crear el vinculo: no hay endpoints para gestionarlo despues" y decir que los vínculos se cambian después con `PATCH /clientes/:id/operadores`.
7. Actualizar `CLAUDE.md`:
   - La fila de `clientes` en la tabla de endpoints.
   - Los conteos de rutas de la sección de Commands (47 rutas, `clientes` 7, 46 operaciones, 42 `paths`).
   - La lista de endpoints que no validan `cliente_operador` (de 26 a **28**).
   - La convención de escritura: `editarOperadoresCliente` es una escritura nueva que no es un `UPDATE` y contiene el primer `DELETE FROM`.
   - La frase "nothing issues a `DELETE FROM`" del bloque de endpoints, que deja de ser cierta: el borrado de `cliente_operador` es físico.
   - En la lista de diferidos del Domain, quitar "endpoints to manage `cliente_operador` links after a client is created".
   - En la nota de `ClientesRepository` de la convención de acceso, que el módulo `clientes` ahora tiene cuatro escrituras y ninguna valida `cliente_operador`.

---

## Acceptance criteria

- [ ] El route log muestra **47** rutas, con `GET /clientes/:id/operadores` y `PATCH /clientes/:id/operadores` entre ellas.
- [ ] Sin header `Authorization`, las dos rutas responden 401.
- [ ] Con el token de un `OPERADOR` sin vínculo con el cliente, las dos rutas responden 200.
- [ ] `GET /clientes/:id/operadores` responde `{ ok: true, msg: 'Operadores del cliente obtenidos correctamente', operadores }`, y cada elemento tiene exactamente las claves `id` y `nombre`.
- [ ] `operadores` coincide con una consulta directa en MySQL de los vínculos del cliente cuyo usuario tiene `isActive = 1` y rol `OPERADOR`, ordenado por nombre ascendente.
- [ ] Un vínculo a un usuario con `isActive = 0` o con rol `ADMIN` existe en `cliente_operador` y no aparece en el `GET`.
- [ ] Un cliente sin vínculos responde 200 con `operadores: []`.
- [ ] Las dos rutas responden 400 `El cliente con id 'X' no existe` con un id inexistente, y 400 `El cliente con id 'X' ya fue rechazado` con un cliente rechazado. En el `PATCH`, `cliente_operador` no cambia.
- [ ] `PATCH` de `[X, Y]` a `[Y, Z]` responde `{ ok: true, msg: 'Operadores del cliente actualizados correctamente' }`, borra la fila de `X`, inserta la de `Z` y deja la de `Y` con el mismo `id` y `created_at`.
- [ ] `PATCH` con el mismo conjunto que ya existe responde 200 y no cambia ninguna fila.
- [ ] Después del `PATCH`, `GET /clientes` con el token de `X` no trae al cliente y con el de `Z` sí.
- [ ] `{ "usuario_ids": [] }` responde 400 `Debe vincular al menos un usuario`.
- [ ] `{}` responde 400 `Usuarios a vincular requeridos`.
- [ ] `{ "usuario_ids": [4, 4] }` responde 400 `No se permiten usuarios repetidos`.
- [ ] `{ "usuario_ids": [0] }` y `{ "usuario_ids": ["4"] }` responden 400.
- [ ] Un `usuario_id` que no existe responde 400 `El usuario con id 'X' no existe` y `cliente_operador` no cambia.
- [ ] Un `usuario_id` de un `ADMIN` o de un usuario inactivo se vincula con 200.
- [ ] El `PATCH` no cambia ninguna columna de `clientes`.
- [ ] `POST /clientes`, `GET /clientes`, `GET /clientes/all`, `PATCH /clientes/:id` y `PATCH /clientes/:id/rechazar` responden igual que antes.
- [ ] `/docs` muestra las dos rutas bajo el tag `clientes`, agrupadas en `/clientes/{id}/operadores`, con su descripción y su `@ApiParam`.
- [ ] La descripción de `POST /clientes` en `/docs` ya no dice que no hay endpoints para gestionar el vínculo.
- [ ] No se aplicó DDL y no se agregó ninguna fila a `catalogo_permisos` ni a `permisos`.

---

## Decisions

- **Sí:** dos rutas, `GET` y `PATCH` sobre `/clientes/:id/operadores`. Decisión del usuario. Primero se lee para preseleccionar, después se guarda.
- **Sí:** reemplazo total del conjunto. Decisión del usuario. El front manda lo que quedó marcado en el selector y no calcula diferencias.
- **No:** rutas separadas para agregar y quitar un operador. Más rutas y el front tendría que calcular la diferencia.
- **Sí:** los vínculos que se mantienen no se tocan. Borrar todo y reinsertar perdería el `created_at` de cada vínculo.
- **Sí:** `DELETE` físico. Decisión del usuario. `cliente_operador` es una tabla puente sin datos propios, y el `UNIQUE` permite volver a vincular.
- **No:** `isActive` y auditoría en `cliente_operador`. Necesitaba DDL, filtrar `isActive` en `GET /clientes` y revivir la fila al re-vincular por el `UNIQUE`.
- **Sí:** mínimo un operador. Decisión del usuario. Misma regla que `POST /clientes`; un cliente sin operadores no aparece en el `GET /clientes` de nadie.
- **Sí:** cualquier usuario autenticado. Decisión del usuario. El permiso se valida en el front, igual que el spec 41.
- **No:** solo `ADMIN` con `validateCallerEsAdmin`. Se recomendó, porque este endpoint decide qué clientes ve cada operador en `GET /clientes`, y se descartó.
- **Sí:** solo se valida que cada usuario exista. Decisión del usuario. Da un 400 legible en vez del 500 de la FK, y es el mismo criterio de `POST /clientes`.
- **No:** validar `isActive` y rol `OPERADOR` de los `usuario_ids`. Se recomendó y se descartó.
- **Sí:** el `GET` filtra operadores activos con rol `OPERADOR`. Decisión del usuario. La preselección coincide con el catálogo del selector (spec 39).
- **No:** `GET` sin filtro de rol ni `isActive`. Mostraría vínculos que no están en el selector del front.
- **Sí:** se acepta la diferencia entre lo que el `PATCH` permite vincular y lo que el `GET` muestra. Decisión del usuario, documentada en Risks.
- **Sí:** ids repetidos responden 400 del DTO. Decisión del usuario.
- **No:** deduplicar en silencio. Se recomendó y se descartó.
- **Sí:** cliente inexistente o rechazado responde 400 en las dos rutas. Reusa `validateClienteActivo`, con los mismos mensajes de `rechazar` y `editar`.
- **Sí:** el `PATCH` no escribe en `clientes`. Decisión del usuario. No se tocan `updated_at` ni `actualizado_por`.
- **No:** registrar en `clientes.actualizado_por` quién cambió los vínculos. Se recomendó y se descartó.
- **Sí:** `{ ok, msg }` sin payload, 200 aunque no cambie nada. Igual que `PATCH /clientes/:id`.
- **No:** devolver la lista final en el `PATCH`.
- **Sí:** sin fila en `catalogo_permisos`/`permisos`. Sin un `PermissionsGuard` la fila no cambia nada, el mismo argumento de los specs anteriores.
- **Sí:** corregir la frase de `POST /clientes` en Swagger que dice que no hay forma de gestionar el vínculo. Este spec la vuelve falsa.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Cualquiera con un token cambia los operadores de cualquier cliente llamando a la API directo, incluido vincularse a sí mismo y ver el cliente en su `GET /clientes` | Riesgo aceptado. El permiso se valida en el front. Hoy `GET /clientes/all` ya devuelve todos los clientes a cualquiera, así que no abre datos nuevos. |
| No queda registro de quién cambió los vínculos ni de qué vínculos existían antes | Riesgo aceptado. El `DELETE` es físico y no se escribe `actualizado_por`. Las filas que se mantienen conservan su `created_at`. |
| Un vínculo a un usuario inactivo o con otro rol, creado por `POST /clientes` o por este `PATCH`, no aparece en el `GET` y se borra la próxima vez que el front guarde | Riesgo aceptado. Es la consecuencia de validar solo existencia en la escritura y filtrar en la lectura. La descripción de Swagger lo advierte. |
| Se vincula un `ADMIN` o `SUPERVISOR` llamando a la API | Igual que en `POST /clientes` hoy. El vínculo no da permisos: solo hace que el cliente aparezca en su `GET /clientes`. |
| Quitar a un operador de un cliente con un lote abierto | El operador deja de ver el cliente en `GET /clientes` y `POST /lotes` / `POST /pesajes` empiezan a responder 403 para él en ese cliente. Es el efecto buscado. |
| Dos `PATCH` simultáneos sobre el mismo cliente | Cada uno corre en su transacción; el `UNIQUE (cliente_id, usuario_id)` evita filas duplicadas. Si dos `INSERT` del mismo par chocan, uno falla con un 500 de MySQL. Se reintenta. |

---

## What is **not** in this spec

- Validar rol o `isActive` de los `usuario_ids`.
- Dejar un cliente sin operadores.
- Rutas para agregar o quitar un solo operador.
- Borrado lógico o auditoría de vínculos.
- Escribir `updated_at` o `actualizado_por` en `clientes`.
- Restringir por rol, validar `cliente_operador` o sembrar permisos.
- Listar los clientes de un operador desde el lado del usuario.
- Paginación o filtros en el `GET`.
- DDL.

Cada uno de estos, si se necesita, va en su propio spec.
