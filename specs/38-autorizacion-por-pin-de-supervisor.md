# SPEC 38 — Autorización por PIN de supervisor para pesajes sobre el peso máximo

> **Status:** Approved
> **Depends on:** SPEC 03 (guardado de pesajes), SPEC 04 (bandas de peso), SPEC 34 (reusa `validateCallerEsAdmin` y `validateUsuarioActivo`), SPEC 37 (mensaje del 403 como parámetro), SPEC 22 (convención de Swagger)
> **Date:** 2026-10-10
> **Objective:** Que un pesaje cuyo `peso_neto` supera el `peso_maximo` del lote solo se pueda guardar con la autorización de un supervisor, que la da escribiendo su PIN, y que el pesaje registre qué supervisor lo aprobó con excepción.

---

## Why this spec exists

Hoy `POST /pesajes` guarda cualquier peso. Un pesaje sobre el máximo queda con `fuera_de_rango = 1` y estado `MAXIMO`, y nadie lo autoriza. El `diagram.jpeg` pide que un supervisor apruebe esa excepción con un PIN. El spec 04 lo dejó fuera por necesitar esquema nuevo.

El front va a bloquear la pantalla cuando el peso supere el máximo y va a pedir el PIN. **El control lo hace el front, por decisión del usuario.** El backend valida el PIN y registra quién aprobó, pero no impide guardar. El flujo tiene dos pasos:

1. El front llama a `POST /pesajes/validar-pin` con el PIN. El backend identifica al supervisor y devuelve una **autorización de un solo uso** (un `token`). Si el PIN es correcto, el front desbloquea la pantalla.
2. El front guarda el pesaje con el `POST /pesajes` de siempre y le agrega el `token`. Si el peso supera el máximo, el backend consume la autorización y escribe en el pesaje el id del supervisor.

**`POST /pesajes` no exige el token.** Un pesaje sobre el máximo sin token se guarda igual que hoy, con `aprobado_con_excepcion_por` en `NULL`. El token existe para que el supervisor quede registrado sin que se pueda falsificar: el front no manda el id del supervisor, manda un token que solo se obtiene con el PIN correcto.

**El PIN es la identidad del supervisor.** No hay selector de nombre, así que el PIN tiene que ser único en todo el sistema. Para que nadie descubra el PIN de otro al chocar con él, **el PIN lo genera el sistema**: un `ADMIN` lo pide para un usuario con rol `SUPERVISOR` y el backend devuelve uno libre, una sola vez.

**Los PINs viven en una tabla propia, `pines_supervisor`, y la tabla `usuarios` no se toca.** Así el PIN no aparece al lado de los datos del usuario, ninguna consulta existente sobre `usuarios` puede arrastrarlo, y el día que se decida hashearlo el cambio queda dentro de esa tabla.

El rol `SUPERVISOR` ya existe en `roles` (id 3 en la base actual, verificado el 2026-10-10), aunque hoy ningún usuario lo tiene. Este spec es el primero que lo usa en código.

**Etapa.** El diagrama ubica el PIN en `CLIENTE_FINAL`, pero ahí el lote ya está cerrado y `POST /pesajes` responde 400 desde el spec 13. Este spec aplica el PIN donde hoy se pesa, en lotes abiertos (`EN_PROCESO`). Pesar en `CLIENTE_FINAL` sigue fuera.

---

## Scope

**In:**

- DDL:
  - tabla nueva `pines_supervisor`, un PIN por supervisor, en claro y único;
  - tabla nueva `autorizaciones_pin`;
  - columna `pesajes.aprobado_con_excepcion_por INT NULL`, con FK a `usuarios(id)`.

  La tabla `usuarios` **no cambia**.
- `PATCH /auth/usuarios/:id/pin`: un `ADMIN` genera el PIN de un usuario con rol `SUPERVISOR` que todavía no tiene uno. Devuelve `{ ok, msg, pin }`.
- `POST /pesajes/validar-pin`: cualquier autenticado manda un PIN. Si corresponde a un supervisor activo, se crea una fila en `autorizaciones_pin` y se devuelve `{ ok, msg, autorizacion: { token, supervisor } }`.
- `POST /pesajes` acepta un campo **opcional** nuevo, `autorizacion_token`. Sin él, el pesaje se guarda como hoy, pese lo que pese. Con él y un peso sobre el máximo, el token tiene que existir y no estar usado; si no, responde 400.
- Al guardar un pesaje sobre el máximo **con token**, en la misma transacción: se escribe `aprobado_con_excepcion_por` con el supervisor de la autorización y se marca la autorización como usada (`usada_por`, `usada_en`, `pesaje_id`).
- Tipos en `src/database/types/types.ts`, Swagger en los dos controllers tocados, y `CLAUDE.md`.

