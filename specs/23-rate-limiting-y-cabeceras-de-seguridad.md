# SPEC 23 — Rate limiting y cabeceras de seguridad

> **Status:** Draft
> **Depends on:** SPEC 22 (monta Swagger en `/docs`, cuya UI hay que contemplar en la CSP)
> **Date:** 2026-09-11
> **Objective:** Poner `helmet` delante de las 26 rutas y `@nestjs/throttler` con un límite global de 100/min por IP más uno de 5/min sobre `POST /auth/login`, sin cambiar el cuerpo de ninguna respuesta existente.

---

## Why this spec exists

Hoy `POST /auth/login` se puede llamar sin ningún freno. No hay contador de intentos, no hay bloqueo, no hay registro de fallos: un script prueba contraseñas contra un usuario a la velocidad que aguante el MySQL, y el único rastro que deja son 401 en el log. En un sistema donde el token dura 8 horas y ningún endpoint valida permisos, una cuenta adivinada es acceso completo.

Tampoco hay una sola cabecera de seguridad. La API responde con el `X-Powered-By: Express` que trae el framework y sin `nosniff`, sin `X-Frame-Options` y sin CSP.

Cuatro cosas conviene tener claras antes de leer el resto.

**La primera: el límite de `@nestjs/throttler` es por endpoint, no por API.** La clave de almacenamiento incluye el nombre de la clase y el del handler, así que "100/min" significa 100 por minuto **a cada ruta** desde una IP. Una IP puede hacer 100 a `GET /clientes` y otras 100 a `GET /pesajes/:id` en el mismo minuto. Es el comportamiento por defecto de la librería y se acepta tal cual: sigue frenando el barrido secuencial de `GET /pesajes/:id`, que es el caso que importa.

**La segunda: el orden de los guards decide si el throttler sirve para algo.** El `JwtAuthGuard` está registrado dos veces —`APP_GUARD` en `AppModule` y `useGlobalGuards` en `main.ts`— y los guards globales corren en el orden en que se registran. Si el `JwtAuthGuard` corre primero, una inundación sin token recibe 401 sin que el throttler la cuente nunca. Por eso el guard del throttler se declara **antes** que el `JwtAuthGuard` en el array de `providers` de `AppModule`, y hay un paso del plan que lo verifica empíricamente.

**La tercera: `helmet` rompe la UI de Swagger si se monta sin más.** La CSP por defecto prohíbe el script inline con el que Swagger UI se arranca, así que `/docs` carga en blanco. La salida elegida es una CSP estricta global más una relajada montada **solo sobre `/docs`**, dentro del mismo `if (NODE_ENV !== 'production')` que ya existe. En producción sólo hay una CSP, la estricta.

**La cuarta: el `DatabaseMiddleware` corre antes que cualquier guard.** Una petición que termina en 429 ya abrió y cerró su pool de MySQL. El rate limiting protege el login, no la base de datos.

---

## Scope

**In:**

- Instalar `helmet` en el rango `^8` como dependencia de producción.
- `app.use(helmet())` en `src/main.ts`, después de `app.enableCors()` y **antes** del bloque de Swagger.
- Un segundo `app.use('/docs', helmet({ contentSecurityPolicy: { directives: ... } }))` con la CSP relajada, **dentro** del `if (process.env.NODE_ENV !== 'production')` y **antes** del `SwaggerModule.setup`.
- Instalar `@nestjs/throttler` en el rango `^6.5` como dependencia de producción.
- `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])` en `src/app.module.ts`.
- Archivo nuevo `src/guards/app-throttler.guard.ts` con `AppThrottlerGuard extends ThrottlerGuard`, que sobrescribe `getTracker` para que en `/auth/login` la clave sea IP + username y en el resto sea la IP sola.
- Registrar `AppThrottlerGuard` como `APP_GUARD` **antes** del `JwtAuthGuard` en el array de `providers`.
- `@Throttle({ default: { ttl: 60_000, limit: 5 } })` sobre `POST /auth/login` en `src/modules/auth/auth.controller.ts`.
- `@ApiOperation` de `login` ampliado con una línea que anuncia el límite de 5/min.
- Comentario en `.env.example` sobre `trust proxy` y sección en `CLAUDE.md`.

**Out of scope (for future specs):**

