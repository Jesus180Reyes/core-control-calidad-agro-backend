# SPEC 33 — Renovación de contraseña vencida

> **Status:** Implemented
> **Depends on:** — (toca solo el módulo `auth`, que no nació de ningún spec; SPEC 22 aporta la convención de Swagger)
> **Date:** 2026-10-07
> **Objective:** Que cada contraseña tenga fecha de vencimiento, que `POST /auth/login` responda 403 con `passwordVencida: true` cuando la contraseña correcta ya venció, y que un nuevo `POST /auth/renovar-password` público permita cambiarla.

---

## Why this spec exists

Hoy una contraseña de `usuarios` vale para siempre. Además, la contraseña de un usuario nuevo la escribe otra persona (`POST /auth/register` exige token y la define quien llama), y el usuario nunca tiene que cambiarla.

Este spec agrega una política de vigencia mínima. Se apoya en tres ideas.

**La primera: una contraseña vencida no da acceso a nada.** El login no emite token cuando la contraseña venció. Por eso la renovación no puede exigir token y se autentica con la contraseña actual, igual que el login.

**La segunda: el vencimiento solo se revela a quien conoce la contraseña.** El 403 sale solo si la contraseña enviada es correcta. Con una contraseña incorrecta, el usuario vencido recibe el mismo 401 de siempre.

**La tercera: nadie queda bloqueado al desplegar.** `password_vence_en = NULL` significa "no vence", así que los usuarios existentes no notan el cambio hasta su primera renovación. Los usuarios creados desde este spec nacen vencidos y cambian la contraseña en su primer login.

---

## Scope

**In:**

- DDL: dos columnas nuevas en `usuarios`, `password_vence_en` y `password_actualizada_en`, ambas `DATETIME NULL`.
- Nueva variable de entorno opcional `PASSWORD_VIGENCIA_DIAS`, con 90 por defecto.
- `POST /auth/login`: después de validar la contraseña, si `password_vence_en <= NOW()` responde **403** con `message: 'La contraseña ha caducado'` y `passwordVencida: true`, sin token. El 200 suma `passwordVencida: false`.
- Nuevo `POST /auth/renovar-password`, `@Public()`, con body `{ username, password_actual, password_nueva }`.
- La renovación sirve para cualquier contraseña, vencida o vigente.
- La renovación escribe el hash nuevo, `password_actualizada_en = NOW()` y `password_vence_en = NOW() + PASSWORD_VIGENCIA_DIAS`.
- Reglas de `password_nueva`: mínimo 8 caracteres, al menos una mayúscula, al menos un número, y distinta de la actual.
- `POST /auth/register` escribe `password_vence_en = NOW()`, así que el usuario nuevo debe cambiar la contraseña en su primer login.
- Swagger: `@ApiOperation` del endpoint nuevo y la descripción de `POST /auth/login` actualizada con el 403.
- `.env.example` y `CLAUDE.md` actualizados.

**Out of scope (for future specs):**

- Historial de contraseñas (no reutilizar las últimas N). Necesita una tabla propia.
- Backfill de los usuarios existentes. Siguen en `NULL` (no vencen) hasta que alguien les ponga una fecha con un `UPDATE` a mano.
- Aviso previo de vencimiento ("tu contraseña vence en 5 días") en la respuesta del login.
- Revocar los access tokens ya emitidos cuando la contraseña vence o se renueva.
- Recuperación de contraseña olvidada (por correo, por admin, etc.).
- Que un admin restablezca la contraseña de otro usuario.
- Bloqueo por intentos fallidos y rate limiting de `auth` (SPEC 23 sigue sin implementar).
- Validar `usuarios.isActive` en el login o en la renovación. El login hoy no lo valida, y este spec no cambia eso.
- Aplicar la regla de complejidad a `POST /auth/register`.
- Un endpoint para cambiar la contraseña estando autenticado (con token). El endpoint público ya cubre ese caso.

---

## Data model

### DDL (se aplica a mano en MySQL)

```sql
ALTER TABLE usuarios
  ADD COLUMN password_vence_en DATETIME NULL AFTER password,
  ADD COLUMN password_actualizada_en DATETIME NULL AFTER password_vence_en;
```

No lleva FK, índice, `UNIQUE` ni backfill. Los conteos de FKs y `UNIQUE` del proyecto no cambian.