**Out of scope (for future specs):**

- Que `POST /pesajes` **exija** la autorización para un peso sobre el máximo. Hoy el bloqueo vive solo en el front.
- Hashear el PIN. Por ahora se guarda en claro; queda para otro spec.
- Una columna de PIN en `usuarios`.
- Pedir PIN para pesajes **bajo** el `peso_minimo`. Se siguen guardando sin autorización, como hoy.
- Pesar en la etapa `CLIENTE_FINAL`.
- Límite de intentos, bloqueo o registro de PINs fallidos. Queda para el spec 23 (rate limiting) o uno propio.
- Regenerar, cambiar, revocar o consultar un PIN por API. Un PIN se asigna una vez y para siempre.
- Que el supervisor elija su PIN.
- Vencimiento de la autorización, o atarla al operador, al lote o al peso.
- Volver a validar, al consumir la autorización, que el supervisor siga activo o siga siendo `SUPERVISOR`.
- Una columna `aprobado_con_excepcion_en`. La fecha queda en `autorizaciones_pin.usada_en`.
- Devolver `aprobado_con_excepcion_por` (o el nombre del supervisor) en `GET /pesajes/byLote/:loteId`, `GET /pesajes/historial` o `GET /pesajes/:id`.
- Un estado de calidad nuevo (`EXCEPCION` o `APROBADO CON EXCEPCIÓN`). El pesaje sigue en `MAXIMO`.
- Cambiar la respuesta de `POST /pesajes`.
- Asignar el rol `SUPERVISOR` a un usuario existente. Hoy solo se puede al registrarlo con `POST /auth/register` (`rol: 3`) o a mano en MySQL.
- Contar las excepciones en las métricas del spec 35 o en el chat del spec 28.
- Un `PermissionsGuard` o una fila en `catalogo_permisos`/`permisos`.

---

## Data model

### DDL

Se aplica **a mano en MySQL**, en este orden y antes de escribir código. Los tipos tienen que coincidir con los de la base: `usuarios.id` es `INT` y `pesajes.id` es `BIGINT` (verificado con `SHOW CREATE TABLE` el 2026-10-10).

```sql
CREATE TABLE pines_supervisor (
  id          INT       NOT NULL AUTO_INCREMENT,
  usuario_id  INT       NOT NULL,
  pin         CHAR(4)   NOT NULL,
  created_by  INT       NOT NULL,
  created_at  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pines_supervisor_usuario (usuario_id),
  UNIQUE KEY uq_pines_supervisor_pin (pin),
  CONSTRAINT fk_pines_supervisor_usuario    FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT fk_pines_supervisor_created_by FOREIGN KEY (created_by) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE pesajes
  ADD COLUMN aprobado_con_excepcion_por INT NULL AFTER aprobado_en,
  ADD CONSTRAINT fk_pesajes_aprobado_con_excepcion_por
    FOREIGN KEY (aprobado_con_excepcion_por) REFERENCES usuarios (id);

CREATE TABLE autorizaciones_pin (
  id             INT       NOT NULL AUTO_INCREMENT,
  token          CHAR(36)  NOT NULL,
  supervisor_id  INT       NOT NULL,
  solicitado_por INT       NOT NULL,
  created_at     TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  usada_por      INT       NULL,
  usada_en       DATETIME  NULL,
  pesaje_id      BIGINT    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_autorizaciones_pin_token (token),
  UNIQUE KEY uq_autorizaciones_pin_pesaje (pesaje_id),
  CONSTRAINT fk_autorizaciones_pin_supervisor     FOREIGN KEY (supervisor_id)  REFERENCES usuarios (id),
  CONSTRAINT fk_autorizaciones_pin_solicitado_por FOREIGN KEY (solicitado_por) REFERENCES usuarios (id),
  CONSTRAINT fk_autorizaciones_pin_usada_por      FOREIGN KEY (usada_por)      REFERENCES usuarios (id),
  CONSTRAINT fk_autorizaciones_pin_pesaje         FOREIGN KEY (pesaje_id)      REFERENCES pesajes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

Qué garantiza cada `UNIQUE` de `pines_supervisor`:

- `uq_pines_supervisor_usuario`: un supervisor tiene **como mucho un** PIN. Es la barrera real de "no se permite regenerar".
- `uq_pines_supervisor_pin`: dos supervisores **nunca** comparten PIN. Es lo que permite que el PIN identifique a su dueño.

Conteos del proyecto después del DDL:

- **FKs:** de 16 a **23**. Son dos en `pines_supervisor`, una en `pesajes` y cuatro en `autorizaciones_pin`. Todas apuntan a `usuarios` o a `pesajes`, con el mismo argumento de los specs 10 a 20: una auditoría que apunta a una fila inexistente no sirve.
- **`UNIQUE` registrados:** de 6 a **10**. Contando los dos de `clientes` que nadie había registrado, el total real pasa de 8 a **12**.
- `uq_autorizaciones_pin_pesaje` admite muchos `NULL` en MySQL. Garantiza que un pesaje consuma **como mucho una** autorización, sin estorbar a las autorizaciones que todavía no se usaron.

### Tipos (`src/database/types/types.ts`)

```ts
// PesajesTable
aprobado_con_excepcion_por: number | null;

