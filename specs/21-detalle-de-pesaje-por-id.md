# SPEC 21 — Detalle de un pesaje por id

> **Status:** Approved
> **Depends on:** SPEC 03, SPEC 10, SPEC 19
> **Date:** 2026-09-11
> **Objective:** Agregar `GET /pesajes/:id`, que devuelve los mismos 21 campos que `GET /pesajes/byLote/:loteId` para un solo pesaje, para que el frontend resuelva un código QR concatenando el id escaneado a la URL.

---

## Why this spec exists

El operador escanea el QR de una etiqueta física y el frontend solo sabe hacer una cosa: concatenar el id a una URL y llamar. Hoy no hay a qué llamar. Los dos `GET` de `pesajes` son listas —uno por lote, otro por usuario— y ninguno acepta un id de pesaje.

Este spec es un `GET` y nada más. No hay DDL, no hay DTO, no hay tabla nueva, no hay campo nuevo y no se toca ningún endpoint existente.

Tres cosas conviene tener claras antes de leer el resto.

**La primera: la respuesta es exactamente una fila de `GET /pesajes/byLote/:loteId`.** Los mismos cinco `LEFT JOIN`, los mismos 21 campos, los mismos alias y el mismo mapeo de `TINYINT` a booleano. El frontend ya sabe pintar esa forma. Este endpoint no inventa ninguna.

**La segunda: distingue tres situaciones con tres códigos distintos.** `200` si el pesaje existe y está activo; `404` si el id no existe; y `400` si el pesaje existe pero fue anulado con `PATCH /pesajes/:id/rechazar`, **con el `motivo_rechazo` dentro del mensaje de error**. Una etiqueta impresa no desaparece cuando el pesaje se anula: sigue pegada a la caja y se sigue escaneando, y el operador necesita leer por qué ya no vale. El motivo viaja por el mensaje, no por un campo de la respuesta.

**La tercera: no valida nada de acceso.** Cualquier autenticado con un id lee cualquier pesaje. Es la decimocuarta ruta que se salta `validateVinculoOperador` deliberadamente, y aquí el argumento es el caso de uso: quien escanea una etiqueta en planta puede no tener fila en `cliente_operador` para ese cliente, y un `ADMIN` no tiene ninguna.

Hay además una trampa de ruta que este spec es el primero en tocar. `@Get(':id')` declarado antes que `@Get('historial')` se traga `/pesajes/historial` y lo responde con un 400 de `ParseIntPipe`. `historial` ya está declarado primero en el archivo precisamente por esto, así que el handler nuevo va **al final**, y el orden de declaración pasa a ser parte del contrato.

---

## Scope

**In:**

- Nuevo método `getPesajeById(pesajeId)` en `src/modules/pesajes/repository/pesajes.repository.ts`.
- Nuevo método `findOne(pesajeId)` en `src/modules/pesajes/pesajes.service.ts`, pass-through al repositorio.
- Nuevo handler `@Get(':id')` en `src/modules/pesajes/pesajes.controller.ts`, con `@Param('id', ParseIntPipe)`, **declarado al final de la clase**, después de `@Get('historial')` y `@Get('byLote/:loteId')`.
- Nuevo endpoint `GET /pesajes/:id`, protegido solo por el `JwtAuthGuard` global.
- La consulta reusa los **cinco `LEFT JOIN`** de `getPesajesByLote` —`estados_calidad`, `usuarios`, `lotes`, `unidades_medida`, `etapas`— y devuelve sus **21 campos**, con los mismos alias y en el mismo orden.
- Normalización de los dos `TINYINT` a booleano en el mapeo, igual que en `getPesajesByLote`: `fuera_de_rango` y `aprobado` (tri-estado, `null` se conserva).
- Respuesta `200` con la forma `{ ok, msg, pesaje }`.
- `404` con `NotFoundException` si el id no existe en `pesajes`.
- `400` con `BadRequestException` si el pesaje existe pero tiene `isActive = 0`, con el mensaje `Este pesaje no esta activo. Motivo: <motivo_rechazo>`.
- Actualizar `CLAUDE.md`: el endpoint nuevo, los conteos que cambian y la trampa de ruta ya materializada.

**Out of scope (for future specs):**

