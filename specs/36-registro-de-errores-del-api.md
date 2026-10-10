# SPEC 36 — Registro de errores del API

> **Status:** Implemented
> **Depends on:** Ninguno
> **Date:** 2026-10-10
> **Objective:** Registrar en una tabla nueva, `log_errores`, cada respuesta 5xx que produce el API, con un filtro de excepciones global que escribe por su propia conexión y no cambia la respuesta que recibe el cliente.

---

## Why this spec exists

Hoy, cuando el API falla en producción, el único rastro es la consola del proceso. Nest imprime el stack de una excepción no controlada y nada más. Si el proceso se reinicia o la consola rota, el error se pierde, y no hay forma de saber cuántas veces pasó, en qué ruta ni a qué usuario.

El proyecto no tiene ningún `ExceptionFilter`. Este spec agrega el primero, y lo limita a una sola cosa: **dejar constancia**. No cambia códigos, mensajes ni la forma de ninguna respuesta.

Tres ideas sostienen el diseño.

**La primera: solo se guardan los 5xx.** Un 400 de Zod, un 401 por token vencido, un 403 o un 404 son el API funcionando como se diseñó. Guardarlos llenaría la tabla de ruido y escondería lo que importa: lo que nadie esperaba.

**La segunda: el filtro no usa la conexión del request.** `DatabaseMiddleware` abre un pool de una conexión por request y lo destruye en `res.on('finish')`. Si el filtro escribiera por `req['db']`, tendría que esperar el `INSERT` antes de responder, y si el 5xx fue justamente un fallo de MySQL, esa conexión es la que acaba de fallar. El filtro abre la suya, escribe y la cierra.

**La tercera: registrar un error nunca puede producir otro error.** Si el `INSERT` falla, el filtro lo escribe con `Logger.error` y sigue. El cliente recibe su 5xx igual que hoy.

---

## Scope

**In:**

- Una tabla nueva, `log_errores`, con su DDL aplicado a mano.
- `LogErroresTable` en `src/database/types/types.ts` y la clave `log_errores` en `Database`.
- Un filtro global, `RegistroErroresFilter`, en `src/filters/registro-errores.filter.ts`, registrado **una sola vez** como `APP_FILTER` en `AppModule`.
- El filtro atrapa toda excepción (`@Catch()`), delega la respuesta a `BaseExceptionFilter` sin cambiarla y, si el status es **>= 500**, inserta una fila.
- La fila guarda: status, método, ruta con query string, mensaje, stack, `usuario_id` (si el request estaba autenticado), entorno (`NODE_ENV`) y la fecha de MySQL.
- La escritura se hace por una conexión propia de un solo uso, sin bloquear la respuesta.
- `CLAUDE.md` actualizado.

**Out of scope (for future specs):**

- Errores del front. Se ofreció un `POST` para que el front los reporte y se descartó. Si llega, su spec decide si usa esta tabla (con una columna de origen) u otra.
- Errores 4xx.
- Un endpoint de lectura (`GET /errores` o similar). Los errores se consultan en MySQL.
- Guardar el body del request.
- Guardar la IP, el `User-Agent` o el nombre de la clase de la excepción.
- Agregar un `error_id` a la respuesta 5xx.
- Retención, purga automática o cualquier proceso programado.
- Agrupar o deduplicar errores repetidos.
- Notificaciones (correo, Slack, etc.) cuando ocurre un error.
- Integración con servicios externos (Sentry, Datadog, etc.).
- Índices sobre `log_errores`.
- Arreglar el doble registro global de `ZodValidationPipe` y `JwtAuthGuard`.

---

## Data model

### DDL

```sql
CREATE TABLE log_errores (
  id INT NOT NULL AUTO_INCREMENT,
  status SMALLINT NOT NULL,
  metodo VARCHAR(10) NOT NULL,
  ruta VARCHAR(500) NOT NULL,
  mensaje VARCHAR(1000) NOT NULL,
  stack TEXT NULL,
  usuario_id INT NULL,
  entorno VARCHAR(20) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);
```