Semántica:

| Columna | `NULL` | Con valor |
| --- | --- | --- |
| `password_vence_en` | La contraseña **no vence** (usuarios anteriores a este spec) | Vencida si `password_vence_en <= NOW()` |
| `password_actualizada_en` | El usuario nunca cambió su contraseña por sí mismo | Fecha de la última renovación |

`POST /auth/register` escribe `password_vence_en = NOW()` y deja `password_actualizada_en` en `NULL`, porque la contraseña la eligió quien registró al usuario y no el usuario mismo.

La comparación con `NOW()` se hace **en SQL**, nunca con un `new Date()` de Node. Así comparte reloj con el `NOW()` que la escribe, siguiendo la convención de las escrituras de timestamps del proyecto.

### `src/database/types/types.ts`

```ts
export interface UsuariosTable {
  // ...columnas actuales
  password_vence_en: Date | string | null;
  password_actualizada_en: Date | string | null;
}
```

### Variable de entorno

- `PASSWORD_VIGENCIA_DIAS`: **opcional**, por defecto `90`. Si no es un entero positivo, cae a 90, con el mismo patrón de `resolverTimeout()` en `GeminiService`. Se lee con `ConfigService`, que ya es global. La app arranca sin ella.

### Archivos

| Archivo | Cambio |
| --- | --- |
| `src/database/types/types.ts` | Dos columnas en `UsuariosTable`. |
| `src/modules/auth/dto/renovar-password.dto.ts` | Nuevo. `RenovarPasswordDto`. |
| `src/modules/auth/repository/auth.repository.ts` | Chequeo de vencimiento en `login`, `password_vence_en` en `registerUser` y el método nuevo `renovarPassword`. |
| `src/modules/auth/auth.service.ts` | Pass-through `renovarPassword`. |
| `src/modules/auth/auth.controller.ts` | `POST renovar-password` y la descripción de `login` actualizada. |
| `.env.example` | `PASSWORD_VIGENCIA_DIAS=90`. |
| `CLAUDE.md` | Variables de entorno, fila de `auth`, conteo de rutas y columnas de `usuarios`. |

### DTO `RenovarPasswordDto`

```ts
{
  username: string;         // min 2, igual que LoginUserDto
  password_actual: string;  // min 8, igual que LoginUserDto
  password_nueva: string;   // min 8, /[A-Z]/ y /[0-9]/, cada regla con su propio mensaje
}
```

No usa `.transform()`, así que el doble pipe global no le afecta. La regla "distinta de la actual" **no** vive en el DTO: necesita el hash guardado, así que se valida en el repositorio.

### Respuestas

`POST /auth/login`, contraseña correcta y vencida (**403**):

```json
{
  "statusCode": 403,
  "message": "La contraseña ha caducado",
  "passwordVencida": true
}
```

Se lanza como `ForbiddenException` con un objeto como cuerpo, y Nest lo serializa tal cual. Por eso el cuerpo **no** lleva la clave `error: 'Forbidden'` que traen los demás errores del proyecto: el 403 ya dice lo mismo. No lleva `accessToken` ni `user`.

`POST /auth/login`, contraseña correcta y vigente (**200**), con `passwordVencida: false` como única clave nueva:

```json
{
  "ok": true,
  "msg": "Usuario logueado correctamente",
  "user": { "complete_name": "Juan Pérez", "rol": "OPERADOR" },
  "accessToken": "<jwt 8h>",
  "passwordVencida": false
}
```

Así el front lee siempre el mismo campo, en el 200 y en el 403, sin depender del código HTTP. En el 200 vale **siempre** `false`, porque una contraseña vencida nunca llega a ese camino. La clave va en el primer nivel, junto a `accessToken`, y **no** dentro de `user`.

El 401 (usuario inexistente o contraseña incorrecta) **no** lleva `passwordVencida`: ahí no se validó la contraseña, así que no se sabe nada del vencimiento, y devolverlo revelaría el estado de la cuenta a quien no la conoce.

`POST /auth/renovar-password` (**200**):

```json
{ "ok": true, "msg": "Contraseña actualizada correctamente" }
```

No devuelve token. El front llama a `POST /auth/login` con la contraseña nueva.

Errores de `POST /auth/renovar-password`:

| Caso | Código | Mensaje |
| --- | --- | --- |
| Body inválido (largo, sin mayúscula, sin número) | 400 | El de Zod |
| `username` inexistente o `password_actual` incorrecta | 401 | `Usuario o contraseña incorrectos`, el mismo para los dos casos |
| `password_nueva` igual a la actual | 400 | `La nueva contraseña debe ser distinta de la actual` |

---

## Implementation plan

1. Aplicar el DDL en MySQL y verificarlo con `DESCRIBE usuarios`: las dos columnas quedan después de `password` y son `datetime NULL`. Agregar las dos propiedades a `UsuariosTable`. La app compila y nada cambia.
2. Agregar `PASSWORD_VIGENCIA_DIAS=90` a `.env.example`. En `AuthRepository`, inyectar `ConfigService` y agregar el método privado `resolverVigenciaDias()`, que devuelve un entero positivo o 90.
3. En `getUserByUsername`, agregar al `select` una columna calculada en SQL: `password_vence_en IS NOT NULL AND password_vence_en <= NOW()`, con el alias `password_vencida`.
4. En `login`, **después** del `bcrypt.compare` exitoso, lanzar `ForbiddenException({ statusCode: 403, message: 'La contraseña ha caducado', passwordVencida: true })` si `password_vencida` es truthy. Comparar por truthiness, porque MySQL devuelve `0`/`1`. Agregar `password_vencida` a la desestructuración que arma `currentUser`, para que no se filtre dentro de `user`. En `AuthController.login`, agregar `passwordVencida: false` al objeto de respuesta, después de `accessToken`. Prueba manual: con `UPDATE usuarios SET password_vence_en = NOW()`, el login responde 403. Con `NULL`, responde 200 con `passwordVencida: false`.
5. En `registerUser`, agregar `password_vence_en: sql\`NOW()\`` al `insert`. Prueba manual: un usuario recién registrado recibe 403 en su primer login.
6. Crear `src/modules/auth/dto/renovar-password.dto.ts` con `RenovarPasswordDto`.
7. En `AuthRepository`, agregar `renovarPassword(dto)` con la forma de escritura del proyecto. Dentro de `this.db.transaction().execute(async (trx) => ...)`:
   1. Leer el usuario por `username` con `trx`. Si no existe, o si `bcrypt.compare(password_actual, hash)` falla, lanzar `UnauthorizedException('Usuario o contraseña incorrectos')`.
   2. Si `bcrypt.compare(password_nueva, hash)` da `true`, lanzar `BadRequestException('La nueva contraseña debe ser distinta de la actual')`.
   3. Escribir el hash nuevo con `SALT_ROUNDS`, `password_actualizada_en = sql\`NOW()\`` y `password_vence_en = sql\`DATE_ADD(NOW(), INTERVAL ${dias} DAY)\``.

   Devuelve `true`. No mira `password_vence_en`: renueva vencidas y vigentes por igual.
8. `AuthService.renovarPassword` como pass-through. En `AuthController`, agregar `@Post('renovar-password')` con `@Public()`, `@HttpCode(200)` y `@ApiOperation`. Responde `{ ok, msg }`. La descripción dice que es público, que sirve para contraseñas vencidas y vigentes, y que no devuelve token.
9. Actualizar la descripción de `@ApiOperation` de `login` para mencionar el 403 con `passwordVencida: true`.
10. Actualizar `CLAUDE.md`:
    - `PASSWORD_VIGENCIA_DIAS` en la lista de variables (opcional, no hace falta para arrancar).
    - La fila de `auth` en la tabla de endpoints.
    - Una ruta más en el conteo verificado contra el route log.
    - Las dos columnas de `usuarios` en el Domain.

---

## Acceptance criteria