export interface PinesSupervisorTable {
  id: Generated<number>;
  usuario_id: number;
  pin: string;
  created_by: number;
  created_at: Generated<Date | string | null>;
}

export interface AutorizacionesPinTable {
  id: Generated<number>;
  token: string;
  supervisor_id: number;
  solicitado_por: number;
  created_at: Generated<Date | string | null>;
  usada_por: number | null;
  usada_en: Date | string | null;
  pesaje_id: string | number | null;
}

// Database
pines_supervisor: PinesSupervisorTable;
autorizaciones_pin: AutorizacionesPinTable;
```

`UsuariosTable` no cambia.

### El PIN

- Cuatro dígitos, guardado **en claro** en `pines_supervisor.pin`. Es `CHAR(4)` y no un entero, para conservar los ceros a la izquierda (`0042`).
- Se genera con `crypto.randomInt(0, 10000)` y se rellena a cuatro dígitos con `padStart`.
- Para garantizar que sea único, se consulta si el PIN generado ya existe en `pines_supervisor` y se reintenta, **hasta 20 veces**. Si los 20 chocan, se responde 400 `No se pudo generar un PIN unico, intente de nuevo`. El `UNIQUE` de MySQL es la última barrera.
- Nunca vence y nunca cambia por API.
- Ninguna lectura del proyecto lo devuelve, salvo la respuesta de `PATCH /auth/usuarios/:id/pin`, una sola vez. Solo el código de este spec lee `pines_supervisor`.

### `PATCH /auth/usuarios/:id/pin`

Requiere token. **No lleva body ni DTO.** El `:id` usa `ParseIntPipe`.

Errores, en el orden en que se validan, dentro de una transacción:

| Caso | Código | Mensaje |
| --- | --- | --- |
| Sin token | 401 | El de `JwtAuthGuard` |
| Quien llama no es `ADMIN` o ya no existe | 403 | `No tiene permisos para asignar PINs de supervisor` |
| El usuario no existe | 400 | `El usuario con id 'X' no existe` (el de `validateUsuarioActivo`) |
| El usuario tiene `isActive = 0` | 400 | `El usuario con id 'X' esta inactivo` (el de `validateUsuarioActivo`) |
| El usuario no tiene rol `SUPERVISOR` | 400 | `El usuario con id 'X' no tiene el rol SUPERVISOR` |
| El usuario ya tiene una fila en `pines_supervisor` | 400 | `El usuario con id 'X' ya tiene un PIN asignado` |
| 20 colisiones seguidas | 400 | `No se pudo generar un PIN unico, intente de nuevo` |

El rol se compara con el literal `'SUPERVISOR'` en `roles.nombre`, igual que `'ADMIN'` en el spec 34. La autorización va **primero**, así que quien no es admin no puede averiguar qué ids son supervisores.

Si todo pasa, inserta en `pines_supervisor` la fila `{ usuario_id: id, pin, created_by: userId }`.

Respuesta **200**:

```json
{ "ok": true, "msg": "PIN asignado correctamente", "pin": "0427" }
```

### `POST /pesajes/validar-pin`

Requiere token. Cualquier usuario autenticado puede llamarlo. Responde **200** con un `@HttpCode(200)` explícito.

Body (`src/modules/pesajes/dto/validar-pin.dto.ts`):

```ts
{ pin: string } // regex /^\d{4}$/, mensaje 'El PIN debe tener 4 digitos'
```

La búsqueda parte de `pines_supervisor`, con `INNER JOIN usuarios` e `INNER JOIN roles`, y exige tres condiciones:

- `pines_supervisor.pin = pin`;
- `roles.nombre = 'SUPERVISOR'`;
- `usuarios.isActive` distinto de `0`. `NULL` cuenta como activo, igual que en el spec 34.

| Caso | Código | Mensaje |
| --- | --- | --- |
| Body inválido | 400 | El de Zod |
| No hay supervisor activo con ese PIN | 400 | `PIN incorrecto` |

Las tres condiciones dan el **mismo** mensaje: PIN inexistente, supervisor inactivo o usuario que ya no tiene el rol. Es **400 y no 401**, porque un 401 haría que el front interprete que la sesión del operador venció.

Si el PIN es válido, inserta una fila en `autorizaciones_pin`:

- `token`: `crypto.randomUUID()`;
- `supervisor_id`: el `usuario_id` de la fila del PIN;
- `solicitado_por`: el `userId` del token.

Responde:

```json
{
  "ok": true,
  "msg": "PIN valido",
  "autorizacion": { "token": "3f1c9a2e-8b7d-4e21-9c55-0a6f2d7b1e48", "supervisor": "Ana Supervisora" }
}
```

`supervisor` es `usuarios.complete_name`, para que el front muestre quién autorizó. La autorización **no vence y no está atada** al operador, al lote ni al peso. Sirve una sola vez.

### `POST /pesajes`

El DTO (`create-pesaje.dto.ts`) agrega un campo:

```ts
autorizacion_token: z.string().uuid('La autorizacion no es valida').optional()
```

Dentro de la transacción existente, después de calcular `peso_neto`:

- **Sin `autorizacion_token`:** el pesaje se guarda exactamente como hoy, pese lo que pese, con `aprobado_con_excepcion_por` en `NULL`.
- **Con token y `peso_neto > Number(lote.peso_maximo)`:**
  - Se lee la fila con `SELECT ... FOR UPDATE`:
    - No existe: **400** `La autorizacion no existe`. No se inserta nada.
    - `usada_en IS NOT NULL`: **400** `La autorizacion ya fue utilizada`. No se inserta nada.
  - Se inserta el pesaje con `aprobado_con_excepcion_por = supervisor_id`.
  - Se actualiza la autorización: `usada_por = userId`, `usada_en = sql\`NOW()\``, `pesaje_id = insertId`.