- **Sin FK** en `usuario_id`. Un log tiene que sobrevivir aunque el usuario desaparezca, y una FK rota haría fallar el `INSERT` justo cuando hay que registrar. Los conteos del proyecto siguen en **16** FKs y **6** `UNIQUE`.
- **Sin índices** más allá de la PK. Nada lee la tabla por API.
- `created_at` lo pone MySQL con `DEFAULT CURRENT_TIMESTAMP`, así comparte reloj con el resto de las columnas `created_at` del proyecto. El filtro no lo envía.
- La base corre con `STRICT_TRANS_TABLES` (verificado en el spec 27), así que un valor más largo que la columna haría fallar el `INSERT`. Por eso el filtro trunca antes de escribir (ver la tabla siguiente).

### Columnas

| Columna | Valor | Truncado a |
| --- | --- | --- |
| `status` | `exception.getStatus()` si es una `HttpException`, si no **500** | — |
| `metodo` | `req.method` | 10 |
| `ruta` | `req.originalUrl`, que incluye el query string | 500 |
| `mensaje` | `exception.message` si es un `Error`, si no `String(exception)` | 1000 |
| `stack` | `exception.stack` si es un `Error`, si no `NULL` | 15000 caracteres |
| `usuario_id` | `req.user.userId` si existe, si no `NULL` | — |
| `entorno` | `process.env.NODE_ENV`, o `NULL` si no está definido | 20 |

El límite de `stack` es 15000 caracteres y no 65535 porque `TEXT` mide **bytes**, y un carácter `utf8mb4` puede ocupar hasta 4.

`usuario_id` solo existe cuando `JwtAuthGuard` ya validó el token. Un 5xx en una ruta `@Public()` o antes del guard se guarda con `NULL`.

### `LogErroresTable`

```ts
export interface LogErroresTable {
  id: Generated<number>;
  status: number;
  metodo: string;
  ruta: string;
  mensaje: string;
  stack: string | null;
  usuario_id: number | null;
  entorno: string | null;
  created_at: Generated<Date>;
}
```

En `Database`: `log_errores: LogErroresTable`.

### Comportamiento del filtro

1. Llama a `super.catch(exception, host)` de `BaseExceptionFilter`. La respuesta al cliente sale **exactamente igual que hoy**: mismo status, mismo body, y Nest sigue imprimiendo en consola los errores no controlados.
2. Calcula el status. Si es **< 500**, termina.
3. Si es **>= 500**, lanza el registro **sin `await`** (fire-and-forget):
   1. Crea un `Kysely<Database>` con un pool de `mysql2` de `connectionLimit: 1`, con las mismas variables `DB_*` que `DatabaseMiddleware`.
   2. Inserta la fila en `log_errores`.
   3. En un `finally`, destruye el `Kysely`.
   4. Todo va dentro de un `try/catch`. Si algo falla, escribe `Logger.error` con el motivo y **no relanza**.

El filtro no inyecta `DatabaseService`. Así sigue siendo un singleton y no hereda el `Scope.REQUEST`, igual que `GeminiService` (spec 27).

### Archivos

| Archivo | Cambio |
| --- | --- |
| `src/filters/registro-errores.filter.ts` | Nuevo. `RegistroErroresFilter extends BaseExceptionFilter`, `@Catch()`. |
| `src/database/types/types.ts` | `LogErroresTable` y la clave `log_errores` en `Database`. |
| `src/app.module.ts` | Provider `{ provide: APP_FILTER, useClass: RegistroErroresFilter }`. |
| `CLAUDE.md` | Ver el paso 6 del plan. |

`src/main.ts` **no cambia**: el filtro no se registra con `app.useGlobalFilters`, para no repetir el doble registro de pipes y guards.

---

## Implementation plan

