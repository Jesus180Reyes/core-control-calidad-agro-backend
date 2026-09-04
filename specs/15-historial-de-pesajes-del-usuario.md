# SPEC 15 — Historial de pesajes del usuario autenticado

> **Status:** Approved
> **Depends on:** SPEC 02, SPEC 03, SPEC 10
> **Date:** 2026-09-04
> **Objective:** Agregar `GET /pesajes/historial`, que devuelve todos los pesajes activos registrados por el usuario del token (`pesajes.usuario_id`), con el nombre de su lote y de su cliente resueltos por join, sin filtrar por estado del lote ni por vínculo `cliente_operador`.

---

## Why this spec exists

Hoy un operador pesa y el pesaje desaparece de su vista. La única forma de volver a verlo es `GET /pesajes/byLote/:loteId`, que exige saber el `id` del lote y que devuelve los pesajes de **todos** los operadores de ese lote. No hay ninguna ruta que responda "qué he pesado yo". Peor: en cuanto el lote se aprueba o se rechaza, deja de aparecer en los dos `GET /lotes/cliente/:clienteId*`, así que ni siquiera se puede llegar a su `id` para consultarlo. El trabajo del operador se vuelve inalcanzable por API a las pocas horas de hacerlo.

Este spec agrega la ruta que faltaba. Hay que ser explícito con cinco cosas.

**La primera: el filtro es el token, y eso lo hace el primer endpoint de lectura del proyecto que no puede filtrar datos ajenos por construcción.** No hay parámetro de ruta, no hay query param y no hay body: el `WHERE` sale de `req.user.userId`. Un usuario no puede pedir el historial de otro porque no hay dónde escribir el `id` de otro. Es lo contrario de `GET /pesajes/byLote/:loteId`, `GET /clientes/all` y `GET /lotes/cliente/:clienteId/all`, que aceptan un parámetro y devuelven lo que sea que ese parámetro nombre. La consecuencia práctica es que este spec **no necesita** `validateVinculoOperador` para ser seguro: no lo omite como decisión de riesgo — como hicieron SPEC 08 a 13 —, es que no hay nada que autorizar. Es la primera vez en cinco specs que "no valida el vínculo" no es una advertencia.

**La segunda: es el primer endpoint que devuelve datos de lotes cerrados y de clientes rechazados.** Por decisión explícita no se filtra `lotes.estado` ni `clientes.isActive`. Un historial que se vacía solo cuando un supervisor aprueba el lote no es un historial. La consecuencia es que este endpoint expone el `nombre_lote` de lotes que los dos `GET /lotes/cliente/*` ya ocultan, y el `nombre` de clientes que `GET /clientes` y `GET /clientes/all` ya ocultan. Es la primera fuga deliberada de datos que el resto de la API considera retirados — acotada a las filas que el propio usuario creó.

**La tercera: el historial sí filtra `isActive = 1`, así que un pesaje rechazado desaparece del historial de quien lo hizo.** Es el mismo filtro de `GET /pesajes/byLote/:loteId`. La consecuencia a asumir: después de SPEC 10, un pesaje anulado no lo lista ningún endpoint del proyecto, y este spec no cambia eso. Se decidió que el historial muestra lo que sigue valiendo, no la auditoría de lo anulado.

**La cuarta: no hay paginación, ni límite, ni recorte por fecha.** Ninguno de los siete `GET` del proyecto pagina y este no rompe la racha. El riesgo —un operador con miles de pesajes recibiendo todo en una respuesta— queda anotado y sin mitigar, porque introducir el primer query param del proyecto aquí obligaría a diseñar una convención de paginación que después habría que replicar en los otros siete.

**La quinta: no se siembra fila de permiso, y es la sexta vez consecutiva.** Mismo criterio de SPEC 09 a 13: nadie debería ser negado a ver su propio historial, así que el permiso nunca se le denegaría a nadie. Y de todas formas no hay `PermissionsGuard` que lo aplique. La diferencia con las cinco excepciones anteriores es que aquí el argumento es fuerte y no una asunción de riesgo: las de SPEC 10 a 13 dejaron cuatro **escrituras** sin código de permiso; esta deja una lectura que solo devuelve filas del propio usuario.

---

## Scope

**In:**

- Nuevo endpoint `GET /pesajes/historial`, protegido únicamente por el `JwtAuthGuard` global (no lleva `@Public()`).
- Nuevo método `getHistorialByUsuario(userId)` en `src/modules/pesajes/repository/pesajes.repository.ts`: un único `SELECT` con tres `LEFT JOIN`, sin transacción y sin validadores.
- Nuevo método `findHistorial(userId)` en `src/modules/pesajes/pesajes.service.ts`, pass-through al repositorio.
- Nuevo handler `@Get('historial')` en `src/modules/pesajes/pesajes.controller.ts`, declarado **antes** de `@Get('byLote/:loteId')`, con `@Req() req: Request`, **sin `@Param()`, sin `@Body()` y sin `@Query()`**.
- El `SELECT` filtra `pesajes.usuario_id = <userId del token>` y `pesajes.isActive = 1`, y ordena `pesajes.created_at` DESC.
- Trece campos por fila: los once de `GET /pesajes/byLote/:loteId` **menos** `usuarios.complete_name as usuario`, más `lotes.nombre_lote as lote` y `clientes.nombre as cliente`.
- Respuesta `200` con la forma `{ ok, msg, pesajes }`, con la clave nombrada del recurso, no `data`.
- `200` con `pesajes: []` cuando el usuario no ha registrado ningún pesaje activo. **No** es un 404.
- **Sin DDL**: no se agrega ni se modifica ninguna columna, tabla, índice ni FK.
- **Sin cambios en `src/database/types/types.ts`**: todas las columnas y todas las tablas que este spec consulta ya están declaradas.
- **Sin DTO**: el endpoint no recibe nada más que el token.
- Actualizar `CLAUDE.md`: la fila `pesajes` de la tabla de endpoints, el conteo de `GET`s y la nota de que este es el primer endpoint que devuelve el nombre de lotes cerrados y de clientes rechazados.