- [X] `DESCRIBE usuarios` muestra `password_vence_en` y `password_actualizada_en`, ambas `datetime`, `NULL`, después de `password`.
- [X] La app arranca sin `PASSWORD_VIGENCIA_DIAS` definida.
- [X] Un usuario con `password_vence_en = NULL` hace login y recibe 200 con la misma respuesta que antes de este spec más `passwordVencida: false` en el primer nivel, y sin `password_vencida` dentro de `user`.
- [X] Un usuario con `password_vence_en` en el futuro hace login y recibe 200 con `passwordVencida: false`.
- [X] `passwordVencida` es un booleano (`true`/`false`), nunca `0`/`1`, tanto en el 200 como en el 403.
- [X] El 401 del login no lleva la clave `passwordVencida`.
- [X] Un usuario con `password_vence_en <= NOW()` y la contraseña correcta recibe **403** con `message: 'La contraseña ha caducado'` y `passwordVencida: true`, sin `accessToken`.
- [X] Ese mismo usuario con una contraseña **incorrecta** recibe 401 `Usuario o contraseña incorrectas`, no 403.
- [X] Un `username` inexistente sigue recibiendo 401 en el login.
- [X] `POST /auth/register` crea el usuario con `password_vence_en` igual a la hora de MySQL del momento de crearlo y `password_actualizada_en = NULL`. Su primer login responde 403.
- [X] `POST /auth/renovar-password` funciona sin header `Authorization`.
- [X] Con credenciales válidas y una `password_nueva` válida responde 200 `{ ok: true, msg: 'Contraseña actualizada correctamente' }`, sin token.
- [X] Después de renovar, el login con la contraseña nueva responde 200 y el login con la contraseña vieja responde 401.
- [X] Después de renovar, `password_actualizada_en` tiene la hora de la renovación y `password_vence_en` queda 90 días después (o `PASSWORD_VIGENCIA_DIAS` días, si está definida).
- [X] Con `PASSWORD_VIGENCIA_DIAS=abc`, `0` o `-5`, la renovación usa 90 días.
- [X] Renovar una contraseña **vigente** también responde 200 y mueve `password_vence_en`.
- [X] `password_actual` incorrecta responde 401 `Usuario o contraseña incorrectos`. Un `username` inexistente responde exactamente lo mismo.
- [x] `password_nueva` igual a la actual responde 400 `La nueva contraseña debe ser distinta de la actual` y no cambia ninguna columna.
- [x] `password_nueva` con menos de 8 caracteres, sin mayúscula o sin número responde 400 desde el DTO.
- [x] Ningún error de la renovación modifica la fila de `usuarios`.
- [x] `POST /auth/register` sigue aceptando una contraseña de 8 caracteres sin mayúscula ni número.
- [x] `/docs` muestra `POST /auth/renovar-password` con su descripción, y la descripción de `POST /auth/login` menciona el 403.
- [x] El route log muestra exactamente una ruta más que antes de este spec.

---

## Decisions