1. Aplicar el DDL de `log_errores` a mano en MySQL. Verificar con `DESCRIBE log_errores` y `SHOW CREATE TABLE log_errores`. La app no cambia.
2. Agregar `LogErroresTable` y la clave `log_errores` a `src/database/types/types.ts`. La app compila igual, porque nadie usa la tabla todavía.
3. Crear `src/filters/registro-errores.filter.ts` con `RegistroErroresFilter`, que por ahora solo llama a `super.catch`. Registrarlo como `APP_FILTER` en `AppModule`. Prueba manual: un 400, un 401 y un 404 responden byte a byte igual que antes.
4. Agregar al filtro el cálculo del status y el armado de la fila, con los truncados de la tabla de columnas, en un método privado puro. Todavía no escribe.
5. Agregar el registro fire-and-forget: conexión propia, `INSERT`, `destroy` en `finally` y `Logger.error` si algo falla. Prueba manual: con `GEMINI_API_KEY` vacía, `POST /lotes/:id/resumen` de un lote finalizado sin resumen responde 503 y aparece una fila con `status = 503`.
6. Actualizar `CLAUDE.md`:
   - Una nota en Architecture sobre `src/filters/`, el primer `ExceptionFilter` del proyecto, registrado una sola vez como `APP_FILTER`.
   - La nota de que el filtro escribe por una conexión propia y no por `req['db']`, y por qué.
   - En Domain, `log_errores`: la primera tabla que escribe una pieza que no es un repositorio, y que ningún endpoint lee.
   - En Caveats, el DDL de este spec y que los conteos de FKs (**16**) y `UNIQUE` (**6**) no cambian.
   - El conteo de rutas **no** cambia: este spec no agrega ninguna.

---

## Acceptance criteria

- [X] `DESCRIBE log_errores` muestra las nueve columnas con los tipos del DDL.
- [X] El route log muestra las mismas rutas que antes de este spec.
- [X] Un 400 de validación, un 401 sin token, un 403 de `PATCH /auth/usuarios/:id/reset-password` y un 404 de `GET /pesajes/:id` responden igual que antes y **no** insertan ninguna fila.
- [X] Con `GEMINI_API_KEY` vacía, `POST /lotes/:id/resumen` de un lote finalizado sin resumen responde el mismo 503 que antes e inserta una fila con `status = 503`, `metodo = 'POST'`, `ruta = '/lotes/<id>/resumen'`, el mensaje de la excepción y el `usuario_id` del token.
- [X] Un `throw new Error('prueba')` temporal en un handler (que no se commitea) responde el 500 por defecto de Nest (`{ statusCode: 500, message: 'Internal server error' }`) e inserta una fila con `status = 500`, `mensaje = 'prueba'` y un `stack` no nulo.
- [X] Una ruta con query string guarda la `ruta` con el query incluido.
- [X] Un 5xx en una ruta `@Public()` guarda `usuario_id = NULL`.
- [X] `entorno` guarda el valor de `NODE_ENV`, o `NULL` si no está definido.
- [X] `created_at` es la hora de MySQL del error.
- [X] Con un `stack` o un `mensaje` más largo que su columna, la fila se inserta truncada y no falla.
- [X] Si el `INSERT` falla (por ejemplo, con la tabla renombrada temporalmente), el cliente recibe el mismo 5xx y la consola muestra un `Logger.error` del filtro. El proceso no se cae.
- [X] Ninguna fila guarda el body del request.
- [X] El filtro está registrado solo como `APP_FILTER`. `src/main.ts` no cambió.
- [X] No se agregó ninguna fila a `catalogo_permisos` ni a `permisos`.

---

## Decisions