- Generar el QR: imagen, data-URI, contenido o formato. El backend solo expone la lectura; qué imprime la etiquetadora es del frontend.
- Cambiar `POST /pesajes` para que devuelva algo del QR.
- Una columna o código propio del QR distinto de `pesajes.id`. El QR lleva el id de la base.
- `GET /lotes/:id` y `GET /clientes/:id`. Este spec abre solo el de `pesajes`.
- Query params o filtros de cualquier tipo en el endpoint nuevo.
- Devolver el pesaje anulado con 200. Se responde 400 y el cuerpo del pesaje no viaja.
- Agregar `isActive`, `motivo_rechazo`, `rechazado_en`, `rechazado_por`, `aprobado_por` o `aprobado_en` como **campos** de la respuesta. `motivo_rechazo` solo aparece dentro del texto del error.
- Devolver el cliente del lote: **no** se agrega el `LEFT JOIN` a `clientes` que sí tiene `getHistorialByUsuario`.
- Cambiar los campos, los filtros o los códigos de respuesta de `GET /pesajes/byLote/:loteId` y `GET /pesajes/historial`.
- Cualquier escritura: no se puede anular, aprobar ni rechazar desde este endpoint.
- Validar el vínculo `cliente_operador`, exigir un rol, o un `PermissionsGuard`.
- Sembrar filas en `catalogo_permisos` o en `permisos`.
- DDL de cualquier tipo, y cambios a `src/database/types/types.ts`.
- Cambios a `POST /pesajes`, a los tres `PATCH` de `pesajes`, y a cualquier endpoint de `lotes`, `clientes`, `auth`, `permisos` o `catalogos`.

---

## Data model

**Este spec no introduce estructuras de datos nuevas.** No hay DDL, no hay tabla nueva, no hay columna nueva y `src/database/types/types.ts` no cambia. Reusa el modelo de SPEC 03, el `isActive` y el `motivo_rechazo` de SPEC 10 y la columna `aprobado` que adoptó SPEC 19.

### Los 21 campos de la respuesta

Exactamente los de `getPesajesByLote`, en el mismo orden y con los mismos alias:

| Campo | Origen |
| --- | --- |
| `id` | `pesajes.id` |
| `lote_id` | `pesajes.lote_id` |
| `nombre_lote` | `lotes.nombre_lote` |
| `lote_variedad_o_talla` | `lotes.variedad_o_talla` |
| `lote_unidad_medida` | `unidades_medida.nombre` |
| `lote_peso_minimo` | `lotes.peso_minimo` |
| `lote_peso_ideal` | `lotes.peso_ideal` |
| `lote_peso_maximo` | `lotes.peso_maximo` |
| `lote_estado` | `lotes.estado` |
| `etapa` | `etapas.nombre` |
| `peso_bruto` | `pesajes.peso_bruto` |
| `tara` | `pesajes.tara` |
| `peso_neto` | `pesajes.peso_neto` |
| `fuera_de_rango` | `pesajes.fuera_de_rango` |
| `estado_calidad_codigo` | `estados_calidad.codigo` |
| `estado_calidad` | `estados_calidad.nombre` |
| `usuario` | `usuarios.complete_name` |
| `dispositivo_identificador` | `pesajes.dispositivo_identificador` |
| `secuencia_dispositivo` | `pesajes.secuencia_dispositivo` |
| `created_at` | `pesajes.created_at` |
| `aprobado` | `pesajes.aprobado` |

**Ni uno más ni uno menos.** La respuesta de este endpoint es intercambiable con un elemento del array de `GET /pesajes/byLote/:loteId`.

### Los cinco `LEFT JOIN`

Exactamente los mismos de `getPesajesByLote`, sin agregar ni quitar ninguno:

```
pesajes
  LEFT JOIN estados_calidad ON estados_calidad.id = pesajes.estado_calidad_id
  LEFT JOIN usuarios        ON usuarios.id        = pesajes.usuario_id
  LEFT JOIN lotes           ON lotes.id           = pesajes.lote_id
  LEFT JOIN unidades_medida ON unidades_medida.id = lotes.unidad_medida_id
  LEFT JOIN etapas          ON etapas.id          = lotes.etapa_id
WHERE pesajes.id = ?
```

Son `LEFT`, así que un pesaje con `lote_id` nulo se devuelve igual, con `nombre_lote`, los tres pesos de tolerancia, `lote_estado`, `lote_unidad_medida` y `etapa` todos en `null`. **El pesaje nunca desaparece por culpa de un join.**

No hay `where` sobre `lotes.estado`, ni sobre `lotes.etapa_id`, ni sobre `clientes.isActive`: un pesaje de un lote cerrado, rechazado o finalizado se devuelve igual.

### Las dos columnas que se consultan y no se devuelven

El `select` pide **23** columnas: las 21 de arriba más `pesajes.isActive` y `pesajes.motivo_rechazo`. Las dos últimas se usan para decidir el código de respuesta y **se quitan del objeto antes de devolverlo**.

**No hay `where` sobre `isActive` en la consulta.** El filtro se convertiría en un 404 y perdería el motivo; la fila se trae siempre y la rama se decide en código. Es una sola consulta, no dos.

```ts
const { isActive, motivo_rechazo, ...pesaje } = row;

if (isActive === 0) {
  throw new BadRequestException(
    motivo_rechazo
      ? `Este pesaje no esta activo. Motivo: ${motivo_rechazo}`
      : 'Este pesaje no esta activo',
  );
}

return {
  ...pesaje,
  fuera_de_rango: !!pesaje.fuera_de_rango,
  aprobado: pesaje.aprobado === null ? null : !!pesaje.aprobado,
};
```

