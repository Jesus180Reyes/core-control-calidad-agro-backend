# SPEC 52 — Info pública del tenant (`GET /info`)

> **Status:** Implemented
> **Depends on:** SPEC 51 (tabla `parametros`)
> **Date:** 2026-11-10
> **Objective:** Agregar una ruta pública `GET /info` que devuelve `{ app, empresa }` leídos de las claves `APP_NOMBRE` y `EMPRESA_NOMBRE_COMERCIAL` de `parametros`, para que cualquiera que llegue al dominio sepa qué aplicación y qué empresa hay detrás.

---

## Why this spec exists

El front necesita mostrar el nombre de la aplicación y de la empresa antes de que el usuario inicie sesión, por ejemplo en la pantalla de login. `GET /parametros?nombre=` exige JWT. El SPEC 51 descartó hacerla `@Public()` porque eso haría pública toda la tabla, incluidos el RTN, el teléfono y el correo.

Este spec abre solo dos claves fijas en una ruta propia. La tabla sigue protegida.

El nombre `/health` se descartó a propósito. Una ruta con ese nombre promete un chequeo de salud: status, 503, y la usaría el `HEALTHCHECK` de Docker. Esta ruta no cumple ese contrato.

## Scope

**In:**

- Clave nueva `APP_NOMBRE` en `parametros`. Se agrega a `db/seed.sql` con `valor` `NULL` y se llena a mano, igual que las `EMPRESA_*`.
- Ruta `GET /info`, **`@Public()`**. Lee `APP_NOMBRE` y `EMPRESA_NOMBRE_COMERCIAL` y responde `{ app, empresa }`.
- Una clave vacía (`valor` `NULL`), inactiva o inexistente sale como `null` en su campo. La ruta responde 200 de todos modos.
- `InfoController` nuevo dentro de `src/modules/parametros/`, que reutiliza `ParametrosRepository`.
- El paso manual en `deploy/README.md` para los tenants que ya existen: un `INSERT` de `APP_NOMBRE`.
- Swagger: `@ApiTags`, `@ApiOperation`, sin `@ApiBearerAuth`.

**Out of scope (for future specs):**

- Un endpoint de salud real (`/health`) con `status`, 503 cuando MySQL falla, o uptime.
- Cambiar el `HEALTHCHECK` del `Dockerfile`. Sigue llamando a `GET /`.
- Exponer cualquier otra clave de `parametros` sin token: razón social, RTN, dirección, teléfono, correo o sitio web.
- Versión o commit del API en la respuesta.
- Un fallback en código a `'metrika360'` cuando `APP_NOMBRE` está vacía.
- Pasar a `EMPRESA_RAZON_SOCIAL` cuando `EMPRESA_NOMBRE_COMERCIAL` está vacía.
- Rate limiting de la ruta pública (el SPEC 23 sigue en `Draft`).
- Logo o marca del front.

## Data model

No hay DDL. Solo hay una fila nueva en `parametros`, la tabla del SPEC 51:

| `clave` | `valor` | `descripcion` |
| --- | --- | --- |
| `APP_NOMBRE` | `NULL` | Nombre de la aplicación |

En cada tenant, después se completa a mano:

```sql
UPDATE parametros SET valor = 'metrika360' WHERE clave = 'APP_NOMBRE';
```

Respuesta de `GET /info` (200, sin token):

```json
{
  "app": "metrika360",
  "empresa": "AndesBerry"
}
```

Con las dos claves sin completar:

```json
{ "app": null, "empresa": null }
```

Convenciones:

- **Sin el sobre `{ ok, msg, ... }`.** El cuerpo es exactamente `{ app, empresa }`. Es una excepción a la convención de controllers, como las que ya están listadas en el `CLAUDE.md` raíz.
- `app` y `empresa` son `string | null`. Nunca falta ninguno de los dos campos.
- No hay `id`, `clave`, `descripcion`, `isActive` ni timestamps.
- Las claves que lee la ruta son constantes en el código. La ruta no recibe parámetros, así que nadie puede pedir otra clave.

Errores:

| Caso | Respuesta |
| --- | --- |
| Sin token | **200** (ruta pública) |
| Una clave con `valor` `NULL`, inactiva o inexistente | **200** con ese campo en `null` |
| MySQL no responde, o la tabla `parametros` no existe | **500** genérico (lo registra `RegistroErroresFilter` si puede escribir) |

## Implementation plan

1. En la base local: `INSERT INTO parametros (clave, descripcion) VALUES ('APP_NOMBRE', 'Nombre de la aplicación');`. Verificar con `SELECT clave, valor FROM parametros;`.
2. En `db/seed.sql`, agregar la fila `APP_NOMBRE` al bloque `LOCK TABLES parametros WRITE`, con `valor` `NULL`.
3. En `ParametrosRepository`, agregar `obtenerInfoPublica()`. Hace un solo `SELECT clave, valor` sin transacción, con `WHERE clave IN ('APP_NOMBRE', 'EMPRESA_NOMBRE_COMERCIAL') AND isActive = 1`, y arma `{ app, empresa }`. Una clave que no llega queda en `null`. Las dos claves van como constantes del repositorio. Agregar el pass-through en `ParametrosService`.
4. Crear `src/modules/parametros/info.controller.ts`:
   - `@Controller('info')` con `@ApiTags('info')`, sin `@ApiBearerAuth`.
   - `@Public()` y `@Get()`, que devuelve el objeto del servicio tal cual.
   - El `@ApiOperation` dice cuatro cosas: que la ruta es pública, que solo expone esas dos claves, que un campo es `null` si la clave está vacía o inactiva, y que no es un chequeo de salud.

   Registrar el controller en `controllers` de `parametros.module.ts`.
5. En `deploy/README.md`, en la sección "Tabla `parametros`", agregar el paso para los tenants existentes: el `INSERT IGNORE` de `APP_NOMBRE` y el `UPDATE ... SET valor = 'metrika360'`. Un tenant nuevo recibe la fila desde `seed.sql`, pero el `UPDATE` también hace falta.
6. Actualizar la documentación:
   - `src/modules/parametros/CLAUDE.md`: la clave `APP_NOMBRE` (ocho claves sembradas), la ruta `GET /info` (pública, dos claves fijas, campos `null`, sin sobre), y que **agregar una clave a `/info` la hace pública**.
   - `src/database/CLAUDE.md`: en "Hand-maintained tables", `parametros` pasa de "seven empty `EMPRESA_*` keys" a ocho claves, con `APP_NOMBRE` incluida.
   - `CLAUDE.md` raíz:
     - `GET /info` en la lista de rutas `@Public()` de "Auth/guard flow".
     - `GET /info` (cuerpo `{ app, empresa }` sin `ok`/`msg`) en la lista de excepciones de "Conventions".
     - El conteo de rutas: 54 rutas, `parametros` 2; 53 operaciones bajo 49 `paths`.

## Acceptance criteria

- [X] `SELECT clave FROM parametros` en la base local incluye `APP_NOMBRE`.
- [X] `db/seed.sql` siembra `APP_NOMBRE` con `valor` `NULL`.
- [X] `GET /info` **sin token** responde 200.
- [X] Con `APP_NOMBRE = 'metrika360'` y `EMPRESA_NOMBRE_COMERCIAL = 'AndesBerry'`, `GET /info` responde exactamente `{ "app": "metrika360", "empresa": "AndesBerry" }`, sin `ok`, `msg` ni otros campos.
- [X] Con `EMPRESA_NOMBRE_COMERCIAL` en `NULL`, `GET /info` responde 200 con `empresa: null`.
- [X] Tras `UPDATE parametros SET isActive = 0 WHERE clave = 'APP_NOMBRE'`, `GET /info` responde 200 con `app: null`.
- [X] Un cambio hecho con `UPDATE` se ve en la siguiente llamada, sin reiniciar el API.
- [X] `GET /info?nombre=EMPRESA_RTN` devuelve lo mismo que `GET /info`. El query se ignora y el RTN no aparece.
- [X] `GET /parametros?nombre=EMPRESA_RTN` sin token sigue respondiendo 401.
- [X] El log de rutas de Nest muestra 54 rutas, y `/docs-json` tiene 53 operaciones bajo 49 `paths`.
- [X] Swagger (`/docs`) muestra `GET /info` sin candado y con su descripción.
- [X] `npm run lint` no da errores.