- **Sí:** solo errores del API. Decisión del usuario. El reporte desde el front queda para otro spec.
- **No:** un `POST` para que el front reporte errores. Sin rate limiting (el spec 23 sigue en `Draft`), un endpoint público de escritura es una puerta abierta a llenar la tabla.
- **Sí:** solo 5xx. Decisión del usuario. Los 4xx son el API funcionando como se diseñó.
- **No:** 4xx. Cada token vencido sería un 401 guardado.
- **Sí:** conexión propia y corta para el `INSERT`. Decisión del usuario. No depende de `req['db']`, que el middleware destruye en `finish` y que puede ser la conexión que falló. Los errores son raros, así que abrir una conexión por error cuesta poco.
- **No:** reusar `req['db']`. Obliga a esperar el `INSERT` antes de responder, y falla junto con MySQL.
- **No:** un pool singleton permanente. Mantendría una conexión viva todo el tiempo, a diferencia del resto del proyecto.
- **Sí:** fire-and-forget. El `INSERT` no retrasa la respuesta.
- **Sí:** la respuesta al cliente no cambia. Decisión del usuario. Ningún contrato publicado se toca.
- **No:** un `error_id` en el body del 5xx. Obligaría a esperar el `INSERT` y no vendría cuando el `INSERT` falla.
- **No:** guardar el body. Decisión del usuario. Puede traer contraseñas (`POST /auth/login`, `POST /auth/renovar-password`) o la firma de hasta 500.000 caracteres del spec 26.
- **Sí:** guardar el query string, dentro de `ruta`. Decisión del usuario. Ningún query param del proyecto lleva secretos.
- **No:** IP, `User-Agent` ni nombre de la excepción. Se ofrecieron y no se eligieron. El nombre de la clase casi siempre se lee en la primera línea del `stack`.
- **Sí:** registrar en todos los entornos, con una columna `entorno`. Decisión del usuario. Si desarrollo y producción comparten base, se distinguen por esa columna.
- **No:** registrar solo en `production`. Haría falta una tercera convención de `NODE_ENV`, además de la de Swagger.
- **Sí:** tabla `log_errores`. Decisión del usuario.
- **No:** `errores_api` ni `errores`.
- **Sí:** sin retención ni purga. Decisión del usuario. Se borra a mano en MySQL. Un borrado programado sería el primer `DELETE FROM` y el primer proceso programado del proyecto, y merece su propio spec.
- **Sí:** sin endpoint de lectura. Decisión del usuario. Los stack traces muestran detalles internos, y abrirlos pediría decidir quién los lee.
- **Sí:** sin FK en `usuario_id`. Una FK podría hacer fallar justo el `INSERT` que registra un error. No es una excepción nueva a la regla de "unicidad e integridad en código": es la regla.
- **Sí:** truncar en el código antes de escribir. Con `STRICT_TRANS_TABLES`, un valor largo haría fallar el `INSERT`.
- **Sí:** `@Catch()` sin argumentos, extendiendo `BaseExceptionFilter`. Es la forma de ver todas las excepciones sin reescribir cómo Nest arma la respuesta.
- **Sí:** registrado solo como `APP_FILTER`, no también en `main.ts`. El doble registro de pipes ya causó un bug (spec 16). Con un filtro, el doble registro haría que cada error se guardara dos veces.
- **Sí:** el filtro no inyecta `DatabaseService`. Así queda singleton, igual que `GeminiService`.
- **Sí:** sin fila de permiso. No hay endpoint.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Si MySQL está caído, el error que más importa es el que no se puede registrar | El filtro escribe `Logger.error` y el error queda en consola, como hoy. Es el límite de guardar los errores en la misma base que falla. |
| Gemini responde `503 UNAVAILABLE` con frecuencia (6 de 28 llamadas en el spec 27), y eso sale como 502 nuestro | Cada uno genera una fila. Es correcto, porque es una falla real en producción, pero va a ser la mayoría de las filas. Se filtran por `ruta` al consultar. |
| La tabla crece sin límite | Aceptado por decisión explícita. Solo entran 5xx, que deberían ser raros. La purga es un spec aparte. |
| Un bucle de errores (por ejemplo, un 500 en cada request de una ruta muy usada) abre una conexión por error | Cada conexión dura lo que dura un `INSERT` y se cierra en `finally`. Si llegara a saturar MySQL, se agrega un muestreo o deduplicación en otro spec. |
| El `stack` revela rutas de archivos y detalles internos | Solo vive en MySQL. Ningún endpoint lo devuelve, y la respuesta al cliente no cambia. |
| `mensaje` de una excepción podría incluir datos del request (por ejemplo, un error de MySQL que cita el valor de un campo) | Aceptado. Es texto que hoy ya sale en la consola. |
| Un error dentro de un middleware podría no pasar por el filtro global | Se verifica al implementar. Si `DatabaseMiddleware` falla, igual no hay base donde escribir. |
| Alguien agrega más adelante `app.useGlobalFilters(new RegistroErroresFilter())` en `main.ts` "por simetría" | Cada error se guardaría dos veces. Queda escrito en `CLAUDE.md` y en este spec. |

---

## What is **not** in this spec

- Errores del front y cualquier endpoint para reportarlos.
- Errores 4xx.
- Un endpoint de lectura de `log_errores`.
- El body del request, la IP, el `User-Agent` y el nombre de la excepción.
- Un `error_id` en la respuesta.
- Retención, purga o procesos programados.
- Deduplicación, agrupamiento o muestreo.
- Notificaciones y servicios externos de monitoreo.
- Índices sobre la tabla.

Cada uno de estos, si se necesita, va en su propio spec.