La comparación es `isActive === 0`, **no `!== 1`**: `pesajes.isActive` está tipado `Generated<number | null>` y una fila con `NULL` **no** se considera anulada. Es exactamente el criterio que ya usa `validatePesajeActivo` en el mismo archivo, y el mismo que `ClientesRepository` aplica a `clientes.isActive`.

El `motivo_rechazo` nulo tiene rama propia: `PATCH /pesajes/:id/rechazar` siempre lo escribe —es un campo requerido de 5 a 255 caracteres— pero una fila puesta a `isActive = 0` a mano en MySQL no lo tendría, y el mensaje no debe terminar en `Motivo: null`.

### Normalización de los `TINYINT`

MySQL devuelve los dos como `0` / `1`. El mapeo es idéntico al de los dos `GET` existentes:

- `fuera_de_rango` → `true` / `false`.
- `aprobado` → **tri-estado**: `true` aprobado por el aprobador, `false` rechazado por el aprobador, `null` sin revisar. `null` no significa "no aprobado".

`isActive` **no** se normaliza porque no se devuelve.

### Petición y respuestas

```
GET /pesajes/54
Authorization: Bearer <token>
```

```json
{
  "ok": true,
  "msg": "Pesaje obtenido correctamente",
  "pesaje": {
    "id": 54,
    "lote_id": 27,
    "nombre_lote": "JESUSLOTE2026",
    "lote_variedad_o_talla": "QWQE",
    "lote_unidad_medida": "Gramos",
    "lote_peso_minimo": "115.00",
    "lote_peso_ideal": "117.00",
    "lote_peso_maximo": "120.00",
    "lote_estado": "cerrado",
    "etapa": "RECHAZADO",
    "peso_bruto": "119.02",
    "tara": "2.89",
    "peso_neto": "116.13",
    "fuera_de_rango": false,
    "estado_calidad_codigo": "IDEAL",
    "estado_calidad": "PESO IDEAL",
    "usuario": "Luis de Jesus Reyes Nolasco",
    "dispositivo_identificador": null,
    "secuencia_dispositivo": null,
    "created_at": "2026-09-05T23:46:06.000Z",
    "aprobado": true
  }
}
```

Ese ejemplo es un pesaje real de un lote **rechazado**, con `dispositivo_identificador` y `secuencia_dispositivo` nulos: el endpoint lo devuelve igual, porque no filtra por estado del lote y esas dos columnas son opcionales desde SPEC 03.

Errores:

| Caso | Código | Mensaje |
| --- | --- | --- |
| El pesaje no existe | **404** | `El pesaje con id '54' no existe` |
| El pesaje está anulado, con motivo | **400** | `Este pesaje no esta activo. Motivo: Tara mal capturada` |
| El pesaje está anulado, sin motivo | **400** | `Este pesaje no esta activo` |
| `id` de ruta no numérico | 400 | El error de `ParseIntPipe` |
| Sin header `Authorization` | 401 | El del `JwtAuthGuard` |

El **404** es deliberado y es el segundo del proyecto, después del de `GET /permisos/me`. Los ocho `PATCH` lanzan `BadRequestException` con el mismo texto; aquí es una lectura de un recurso por id y el frontend necesita separar "QR inválido" de "etiqueta anulada". Ver Decisions.

Las tres situaciones dan tres respuestas distinguibles: **404** el QR no corresponde a ningún pesaje, **400** la etiqueta existe pero fue anulada y el mensaje dice por qué, **200** el pesaje es válido.

No hay error de Zod: no hay body ni query params que validar.

### Orden de declaración en el controller

`PesajesController` queda con este orden, y **el orden es parte del contrato**:

```
@Get('historial')            ← debe ir antes que :id
@Get('byLote/:loteId')       ← debe ir antes que :id
@Post()
@Patch(':id/rechazar')
@Patch(':id/rechazar/byApprover')
@Patch(':id/aprobar/byApprover')
@Get(':id')                  ← nuevo, al final
```

Nest resuelve por orden de declaración. `@Get(':id')` arriba se tragaría `/pesajes/historial` y `/pesajes/byLote/12`, respondiéndolos con un 400 de `ParseIntPipe`. Los `@Patch(':id/...')` no compiten: son otro método y otra profundidad de ruta.

### DTO

**Este endpoint no tiene DTO.** No recibe body ni query params: el `id` viene en la ruta y el usuario del token. Es el primer endpoint de **lectura** del proyecto sin schema Zod después de `GET /permisos/me` y los tres de `catalogos`.

---

## Implementation plan