- **Con token y un peso que no supera el máximo** (incluso si es exactamente igual): el token se **ignora**, no se consume y `aprobado_con_excepcion_por` queda `NULL`.

El estado sigue siendo `MAXIMO` y `fuera_de_rango` sigue en `1`, igual que en el spec 04. Que `aprobado_con_excepcion_por` no sea `NULL` es lo que distingue "aprobado con excepción" de "sobre el máximo sin autorizar". Como el backend no exige el token, **esto último puede seguir ocurriendo**: un pesaje sobre el máximo con `aprobado_con_excepcion_por` en `NULL` es uno que se guardó sin pasar por el PIN (un front viejo, una llamada directa a la API o un error del front).

La respuesta **no cambia**: `{ ok, msg, pesaje: { id, peso_neto, fuera_de_rango } }`.

### Archivos

| Archivo | Cambio |
| --- | --- |
| `src/database/types/types.ts` | La columna de `pesajes` y las dos tablas nuevas. |
| `src/modules/auth/repository/auth.repository.ts` | `asignarPinSupervisor(id, userId)`, `generarPinUnico(db)`, `validateUsuarioEsSupervisor`, `validateSinPin`. |
| `src/modules/auth/auth.service.ts` | Pass-through `asignarPinSupervisor`. |
| `src/modules/auth/auth.controller.ts` | `@Patch('usuarios/:id/pin')` con `@ApiOperation` y `@ApiParam`. |
| `src/modules/pesajes/dto/validar-pin.dto.ts` | Nuevo. |
| `src/modules/pesajes/dto/create-pesaje.dto.ts` | `autorizacion_token` opcional. |
| `src/modules/pesajes/repository/pesajes.repository.ts` | `validarPin(dto, userId)`, `validateAutorizacionDisponible(token, db)` y los cambios en `createPesaje`. |
| `src/modules/pesajes/pesajes.service.ts` | Pass-through `validarPin`. |
| `src/modules/pesajes/pesajes.controller.ts` | `@Post('validar-pin')` con `@HttpCode(200)` y `@ApiOperation`. Se actualiza la descripción de `@Post()`. |
| `CLAUDE.md` | Ver el paso 5 del plan. |