- **Darle al 429 la forma `{ ok, msg }` del proyecto.** Se queda con el cuerpo por defecto de Nest, en inglés. Si se unifica, va con el filtro global de excepciones, que tampoco existe.
- **Redis como almacén de contadores.** Los contadores viven en la memoria del proceso: con dos instancias cada una cuenta por su lado y un reinicio los borra.
- **`app.set('trust proxy', 1)`.** Ni la llamada ni una variable `TRUST_PROXY`. Queda documentado como lo primero a revisar el día del deploy.
- **Restringir el CORS.** `app.enableCors()` sigue aceptando cualquier origen; necesita los dominios reales del frontend y va en su propio spec.
- Bloqueo persistente de cuenta, tabla de intentos fallidos, captcha, 2FA y desbloqueo por parte de un administrador.
- Límite propio para `POST /auth/register`, que hoy cualquier autenticado puede llamar para crear usuarios de cualquier rol.
- El `PermissionsGuard`, el decorador `@Permisos()` y cualquier avance sobre el enforcement de permisos.
- Filtrar `usuarios.isActive` en el login, y cualquier trabajo sobre revocación o expiración de tokens.
- Quitar el doble registro global del `ZodValidationPipe` o del `JwtAuthGuard`.
- Descomentar `app.setGlobalPrefix('api/v1')`.
- Proteger `/docs` con Basic Auth o cualquier credencial.
- Un `/health` público, logging estructurado y request-id.
- Cambiar el pool por request del `DatabaseMiddleware`.
- Tests de cualquier tipo: el proyecto sigue sin un solo `*.spec.ts`.
- DDL de cualquier tipo, cambios a `src/database/types/types.ts` y filas nuevas en `catalogo_permisos` o `permisos`.

---

## Data model

**Este spec no introduce estructuras de datos.** No hay DDL, no hay tabla nueva, no hay columna nueva, `src/database/types/types.ts` no cambia y **no se agrega ninguna variable de entorno**. Los contadores del throttler viven en memoria y no se persisten en ningún lado.

### Archivos

| Archivo | Cambio |
| --- | --- |
| `src/main.ts` | `app.use(helmet())` global y el `helmet` de `/docs` dentro del `if` de Swagger |
| `src/app.module.ts` | `ThrottlerModule.forRoot` y `APP_GUARD` nuevo, declarado antes del `JwtAuthGuard` |
| `src/guards/app-throttler.guard.ts` | **Nuevo** |
| `src/modules/auth/auth.controller.ts` | `@Throttle` en `login` y una línea más en su `@ApiOperation` |
| `package.json` / `package-lock.json` | `helmet@^8` y `@nestjs/throttler@^6.5` |
| `.env.example` | Comentario sobre `trust proxy`, sin variable nueva |
| `CLAUDE.md` | Sección de rate limiting y cabeceras |

**Ningún `*.service.ts`, ningún `*.repository.ts`, ningún DTO y ningún controller salvo el de `auth`.**

### El orden en `main.ts`

El orden es el contrato de este spec: express ejecuta los middlewares en el orden en que se registran y `helmet` escribe las cabeceras con `res.setHeader`, así que **la última llamada que corre es la que manda**.

```ts
app.enableCors();
app.use(helmet());

if (process.env.NODE_ENV !== 'production') {
  app.use('/docs', helmet({ contentSecurityPolicy: { directives: /* relajadas */ } }));
  // ... DocumentBuilder, createDocument, cleanupOpenApiDoc ...
  SwaggerModule.setup('docs', app, document, { ... });
}
```

Dos condiciones que no se pueden mover:

- El `helmet` de `/docs` va **después** del global, porque si no, el global le pisa la CSP relajada.
- El `helmet` de `/docs` va **antes** del `SwaggerModule.setup`, porque el handler de la ruta cierra la cadena y un middleware registrado después ya no corre.

Las directivas relajadas son exactamente estas cinco: `defaultSrc: ["'self'"]`, `scriptSrc: ["'self'", "'unsafe-inline'"]`, `styleSrc: ["'self'", "'unsafe-inline'"]`, `imgSrc: ["'self'", 'data:', 'https://validator.swagger.io']` y `connectSrc: ["'self'"]`. El `'unsafe-inline'` de `scriptSrc` es el que hace falta para que Swagger UI arranque; el resto del proyecto no lo lleva.

### El guard

```ts
// src/guards/app-throttler.guard.ts
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // En /auth/login la clave es IP + username; en el resto, la IP sola.
  }
}
```

Tres reglas de esa función:

- La ruta se detecta con `req.originalUrl` recortando el query string, comparando contra la cadena `'/auth/login'`. **No hay `setGlobalPrefix`**, así que ese es el path real hoy.
- El username sale de `req.body?.username`, que ya está parseado porque el body parser de Nest es middleware y corre antes que los guards. Se normaliza con `trim()` y `toLowerCase()`.
- Si no hay username, o no es string, la clave usa el literal `'sin-username'`. Así un body vacío no comparte cubo con un login real.

Si la versión instalada pasa un segundo argumento a `getTracker`, se ignora: la firma sólo usa el request.

### Qué cuenta cada límite

| Ruta | Ventana | Tope | Clave |
| --- | --- | --- | --- |
| `POST /auth/login` | 60 s | **5** | IP + username normalizado |
| Las otras 25 rutas, una por una | 60 s | **100** | IP |

El tope de login cuenta **todos** los intentos, no sólo los fallidos: cinco logins correctos seguidos del mismo usuario desde la misma IP también agotan la ventana. Es lo que hace la librería y se acepta: un operador no inicia sesión seis veces por minuto.

---

## Implementation plan

1. Anotar el punto de partida. Arrancar con `npm run start:dev` y confirmar las **26** rutas del log. Guardar `curl -i` de `GET /` y de `POST /auth/login`: hoy no traen ninguna cabecera de `helmet` y sí traen `X-Powered-By`. Lanzar 20 logins seguidos con contraseña incorrecta y confirmar que los 20 responden 401.
2. `npm install helmet@^8` y agregar `app.use(helmet())` en `src/main.ts` justo después de `app.enableCors()`. Verificación: `GET /` sigue respondiendo 401 y ahora trae `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` y `Content-Security-Policy`, y **ya no trae `X-Powered-By`**. Verificación del problema esperado: `/docs` carga en blanco y la consola del navegador muestra errores de CSP. No seguir sin ver eso.
3. Agregar el `app.use('/docs', helmet({ ... }))` con las cinco directivas relajadas, dentro del `if` de `NODE_ENV` y antes del `SwaggerModule.setup`. Verificación: `/docs` vuelve a renderizar sin errores en consola, `/docs-json` sigue devolviendo el OpenAPI, y `curl -I /docs` frente a `curl -I /clientes` muestra dos CSP distintas —sólo la primera con `'unsafe-inline'` en `script-src`.
4. `npm install @nestjs/throttler@^6.5.0` e importar `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])` en `src/app.module.ts`, **sin registrar todavía ningún guard**. Verificación: la app arranca y los 25 endpoints responden exactamente igual que en el paso 1.
5. Crear `src/guards/app-throttler.guard.ts` con `AppThrottlerGuard`, sin registrarlo aún. Verificación: `npm run build` pasa.
6. Registrar `AppThrottlerGuard` como `APP_GUARD` en `providers`, **antes** de la entrada del `JwtAuthGuard`. Verificación del orden, que es el punto del paso: lanzar 101 peticiones sin token a `GET /`; las primeras 100 responden 401 y la 101 responde **429**. Si las 101 responden 401, el orden está mal y el throttler no está viendo nada.
7. Agregar `@Throttle({ default: { ttl: 60_000, limit: 5 } })` a `login` en `auth.controller.ts`, más la línea correspondiente en su `@ApiOperation`. Verificación en tres partes: (a) seis logins con contraseña mala y el mismo username dan 401, 401, 401, 401, 401 y **429**; (b) cambiar sólo el username y reintentar responde **401, no 429**, lo que prueba que la clave incluye el username; (c) esperar 60 segundos y volver a intentar con el username original responde 401 otra vez.
8. Verificación de que el resto no cambió: recorrer los 25 endpoints con el cliente HTTP de siempre y confirmar que devuelven los mismos campos, códigos y mensajes que en el paso 1.
9. Verificación en producción: `npm run build` y arrancar con `NODE_ENV=production`. `/docs` y `/docs-json` dan 404, sólo existe la CSP estricta, los límites siguen aplicando y los 25 endpoints responden igual.
10. `npm run lint` y `npm run build` sin errores nuevos.
11. Agregar a `.env.example` un comentario —sin variable nueva— avisando de que detrás de un proxy o balanceador hace falta `app.set('trust proxy', 1)` en `main.ts`, y que sin eso todas las peticiones llegan con la IP del proxy y comparten cubo.
12. Actualizar `CLAUDE.md`:
    - Sección nueva: los dos límites, que el global es **por endpoint y por IP**, que los contadores viven en memoria y que un reinicio o una segunda instancia los desarma.
    - Que el `AppThrottlerGuard` tiene que quedar **antes** del `JwtAuthGuard` en `providers`, y por qué.
    - Que la clave de `POST /auth/login` es IP + username y que se rompe en silencio si alguna vez se descomenta `setGlobalPrefix('api/v1')`.
    - Que `helmet` corre global con la CSP estricta y que `/docs` monta una relajada encima, y por qué el orden de las dos llamadas no se puede invertir.
    - Que el 429 es el cuerpo por defecto de Nest y es la única respuesta del proyecto que no tiene la forma `{ ok, msg }`.
    - Que `trust proxy` está sin decidir y es lo primero a revisar al desplegar.