1. Verificar el punto de partida: levantar con `npm run start:dev`, confirmar en el log de rutas de Nest que `pesajes` tiene **cinco** rutas y que `GET /pesajes/historial` responde 200. Anotar en MySQL el id de un pesaje activo, el de uno anulado (`isActive = 0`, con `motivo_rechazo`), el de uno aprobado (`aprobado = 1`) y el de uno rechazado por el aprobador (`aprobado = 0`). Si no existe alguno, crearlo con los endpoints correspondientes.
2. Agregar `getPesajeById(pesajeId: number)` a `PesajesRepository`: copia los cinco `LEFT JOIN` y los 21 campos de `getPesajesByLote`, agrega `pesajes.isActive` y `pesajes.motivo_rechazo` al `select`, filtra `.where('pesajes.id', '=', pesajeId)` y **nada más**, y cierra con `executeTakeFirstOrThrow(() => new NotFoundException(\`El pesaje con id '${pesajeId}' no existe\`))`. Importar `NotFoundException` de `@nestjs/common`.
3. En ese mismo método, desestructurar `isActive` y `motivo_rechazo` fuera del objeto, lanzar `BadRequestException` con `Este pesaje no esta activo. Motivo: ${motivo_rechazo}` —o sin la parte del motivo si es nulo— cuando `isActive === 0`, y devolver el resto con `fuera_de_rango` y `aprobado` normalizados. La comparación es `=== 0`, no `!== 1`.
4. Agregar `findOne(pesajeId: number)` a `PesajesService` como pass-through, igual en forma a `findAllByLote`.
5. Agregar el handler `@Get(':id')` a `PesajesController`, **como último método de la clase**, con `@Param('id', ParseIntPipe) id: number`, sin `@Query()`, sin `@Body()` y sin `@Req()`. Responde `{ ok: !!pesaje, msg: 'Pesaje obtenido correctamente', pesaje }`. Sin `@Public()` y sin `@HttpCode`.
6. Levantar y confirmar que `GET /pesajes/:id` aparece en el log de rutas de Nest, **después** de `historial` y `byLote/:loteId`, y que las cinco rutas anteriores siguen apareciendo.
7. Verificación de la trampa de ruta: `GET /pesajes/historial` responde 200 con la lista completa —no un 400 de `ParseIntPipe`— y `GET /pesajes/byLote/12` responde 200 con sus pesajes. **Este es el paso que justifica el orden de declaración.**
8. Verificación del camino feliz: `GET /pesajes/<id activo>` responde 200 con exactamente 21 campos dentro de `pesaje`. Comparar campo por campo contra ese mismo pesaje dentro del array de `GET /pesajes/byLote/:loteId`: los dos objetos deben ser idénticos, clave por clave y valor por valor.
9. Verificación de que no sobran campos: confirmar que la respuesta **no** trae `isActive`, `motivo_rechazo`, `rechazado_en`, `rechazado_por`, `aprobado_por`, `aprobado_en`, `usuario_id` ni `estado_calidad_id`.
10. Verificación del pesaje anulado: `GET /pesajes/<id anulado>` responde **400** con `Este pesaje no esta activo. Motivo: <el motivo que escribió PATCH /pesajes/:id/rechazar>`. Confirmar que el cuerpo del pesaje **no** viaja en la respuesta.
11. Verificación del motivo nulo: poner a mano `isActive = 0` y `motivo_rechazo = NULL` en un pesaje de prueba y confirmar que el mensaje es `Este pesaje no esta activo`, sin la palabra `null` ni `undefined`. Restaurar la fila después.
12. Verificación del `isActive` nulo: poner a mano `isActive = NULL` en un pesaje de prueba y confirmar que responde **200**, no 400: un `NULL` no es una anulación. Restaurar la fila después.
13. Verificación de los tres estados de `aprobado`: el pesaje sin revisar da `aprobado: null`, el aprobado da `true` y el rechazado por el aprobador da `false`. Ninguno de los tres devuelve `0` ni `1`.
14. Verificación del `LEFT JOIN`: poner a mano `lote_id = NULL` en un pesaje activo de prueba y confirmar que responde 200 con `nombre_lote`, `lote_variedad_o_talla`, `lote_unidad_medida`, los tres pesos de tolerancia, `lote_estado` y `etapa` en `null`, y que el pesaje **no** desaparece. Restaurar el `lote_id` después.
15. Verificación de que no filtra estado del lote: escanear un pesaje activo de un lote **cerrado**, uno de un lote **rechazado** y uno de un lote **finalizado** (SPEC 20). Los tres responden 200 con su `lote_estado` y su `etapa` reales.
16. Verificación de los demás errores: `GET /pesajes/999999` responde **404** con `El pesaje con id '999999' no existe` —no 400 y no 200 con `null`—; `GET /pesajes/abc` responde 400 por `ParseIntPipe`; sin header `Authorization` responde 401.
17. Verificación de la ausencia de control de acceso: login con un `Operador` **sin** fila en `cliente_operador` para el cliente del lote y confirmar que lee el pesaje igual, con **200 y no 403**. Es el resultado esperado de este spec.
18. Verificación de que los query params se ignoran: `GET /pesajes/<id>?fuera_de_rango=true&foo=bar` responde exactamente igual que sin ellos. El handler no tiene `@Query()`.
19. Verificación de que nada más cambió: `GET /pesajes/byLote/:loteId` y `GET /pesajes/historial` devuelven los mismos campos de siempre y siguen ocultando los anulados; los siete filtros de SPEC 16 siguen funcionando; `POST /pesajes` y los tres `PATCH` de `pesajes` responden igual; los siete de `lotes`, los cuatro de `clientes`, `GET /permisos/me`, los tres `GET /catalogos/*` y los dos de `auth` responden igual. Confirmar que `permisos` sigue con **14 filas** y `catalogo_permisos` con **9**.
20. Actualizar `CLAUDE.md`:
    - Agregar `GET /pesajes/:id` a la fila `pesajes` de la tabla de endpoints: los mismos 21 campos de `byLote`, 404 si el id no existe, 400 con el motivo si está anulado, sin `cliente_operador` y sin fila de permiso.
    - Corregir la frase de que **no hay `GET /clientes/:id` ni `GET /lotes/:id`**: ahora sí hay un `GET` por id, el de `pesajes`, y los otros dos siguen sin existir.
    - Reescribir la advertencia de colisión de rutas de `PesajesController`: la trampa ya se materializó y se resolvió declarando `@Get(':id')` al final. El orden de declaración es ahora parte del contrato del archivo.
    - Anotar que `motivo_rechazo` ya es legible por API, pero **solo dentro del texto de un error 400**, no como campo de una respuesta. `rechazado_por`, `rechazado_en`, `aprobado_por` y `aprobado_en` siguen sin ser legibles de ninguna forma.
    - Corregir los conteos: los `:id` de ruta pasan de ocho a **nueve**; las rutas que se saltan `validateVinculoOperador` deliberadamente pasan de trece a **catorce** (más la que nunca lo tuvo, `GET /lotes/cliente/:clienteId/all`); el módulo `pesajes` pasa de cinco a **seis** endpoints.
    - Anotar que es la **duodécima** excepción consecutiva a la regla de una fila de permiso por endpoint de SPEC 06.
    - Anotar en la sección de trabajo diferido que la generación del QR, `GET /lotes/:id` y `GET /clientes/:id` siguen sin existir.