Rutas: de **40** a **42**. `auth` pasa a **5** y `pesajes` a **8**. En el OpenAPI, de 39 a **41** operaciones y de 36 a **38** `paths`.

---

## Implementation plan

1. Aplicar el DDL en MySQL y verificarlo con `SHOW CREATE TABLE pines_supervisor`, `pesajes` y `autorizaciones_pin`. Actualizar `src/database/types/types.ts`. La app compila y se comporta igual.
2. En `AuthRepository`, agregar `generarPinUnico(db)`, `validateUsuarioEsSupervisor(id, db)` y `validateSinPin(id, db)`. Agregar `asignarPinSupervisor(id, userId)`, que en una transacción llama, en este orden:
   1. `validateCallerEsAdmin(userId, 'No tiene permisos para asignar PINs de supervisor', trx)`;
   2. `validateUsuarioActivo`;
   3. `validateUsuarioEsSupervisor`;
   4. `validateSinPin`.

   Después genera el PIN, inserta la fila en `pines_supervisor` y devuelve el PIN. Pass-through en `AuthService`. En `AuthController`, `@Patch('usuarios/:id/pin')` con `ParseIntPipe` y respuesta `{ ok, msg, pin }`. Prueba manual: un `ADMIN` asigna el PIN de un usuario `SUPERVISOR` y recibe 4 dígitos. La segunda llamada sobre el mismo usuario responde 400.
3. Crear `validar-pin.dto.ts`. En `PesajesRepository`, agregar `validarPin(dto, userId)` con la búsqueda y el `INSERT` de la autorización, en una transacción. Pass-through en `PesajesService`. En `PesajesController`, `@Post('validar-pin')` con `@HttpCode(200)`. Prueba manual: el PIN del paso 2 devuelve un `token` y el nombre del supervisor. Un PIN cualquiera devuelve 400 `PIN incorrecto`.
4. Agregar `autorizacion_token` al DTO de `POST /pesajes` y `validateAutorizacionDisponible(token, db)` (con `.forUpdate()`) en `PesajesRepository`. En `createPesaje`, aplicar la lógica de la sección de datos: si llega token y `peso_neto > peso_maximo`, validarlo, insertar con `aprobado_con_excepcion_por` y marcar la autorización como usada en la misma transacción. Sin token, nada cambia. Actualizar la descripción de `@Post()` en Swagger, aclarando que el token es opcional y que el backend no bloquea. Prueba manual: un pesaje sobre el máximo sin token responde 201 con `aprobado_con_excepcion_por` en `NULL`. Con el token del paso 3 responde 201 y registra al supervisor. Con el mismo token otra vez responde 400.
5. Actualizar `CLAUDE.md`:
   - En la tabla de endpoints, las filas de `auth` y `pesajes`.
   - En la nota de roles, el endpoint nuevo que discrimina por rol (pasan a ser **tres**) y el primer uso de `SUPERVISOR`.
   - En la sección de dominio, `pines_supervisor`, `autorizaciones_pin` y la columna nueva de `pesajes`. Indicar que el PIN está en claro.
   - Los conteos de rutas, FKs y `UNIQUE`.
   - El párrafo del diagrama, donde el PIN de supervisor deja de figurar como pendiente (pesar en `CLIENTE_FINAL` sí sigue pendiente).
   - La frase que dice que `estado_calidad_id` viene del body, que es falsa desde el spec 04.

---

## Acceptance criteria

- [ ] El DDL quedó aplicado y `SHOW CREATE TABLE` muestra:
  - la tabla `pines_supervisor` con sus dos `UNIQUE` y sus dos FKs;
  - `fk_pesajes_aprobado_con_excepcion_por`;
  - la tabla `autorizaciones_pin` con sus dos `UNIQUE` y sus cuatro FKs.
- [ ] La tabla `usuarios` no tiene columnas nuevas.
- [ ] El route log muestra **42** rutas: `auth` 5 y `pesajes` 8.
- [ ] `PATCH /auth/usuarios/:id/pin` sin token responde 401.
- [ ] Con un token de `OPERADOR` responde 403 `No tiene permisos para asignar PINs de supervisor`, aunque el `:id` no exista.
- [ ] Con un token de `ADMIN`, sobre un usuario `SUPERVISOR` activo sin PIN, responde 200 `{ ok: true, msg: 'PIN asignado correctamente', pin }`. Además:
  - `pin` tiene exactamente 4 dígitos;
  - `pines_supervisor` tiene una fila con ese `usuario_id`, ese `pin` y `created_by` igual al admin.