---

## Acceptance criteria

- [ ] `helmet` está en `dependencies` de `package.json`, en el rango `^8`.
- [ ] `@nestjs/throttler` está en `dependencies`, en el rango `^6.5`.
- [ ] No se agregó ninguna otra dependencia: ni `ioredis`, ni `@nest-lab/throttler-storage-redis`, ni `express-rate-limit`.
- [ ] La app arranca sin errores, `npm run build` pasa y `npm run lint` no introduce errores nuevos.
- [ ] El log de Nest sigue mapeando **26** rutas, con el reparto `auth` 2, `catalogos` 3, `clientes` 4, `lotes` 8, `permisos` 1, `pesajes` 7, más `GET /`.
- [ ] `GET /` responde 401 y su respuesta trae `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Strict-Transport-Security` y `Content-Security-Policy`.
- [ ] Ninguna respuesta de la API trae `X-Powered-By`.
- [ ] Con `NODE_ENV` sin definir, `/docs` renderiza la UI de Swagger sin errores de CSP en la consola del navegador.
- [ ] La cabecera `Content-Security-Policy` de `/docs` **no** es la misma que la de `/clientes`: sólo la de `/docs` lleva `'unsafe-inline'` en `script-src`.
- [ ] Con `NODE_ENV=production`, `/docs` y `/docs-json` devuelven **404** y la única CSP servida es la estricta.
- [ ] Seis `POST /auth/login` seguidos con el mismo username y contraseña incorrecta desde la misma IP responden 401 cinco veces y **429** la sexta.
- [ ] Tras ese 429, un `POST /auth/login` con **otro** username desde la misma IP responde **401, no 429**.
- [ ] Pasados 60 segundos, el username bloqueado vuelve a responder 401.
- [ ] Un `POST /auth/login` con credenciales correctas sigue respondiendo **200** con `accessToken` y `user`, mientras la ventana no esté agotada.
- [ ] 101 peticiones sin token a `GET /` responden 401 las primeras 100 y **429** la 101, lo que prueba que el throttler corre antes que el `JwtAuthGuard`.
- [ ] `AppThrottlerGuard` aparece **antes** que `JwtAuthGuard` en el array de `providers` de `AppModule`.
- [ ] El cuerpo del 429 es el de Nest por defecto: no se creó ningún filtro de excepciones ni se cambió el mensaje.
- [ ] Existe `src/guards/app-throttler.guard.ts` y es el **único** archivo de código nuevo.
- [ ] `src/main.ts` conserva **las dos** registraciones del `ZodValidationPipe` y **las dos** del `JwtAuthGuard`, y `setGlobalPrefix` sigue comentado.
- [ ] `app.enableCors()` sigue igual, sin lista de orígenes.
- [ ] No se llamó a `app.set('trust proxy', ...)` y no se agregó ninguna variable de entorno.
- [ ] No se modificó ningún `*.service.ts`, `*.repository.ts` ni DTO, ni ningún controller salvo `auth.controller.ts`.
- [ ] `src/database/types/types.ts` no cambió y no se aplicó ningún DDL.
- [ ] `permisos` sigue con **14** filas y `catalogo_permisos` con **9**.
- [ ] Los 25 endpoints documentados devuelven los mismos campos, códigos y mensajes que antes de este spec.
- [ ] El documento de `/docs-json` sigue teniendo **25 operaciones** en 24 claves de `paths`.
- [ ] `README.md` **no** cambió.
- [ ] `.env.example` no ganó variables nuevas, sólo el comentario sobre `trust proxy`.
- [ ] `CLAUDE.md` documenta los dos límites, que el global es por endpoint, el orden de los guards, la clave IP + username, las dos capas de `helmet` y el pendiente de `trust proxy`.