- **Sí:** dos columnas, `password_vence_en` y `password_actualizada_en`. La primera decide el vencimiento y la segunda deja registro de cuándo cambió la contraseña. Decisión del usuario.
- **No:** guardar solo `password_actualizada_en` y calcular el vencimiento. Si cambiara la política, cambiaría el vencimiento de todos los usuarios de golpe.
- **Sí:** 90 días, configurable con la variable opcional `PASSWORD_VIGENCIA_DIAS`. Decisión del usuario. Se ajusta sin desplegar código.
- **Sí:** un valor inválido cae a 90. Es el mismo criterio de `GEMINI_TIMEOUT_MS` y `CHAT_LIMITE_DIARIO`, así que no hay forma de apagar el vencimiento por configuración.
- **Sí:** 403 sin token, con `passwordVencida: true` en el cuerpo del error. Decisión del usuario. Una contraseña vencida no da acceso a nada.
- **No:** 200 con token y la flag. El vencimiento no bloquearía nada.
- **Sí:** el 200 del login también lleva `passwordVencida`, siempre en `false`. Decisión del usuario. El front lee el mismo campo en los dos casos sin validar el código HTTP. Es un cambio aditivo: un cliente que no lo lee no se rompe.
- **No:** `passwordVencida` en el 401. Ahí no se validó la contraseña, y devolverlo le diría a quien no la conoce si la cuenta está vencida.
- **No:** 200 `{ ok: false }`. Rompería la forma de error del proyecto.
- **Sí:** el mensaje es `La contraseña ha caducado`, con ortografía corregida respecto del prompt original ("Contrasena a caducado"). Decisión del usuario.
- **Sí:** el chequeo de vencimiento va **después** de `bcrypt.compare`. Así quien no conoce la contraseña no puede averiguar si una cuenta está vencida.
- **Sí:** `POST /auth/renovar-password` es `@Public()` y se autentica con `username` + `password_actual`. Decisión del usuario. Es la única opción coherente con un login que no emite token.
- **No:** un token temporal de un solo uso emitido por el login vencido. Exigiría un secreto o claim nuevo y un guard, para un beneficio marginal frente a pedir la contraseña actual.
- **Sí:** la renovación acepta contraseñas vigentes. Decisión del usuario. Con un solo endpoint también se cubre el cambio voluntario.
- **Sí:** el endpoint devuelve solo `{ ok, msg }`. Decisión del usuario. El login sigue siendo el único lugar que emite tokens.
- **Sí:** `password_vence_en = NULL` significa "no vence" y no hay backfill. Decisión del usuario. Al desplegar nadie queda bloqueado.
- **Sí:** `POST /auth/register` escribe `password_vence_en = NOW()`. Decisión del usuario. La contraseña inicial la eligió otra persona y se trata como temporal.
- **Sí:** `register` deja `password_actualizada_en` en `NULL`. Esa columna registra cambios hechos por el propio usuario, y en el registro la contraseña la elige otra persona.
- **Sí:** las reglas de la contraseña nueva son mínimo 8, mayúscula, número y distinta de la actual. Decisión del usuario.
- **Sí:** las tres primeras reglas viven en el DTO. "Distinta de la actual" vive en el repositorio porque necesita el hash.
- **No:** aplicar la complejidad a `register`. Decisión del usuario. Cambiaría el contrato de un endpoint existente, y la contraseña de `register` se reemplaza sí o sí en el primer login.
- **No:** historial de contraseñas. Necesita una tabla nueva y queda fuera del alcance.
- **Sí:** el 401 de la renovación usa un solo mensaje para usuario inexistente y contraseña incorrecta. No le dice a un atacante qué falló.
- **Sí:** la comparación y la escritura de fechas se hacen con `NOW()` de MySQL. Comparten reloj con `created_at` y con el resto de los timestamps del proyecto.
- **Sí:** sin fila en `catalogo_permisos`/`permisos`. El endpoint es `@Public()`, así que un permiso no tendría a quién aplicarse.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Un access token emitido antes del vencimiento sigue valiendo hasta sus 8h, aunque la contraseña ya haya vencido o se haya renovado | **Aceptado.** El `JwtStrategy` no consulta la base. Revocar tokens va en su propio spec. |
| `POST /auth/renovar-password` es público y no tiene rate limiting, así que sirve para probar contraseñas por fuerza bruta | Es la misma exposición que ya tiene `POST /auth/login`. **No agrega superficie nueva.** El rate limiting (SPEC 23) sigue sin implementarse. |
| Los usuarios existentes nunca vencen mientras sigan en `NULL` | **Decisión explícita.** Para hacerlos vencer basta un `UPDATE usuarios SET password_vence_en = ...` a mano. |
| Un front que no maneje el 403 deja al usuario recién registrado sin poder entrar | Es un cambio de contrato para `register` → primer login. Hay que coordinar con el front **antes** de desplegar: el front tiene que leer `passwordVencida` y mostrar la pantalla de renovación. |
| La columna calculada `password_vencida` se filtra dentro de `user` en el 200 del login | El paso 4 la quita en la desestructuración, y un criterio de aceptación lo verifica. |
| `passwordVencida` viaja como `0`/`1` porque se copia directo de la columna calculada de MySQL | El 200 escribe el literal `false` y el 403 el literal `true`. Ninguno lee el valor de la base, y un criterio de aceptación exige el booleano. |
| Un usuario desactivado (`isActive = 0`) puede renovar su contraseña | Hoy ese usuario también puede hacer login, porque el login no mira `isActive`. Este spec no empeora nada. Validar `isActive` va aparte. |

---

## What is **not** in this spec

- Historial de contraseñas.
- Backfill de los usuarios existentes.
- Aviso previo de vencimiento.
- Revocación de tokens ya emitidos.
- Recuperación de contraseña olvidada y restablecimiento por un admin.
- Bloqueo por intentos fallidos y rate limiting.
- Validación de `usuarios.isActive`.
- Reglas de complejidad en `POST /auth/register`.
- Cambio de contraseña con token.

Cada uno de estos, si se necesita, va en su propio spec.