- [ ] Sobre un usuario que ya tiene PIN responde 400 `El usuario con id 'X' ya tiene un PIN asignado`, y su fila no cambia.
- [ ] Sobre un usuario `OPERADOR` o `ADMIN` responde 400 `El usuario con id 'X' no tiene el rol SUPERVISOR`.
- [ ] Sobre un id inexistente responde 400 `El usuario con id 'X' no existe`. Sobre un usuario con `isActive = 0` responde 400 `El usuario con id 'X' esta inactivo`.
- [ ] Después de asignar PIN a dos supervisores, sus dos `pin` son distintos.
- [ ] `POST /pesajes/validar-pin` con el PIN de un supervisor activo responde 200. La respuesta trae:
  - `autorizacion.token` en formato UUID;
  - `autorizacion.supervisor` igual a su `complete_name`.

  Además inserta una fila con `supervisor_id`, `solicitado_por` = quien llama y `usada_en` en `NULL`.
- [ ] Con un PIN que no está asignado responde 400 `PIN incorrecto` y no inserta ninguna fila.
- [ ] Con el PIN de un supervisor con `isActive = 0` responde 400 `PIN incorrecto`.
- [ ] Con `pin: '123'`, `pin: '12345'` o `pin: 'abcd'` responde 400 desde Zod.
- [ ] `POST /pesajes` con `peso_neto > peso_maximo` y sin `autorizacion_token` responde 201, igual que antes de este spec, con `aprobado_con_excepcion_por` en `NULL`.
- [ ] El mismo pesaje con un token válido sin usar responde 201. La fila tiene `aprobado_con_excepcion_por` = `supervisor_id` de la autorización, `fuera_de_rango = 1` y el estado `MAXIMO`.
- [ ] Después de ese 201, la autorización tiene `usada_por` = el operador, `usada_en` con la hora de MySQL y `pesaje_id` = el id del pesaje nuevo.
- [ ] Repetir con el mismo token responde 400 `La autorizacion ya fue utilizada` y no inserta ninguna fila.
- [ ] Un token con formato UUID que no está en la tabla responde 400 `La autorizacion no existe`.
- [ ] Un token que no es UUID responde 400 desde Zod.
- [ ] Un pesaje con `peso_neto` exactamente igual al `peso_maximo` se guarda sin token, con `aprobado_con_excepcion_por` en `NULL`.
- [ ] Un pesaje dentro del rango que manda un token válido responde 201, guarda `aprobado_con_excepcion_por` en `NULL` y deja la autorización sin usar (`usada_en` en `NULL`).
- [ ] Un pesaje bajo el `peso_minimo` se guarda sin token, como antes de este spec.
- [ ] Un token pedido por un operador lo puede consumir otro operador, y `usada_por` registra a quien lo consumió.
- [ ] Si el pesaje falla por otra validación (lote cerrado, operador no vinculado), la autorización no queda marcada como usada.
- [ ] La respuesta de `POST /pesajes` sigue siendo `{ ok, msg, pesaje: { id, peso_neto, fuera_de_rango } }`.
- [ ] Ninguna respuesta de la API, salvo la de `PATCH /auth/usuarios/:id/pin`, contiene un PIN.
- [ ] `/docs` muestra los dos endpoints nuevos con su descripción, y la descripción de `POST /pesajes` menciona `autorizacion_token`.
- [ ] No se agregó ninguna fila a `catalogo_permisos` ni a `permisos`.

---

## Decisions