---

## Decisions

- **Sí:** `helmet` y `@nestjs/throttler` en el mismo spec. Decisión explícita del usuario. Los dos son cableado de `main.ts` y `app.module.ts`, no tocan controllers ni repositorios, y separados serían dos specs de tres pasos.
- **Sí:** límite global de 100/min más 5/min en el login. Decisión explícita del usuario. El global frena el barrido de `GET /pesajes/:id`, que con ids secuenciales recorre toda la tabla; el del login es el motivo del spec.
- **Sí:** se acepta que el global sea **por endpoint y por IP**, no un total agregado. Es el comportamiento por defecto de la librería, que mete la clase y el handler en la clave de almacenamiento.
- **No:** sobrescribir `generateKey` para tener un único cubo por IP. Se descarta: es un override más, se aleja del comportamiento documentado de la librería y no cambia el caso que importa.
- **Sí:** la clave del login es **IP + username**. Decisión explícita del usuario. Sólo por IP, una planta entera detrás de un NAT se bloquea entre sí; sólo por username, un atacante prueba una contraseña contra miles de cuentas sin tope.
- **No:** clave sólo por IP, que es el default y no costaría código. Se descarta por lo anterior.
- **Sí:** contadores en la memoria del proceso. Decisión explícita del usuario. Cero infraestructura nueva. Consecuencia asumida: con dos instancias cada una cuenta por su lado y un reinicio borra los contadores, así que el límite real de login con N instancias es 5·N por minuto.
- **No:** Redis. Se descarta: agrega dependencia, variable de entorno y un servicio más que desplegar para un despliegue que hoy es de una sola instancia.
- **Sí:** CSP activa, con una excepción montada sólo sobre `/docs`. Decisión explícita del usuario. La API se queda con la CSP estricta de `helmet` y sólo la ruta de la UI afloja el `script-src`.
- **No:** `contentSecurityPolicy: false` global. Se descarta pese a ser lo más corto: apagaría la CSP también para las 26 rutas de la API, no sólo para `/docs`.
- **No:** `helmet` completo dejando `/docs` roto. Se descarta: la UI de Swagger vive justo en local y en staging, que es donde `NODE_ENV` no vale `production`.
- **Sí:** el `helmet` de `/docs` se registra después del global y antes del `SwaggerModule.setup`. No es estilo, es la única posición en la que funciona: antes del global, se lo pisa; después del `setup`, no llega a correr.
- **Sí:** el 429 se queda con el cuerpo por defecto de Nest. Decisión explícita del usuario. Consecuencia asumida: es la única respuesta del proyecto en inglés y sin la forma `{ ok, msg }`. Unificarla pide un filtro global de excepciones, que no existe y no tiene dueño.
- **Sí:** `AppThrottlerGuard` declarado antes del `JwtAuthGuard` en `providers`. Sin eso, cualquier petición sin token se va en 401 antes de contarse y el rate limiting no protege nada salvo a los ya autenticados. El paso 6 lo verifica con 101 peticiones, no con una lectura del código.
- **No:** tocar el doble registro del `JwtAuthGuard`. Se descarta, como en SPEC 22: sigue sin dueño desde SPEC 16 y arreglarlo aquí cambiaría el runtime de los 25 endpoints dentro de un spec de endurecimiento.
- **No:** `app.set('trust proxy', 1)` ni una variable `TRUST_PROXY`. Decisión explícita del usuario: el despliegue todavía no está definido. Consecuencia asumida: si el día del deploy hay un nginx o un Cloudflare delante, **todas** las peticiones llegan con la IP del proxy, comparten cubo y el primero que agote la ventana bloquea a todos. Queda anotado en `.env.example` y en `CLAUDE.md` como lo primero a revisar.
- **No:** restringir el CORS aquí. Decisión explícita del usuario: necesita los dominios reales del frontend y equivocarse rompe al cliente el día del deploy. Va en su propio spec.
- **No:** límite propio para `POST /auth/register`. Se descarta en este spec: ya exige token y su problema real no es el volumen sino que no valida rol, lo que se arregla con el `PermissionsGuard` y no con un contador.
- **No:** bloqueo persistente de cuenta, tabla de intentos fallidos o desbloqueo por administrador. Se descarta: exige DDL, un endpoint de desbloqueo y una decisión de producto sobre quién desbloquea. Es su propio spec si se necesita.
- **Sí:** el límite de login cuenta también los intentos correctos. Es lo que hace la librería sin código extra, y seis inicios de sesión en un minuto desde la misma IP para el mismo usuario no es un caso real.
- **Sí:** la descripción Swagger de `login` anuncia el límite. Es el único cambio de texto de la UI y evita que el frontend interprete un 429 como un error del servidor.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **Detrás de un proxy, todas las peticiones comparten la IP del proxy** y el límite global bloquea a todos los usuarios a la vez en cuanto uno agote la ventana. | Sin mitigar en código, por decisión. Queda en `.env.example`, en `CLAUDE.md` y en Decisions. La salida es una línea, `app.set('trust proxy', 1)`, el día que el despliegue se defina. |
| **La clave del login compara contra la cadena `'/auth/login'`.** Si algún día se descomenta `app.setGlobalPrefix('api/v1')`, el path pasa a `/api/v1/auth/login`, la comparación falla y el login vuelve a contarse sólo por IP **sin fallar ni avisar**. | Anotado en `CLAUDE.md` junto al `setGlobalPrefix` comentado. Es el mismo tipo de trampa que el `etapa_id = 2` hardcodeado de SPEC 19. |
| **Los contadores viven en memoria**: un reinicio del proceso los borra y un atacante recupera su ventana completa; con dos instancias el tope real se multiplica por el número de instancias. | Aceptado por decisión. Documentado en `CLAUDE.md`. Si el despliegue pasa a más de una instancia, Redis deja de ser opcional y es su propio spec. |
| **El `DatabaseMiddleware` corre antes que los guards**, así que cada petición rechazada con 429 ya abrió y destruyó su pool de MySQL. El rate limiting no protege la base de datos del coste de conexión. | Sin mitigar. Es consecuencia del pool por request, que es su propio trabajo pendiente. Anotado para que nadie asuma que el throttler cubre ese frente. |
| **Si el guard queda registrado después del `JwtAuthGuard`**, todo compila, todo arranca y el rate limiting no protege nada de lo que llegue sin token. El fallo es silencioso. | Mitigado con la verificación de 101 peticiones del paso 6 y con un criterio de aceptación propio. |
| **`helmet` global sobre una UI servida por express**: si en el futuro se monta cualquier otra ruta HTML, va a chocar con la CSP estricta igual que `/docs`. | El patrón queda establecido: un `helmet` acotado por path, después del global y antes del handler. Documentado en `CLAUDE.md`. |
| **Un frontend que dispare muchas lecturas seguidas al mismo endpoint puede tocar el techo de 100/min** y recibir un 429 que hoy no sabe interpretar. | Parcialmente mitigado: el límite es por endpoint, no agregado, lo que da bastante aire. El paso 8 recorre los 25 endpoints antes de dar el spec por cerrado. |
| **`Strict-Transport-Security` sobre HTTP plano.** Si el server se expone sin TLS, la cabecera no hace nada; si se expone con TLS y luego se quita, el navegador seguirá forzando HTTPS durante el `max-age`. | Aceptado: es el default de `helmet` y el destino es un despliegue con TLS. Anotado en `CLAUDE.md`. |

---

## What is **not** in this spec

- Darle al 429 la forma `{ ok, msg }`, y cualquier filtro global de excepciones.
- Redis o cualquier almacén compartido de contadores.
- `app.set('trust proxy', 1)` y la variable `TRUST_PROXY`.
- Restringir el CORS.
- Bloqueo persistente de cuenta, tabla de intentos fallidos, captcha y 2FA.
- Un límite propio para `POST /auth/register`.
- El `PermissionsGuard`, `@Permisos()` y el enforcement de permisos.
- Filtrar `usuarios.isActive` en el login, revocación de tokens y refresh token.
- Quitar el doble registro global del `ZodValidationPipe` o del `JwtAuthGuard`.
- Descomentar `app.setGlobalPrefix('api/v1')`.
- Proteger `/docs` con Basic Auth o cualquier credencial.
- Un `/health` público, logging estructurado y request-id.
- Cambiar el pool por request del `DatabaseMiddleware`.
- Validar las variables de entorno al arranque y quitar los secretos por defecto del JWT.
- Paginación de las listas.
- Tests de cualquier tipo.
- DDL, cambios a `src/database/types/types.ts` y filas nuevas en `catalogo_permisos` o `permisos`.

Cada uno de estos, si se necesita, va en su propio spec.