---

## Acceptance criteria

- [ ] `GET /pesajes/:id` aparece en el log de rutas de Nest, y las cinco rutas anteriores de `pesajes` siguen apareciendo.
- [ ] `@Get(':id')` es el **último** método declarado en `PesajesController`, después de `@Get('historial')` y `@Get('byLote/:loteId')`.
- [ ] `GET /pesajes/historial` sigue respondiendo 200 con la lista del usuario, **no** un 400 de `ParseIntPipe`.
- [ ] `GET /pesajes/byLote/12` sigue respondiendo 200 con los pesajes del lote, **no** un 400 de `ParseIntPipe`.
- [ ] No se creó ningún DTO: `src/modules/pesajes/dto/` sigue con exactamente cuatro archivos.
- [ ] No se creó ningún módulo, controller, service ni repositorio nuevo: solo se modificaron `pesajes.controller.ts`, `pesajes.service.ts` y `repository/pesajes.repository.ts`.
- [ ] `src/database/types/types.ts` **no cambió** y no se aplicó ningún DDL.
- [ ] `src/app.module.ts` no cambió y la app arranca sin errores de compilación.
- [ ] Pedir un pesaje activo responde 200 con la forma `{ ok: true, msg: 'Pesaje obtenido correctamente', pesaje }`.
- [ ] El payload se llama `pesaje` en singular, no `pesajes` ni `data`.
- [ ] El objeto `pesaje` trae exactamente **21** campos: los mismos de `getPesajesByLote`, con los mismos alias.
- [ ] Ese objeto es **idéntico**, clave por clave y valor por valor, al elemento correspondiente del array de `GET /pesajes/byLote/:loteId`.
- [ ] La respuesta **no** incluye `isActive`, `motivo_rechazo`, `rechazado_en`, `rechazado_por`, `aprobado_por`, `aprobado_en`, `usuario_id`, `estado_calidad_id` ni el nombre del cliente.
- [ ] `fuera_de_rango` viene como `true` / `false`, nunca como `0` / `1`.
- [ ] `aprobado` viene como `true`, `false` o `null`, nunca como `0` / `1`: los tres estados se distinguen.
- [ ] La consulta tiene exactamente **cinco** `LEFT JOIN`: no se agregó el de `clientes`.
- [ ] La consulta **no** tiene ningún `where` sobre `isActive`, `lotes.estado`, `lotes.etapa_id` ni `clientes.isActive`: la única condición del `where` es `pesajes.id`.
- [ ] Se hace **una sola** consulta a la base por llamada, no dos.
- [ ] Pedir un pesaje anulado (`isActive = 0`) responde **400** con `Este pesaje no esta activo. Motivo: <motivo_rechazo>`, no 200 y no 404.
- [ ] Ese 400 **no** incluye el pesaje en el cuerpo de la respuesta.
- [ ] Un pesaje anulado con `motivo_rechazo` nulo responde 400 con `Este pesaje no esta activo`, sin la palabra `null` ni `undefined` en el mensaje.
- [ ] Un pesaje con `isActive = NULL` responde **200**, no 400: la comparación es `=== 0`, no `!== 1`.
- [ ] Un pesaje activo de un lote **cerrado**, uno de un lote **rechazado** y uno de un lote **finalizado** se devuelven los tres con 200.
- [ ] Un pesaje activo con `lote_id` nulo se devuelve con 200 y con `nombre_lote`, `lote_variedad_o_talla`, `lote_unidad_medida`, `lote_peso_minimo`, `lote_peso_ideal`, `lote_peso_maximo`, `lote_estado` y `etapa` en `null`: los cinco joins son `LEFT`.
- [ ] Un pesaje con `dispositivo_identificador` y `secuencia_dispositivo` nulos se devuelve con 200 y esos dos campos en `null`.
- [ ] Pedir un id que no existe responde **404** con `El pesaje con id 'X' no existe`, no 400, no 500 y no 200 con `pesaje: null`.
- [ ] Un `id` de ruta no numérico responde 400 por `ParseIntPipe`.
- [ ] Sin header `Authorization`, o con un token inválido, responde 401: el endpoint no es `@Public()`.
- [ ] Un `Operador` **sin** fila en `cliente_operador` para el cliente del lote lee el pesaje igual: responde **200, no 403**. **Este spec no valida el vínculo.**
- [ ] No se exige ningún rol, y `req.user` sigue siendo `{ userId, username }`.
- [ ] El endpoint devuelve el mismo pesaje sin importar qué usuario lo pida: no filtra por `usuario_id`.
- [ ] Cualquier query param enviado se ignora y la respuesta es idéntica: el handler no tiene `@Query()`.
- [ ] El endpoint no escribe nada: llamarlo no modifica ninguna columna de `pesajes` ni de ninguna otra tabla.
- [ ] `getPesajesByLote` y `getHistorialByUsuario` **no se modificaron**: ni joins, ni `select`, ni filtros, ni mapeo, ni orden.
- [ ] `validatePesajeActivo`, `validateLoteAbierto`, `validateLoteEnClienteFinal`, `validatePesajeSinRevisar`, `validateVinculoOperador`, `resolveEtapa` y `resolveEstadoCalidad` **no se modificaron**.
- [ ] Los siete filtros de SPEC 16 siguen funcionando igual en los dos `GET` de lista.
- [ ] `POST /pesajes`, `PATCH /pesajes/:id/rechazar`, `PATCH /pesajes/:id/rechazar/byApprover` y `PATCH /pesajes/:id/aprobar/byApprover` funcionan exactamente igual que antes.
- [ ] Los siete endpoints de `lotes`, los cuatro de `clientes`, `GET /permisos/me`, los tres `GET /catalogos/*` y los dos de `auth` responden igual.
- [ ] `permisos` sigue con exactamente **14 filas** y `catalogo_permisos` con **9**: no se sembró ninguna fila.
- [ ] No se agregó ninguna dependencia a `package.json`: no hay librería de QR.
- [ ] `POST /pesajes` sigue devolviendo exactamente `{ id, peso_neto, fuera_de_rango }`: no devuelve QR ni URL.
- [ ] No existe `GET /lotes/:id` ni `GET /clientes/:id`.
- [ ] `CLAUDE.md` documenta `GET /pesajes/:id` con sus 21 campos, su 404, su 400 de pesaje anulado y su falta de control de acceso.
- [ ] `CLAUDE.md` ya **no** dice que no existe ningún `GET` por id, y su advertencia de colisión de rutas de `PesajesController` refleja que `@Get(':id')` ya existe y va al final.
- [ ] Los conteos de `CLAUDE.md` quedan en **nueve** `:id` de ruta, **catorce** rutas que se saltan `validateVinculoOperador` deliberadamente y **seis** endpoints en el módulo `pesajes`.