## Decisions

- **Yes:** ruta `GET /info`. Describe qué app y qué empresa hay detrás del dominio. No choca con ninguna ruta actual ni con `/reportes/*`.
- **No:** `/health`. Promete un chequeo de salud que esta ruta no hace, y el nombre queda libre para un endpoint de salud real.
- **No:** `/parametros/publicos`. Al estar junto a la ruta con JWT, da a entender que expone más claves de la tabla.
- **Yes:** `@Public()` con solo dos claves fijas en el código. El SPEC 51 rechazó abrir toda la tabla. Esto abre dos nombres, no la tabla.
- **Yes:** `APP_NOMBRE` como clave nueva en `parametros`, por decisión del usuario. Cada tenant puede tener su propio nombre de app, a cambio de un `INSERT` a mano en cada base existente.
- **No:** constante en código ni variable de entorno para `app`.
- **Yes:** `APP_NOMBRE` se siembra en `NULL` y se llena a mano, como las `EMPRESA_*`. Es la misma regla para toda la tabla.
- **No:** fallback en código a `'metrika360'`. Un `null` muestra que el `UPDATE` falta, en vez de esconderlo.
- **Yes:** `empresa` sale de `EMPRESA_NOMBRE_COMERCIAL`. Es el nombre que se muestra. La razón social es un dato fiscal.
- **No:** caer a `EMPRESA_RAZON_SOCIAL` cuando el nombre comercial está vacío.
- **Yes:** una clave vacía, inactiva o inexistente sale como `null`, con 200. Un tenant recién creado no rompe su pantalla de login porque nadie llenó un dato. Esto difiere a propósito del 404 de `GET /parametros`, donde la clave la elige quien llama.
- **Yes:** cuerpo exacto `{ app, empresa }`, sin `ok`/`msg`, por decisión del usuario.
- **No:** `status` ni 503 cuando MySQL falla. Esto no es un endpoint de salud. Un fallo de base es un 500 genérico.
- **No:** uptime, timestamp, versión o commit. Es información pública que no se pidió.
- **No:** cambiar el `HEALTHCHECK` del `Dockerfile`.
- **Yes:** `InfoController` dentro de `src/modules/parametros/`, reutilizando `ParametrosRepository`. La tabla es de ese módulo, y otro módulo con su propio repositorio duplicaría el acceso.
- **Yes:** un solo `SELECT ... WHERE clave IN (...)`, sin transacción. Es una lectura.

## Risks

| Risk | Mitigation |
| --- | --- |
| Un tenant existente no recibe el `INSERT` de `APP_NOMBRE` | `GET /info` responde `app: null`, no un error. El paso queda en `deploy/README.md`. |
| Alguien agrega una clave sensible a las constantes de `/info` y la expone sin token | Queda escrito en `src/modules/parametros/CLAUDE.md` y en la descripción de Swagger. Exponer otra clave es otro spec. |
| La ruta es pública y sin rate limiting (SPEC 23 en `Draft`), y cada llamada abre una conexión MySQL (`DatabaseMiddleware`) | **Aceptado**, igual que `POST /auth/login`, que ya es público y toca la base. El rate limiting es del SPEC 23. |
| Alguien usa `/info` como health check y no detecta que la base cayó | Un fallo de MySQL responde 500, así que un monitor que espere 200 lo detecta igual. La descripción de Swagger dice que no es un chequeo de salud. |
| El nombre comercial de la empresa queda visible para cualquiera que llegue al dominio | **Aceptado.** Es el propósito de la ruta: mostrarlo en el login. |

## What is **not** in this spec

- Endpoint `/health` con `status`, 503 o uptime.
- Cambios al `HEALTHCHECK` del `Dockerfile`.
- Otras claves de `parametros` sin token.
- Versión o commit del API.
- Fallback en código para `app` o `empresa`.
- Rate limiting.
- Logo o marca del front.

Cada uno de esos, si llega, va en su propio spec.