**Out of scope (for future specs):**

- Un historial de **otro** usuario: no hay `GET /pesajes/usuario/:usuarioId` ni ningún parámetro para pedir el historial ajeno. Este spec solo lee el token.
- Un historial por cliente (`cliente_operador`), es decir "todo lo que se pesó en mi cartera, lo haya pesado yo o no".
- Paginación, `?page`, `?limit` o cualquier query param. Este spec no introduce el primer query param del proyecto.
- Filtros por fecha (`?desde`, `?hasta`), por lote, por cliente, por producto o por estado de calidad.
- Recortes fijos en código, del tipo "últimos 50" o "últimos 30 días".
- Devolver los pesajes **rechazados** (`isActive = 0`), y por tanto devolver `motivo_rechazo`, `rechazado_por` o `rechazado_en` en algún endpoint. Siguen sin listarse en ninguna parte, igual que después de SPEC 10.
- Un query param `?incluirRechazados=true`.
- Agregados: total pesado, conteo por estado de calidad, conteo de fuera de rango. Este endpoint devuelve filas, no resúmenes.
- Devolver el estado del lote (`lotes.estado`, `etapa_id`, `motivo_rechazo`, `aprobado_por`) junto a cada pesaje.
- Cambios a `GET /pesajes/byLote/:loteId`, que sigue con sus doce campos, su `usuarios.complete_name as usuario` y su filtro `isActive = 1`.
- Cambios a `POST /pesajes` y a `PATCH /pesajes/:id/rechazar`.
- Cambios a los módulos `auth`, `clientes`, `lotes`, `permisos` y `catalogos`.
- Sembrar filas en `catalogo_permisos` o en `permisos`. Se decidió explícitamente no hacerlo (ver Decisions).
- **Aplicar** permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`.
- Validar el vínculo `cliente_operador`. Aquí no aplica: el filtro es el propio `usuario_id`.
- Validar `usuarios.isActive` o que el usuario del token siga existiendo. A diferencia de `GET /permisos/me`, este endpoint no consulta `usuarios` y no puede devolver 404.
- Un `GET /pesajes/:id` para un pesaje suelto. Ver la nota de orden de rutas en Risks antes de agregarlo.
- Caché de la respuesta.
- Índice en MySQL sobre `pesajes.usuario_id`. Ver Risks.

---

## Data model

**Este spec no introduce datos nuevos.** No hay DDL, no hay tabla nueva, no hay columna nueva y `src/database/types/types.ts` no se toca. Todo lo que necesita ya existe:

| Tabla | Columnas que consume | Ya declarada en `types.ts` |
| --- | --- | --- |
| `pesajes` | `id`, `lote_id`, `usuario_id`, `peso_bruto`, `tara`, `peso_neto`, `fuera_de_rango`, `dispositivo_identificador`, `secuencia_dispositivo`, `created_at`, `isActive`, `estado_calidad_id` | Sí |
| `estados_calidad` | `id`, `codigo`, `nombre` | Sí |
| `lotes` | `id`, `nombre_lote`, `cliente_id` | Sí |
| `clientes` | `id`, `nombre` | Sí |

### La consulta

```ts
async getHistorialByUsuario(userId: number) {
  const pesajes = await this.db
    .selectFrom('pesajes')
    .leftJoin('estados_calidad', 'estados_calidad.id', 'pesajes.estado_calidad_id')
    .leftJoin('lotes', 'lotes.id', 'pesajes.lote_id')
    .leftJoin('clientes', 'clientes.id', 'lotes.cliente_id')
    .select([
      'pesajes.id',
      'pesajes.lote_id',
      'lotes.nombre_lote as lote',
      'clientes.nombre as cliente',
      'pesajes.peso_bruto',
      'pesajes.tara',
      'pesajes.peso_neto',
      'pesajes.fuera_de_rango',
      'estados_calidad.codigo as estado_calidad_codigo',
      'estados_calidad.nombre as estado_calidad',
      'pesajes.dispositivo_identificador',
      'pesajes.secuencia_dispositivo',
      'pesajes.created_at',
    ])
    .where('pesajes.usuario_id', '=', userId)
    .where('pesajes.isActive', '=', 1)
    .orderBy('pesajes.created_at', 'desc')
    .execute();

  return pesajes;
}
```

En SQL:

```sql
SELECT p.id, p.lote_id, l.nombre_lote AS lote, c.nombre AS cliente,
       p.peso_bruto, p.tara, p.peso_neto, p.fuera_de_rango,
       ec.codigo AS estado_calidad_codigo, ec.nombre AS estado_calidad,
       p.dispositivo_identificador, p.secuencia_dispositivo, p.created_at
FROM pesajes p
LEFT JOIN estados_calidad ec ON ec.id = p.estado_calidad_id
LEFT JOIN lotes l           ON l.id  = p.lote_id
LEFT JOIN clientes c        ON c.id  = l.cliente_id
WHERE p.usuario_id = ?
  AND p.isActive = 1