---

## Decisions

- **Sí:** `GET /pesajes/:id`, la ruta REST canónica. Decisión explícita del usuario. El frontend escanea el QR y concatena el id crudo, sin transformarlo.
- **No:** `GET /pesajes/qr/:id`. Se descarta: inventa una ruta no-REST para lo que es un detalle normal y dejaría bloqueado el `GET /pesajes/:id` el día que se necesite.
- **No:** `GET /pesajes/scan/:codigo` con una columna propia del QR. Se descarta: exige DDL y un generador de códigos para un problema que el id ya resuelve. Si algún día el id de la base no debe viajar en la etiqueta, va en su propio spec.
- **Sí:** el handler se declara **al final** de `PesajesController`. Es obligatorio, no estilístico: arriba se tragaría `/pesajes/historial` y `/pesajes/byLote/:loteId`. Hay dos criterios de aceptación que lo fijan.
- **Sí:** exactamente los mismos 21 campos y los mismos cinco `LEFT JOIN` de `getPesajesByLote`. Decisión explícita del usuario, con un payload real pegado como referencia. El frontend ya sabe pintar esa forma y el detalle no inventa una nueva.
- **No:** agregar `isActive`, `motivo_rechazo` o `rechazado_en` como campos de la respuesta. Se descarta por decisión explícita del usuario: la respuesta debe ser intercambiable con una fila de `byLote`, y un campo de más rompería esa propiedad.
- **No:** agregar el `LEFT JOIN` a `clientes` para devolver el nombre del cliente. Se descarta por decisión explícita del usuario: un sexto join para un campo que el flujo de escaneo no pide. Se puede agregar después sin romper nada.
- **No:** devolver `rechazado_por`, `aprobado_por` y `aprobado_en`. Se descarta con el mismo criterio de SPEC 13, 19 y 20: quién aprobó o rechazó un pesaje y cuándo sigue siendo solo consultable en MySQL. El estado `aprobado` sí viaja, que es lo que el escaneo necesita.
- **Sí:** un pesaje anulado responde **400** con `Este pesaje no esta activo` más el `motivo_rechazo`. Decisión explícita del usuario. Una etiqueta impresa no desaparece cuando el pesaje se anula, y escanearla tiene que decir algo mejor que "no existe".
- **Sí:** el motivo viaja **dentro del texto del error**, no como campo. Es la única forma de decir por qué sin agregar un campo a la respuesta exitosa. Consecuencia asumida: `motivo_rechazo` pasa a ser legible por API, pero solo en un 400.
- **No:** filtrar `isActive = 1` en el `where` y responder 404 al anulado. Se descarta: haría indistinguible una etiqueta anulada de un QR corrupto, que es justo lo que el operador necesita distinguir en planta.
- **No:** devolver el pesaje anulado con 200 y una bandera. Se descarta por decisión explícita del usuario: cambiaría la forma de la respuesta y dejaría que un frontend distraído lo pintara como válido.
- **Sí:** la consulta trae `isActive` y `motivo_rechazo` y los descarta antes de devolver, en **una sola** consulta. La alternativa —un `SELECT` de validación y otro de lectura— duplicaría el viaje a la base para la misma fila.
- **Sí:** la comparación es `isActive === 0`, no `!== 1`. Es el criterio que ya usa `validatePesajeActivo` en el mismo archivo: la columna es nullable y un `NULL` no es una anulación. Hay un criterio de aceptación que lo fija.
- **Sí:** rama dedicada para el `motivo_rechazo` nulo. `PATCH /pesajes/:id/rechazar` siempre lo escribe, pero una fila tocada a mano en MySQL no, y el mensaje no debe terminar en `Motivo: null`.
- **Sí:** **404** cuando el id no existe. Decisión explícita del usuario. Es una lectura de un recurso por id y el frontend necesita separar "QR inválido" de "etiqueta anulada". Precedente: `GET /permisos/me`.
- **No:** 400 con `BadRequestException` para el id inexistente, como hacen los ocho `PATCH`. Se descarta: colisionaría con el 400 del pesaje anulado y el frontend perdería la distinción. Consecuencia asumida: el proyecto queda con dos códigos distintos para "el pesaje con id X no existe" según sea lectura o escritura.
- **No:** 200 con `pesaje: null`. Se descarta: rompe la convención del proyecto y esconde un QR corrupto detrás de una respuesta exitosa.
- **Sí:** la respuesta va envuelta en `{ ok, msg, pesaje }`. Decisión explícita del usuario. Es la convención de todos los endpoints del proyecto salvo los tres de `catalogos`.
- **Sí:** el QR queda **fuera de alcance**. Decisión explícita del usuario. El backend expone la lectura; generar la imagen, elegir librería y decidir si la etiqueta lleva URL completa o solo el id es del frontend.
- **No:** que `POST /pesajes` devuelva el QR. Se descarta: agrega una dependencia nueva y modifica un endpoint existente para algo que el frontend ya puede hacer con el `id` que ya recibe.
- **Sí:** sin body, sin query params y sin DTO. No hay nada que filtrar en un recurso único.
- **Sí:** cualquier usuario autenticado puede leer cualquier pesaje, sin `validateVinculoOperador`. Decisión explícita del usuario. Es la **decimocuarta** ruta que se lo salta deliberadamente.
- **No:** validar el vínculo `cliente_operador`. Se descarta por el caso de uso: quien escanea en planta puede no tener fila para ese cliente y un `ADMIN` no tiene ninguna. Consecuencia asumida: con un id secuencial se puede recorrer la tabla entera de pesajes. Queda en Risks.
- **Sí:** ninguna fila nueva en `catalogo_permisos` ni en `permisos`. Decisión explícita del usuario. **Duodécima** excepción consecutiva a la regla de SPEC 06.
- **No:** sembrar un `VER-PESAJE` sin aplicarlo. Se descarta con el mismo argumento de SPEC 19 y 20: hoy no cambia nada y habría que decidir a qué roles asignarlo sin un guard que lo lea.
- **Sí:** `pesajes.id` se devuelve tal como lo entrega el driver, sin `Number()`. Es exactamente lo que ya hace `getPesajesByLote`, y forzarlo aquí haría que el mismo pesaje tuviera dos formas según el endpoint.
- **No:** tocar `getPesajesByLote` o `getHistorialByUsuario`. Se descarta: cambiaría la respuesta de dos endpoints en producción y este spec no lo necesita.
- **No:** abrir también `GET /lotes/:id` y `GET /clientes/:id` "ya que estamos". Se descarta: cada uno tiene su propia decisión de campos y de filtros, y el de `lotes` arrastra la pregunta de los lotes finalizados que SPEC 20 dejó abierta.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **`@Get(':id')` mal ubicado rompe dos endpoints en producción** sin fallar al compilar: `/pesajes/historial` y `/pesajes/byLote/12` empezarían a responder 400 de `ParseIntPipe`. | Mitigado con proceso: el paso 7 del plan lo verifica explícitamente y hay dos criterios de aceptación dedicados. Es la trampa que `CLAUDE.md` viene advirtiendo desde SPEC 15 y este spec es el primero que la toca. |
| **Cualquier autenticado lee cualquier pesaje con solo tener el id**, y los ids son secuenciales: se puede recorrer la tabla entera incrementando el número. Peor que las trece rutas abiertas anteriores, porque esta no necesita conocer un lote ni un cliente. | **Sin mitigar por diseño**, por decisión explícita del usuario. Hay un criterio de aceptación que lo fija como comportamiento esperado. La mitigación real es el spec del `PermissionsGuard`. |
| **El `motivo_rechazo` pasa a ser legible por API**, dentro del mensaje del 400. Es texto libre escrito por un operador y ahora lo lee cualquier autenticado que tenga el id. | Aceptado por decisión: sin el motivo, el 400 no diría nada útil. No es dato sensible de negocio, pero conviene saber que dejó de ser interno. |
| **El endpoint no filtra por estado del lote**, así que expone pesajes de lotes cerrados, rechazados y finalizados, y de clientes rechazados —datos que el resto de la API esconde. | Aceptado: es el punto del endpoint. Es la misma apertura que SPEC 15 aceptó en `GET /pesajes/historial`, pero sin el filtro del token que allá la contenía. |
| **El 400 del pesaje anulado se confunde con el 400 de `ParseIntPipe`** si el frontend solo mira el código y no el mensaje. Los dos son 400 en la misma ruta. | Mitigado parcialmente: los mensajes son muy distintos y el de `ParseIntPipe` llega solo con un `id` no numérico, que el QR no produce. Si alguna vez estorba, la salida es un código propio en el body, y eso es otro spec. |
| **El proyecto queda con dos códigos distintos** para el mismo mensaje `El pesaje con id 'X' no existe`: 404 en esta lectura y 400 en los tres `PATCH` de `pesajes`. | Aceptado por decisión explícita. Unificarlos cambiaría el código de respuesta de tres endpoints en producción, y va en su propio spec si alguna vez molesta. |
| Una fila con `isActive = NULL` responde 200 aunque nadie sepa si es válida. La columna es nullable y nada garantiza que valga `1`. | Aceptado: es exactamente lo que ya hacen `validatePesajeActivo` y los dos `GET` de lista —que filtran `isActive = 1` y por tanto **sí** la esconden—, así que este endpoint es un poco más permisivo que ellos. Anotado, no corregido. |
| `pesajes.id` es `BIGINT`. Si algún ambiente lo devuelve como string, el `id` de la respuesta viaja como `"54"` y no como `54`. | Sin mitigar, y es idéntico al comportamiento actual de `GET /pesajes/byLote/:loteId`: se prefiere la consistencia entre los dos endpoints antes que arreglarlo solo en uno. |