- **Sí:** el bloqueo vive en el front. `POST /pesajes` no exige la autorización. Decisión del usuario, tomada sabiendo que una llamada directa a la API se lo salta. Ver riesgos.
- **No:** que `POST /pesajes` responda 403 a un pesaje sobre el máximo sin token. Estuvo en un borrador anterior de este spec y el usuario lo descartó.
- **Sí:** `POST /pesajes` acepta un token opcional para registrar al supervisor. Decisión del usuario. El supervisor queda registrado sin que se pueda falsificar.
- **No:** que el front reenvíe el `supervisor_id` en `POST /pesajes`. Es más simple, pero cualquiera podría atribuir un pesaje a un supervisor sin saber su PIN.
- **No:** no registrar nada. `validar-pin` solo respondería si el PIN es correcto y no quedaría rastro de quién aprobó.
- **Sí:** un token inválido o ya usado responde 400 y no guarda el pesaje, aunque el token sea opcional. Si el front manda un token, espera que se registre un supervisor. Guardar en silencio sin registrarlo escondería un error del front.
- **No:** mandar el PIN en el body de `POST /pesajes`. El front no podría validarlo antes de guardar.
- **Sí:** solo `peso_neto > peso_maximo` exige PIN. Decisión del usuario. El límite es estricto: igual al máximo es `IDEAL` según el spec 04.
- **No:** pedir PIN también bajo el mínimo.
- **Sí:** el PIN identifica al supervisor, sin selector de nombre. Decisión del usuario. Por eso tiene que ser único.
- **Sí:** el PIN lo genera el sistema. Si lo eligiera el supervisor, un "PIN no disponible" le revelaría el PIN de otro.
- **Sí:** 4 dígitos. Decisión del usuario, por velocidad en planta. Ver riesgos.
- **No:** 6 dígitos.
- **Sí:** tabla propia `pines_supervisor`. Decisión del usuario, que no quiere el PIN como columna de `usuarios`. Separa el PIN de los datos del usuario, ninguna consulta existente sobre `usuarios` puede arrastrarlo, y registra qué admin asignó cada PIN (`created_by`).
- **No:** una columna en `usuarios`, ni en claro ni con hash. Era el diseño de los primeros borradores de este spec.
- **No:** guardar los PINs dentro de `autorizaciones_pin`. Mezclaría dos cosas con ciclos de vida distintos: un PIN dura para siempre y una autorización se usa una vez.
- **Sí:** el PIN en claro. Decisión del usuario, que deja el hash para después. Permite los dos `UNIQUE` y buscar al supervisor con un `=`. Ver riesgos.
- **No:** HMAC con secreto, por ahora. Se ofreció y se aplazó. Cuando llegue, el cambio queda dentro de `pines_supervisor`: la columna `pin` pasa a guardar el HMAC, se agrega una variable de entorno con el secreto, y hay que reasignar todos los PINs.
- **No:** bcrypt. Habría que comparar contra el hash de cada supervisor para validar o para garantizar unicidad, y no permitiría un `UNIQUE`.
- **Sí:** solo usuarios con rol `SUPERVISOR` tienen PIN y solo un `ADMIN` lo genera. Reusa `validateCallerEsAdmin` con su mensaje como parámetro (spec 37).
- **No:** un PIN que se regenera o se revoca por API. Decisión del usuario. Cambiarlo es un `DELETE` a mano en `pines_supervisor` y una nueva asignación.
- **Sí:** tabla `autorizaciones_pin` para el token. Es lo único que hace real el "un solo uso": se marca en la misma transacción que el `INSERT` del pesaje, con `FOR UPDATE`.
- **No:** un JWT de corta vida. Nada recordaría que ya se usó.
- **Sí:** el token es un `crypto.randomUUID()` y no el id de la fila. Un id secuencial se adivina sumando uno. Con el UUID nadie usa una autorización que no recibió.
- **Sí:** la autorización no vence y no se ata al operador, al lote ni al peso. Decisión del usuario. Ver riesgos.
- **Sí:** se guardan `solicitado_por` y `usada_por` por separado. Como la autorización no está atada, pueden ser personas distintas, y la auditoría tiene que mostrarlo.
- **Sí:** solo `aprobado_con_excepcion_por` en `pesajes`, sin `_en`. Decisión del usuario. La fecha está en `autorizaciones_pin.usada_en`, que se une por `pesaje_id`.
- **Sí:** el estado de calidad sigue en `MAXIMO`. Así las bandas del spec 04 y las métricas del spec 35 no cambian.
- **No:** un estado nuevo en `estados_calidad`.
- **Sí:** un token mandado con un peso que no lo necesita se ignora y no se consume. Gastarlo sin motivo obligaría a pedir otro PIN para un pesaje que sí lo necesite.
- **Sí:** `PIN incorrecto` con 400 y el mismo mensaje en los tres casos. No revela si el PIN existe con un supervisor inactivo, y no provoca que el front cierre la sesión como haría un 401.
- **Sí:** la respuesta de `POST /pesajes` no cambia. El front ya sabe que pidió el PIN y ya tiene el nombre del supervisor desde `validar-pin`.
- **Sí:** las lecturas no exponen `aprobado_con_excepcion_por`. Es el mismo criterio que con `aprobado_por` y `rechazado_por` de `pesajes`. Exponerlo va en otro spec.
- **Sí:** sin fila en `catalogo_permisos`/`permisos`. La asignación es por rol, y `validar-pin` lo puede llamar cualquier autenticado por diseño.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **El bloqueo se salta llamando a la API.** Cualquier autenticado puede guardar un pesaje sobre el máximo sin PIN con un `POST /pesajes` directo (Postman, un front viejo, un script) | **Aceptado por decisión explícita.** Queda rastro: un pesaje con `fuera_de_rango = 1`, estado `MAXIMO` y `aprobado_con_excepcion_por` en `NULL`, guardado después de este spec, no pasó por el PIN. Se puede listar en MySQL. Exigir el token es un cambio pequeño en un spec futuro. |
| **Fuerza bruta.** Hay 10.000 PINs posibles, no hay límite de intentos y cualquier autenticado puede llamar a `validar-pin`. Con 5 supervisores, ~2.000 intentos alcanzan para dar con uno, y un script lo hace en minutos | **Sin mitigar por decisión explícita.** Un 400 no se escribe en `log_errores`, así que el ataque no deja rastro. Queda para el spec 23 o uno propio. La única huella es una fila en `autorizaciones_pin` por cada PIN acertado, con su `solicitado_por`. |
| **PIN en claro.** Quien lea `pines_supervisor` (un backup, un acceso a MySQL) ve todos los PINs | **Aceptado por decisión explícita, hasta un spec de hash.** La tabla es aparte de `usuarios`, ninguna lectura de la API la devuelve y solo el código de este spec la consulta. |
| **Autorizaciones sin vencimiento ni atadura.** Un operador puede pedir el PIN una vez, guardar el token y usarlo días después, en otro lote o con otro peso que el supervisor nunca vio | **Aceptado por decisión explícita.** `solicitado_por`, `usada_por` y las dos fechas permiten reconstruirlo después en MySQL. |
| Un supervisor desactivado, o al que le quitan el rol, deja tokens sin usar que siguen sirviendo | **Sin mitigar.** La validación de supervisor ocurre en `validar-pin`, no al consumir el token. |
| Un PIN filtrado no se puede cambiar por API | Un `DELETE FROM pines_supervisor WHERE usuario_id = ?` a mano y una nueva llamada a `PATCH /auth/usuarios/:id/pin`. Las autorizaciones ya emitidas no se ven afectadas. |
| Dos supervisores obtienen el mismo PIN por una carrera entre el `SELECT` de unicidad y el `INSERT` | El `UNIQUE` lo impide y el segundo recibe un 500 de MySQL. Es poco probable: solo escriben admins y hay 10.000 valores. |
| Con muchos supervisores, los 4 dígitos se agotan o los reintentos fallan | Con 20 reintentos y pocos supervisores la probabilidad es despreciable. Si los 20 chocan, se responde 400 y se reintenta. Aun así, cuantos más supervisores, más fácil es adivinar uno (ver el primer riesgo). |
| Hoy ningún usuario tiene el rol `SUPERVISOR` | Hay que registrarlos con `POST /auth/register` y `rol: 3`, o con un `UPDATE` a mano. Comprobar el id en cada entorno, porque los ids difieren. |
| Si `roles.nombre` no es `SUPERVISOR` en un entorno, ningún usuario puede recibir PIN | Falla cerrado: `PATCH /auth/usuarios/:id/pin` responde 400 y `validar-pin` siempre responde `PIN incorrecto`. |

---

## What is **not** in this spec

- Que `POST /pesajes` exija la autorización. El bloqueo es del front.
- Hashear el PIN, o guardarlo como columna de `usuarios`.
- PIN para pesajes bajo el mínimo.
- Pesar en la etapa `CLIENTE_FINAL`.
- Límite de intentos, bloqueo o registro de PINs fallidos.
- Regenerar, cambiar, revocar o consultar un PIN por API, o que lo elija el supervisor.
- Vencimiento de la autorización o atarla al operador, al lote o al peso.
- `aprobado_con_excepcion_en`, o exponer la excepción en las lecturas de `pesajes`.
- Un estado de calidad nuevo, o cambiar la respuesta de `POST /pesajes`.
- Asignar el rol `SUPERVISOR` a un usuario existente.
- Métricas o chat que cuenten las excepciones.
- `PermissionsGuard` o filas de permisos.

Cada uno de estos, si se necesita, va en su propio spec.