ORDER BY p.created_at DESC;
```

Es una consulta plana, sin transacción y sin validadores, igual en forma a `getPesajesByLote` y a los tres `SELECT` de `CatalogosRepository`. **No** es el patrón de escritura del proyecto y no debe llevarlo: no hay nada que validar antes de leer.

### Los tres `LEFT JOIN`, y por qué ninguno es `INNER`

| Join | Por qué `LEFT` |
| --- | --- |
| `estados_calidad` | Es el mismo `leftJoin` que ya usa `getPesajesByLote`. `pesajes.estado_calidad_id` es `NOT NULL` en el tipo, así que en la práctica siempre resuelve. |
| `lotes` | `pesajes.lote_id` es **nullable**. Un pesaje huérfano aparece en el historial con `lote` y `cliente` en `null` en vez de desaparecer sin dejar rastro. Decisión explícita del usuario. |
| `clientes` | Consecuencia del anterior: si no hay lote, no hay `cliente_id` que seguir. Además, `lotes.cliente_id` es `NOT NULL`, así que este join solo produce `null` cuando el de `lotes` ya lo hizo. |

Hoy `POST /pesajes` **siempre** escribe `lote_id` —lo exige el DTO y `validateLoteAbierto` lo resuelve—, así que no debería existir ninguna fila con `lote_id` en `NULL`. El `LEFT JOIN` está por lo que la columna permite, no por lo que la aplicación escribe. `PATCH /pesajes/:id/rechazar` ya contempla ese caso con un mensaje propio, así que el proyecto ya asume que la fila huérfana es posible.

### Lo que **no** filtra, y es deliberado

| Filtro que no está | Consecuencia |
| --- | --- |
| `lotes.estado = 'abierto'` | El historial incluye pesajes de lotes **cerrados**, tanto rechazados (SPEC 12) como aprobados (SPEC 13). Es el primer endpoint que devuelve el `nombre_lote` de un lote que los dos `GET /lotes/cliente/*` ya ocultan. |
| `clientes.isActive = 1` | El historial incluye pesajes de clientes **rechazados** (SPEC 11). Es el primer endpoint que devuelve el `nombre` de un cliente que `GET /clientes` y `GET /clientes/all` ya ocultan. |
| `cliente_operador` | Un operador desvinculado de un cliente **sigue viendo** en su historial los pesajes que hizo para ese cliente, con el nombre del cliente. El vínculo no se consulta. |
| `usuarios.isActive` | No se consulta `usuarios` en absoluto. El endpoint no puede devolver 404. |

Las tres primeras filas son la definición misma de "historial" y están en Decisions. La tercera está además en Risks.

### Lo que **sí** filtra

| Filtro | Efecto |
| --- | --- |
| `pesajes.usuario_id = <token>` | Solo las filas que ese usuario registró. No hay forma de pedir las de otro. |
| `pesajes.isActive = 1` | Un pesaje anulado por `PATCH /pesajes/:id/rechazar` **desaparece** del historial de quien lo hizo. Mismo filtro que `GET /pesajes/byLote/:loteId`. |

### Diferencias con `GET /pesajes/byLote/:loteId`

Los dos `GET` del módulo se parecen a propósito, pero no son el mismo select:

| | `byLote/:loteId` | `historial` |
| --- | --- | --- |
| Filtro principal | `lote_id` del parámetro de ruta | `usuario_id` del token |
| `isActive = 1` | Sí | Sí |
| `usuario` (nombre de quien pesó) | **Sí** | **No.** Siempre sería el mismo: el del token. |
| `lote` y `cliente` (nombres) | No | **Sí.** Sin ellos el historial es una lista de números sin contexto. |
| Join a `usuarios` | Sí | **No.** No hace falta. |
| Orden | `created_at` DESC | `created_at` DESC |
| Campos | 12 | 13 |

El `usuario` se quita por redundante y el join a `usuarios` con él. Los dos métodos quedan como consultas hermanas pero independientes: **no se factoriza un select común**, por la misma razón que SPEC 13 dejó `resolveEtapaRechazado` intacto.

### DTO

**Este endpoint no tiene DTO.** No recibe body, ni parámetro de ruta, ni query param. Es el segundo endpoint del proyecto que solo lee el token, después de `GET /permisos/me`, y el primero de `pesajes` sin ningún parámetro.

### Petición y respuestas

Petición:

```
GET /pesajes/historial
Authorization: Bearer <token>
```

Respuesta (200):

```json
{
  "ok": true,
  "msg": "Historial de pesajes obtenido correctamente",
  "pesajes": [
    {
      "id": 41,
      "lote_id": 9,
      "lote": "LOTE-001",
      "cliente": "Agroexportadora del Valle",
      "peso_bruto": "25.50",
      "tara": "1.20",
      "peso_neto": "24.30",
      "fuera_de_rango": 0,
      "estado_calidad_codigo": "IDEAL",
      "estado_calidad": "IDEAL",
      "dispositivo_identificador": "BAL-01",
      "secuencia_dispositivo": 7,
      "created_at": "2026-09-04T14:22:10.000Z"
    }
  ]
}
```

Respuesta cuando el usuario no ha pesado nada, o cuando todos sus pesajes fueron rechazados (200, **no** 404):

```json
{
  "ok": true,
  "msg": "Historial de pesajes obtenido correctamente",
  "pesajes": []
}
```

El `ok` se calcula como `!!pesajes`, igual que en los otros dos handlers del controlador. Un array vacío es *truthy* en JavaScript, así que el caso vacío responde `ok: true`. Es el comportamiento que ya tiene `GET /pesajes/byLote/:loteId` con un lote sin pesajes; este spec lo copia y no lo corrige.

Errores:

| Caso | Respuesta |
| --- | --- |
| Sin header `Authorization` | 401 del `JwtAuthGuard` |
| Token expirado o firmado con otro secreto | 401 |
| El `userId` del token no existe en `usuarios` | **200 con `pesajes: []`.** No se consulta `usuarios`, así que no hay 404 posible. Se aparta a propósito de `GET /permisos/me`, que sí devuelve 404. |

No hay 400 en este endpoint: no hay nada que validar.

Los `peso_*` vuelven del driver de MySQL como `string`, igual que en `GET /pesajes/byLote/:loteId`, y este spec **no** los convierte con `Number()`. Se mantiene el comportamiento del endpoint hermano; unificarlo es otro trabajo.

---

## Implementation plan

1. Confirmar contra MySQL que hay datos para probar: `SELECT usuario_id, COUNT(*) FROM pesajes WHERE isActive = 1 GROUP BY usuario_id;`. Anotar un `usuario_id` con varios pesajes y el token de ese usuario. Si no hay ninguno, crear dos o tres con `POST /pesajes` antes de seguir.
2. Confirmar con `SELECT COUNT(*) FROM pesajes WHERE lote_id IS NULL;` cuántas filas huérfanas hay. Lo esperado es **0**; si sale otro número, el `LEFT JOIN` de este spec es el que las va a hacer visibles y conviene saberlo antes de probar.
3. Agregar `getHistorialByUsuario(userId: number)` a `PesajesRepository`, con la consulta exacta del modelo de datos. Sin transacción, sin validadores privados nuevos y sin tocar ninguno de los seis que ya existen. Confirmar que compila (`npm run build`).
4. Agregar `findHistorial(userId: number)` a `PesajesService` como pass-through, igual en forma a `findAllByLote`.
5. Agregar el handler `@Get('historial')` a `PesajesController`, declarado **antes** de `@Get('byLote/:loteId')`, con `@Req() req: Request` y ningún otro decorador de parámetro. Lee `const { userId } = req.user as { userId: number }`. Responde `{ ok: !!pesajes, msg: 'Historial de pesajes obtenido correctamente', pesajes }`. Sin `@Public()` y sin `@HttpCode`.
6. Levantar con `npm run start:dev` y confirmar que `GET /pesajes/historial` aparece en el log de rutas de Nest junto a los tres endpoints de pesajes ya existentes, y que los tres siguen apareciendo.
7. Verificación manual del camino feliz: con el token del paso 1, llamar al endpoint y confirmar 200, que vienen exactamente los pesajes de ese `usuario_id`, que cada fila trae los trece campos, que `lote` y `cliente` traen nombres y no ids, y que el orden es del más reciente al más antiguo.
8. Verificación manual del aislamiento por usuario: con el token de **otro** usuario, confirmar que la respuesta contiene un conjunto distinto de filas y **ninguna** del usuario anterior. Confirmar además que no existe forma de pedir el historial ajeno: la ruta no acepta parámetros.
9. Verificación manual de los rechazados: rechazar uno de los pesajes con `PATCH /pesajes/:id/rechazar` y confirmar que desaparece del historial, que el resto sigue igual y que la cuenta bajó en uno.
10. Verificación manual de los lotes cerrados: aprobar con `PATCH /lotes/:id/aprobar` el lote de uno de los pesajes del historial y confirmar que el pesaje **sigue apareciendo**, con su `lote` y su `cliente` intactos, pese a que el lote ya no aparece en `GET /lotes/cliente/:clienteId`. Repetir con un lote **rechazado** por `PATCH /lotes/:id/rechazar`.
11. Verificación manual de los clientes rechazados: rechazar con `PATCH /clientes/:id/rechazar` el cliente de uno de los pesajes y confirmar que el pesaje **sigue apareciendo** con el `nombre` del cliente rechazado, pese a que ese cliente ya no aparece en `GET /clientes` ni en `GET /clientes/all`.
12. Verificación manual del vínculo: borrar a mano la fila de `cliente_operador` que une al usuario con ese cliente y confirmar que su historial **no cambia**. Volver a insertarla.
13. Verificación manual del caso vacío: con el token de un usuario recién registrado por `POST /auth/register`, confirmar 200 con `pesajes: []`, `ok: true` y **no** 404.
14. Verificación manual de los errores: llamar sin header `Authorization` y confirmar 401; con un token expirado y confirmar 401; con un token válido cuyo `user_id` no exista en `usuarios` y confirmar **200 con `pesajes: []`**, no 404.
15. Verificación manual de que nada más cambió: `GET /pesajes/byLote/:loteId` responde con sus **doce** campos de siempre, incluido `usuario`, en el mismo orden; `POST /pesajes` y `PATCH /pesajes/:id/rechazar` responden igual; `GET /permisos/me` devuelve los mismos códigos que antes.
16. Confirmar que `permisos` sigue con **14 filas** y `catalogo_permisos` con **9**: este spec no siembra ninguna.
17. Actualizar `CLAUDE.md`: agregar `GET /pesajes/historial` a la fila `pesajes` de la tabla de endpoints, describiendo sus trece campos, sus dos filtros y los tres que **no** tiene; anotar que es el primer endpoint que devuelve el nombre de lotes cerrados y de clientes rechazados; anotar que es el segundo endpoint que se resuelve solo con el token, después de `GET /permisos/me`, y que por eso "no valida `cliente_operador`" aquí no es una advertencia sino que no hay nada que validar; y anotar que sigue sin sembrarse fila de permiso, sexta excepción consecutiva.

---

## Acceptance criteria

- [ ] No se ejecutó ningún DDL: `DESCRIBE pesajes;`, `DESCRIBE lotes;` y `DESCRIBE clientes;` muestran exactamente las mismas columnas que antes de este spec.
- [ ] `src/database/types/types.ts` **no cambió**: ninguna interfaz nueva y ninguna clave nueva en `Database`.
- [ ] No se creó ningún DTO: `src/modules/pesajes/dto/` sigue con exactamente dos archivos, `create-pesaje.dto.ts` y `rechazar-pesaje.dto.ts`.
- [ ] No se creó ningún módulo, controller, service ni repositorio nuevo: solo se modificaron `pesajes.controller.ts`, `pesajes.service.ts` y `repository/pesajes.repository.ts`.
- [ ] `src/app.module.ts` no cambió: `PesajesModule` ya estaba registrado.
- [ ] La app arranca sin errores de compilación (`npm run start:dev`).
- [ ] `GET /pesajes/historial` aparece en el log de rutas de Nest, y `GET /pesajes/byLote/:loteId`, `POST /pesajes` y `PATCH /pesajes/:id/rechazar` siguen apareciendo.
- [ ] El handler `@Get('historial')` está declarado **antes** que `@Get('byLote/:loteId')` en el controlador.
- [ ] El handler no tiene `@Param()`, ni `@Body()`, ni `@Query()`: su único decorador de parámetro es `@Req()`.
- [ ] La respuesta es exactamente `{ ok, msg, pesajes }`, con `msg = 'Historial de pesajes obtenido correctamente'` y la clave nombrada `pesajes`, **no** `data`.
- [ ] Cada elemento del array trae exactamente trece campos: `id`, `lote_id`, `lote`, `cliente`, `peso_bruto`, `tara`, `peso_neto`, `fuera_de_rango`, `estado_calidad_codigo`, `estado_calidad`, `dispositivo_identificador`, `secuencia_dispositivo` y `created_at`.
- [ ] La respuesta **no** incluye `usuario`, ni `usuario_id`, ni `isActive`, ni `motivo_rechazo`, ni `rechazado_por`, ni `rechazado_en`, ni `estado_calidad_id`, ni `cliente_id`, ni el estado del lote.
- [ ] `lote` es el `nombre_lote` del lote y `cliente` es el `nombre` del cliente: los dos son texto, no ids.
- [ ] La consulta filtra `pesajes.usuario_id` con el `userId` del token y con nada más.
- [ ] La consulta filtra `pesajes.isActive = 1`.
- [ ] Las filas vienen ordenadas por `pesajes.created_at` descendente, de la más reciente a la más antigua.
- [ ] Con el token de un usuario A, la respuesta contiene **todos** sus pesajes activos y **ninguno** de otro usuario.
- [ ] Con el token de un usuario B, la respuesta es distinta de la de A y no comparte ninguna fila con ella.
- [ ] No existe ninguna forma de pedir el historial de otro usuario: la ruta no acepta parámetro de ruta ni query param, y `GET /pesajes/historial/3` responde 404 de Nest.
- [ ] Un pesaje rechazado con `PATCH /pesajes/:id/rechazar` **desaparece** del historial de quien lo registró.
- [ ] Un pesaje cuyo lote fue **aprobado** con `PATCH /lotes/:id/aprobar` **sigue apareciendo** en el historial, con su `lote` y su `cliente` llenos, pese a que el lote ya no aparece en `GET /lotes/cliente/:clienteId`. **Es el comportamiento esperado de este spec.**
- [ ] Un pesaje cuyo lote fue **rechazado** con `PATCH /lotes/:id/rechazar` **sigue apareciendo** en el historial. **Es el comportamiento esperado.**
- [ ] Un pesaje cuyo cliente fue **rechazado** con `PATCH /clientes/:id/rechazar` **sigue apareciendo**, con el `nombre` del cliente rechazado. **Es el comportamiento esperado**, y es el único endpoint del proyecto que devuelve ese nombre.
- [ ] Borrar la fila de `cliente_operador` entre el usuario y el cliente **no** cambia su historial: la consulta no toca esa tabla.
- [ ] Un usuario sin ningún pesaje recibe 200 con `pesajes: []` y `ok: true`, **no** un 404 y **no** un 500.
- [ ] Un usuario cuyos pesajes fueron todos rechazados recibe 200 con `pesajes: []`.
- [ ] Un token válido cuyo `user_id` no existe en `usuarios` recibe **200 con `pesajes: []`**, no 404: este endpoint no consulta `usuarios`, a diferencia de `GET /permisos/me`.
- [ ] `GET /pesajes/historial` sin header `Authorization` responde 401: el endpoint no es `@Public()`.
- [ ] `GET /pesajes/historial` con un token expirado o firmado con otro secreto responde 401.
- [ ] El endpoint no responde 400 en ningún caso: no hay nada que validar.
- [ ] Un pesaje con `lote_id` en `NULL`, si existiera, aparece en el historial con `lote: null` y `cliente: null`, y no rompe la respuesta: los joins son `LEFT`, no `INNER`.
- [ ] El método del repositorio **no** abre transacción y **no** llama a ningún validador: es un único `SELECT`.
- [ ] `getHistorialByUsuario` **no** llama a `validateVinculoOperador`, y los seis validadores privados de `PesajesRepository` no se modificaron.
- [ ] `getPesajesByLote` no cambió: sigue devolviendo sus **doce** campos, incluido `usuarios.complete_name as usuario`, con su join a `usuarios`, su filtro `isActive = 1` y su orden.
- [ ] No se factorizó ningún select común entre los dos métodos: siguen siendo dos consultas independientes.
- [ ] `createPesaje` y `rechazarPesaje` no cambiaron.
- [ ] `permisos` sigue teniendo exactamente **14 filas** y `catalogo_permisos` exactamente **9**: no se sembró ninguna fila.
- [ ] `GET /permisos/me` devuelve exactamente los mismos códigos que antes de este spec para los dos roles.
- [ ] Cualquier usuario autenticado puede llamar al endpoint, sin importar su rol: no hay `PermissionsGuard` y `req.user` sigue siendo `{ userId, username }`.
- [ ] El payload del JWT no cambió.
- [ ] `POST /clientes`, `GET /clientes`, `GET /clientes/all`, `PATCH /clientes/:id/rechazar`, `POST /lotes`, los dos `GET /lotes/cliente/:clienteId*`, `PATCH /lotes/:id/rechazar`, `PATCH /lotes/:id/aprobar`, `POST /pesajes`, `GET /pesajes/byLote/:loteId`, `PATCH /pesajes/:id/rechazar`, `POST /auth/login`, `POST /auth/register`, `GET /permisos/me` y los tres `GET /catalogos/*` siguen funcionando igual.
- [ ] `CLAUDE.md` lista `GET /pesajes/historial` en la tabla de endpoints, con sus trece campos y sus dos filtros.
- [ ] `CLAUDE.md` anota que es el primer endpoint que devuelve el nombre de lotes cerrados y de clientes rechazados, y que se resuelve solo con el token.

---

## Decisions

- **Sí:** "los pesajes del usuario logueado" significa `pesajes.usuario_id = <userId del token>`, es decir los que **esa persona registró**. Decisión explícita del usuario. Es la lectura literal de lo que se pidió: el historial de quien pesa.
- **No:** los pesajes de los clientes a los que el usuario está vinculado por `cliente_operador`. Se descarta: eso es "el historial de mi cartera", incluye lo que pesaron otros operadores y exige dos joins más. Si hace falta, va en su propio spec.
- **No:** filtrar por `usuario_id` **y además** exigir vínculo vigente con el cliente. Se descarta con la consecuencia sobre la mesa: si a alguien lo desvinculan de un cliente, sus pesajes viejos desaparecerían de su propio historial, que es exactamente lo que un historial no debe hacer.
- **Sí:** la ruta es `GET /pesajes/historial`. Decisión explícita del usuario. Es un segmento estático, no choca con `byLote/:loteId` (dos segmentos) ni con `:id/rechazar` (otro verbo), y nombra lo que es.
- **No:** `GET /pesajes/me`, que habría copiado el precedente de `GET /permisos/me`. Se descarta pese a la consistencia: `historial` describe mejor el recurso, que es una lista de eventos y no un atributo del usuario.
- **No:** `GET /pesajes/mis-pesajes`. Se descarta: sería la segunda ruta con guion del proyecto, después de `catalogos/unidades-medida`, y no aporta claridad sobre `historial`.
- **Sí:** el handler se declara **antes** de `@Get('byLote/:loteId')`. Hoy no hay conflicto posible entre los dos —uno tiene un segmento y el otro dos—, pero declarar el estático primero es el hábito que `CLAUDE.md` ya pide para `GET /clientes/all` y para el futuro `GET /lotes/:id`. Ver Risks.
- **Sí:** el historial filtra `isActive = 1`. Decisión explícita del usuario. El historial muestra lo que sigue valiendo. Mismo filtro que `GET /pesajes/byLote/:loteId`, así que los dos `GET` del módulo son coherentes entre sí.
- **No:** devolver también los rechazados con su `isActive` y su `motivo_rechazo` visibles. Se descarta pese a ser más útil como auditoría: habría sido el primer endpoint del proyecto que expone filas rechazadas y habría añadido tres campos que ningún otro `GET` devuelve. Consecuencia asumida y anotada en Risks: un pesaje anulado sigue sin listarse en ninguna parte.
- **No:** un query param `?incluirRechazados=true`. Se descarta: sería el primer query param del proyecto y obligaría a un DTO de query con Zod para un caso que ni siquiera se pidió.
- **Sí:** el historial incluye pesajes de lotes **cerrados**, tanto aprobados como rechazados. Decisión explícita del usuario. Es la razón de existir del endpoint: los dos `GET /lotes/cliente/*` filtran `estado = 'abierto'`, así que sin esto el trabajo del operador se volvería inalcanzable en cuanto un supervisor cierra el lote.
- **No:** filtrar `lotes.estado = 'abierto'` para ser consistente con los dos `GET` de lotes. Se descarta: el historial se vaciaría solo y el endpoint no serviría para nada.
- **No:** devolver también `lotes.estado` para que el cliente distinga. Se descarta: `'cerrado'` no dice si fue rechazo o aprobación —esa es la ambigüedad que SPEC 13 dejó documentada— así que el campo confundiría más de lo que aclara. Devolver el estado de verdad exige `motivo_rechazo` y `aprobado_por`, y eso es otro spec.
- **Sí:** el historial incluye pesajes de clientes **rechazados**, sin filtrar `clientes.isActive`. Decisión explícita del usuario, con la consecuencia registrada: es el primer endpoint del proyecto que devuelve el `nombre` de un cliente que el resto de la API ya oculta.
- **Sí:** los joins a `lotes` y a `clientes` son `LEFT`, no `INNER`. Decisión explícita del usuario. Un pesaje con `lote_id` en `NULL` aparece con `lote: null` y `cliente: null` en vez de desaparecer en silencio. Hoy no debería haber ninguna fila así, pero la columna lo permite y `PATCH /pesajes/:id/rechazar` ya contempla el caso.
- **No:** `INNER JOIN`, que habría descartado la fila huérfana. Se descarta: perder filas del historial sin decirlo es peor que devolver dos campos nulos.
- **Sí:** los campos son los de `GET /pesajes/byLote/:loteId` **menos** `usuario`, **más** `lote` y `cliente`. Decisión explícita del usuario. Sin el nombre del lote y del cliente, el historial es una lista de números sin contexto.
- **Sí:** se quita `usuarios.complete_name as usuario`, y con él el join a `usuarios`. Es redundante: todas las filas son del usuario del token. Consecuencia: este endpoint no consulta `usuarios` y por tanto no puede devolver 404, a diferencia de `GET /permisos/me`.
- **No:** copiar literalmente el select de `getPesajesByLote`, `usuario` incluido. Se descarta por la redundancia, aunque habría dejado los dos métodos idénticos salvo el `WHERE`.
- **No:** una lista mínima sin `tara`, sin `dispositivo_identificador` y sin estado de calidad. Se descarta: son datos que ya están en la fila y que el otro `GET` ya devuelve; recortarlos obligaría a otra llamada para verlos.
- **No:** factorizar un select común entre los dos métodos del repositorio. Se descarta: se mantiene el criterio de SPEC 13 al dejar `resolveEtapaRechazado` intacto — dos consultas parecidas es más barato que un helper compartido que después hay que parametrizar.
- **Sí:** sin paginación, sin límite y sin recorte por fecha. Decisión explícita del usuario. Ninguno de los siete `GET` del proyecto pagina y este no introduce la primera convención de paginación. Riesgo asumido y anotado.
- **No:** un `.limit(50)` clavado. Se descarta: dejaría el historial viejo inalcanzable por API y el número quedaría escrito en el código sin spec que lo justifique.
- **No:** `?page` y `?limit`. Se descarta: exige DTO de query, un `COUNT(*)`, decidir la forma de la respuesta paginada y después replicarlo en los otros siete `GET`. Es un spec propio.
- **No:** `?desde` y `?hasta`. Se descarta por lo mismo, más la pregunta de zona horaria que abriría.
- **Sí:** la respuesta usa la clave nombrada `pesajes`, no `data`. Sigue la convención del proyecto; `data` es la excepción deliberada de los tres `GET /catalogos/*` de SPEC 09 y no se extiende aquí.
- **Sí:** el caso vacío es 200 con `pesajes: []`. Mismo criterio que `GET /permisos/me` con un rol sin permisos y que `GET /pesajes/byLote/:loteId` con un lote sin pesajes. Un historial vacío no es un error.
- **Sí:** el `ok` se calcula como `!!pesajes`, copiando los otros dos handlers del controlador. Un array vacío es *truthy*, así que el caso vacío responde `ok: true`. Se copia el comportamiento existente en vez de corregirlo aquí.
- **No:** validar que el usuario del token siga existiendo en `usuarios`, con 404 como hace `GET /permisos/me`. Se descarta: obligaría a una segunda consulta solo para producir un error que ningún cliente va a ver, porque un token válido siempre nombra a un usuario que existía al emitirlo. El caso raro cae en `pesajes: []`.
- **Sí:** el método del repositorio es un único `SELECT`, sin transacción y sin validadores. Es una lectura; el patrón de transacción del proyecto es para el camino de escritura. Misma forma que `getPesajesByLote` y que los tres `SELECT` de `CatalogosRepository`.
- **Sí:** sin `validateVinculoOperador`. Aquí **no es una excepción a la convención de acceso**, como sí lo fue en SPEC 08 a 13: el filtro es el propio `usuario_id` del token, así que no hay dato ajeno que autorizar. Queda escrito para que nadie lo cuente como la octava ruta que se salta el vínculo.
- **Sí:** ninguna fila nueva en `catalogo_permisos` ni en `permisos`. Decisión explícita del usuario. Sexta excepción consecutiva a la regla de SPEC 06, y la de argumento más fuerte: negarle a alguien su propio historial no tiene sentido, y de todas formas no hay `PermissionsGuard`.
- **No:** sembrar `VER-MIS-PESAJES` en el catálogo y asignárselo a los dos roles. Se descarta pese a ser lo que la convención pide, y pese a que después de SPEC 14 cuesta tres `INSERT` en vez de dos.
- **No:** sembrar el código solo en el catálogo, sin asignarlo a ningún rol. Se descarta: dejaría un código que `GET /permisos/me` no devuelve a nadie y que nadie sabría si es deliberado.
- **No:** un `GET /pesajes/usuario/:usuarioId` para ver el historial ajeno. Se descarta: exige decidir quién puede verlo, y esa decisión depende del `PermissionsGuard` que todavía no existe.
- **No:** agregados en la respuesta (total pesado, conteos por estado de calidad, fuera de rango). Se descarta: este endpoint devuelve filas. Los agregados por lote ya están diferidos desde SPEC 02 y van con ellos.
- **No:** convertir los `peso_*` con `Number()`. Se descarta: `GET /pesajes/byLote/:loteId` los devuelve como vienen del driver y los dos `GET` deben responder igual. Unificar el tipo es una limpieza propia de todo el proyecto.
- **No:** un índice en MySQL sobre `pesajes.usuario_id`. Se descarta en este spec por la regla de no aplicar DDL que no haga falta todavía; queda en Risks.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **Sin paginación ni límite**, un operador con miles de pesajes recibe todas sus filas en una respuesta, y la consulta escanea toda su historia cada vez. Es el primer endpoint del proyecto cuyo resultado crece sin techo con el uso: los otros siete están acotados por un lote, un cliente o un catálogo. | **Sin mitigar por decisión explícita del usuario.** Es el riesgo principal de este spec. La mitigación real es el spec que introduzca la convención de paginación del proyecto, que tendrá que aplicarla también a `GET /pesajes/byLote/:loteId`. |
| El `WHERE pesajes.usuario_id = ?` no tiene índice detrás. Con la tabla creciendo, es un *full table scan* por llamada. | Sin mitigar: no se aplica DDL en este spec. Queda anotado que un `CREATE INDEX idx_pesajes_usuario_id ON pesajes (usuario_id);` es la primera medida si el endpoint se pone lento, y que no cambia ni una línea de código. |
| **Es el primer endpoint que devuelve el `nombre` de un cliente rechazado y el `nombre_lote` de un lote cerrado**, datos que `GET /clientes`, `GET /clientes/all` y los dos `GET /lotes/cliente/*` ya ocultan. Alguien puede leerlo como una fuga. | Asumido por decisión explícita, y acotado: solo se ven las filas que el propio usuario registró, y solo el nombre. Hay tres criterios de aceptación que lo fijan como comportamiento esperado y el paso 17 lo escribe en `CLAUDE.md`. |
| **Un operador desvinculado de un cliente sigue viendo el nombre de ese cliente** en su historial. El `cliente_operador` deja de ser la frontera de lo que ve. | Asumido por decisión explícita: quitar el vínculo no debería borrar la historia de trabajo de nadie. Hay un criterio de aceptación que lo verifica. Si algún día debe dejar de verse, el filtro es una línea. |
| **Un pesaje rechazado desaparece del historial de quien lo hizo**, y sigue sin listarlo ningún endpoint. Quien anuló un pesaje por error no tiene forma de verlo por API. | Sin mitigar por decisión. Es la misma consecuencia que SPEC 10 ya asumió; este spec no la agrava ni la corrige. La fila sigue en la base y se consulta por SQL. |
| Alguien agrega después un `GET /pesajes/:id` y lo declara **antes** de `historial`, con lo que `/pesajes/historial` empieza a resolver contra ese handler y `ParseIntPipe` responde 400. Es exactamente la trampa que `CLAUDE.md` ya advierte para `GET /clientes/all` y para `LotesController`. | Mitigado en parte: el paso 5 declara `historial` primero, así que un `:id` agregado al final no la rompe. Queda anotado en `CLAUDE.md` como el tercer sitio del proyecto donde una ruta estática convive con un futuro `:id`. |
| Los dos `GET` del módulo devuelven campos distintos para el mismo recurso: uno trae `usuario` y el otro `lote`/`cliente`. Un cliente de la API que reuse el mismo tipo para los dos se rompe. | Asumido: la diferencia es deliberada y está en la tabla comparativa del modelo de datos. Hay criterios de aceptación que fijan los doce campos de uno y los trece del otro. |
| Un token válido cuyo usuario ya no existe recibe 200 con `[]` en vez de 404, apartándose de `GET /permisos/me`, que sí devuelve 404 en ese caso. Dos endpoints del proyecto tratan el mismo caso de forma distinta. | Asumido por decisión: consultar `usuarios` solo para producir ese 404 sería una consulta extra en cada llamada. Hay un criterio de aceptación que fija el 200 como esperado, para que no se lea como un descuido. |
| Al no sembrar fila de permiso, el `PermissionsGuard` futuro encuentra **otro** endpoint sin código que exigir. Van seis specs seguidos. | Queda registrado aquí, en Decisions y en `CLAUDE.md`. A diferencia de las cuatro escrituras de SPEC 10 a 13, aquí el argumento es que el permiso no se le negaría a nadie: el endpoint solo devuelve filas del propio llamante. |

---

## What is **not** in this spec

- El historial de **otro** usuario: no hay `GET /pesajes/usuario/:usuarioId` ni parámetro alguno para pedirlo.
- El historial por cliente o por cartera (`cliente_operador`), que incluiría lo que pesaron otros operadores.
- Paginación, query params de cualquier tipo, filtros por fecha, por lote, por cliente o por estado de calidad.
- Recortes fijos en código, del tipo "últimos 50" o "últimos 30 días".
- Devolver los pesajes rechazados, ni `motivo_rechazo`, `rechazado_por` o `rechazado_en` en ningún endpoint.
- Agregados: total pesado, conteos por estado de calidad o de fuera de rango.
- Devolver el estado del lote junto a cada pesaje.
- Cambios a `GET /pesajes/byLote/:loteId`, `POST /pesajes` y `PATCH /pesajes/:id/rechazar`.
- Cambios a los módulos `auth`, `clientes`, `lotes`, `permisos` y `catalogos`.
- Cualquier DDL: ni columnas, ni tablas, ni índices, ni FK. Tampoco el índice sobre `pesajes.usuario_id`.
- Cambios a `src/database/types/types.ts`.
- Sembrar filas en `catalogo_permisos` o en `permisos`.
- Aplicar permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`.
- Validar el vínculo `cliente_operador`, ni `usuarios.isActive`, ni la existencia del usuario del token.
- Un `GET /pesajes/:id` para un pesaje suelto.
- Convertir los `peso_*` a `number` en la respuesta.
- Caché de la respuesta.

Cada uno de estos, si se necesita, va en su propio spec.