---

## What is **not** in this spec

- Generar el QR: imagen, data-URI, contenido o formato de la etiqueta.
- Cambiar `POST /pesajes` para que devuelva un QR o una URL.
- Una columna o código propio del QR distinto de `pesajes.id`.
- `GET /lotes/:id` y `GET /clientes/:id`.
- Query params o filtros de cualquier tipo en el endpoint nuevo.
- Devolver el pesaje anulado con 200, o con una bandera que lo señale.
- Agregar `isActive`, `motivo_rechazo`, `rechazado_en`, `rechazado_por`, `aprobado_por` o `aprobado_en` como campos de la respuesta.
- Devolver el cliente del lote, y por tanto el `LEFT JOIN` a `clientes`.
- Modificar `getPesajesByLote`, `getHistorialByUsuario` o cualquier validador privado de `PesajesRepository`.
- Cualquier escritura desde este endpoint.
- Unificar el código de respuesta de "el pesaje no existe" entre la lectura y los tres `PATCH`.
- Un código de error propio en el body para distinguir los dos 400.
- Validar el vínculo `cliente_operador`, exigir un rol, o un `PermissionsGuard`.
- Sembrar filas en `catalogo_permisos` o en `permisos`.
- DDL de cualquier tipo y cambios a `src/database/types/types.ts`.
- Paginación, agregados o `resumen_ia`.
- Cambios a `POST /pesajes`, a los tres `PATCH` de `pesajes`, y a los endpoints de `lotes`, `clientes`, `auth`, `permisos` y `catalogos`.

Cada uno de estos, si se necesita, va en su propio spec.
