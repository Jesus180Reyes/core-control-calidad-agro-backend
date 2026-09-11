# SPEC 22 — Documentación OpenAPI con Swagger

> **Status:** Approved
> **Depends on:** SPEC 01 a SPEC 21 (documenta la superficie que dejaron; no modifica ninguna)
> **Date:** 2026-09-11
> **Objective:** Montar Swagger en `/docs` y documentar los 25 endpoints del proyecto —entradas, salidas, códigos de error y falta de control de acceso— sin cambiar el comportamiento de ninguno.

---

## Why this spec exists

Hoy la documentación de la API son `specs/` y `CLAUDE.md`. Los dos están escritos para quien trabaja en el backend, no para quien lo consume. El frontend no tiene forma de saber qué campos devuelve `GET /pesajes/byLote/:loteId` sin leer un repositorio de Kysely, ni qué mensaje exacto trae el 400 de un lote cerrado.

Este spec es documentación y nada más. **No hay DDL, no hay endpoint nuevo, no hay campo nuevo y ninguna respuesta cambia un solo byte.**

Seis cosas conviene tener claras antes de leer el resto.

**La primera: son 25 endpoints, no 23.** El conteo verificado sobre los decoradores de ruta es `auth` 2, `catalogos` 3, `clientes` 4, `lotes` 8, `permisos` 1 y `pesajes` 7. Hay además una ruta 26, `GET /` en `src/app.controller.ts`, que ningún spec menciona y que este spec **excluye** de la UI sin borrarla.

**La segunda: `patchNestJsSwagger()` ya no existe.** Es la función que aparece en casi todos los tutoriales de `nestjs-zod`, y fue eliminada en la v5. El proyecto tiene `nestjs-zod@5.4.0`, donde `createZodDto` define `_OPENAPI_METADATA_FACTORY` por su cuenta: los 11 DTOs de entrada que ya existen se documentan solos en cuanto `@nestjs/swagger` esté instalado, incluidos los query params de SPEC 16, 17 y 18, que se expanden uno por uno desde su schema Zod. Lo único que hace falta es pasar el documento por `cleanupOpenApiDoc()` antes del `SwaggerModule.setup`.

**La tercera: las respuestas no existen como tipo en ninguna parte.** Los controllers arman `{ ok, msg, <payload> }` a mano con un objeto literal y el payload viene tipado sólo por la inferencia de Kysely. Para documentarlas hay que escribir schemas que hoy no existen, y esos schemas **no se aplican en runtime**: son para la UI, no para serializar. La consecuencia asumida es que pueden mentir si alguien cambia un controller y no el schema.

**La cuarta: la UI de Swagger no pasa por el `JwtAuthGuard` global.** No es una ruta de Nest sino middleware de express, así que el guard no la ve. Por eso se monta condicionada a `NODE_ENV !== 'production'`.

**La quinta: hay dos formas de error, no una.** Las excepciones de Nest (`BadRequestException`, `NotFoundException`, `UnauthorizedException`, `ForbiddenException`, `ConflictException`) devuelven `{ message, error, statusCode }`. La `ZodValidationException` de `nestjs-zod` devuelve `{ statusCode, message: 'Validation failed', errors }`, con el array de issues de Zod. Documentar una sola sería documentar mal.

**La sexta: la doc dice la verdad.** Las 14 rutas que se saltan `validateVinculoOperador` a propósito y la ausencia total de enforcement de permisos aparecen en la descripción de cada endpoint afectado. El frontend lleva 21 specs asumiendo filtros que no existen.

---

## Scope

**In:**

- Instalar `@nestjs/swagger` (peer opcional de `nestjs-zod@5`, rango `^11.0.0`) como dependencia de producción.
- Bloque de Swagger en `src/main.ts`, montado **solo si `process.env.NODE_ENV !== 'production'`**, con la UI en `/docs` y el JSON en `/docs-json`.
- `DocumentBuilder` con título, descripción, versión, `addBearerAuth` y los seis tags en minúscula: `auth`, `catalogos`, `clientes`, `lotes`, `permisos`, `pesajes`.
- `cleanupOpenApiDoc()` de `nestjs-zod` aplicado al documento antes del `setup`.
- `swaggerOptions: { persistAuthorization: true }` para que el token sobreviva al refresco de la página.
- `@ApiTags` y `@ApiBearerAuth` a nivel de clase en los seis controllers, **salvo** en los dos endpoints `@Public()` de `auth`.
- `@ApiOperation` con `summary` y `description` en los 25 endpoints.
- `@ApiParam` en los nueve `:id` y en los cuatro `:clienteId` / `:loteId`.
- Schemas Zod de respuesta nuevos, uno por forma de respuesta, envueltos en `createZodDto`, **usados sólo para documentar**: siete archivos nuevos, 22 clases.
- Dos schemas de error compartidos en `src/swagger/error-response.dto.ts`: `ErrorResponseDto` y `ValidationErrorResponseDto`.
- `@ApiResponse` por endpoint con los códigos que realmente puede devolver y **el texto exacto** del mensaje de cada uno.
- Línea explícita en la `description` de las 14 rutas que se saltan `validateVinculoOperador`, y de las que aceptan query params que hoy se ignoran.
- `@ApiExcludeController()` en `src/app.controller.ts`.
- `.env.example` nuevo, con las seis variables actuales más `NODE_ENV`.
- Actualizar `CLAUDE.md` con la sección de Swagger, la variable nueva y los conteos verificados.

**Out of scope (for future specs):**

- Cambiar el comportamiento de **cualquier** endpoint: ni campos, ni filtros, ni códigos, ni mensajes.
- Quitar el doble registro global del `ZodValidationPipe` o del `JwtAuthGuard` en `main.ts`.
- Descomentar `app.setGlobalPrefix('api/v1')`.
- Borrar `src/app.controller.ts`, `src/app.service.ts` o la ruta `GET /`.
- Serializar las respuestas con `ZodSerializerDto` o `ZodSerializerInterceptor`.
- Un filtro de excepciones global que unifique la forma de los errores.
- Proteger `/docs` con Basic Auth o cualquier otra credencial.
- Versionado de la API (`/v1`, `@ApiVersion`) y publicación del JSON a un portal externo.
- Generar un cliente TypeScript a partir del OpenAPI.
- Actualizar `README.md`, que sigue siendo el boilerplate de NestJS.
- Tests de ningún tipo: el proyecto sigue sin un solo `*.spec.ts`.
- Sembrar filas en `catalogo_permisos` o en `permisos`.
- DDL de cualquier tipo y cambios a `src/database/types/types.ts`.

---

## Data model

**Este spec no introduce estructuras de datos en la base.** No hay DDL, no hay tabla nueva, no hay columna nueva y `src/database/types/types.ts` no cambia. Lo que introduce son **schemas de documentación**, que viven sólo en TypeScript y nunca tocan MySQL.

### Archivos nuevos

| Archivo | Contenido |
| --- | --- |
| `src/swagger/error-response.dto.ts` | `ErrorResponseDto` y `ValidationErrorResponseDto` |
| `src/modules/auth/dto/responses.dto.ts` | 2 clases |
| `src/modules/clientes/dto/responses.dto.ts` | 3 clases |
| `src/modules/lotes/dto/responses.dto.ts` | 6 clases |
| `src/modules/pesajes/dto/responses.dto.ts` | 7 clases |
| `src/modules/permisos/dto/responses.dto.ts` | 1 clase (carpeta `dto/` nueva) |
| `src/modules/catalogos/dto/responses.dto.ts` | 3 clases (carpeta `dto/` nueva) |
| `.env.example` | Las seis variables actuales más `NODE_ENV` |

`src/swagger/` es carpeta nueva a nivel de `src`, al lado de `decorators/`, `guards/` y `strategy/`. **No se crea `src/common/`**: el proyecto no tiene esa convención y no se inventa aquí.

### Archivos modificados

`src/main.ts`, `src/app.controller.ts`, los seis `*.controller.ts` de `src/modules/`, `package.json`, `package-lock.json` y `CLAUDE.md`. **Ningún `*.service.ts`, ningún `*.repository.ts`, ningún `*.module.ts` y ningún DTO de entrada.**

### Las dos formas de error

Son distintas y las dos son reales. Verificadas contra `node_modules/nestjs-zod/dist/index.cjs` y contra `HttpException` de Nest.

```ts
// src/swagger/error-response.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// BadRequestException, NotFoundException, UnauthorizedException,
// ForbiddenException, ConflictException
export class ErrorResponseDto extends createZodDto(
  z.object({
    message: z.string(),
    error: z.string(),
    statusCode: z.number(),
  }),
) {}

// ZodValidationException (el pipe global de nestjs-zod)
export class ValidationErrorResponseDto extends createZodDto(
  z.object({
    statusCode: z.literal(400),
    message: z.literal('Validation failed'),
    errors: z.array(z.unknown()),
  }),
) {}
```

Un `POST /pesajes` con el body mal formado devuelve la segunda. Un `POST /pesajes` con el body correcto pero un lote cerrado devuelve la primera. Los dos son 400 en la misma ruta, y la UI tiene que mostrar las dos.

### Forma de los schemas de respuesta

Sin helper y sin abstracción: **cada schema declara `ok` y `msg` completos**. El envoltorio se escribe 22 veces a propósito, para que cada respuesta se lea entera en un solo lugar.

```ts
// src/modules/pesajes/dto/responses.dto.ts (extracto)
const pesajeDetalleSchema = z.object({
  id: z.union([z.string(), z.number()]),
  lote_id: z.number().nullable(),
  nombre_lote: z.string().nullable(),
  // ... los 21 campos de SPEC 21
  peso_neto: z.union([z.string(), z.number()]),
  fuera_de_rango: z.boolean(),
  aprobado: z.boolean().nullable(),
});

export class PesajeResponseDto extends createZodDto(
  z.object({
    ok: z.boolean(),
    msg: z.literal('Pesaje obtenido correctamente'),
    pesaje: pesajeDetalleSchema,
  }),
) {}
```

Dos reglas de tipado que no son opcionales, porque si se ignoran la doc miente:

- **Los `peso_*` y cualquier `DECIMAL` se declaran `z.union([z.string(), z.number()])`.** El driver de MySQL los devuelve como string (`"115.00"`) y la doc debe decirlo.
- **`pesajes.id` es `BIGINT`** y se declara igual, `z.union([z.string(), z.number()])`, porque el proyecto no lo pasa por `Number()` en las lecturas.

`fuera_de_rango` sí es `z.boolean()` y `aprobado` sí es `z.boolean().nullable()`: los dos repositorios de lectura los normalizan antes de devolverlos.

### Las 22 clases de respuesta

| Módulo | Clase | Endpoints que documenta |
| --- | --- | --- |
| `auth` | `LoginResponseDto` | `POST /auth/login` |
| `auth` | `RegisterResponseDto` | `POST /auth/register` |
| `clientes` | `ClientesResponseDto` | `GET /clientes` y `GET /clientes/all` |
| `clientes` | `CrearClienteResponseDto` | `POST /clientes` |
| `clientes` | `RechazarClienteResponseDto` | `PATCH /clientes/:id/rechazar` |
| `lotes` | `LotesResponseDto` | los tres `GET /lotes/cliente/:clienteId*` |
| `lotes` | `CrearLoteResponseDto` | `POST /lotes` |
| `lotes` | `RechazarLoteResponseDto` | `PATCH /lotes/:id/rechazar` |
| `lotes` | `RechazarLoteByApproverResponseDto` | `PATCH /lotes/:id/rechazar/byApprover` |
| `lotes` | `AprobarLoteResponseDto` | `PATCH /lotes/:id/aprobar` |
| `lotes` | `FinalizarLoteResponseDto` | `PATCH /lotes/:id/finalizar/byApprover` |
| `pesajes` | `HistorialPesajesResponseDto` | `GET /pesajes/historial` |
| `pesajes` | `PesajesLoteResponseDto` | `GET /pesajes/byLote/:loteId` |
| `pesajes` | `PesajeResponseDto` | `GET /pesajes/:id` |
| `pesajes` | `CrearPesajeResponseDto` | `POST /pesajes` |
| `pesajes` | `RechazarPesajeResponseDto` | `PATCH /pesajes/:id/rechazar` |
| `pesajes` | `RechazarPesajeByApproverResponseDto` | `PATCH /pesajes/:id/rechazar/byApprover` |
| `pesajes` | `AprobarPesajeByApproverResponseDto` | `PATCH /pesajes/:id/aprobar/byApprover` |
| `permisos` | `PermisosMeResponseDto` | `GET /permisos/me` |
| `catalogos` | `ProductosResponseDto` | `GET /catalogos/productos` |
| `catalogos` | `UsuariosResponseDto` | `GET /catalogos/usuarios` |
| `catalogos` | `UnidadesMedidaResponseDto` | `GET /catalogos/unidades-medida` |

**22 clases para 25 endpoints.** Sólo se comparte clase donde la respuesta es idéntica campo por campo **y** con el mismo `msg`: los dos `GET` de `clientes` y los tres `GET` de `lotes/cliente`. Los cuatro `PATCH` de `lotes` devuelven todos `{ ok, msg }` pero cada uno con su `msg` propio, así que cada uno tiene su clase.

### Los payloads reales, verificados contra el código

Lo que hay que declarar en cada schema, leído de los repositorios y no de `CLAUDE.md`:

- **`POST /auth/login`** → `{ ok, msg, user, accessToken }`. `user` es `{ complete_name, rol }` — el repositorio desestructura fuera `password`, `id`, `cedula` y `username`. **`accessToken` va al primer nivel, no dentro de `user`.**
- **`POST /auth/register`** → `{ ok, msg, user }` donde `user` es **un número**, el `insertId`. No es un objeto.
- **`GET /clientes` y `GET /clientes/all`** → `clientes`, array de seis campos: `id`, `nombre`, `producto`, `codigo_exportacion`, `telefono`, `direccion_planta`. No incluye `rtn`.
- **`POST /clientes`** → `{ ok, msg, cliente }` donde `cliente` es **un número**, el id creado.
- **`POST /lotes`** → `{ ok, msg }` y **nada más**: el controller descarta el id que devuelve el service. Es el único `POST` del proyecto que no devuelve nada de lo que creó.
- **`GET /lotes/cliente/:clienteId*`** (los tres) → `lotes`, array de diez campos: `id`, `nombre_lote`, `variedad_o_talla`, `producto`, `unidad_medida`, `peso_minimo`, `peso_ideal`, `peso_maximo`, `estado`, `etapa`.
- **`POST /pesajes`** → `{ ok, msg, pesaje }` donde `pesaje` es `{ id, peso_neto, fuera_de_rango }`, tres campos.
- **`GET /pesajes/byLote/:loteId` y `GET /pesajes/:id`** → los 21 campos de SPEC 21.
- **`GET /pesajes/historial`** → los 14 campos de SPEC 15.
- **`GET /permisos/me`** → `permisos`, un `string[]` plano.
- **`GET /catalogos/*`** → `data`, array de `{ id, nombre }`. **La clave es `data`, no un nombre de recurso** (SPEC 09).
- **Los ocho `PATCH`** → `{ ok, msg }`, sin payload.

### Los errores reales, por endpoint

El texto exacto, tomado de las excepciones del código:

| Código | Dónde | Mensaje |
| --- | --- | --- |
| 400 | los 11 DTOs de entrada | `Validation failed` + `errors` de Zod |
| 400 | validadores de dominio | `El pesaje con id 'X' no existe`, `Este pesaje no esta activo`, `El RTN 'X' ya esta registrado`, etc. |
| 400 | `ParseIntPipe` | el error del pipe, en los 13 params numéricos |
| 401 | `POST /auth/login` | `Usuario o contraseña incorrectos` si el usuario no existe, `Usuario o contraseña incorrectas` si la clave falla — **las dos variantes existen en el código y se documentan las dos** |
| 401 | los 23 endpoints no `@Public()` | el del `JwtAuthGuard` |
| 403 | `GET /lotes/cliente/:clienteId`, `POST /lotes`, `POST /pesajes` | `No tiene acceso al cliente con id 'X'` — **son los únicos tres endpoints que pueden devolver 403** |
| 404 | `GET /permisos/me` | `Usuario no encontrado` |
| 404 | `GET /pesajes/:id` | `El pesaje con id 'X' no existe` |
| 409 | `POST /auth/register` | `El usuario con 'X' ya existe registrado` — **el único 409 del proyecto**, y no está documentado en `CLAUDE.md` |

### Las advertencias que van en la `description`

Texto que aparece en la UI, no sólo en `specs/`:

- **Las 14 rutas que se saltan `validateVinculoOperador`** llevan: `No valida el vínculo cliente_operador: cualquier usuario autenticado puede llamarla.`
- **`GET /lotes/cliente/:clienteId/all`**, que nunca lo tuvo y ningún spec lo decidió, lleva la misma línea.
- **`GET /clientes`** lleva: `No acepta query params. Un query string se ignora, no se rechaza.` Es verdad verificable: el handler no tiene `@Query()`.
- **`GET /clientes/all`** lleva la divergencia de SPEC 17: `Sus cuatro filtros sí devuelven 400 ante un valor inválido, a diferencia de los de pesajes y lotes.`
- **Los filtros de `pesajes`** llevan: `Un valor inválido se ignora, nunca devuelve 400.` y `fuera_de_rango acepta 'true'/'false'; '1'/'0' se ignoran.`
- **`GET /permisos/me`** lleva: `Informativo. Ningún endpoint valida permisos hoy.`
- **Los cuatro endpoints `byApprover` y `PATCH /lotes/:id/finalizar/byApprover`** llevan: `Opera sobre lotes cerrados en etapa CLIENTE_FINAL, al revés que el resto de escrituras.`

### El bloque de `main.ts`

Va después de `app.enableCors()` y antes de `app.listen`. Es lo único que se agrega al archivo.

```ts
if (process.env.NODE_ENV !== 'production') {
  const config = new DocumentBuilder()
    .setTitle('Core Control Calidad Agro API')
    .setDescription('...')
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addTag('auth')
    // ... los otros cinco
    .build();

  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: { persistAuthorization: true },
  });
}
```

`cleanupOpenApiDoc` se importa de `nestjs-zod`, no de `@nestjs/swagger`. **`patchNestJsSwagger` no existe en la v5 y no se debe intentar importar**: el build falla.

---

## Implementation plan

1. Verificar el punto de partida: `npm run start:dev`, anotar del log de rutas de Nest las **26** rutas mapeadas y confirmar el reparto `auth` 2, `catalogos` 3, `clientes` 4, `lotes` 8, `permisos` 1, `pesajes` 7, más `GET /`. Guardar la lista: es la referencia contra la que se compara la UI al final.
2. `npm install @nestjs/swagger` y confirmar que resuelve a `^11`, que es el rango que `nestjs-zod@5.4.0` declara como peer opcional. Confirmar que la app sigue arrancando sin cambios de código.
3. Agregar el bloque de Swagger a `src/main.ts`: `DocumentBuilder` con título, descripción, versión, `addBearerAuth` y los seis `addTag`; `cleanupOpenApiDoc(SwaggerModule.createDocument(...))`; `SwaggerModule.setup('docs', ...)` con `jsonDocumentUrl: 'docs-json'` y `persistAuthorization: true`; todo dentro del `if (process.env.NODE_ENV !== 'production')`. Verificación: `/docs` carga y ya lista las 26 rutas con sus DTOs de entrada, **sin haber tocado un solo controller**.
4. Agregar `@ApiExcludeController()` a `src/app.controller.ts`. Verificación: la UI baja a 25 rutas y `GET /` sigue respondiendo igual por HTTP.
5. Crear `src/swagger/error-response.dto.ts` con `ErrorResponseDto` y `ValidationErrorResponseDto`. Nada lo usa todavía.
6. Agregar `@ApiTags('auth')` a `AuthController` y `@ApiOperation` + `@ApiResponse` a sus dos endpoints, con `LoginResponseDto` y `RegisterResponseDto` en un `src/modules/auth/dto/responses.dto.ts` nuevo. **Sin `@ApiBearerAuth`**: los dos son `@Public()`. Documentar el 401 con sus dos mensajes y el 409. Verificación: en la UI los dos endpoints de `auth` aparecen sin candado.
7. Agregar `@ApiTags('catalogos')` y `@ApiBearerAuth()` a `CatalogosController`, crear `src/modules/catalogos/dto/responses.dto.ts` con las tres clases y decorar los tres endpoints. Anotar en la descripción que la clave del payload es `data` y que `GET /catalogos/usuarios` devuelve **todos** los usuarios activos, `ADMIN` incluidos.
8. Agregar `@ApiTags('permisos')` y `@ApiBearerAuth()` a `PermisosController`, crear `src/modules/permisos/dto/responses.dto.ts` con `PermisosMeResponseDto` y decorar `GET /permisos/me` con su 200, su 404 y la nota de que nada se enforcea.
9. Agregar `@ApiTags('clientes')` y `@ApiBearerAuth()` a `ClientesController`, crear `src/modules/clientes/dto/responses.dto.ts` con sus tres clases y decorar los cuatro endpoints. Incluir la nota de que `GET /clientes` ignora los query params y la de que los cuatro filtros de `GET /clientes/all` **sí** devuelven 400.
10. Agregar `@ApiTags('lotes')` y `@ApiBearerAuth()` a `LotesController`, crear `src/modules/lotes/dto/responses.dto.ts` con sus seis clases y decorar los ocho endpoints. Incluir el 403 en los dos que pueden darlo, la nota de `cliente_operador` en los seis que se lo saltan y la nota de precondición invertida en los dos `byApprover` y en `finalizar`.
11. Agregar `@ApiTags('pesajes')` y `@ApiBearerAuth()` a `PesajesController`, crear `src/modules/pesajes/dto/responses.dto.ts` con sus siete clases y decorar los siete endpoints. Incluir el 403 de `POST /pesajes`, el 404 de `GET /pesajes/:id`, el 400 con `motivo_rechazo` del pesaje anulado, la nota de que `historial` no acepta `?usuario_id` por diseño y la de `true`/`false` en `fuera_de_rango`. **No reordenar los métodos de la clase**: `@Get(':id')` sigue siendo el último, y eso es contrato desde SPEC 21.
12. Verificación de los DTOs de entrada: en la UI, `POST /pesajes` muestra el body con sus campos y sus reglas; `GET /pesajes/byLote/:loteId` muestra sus **seis** query params; `GET /pesajes/historial` muestra sus **siete** y **no** muestra `usuario_id`; `GET /clientes/all` muestra sus **cuatro**; `GET /clientes` no muestra ninguno.
13. Verificación del bearer: pegar un token real en el botón *Authorize*, ejecutar `GET /permisos/me` desde la UI y recibir 200. Refrescar la página y confirmar que el token sigue cargado (`persistAuthorization`).
14. Verificación de que nada cambió en runtime: recorrer los 25 endpoints con el cliente HTTP de siempre —no desde la UI— y confirmar que devuelven **exactamente** los mismos campos, códigos y mensajes que antes del paso 2. Comparar contra las respuestas guardadas en el paso 1.
15. Verificación de las dos formas de error: `POST /pesajes` con el body vacío devuelve `Validation failed` con `errors`; `POST /pesajes` con un lote cerrado devuelve `{ message, error, statusCode }`. Confirmar que la UI documenta las dos para esa ruta.
16. Verificación del apagado: arrancar con `NODE_ENV=production npm run start:prod` (tras `npm run build`) y confirmar que `/docs` y `/docs-json` devuelven **404** y que los 25 endpoints siguen respondiendo normal. Volver a arrancar sin la variable y confirmar que `/docs` vuelve.
17. Verificación del JSON: `GET /docs-json` devuelve un OpenAPI válido con `paths` de **25** entradas, sin `GET /`, y con los seis tags.
18. Crear `.env.example` con `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `PORT` y `NODE_ENV`, todos sin valores reales. **No se toca el `.env`**, que no está versionado.
19. `npm run lint` y `npm run build` sin errores.
20. Actualizar `CLAUDE.md`:
    - Sección nueva de Swagger: `/docs` y `/docs-json`, la condición `NODE_ENV !== 'production'`, que la UI **no** pasa por el `JwtAuthGuard`, y que `patchNestJsSwagger` no existe en `nestjs-zod@5`.
    - Agregar `NODE_ENV` a la lista de variables de entorno y mencionar `.env.example`.
    - Anotar la convención nueva: **al agregar un endpoint hay que agregar su schema de respuesta en `responses.dto.ts` y sus decoradores**, porque nada lo valida y la doc se queda muda sin avisar.
    - Corregir los conteos con los verificados: **26** rutas mapeadas, **25** documentadas, y el reparto por módulo (`lotes` son **ocho**, no siete; `pesajes` son **siete**, no seis).
    - Documentar la ruta `GET /` de `AppController`, que ningún spec menciona, y que este spec la excluye de la UI sin borrarla.
    - Documentar el **409** de `POST /auth/register`, que no está en la tabla de endpoints, y los dos mensajes distintos del 401 de `POST /auth/login`.
    - Anotar que `POST /lotes` responde `{ ok, msg }` **sin payload**, a diferencia de los otros dos `POST`.
    - Anotar que los schemas de respuesta **no se aplican en runtime** y pueden desincronizarse.

---

## Acceptance criteria

- [ ] `@nestjs/swagger` está en `dependencies` de `package.json`, en el rango `^11`.
- [ ] No se agregó ninguna otra dependencia: ni `swagger-ui-express`, ni `express-basic-auth`, ni `zod-to-openapi`.
- [ ] La app arranca sin errores y `npm run build` y `npm run lint` pasan.
- [ ] `GET /docs` carga la UI de Swagger cuando `NODE_ENV` no está definido.
- [ ] `GET /docs-json` devuelve un documento OpenAPI válido.
- [ ] Con `NODE_ENV=production`, `/docs` y `/docs-json` devuelven **404** y los 25 endpoints siguen respondiendo igual.
- [ ] El documento tiene exactamente **25** entradas en `paths`.
- [ ] `GET /` **no** aparece en la UI, pero sigue respondiendo por HTTP: `AppController` lleva `@ApiExcludeController()` y no se borró.
- [ ] Hay exactamente seis tags, en minúscula: `auth`, `catalogos`, `clientes`, `lotes`, `permisos`, `pesajes`.
- [ ] El reparto por tag es `auth` 2, `catalogos` 3, `clientes` 4, `lotes` 8, `permisos` 1, `pesajes` 7.
- [ ] Los 23 endpoints protegidos muestran candado; `POST /auth/login` y `POST /auth/register` **no**.
- [ ] Pegar un token en *Authorize* y ejecutar `GET /permisos/me` desde la UI devuelve 200.
- [ ] Tras refrescar la página, el token sigue cargado: `persistAuthorization` está activo.
- [ ] `POST /pesajes` muestra su body con todos los campos de `CreatePesajeDto`.
- [ ] `GET /pesajes/byLote/:loteId` muestra sus **seis** query params.
- [ ] `GET /pesajes/historial` muestra sus **siete** query params y **no** muestra `usuario_id`.
- [ ] `GET /clientes/all` muestra sus **cuatro** query params.
- [ ] `GET /clientes` no muestra ningún query param, y su descripción dice que un query string se ignora.
- [ ] Los 25 endpoints tienen `@ApiOperation` con `summary` no vacío.
- [ ] Los 25 endpoints declaran su respuesta de éxito con una clase de `responses.dto.ts`, y el ejemplo que muestra la UI coincide campo por campo con lo que devuelve la API.
- [ ] `GET /pesajes/:id` y `GET /pesajes/byLote/:loteId` documentan los mismos **21** campos.
- [ ] `GET /pesajes/historial` documenta **14** campos.
- [ ] Los tres `GET /lotes/cliente/:clienteId*` documentan los mismos **10** campos.
- [ ] `GET /clientes` y `GET /clientes/all` documentan los mismos **6** campos, sin `rtn`.
- [ ] `GET /catalogos/*` documentan la clave del payload como **`data`**, no como un nombre de recurso.
- [ ] `POST /auth/register` documenta `user` como **número**, no como objeto.
- [ ] `POST /clientes` documenta `cliente` como **número**.
- [ ] `POST /lotes` documenta la respuesta como `{ ok, msg }` **sin payload**.
- [ ] `POST /auth/login` documenta `accessToken` en el **primer nivel**, no dentro de `user`.
- [ ] Los ocho `PATCH` documentan `{ ok, msg }` sin payload.
- [ ] Los campos `DECIMAL` (`peso_bruto`, `tara`, `peso_neto`, `peso_minimo`, `peso_ideal`, `peso_maximo`) se documentan como `string | number`.
- [ ] `pesajes.id` se documenta como `string | number`.
- [ ] `fuera_de_rango` se documenta como booleano y `aprobado` como booleano nullable de tres estados.
- [ ] Existen las dos clases de error y las dos se usan: `ValidationErrorResponseDto` en los 11 endpoints con DTO de entrada, `ErrorResponseDto` en el resto de códigos.
- [ ] Cada endpoint declara **sólo** los códigos que realmente puede devolver.
- [ ] `GET /lotes/cliente/:clienteId`, `POST /lotes` y `POST /pesajes` son los **únicos tres** que documentan un **403**, con el mensaje `No tiene acceso al cliente con id 'X'`.
- [ ] `GET /pesajes/:id` documenta su **404** y su **400** con `motivo_rechazo`, separados.
- [ ] `GET /permisos/me` documenta su **404** con `Usuario no encontrado`.
- [ ] `POST /auth/register` documenta su **409** con `El usuario con 'X' ya existe registrado`.
- [ ] `POST /auth/login` documenta sus **dos** mensajes de 401.
- [ ] Las 14 rutas que se saltan `validateVinculoOperador`, más `GET /lotes/cliente/:clienteId/all`, lo dicen en su `description`.
- [ ] `GET /permisos/me` dice en su `description` que ningún endpoint valida permisos.
- [ ] Los nueve `:id` y los cuatro `:clienteId` / `:loteId` tienen `@ApiParam`.
- [ ] **Ninguna respuesta de la API cambió**: los 25 endpoints devuelven los mismos campos, códigos y mensajes que antes de este spec, verificados fuera de la UI.
- [ ] No se registró `ZodSerializerInterceptor` ni se usó `@ZodSerializerDto` en ningún endpoint.
- [ ] `src/main.ts` conserva **las dos** registraciones del `ZodValidationPipe` y **las dos** del `JwtAuthGuard`, y `setGlobalPrefix` sigue comentado.
- [ ] No se modificó ningún `*.service.ts`, `*.repository.ts`, `*.module.ts` ni ningún DTO de entrada.
- [ ] `src/database/types/types.ts` no cambió y no se aplicó ningún DDL.
- [ ] `@Get(':id')` sigue siendo el **último** método de `PesajesController`, y `@Get('all')` sigue antes que `@Get()` en `ClientesController`.
- [ ] `GET /pesajes/historial` y `GET /pesajes/byLote/12` siguen respondiendo 200, no un 400 de `ParseIntPipe`.
- [ ] `permisos` sigue con **14** filas y `catalogo_permisos` con **9**.
- [ ] Existe `.env.example` con las siete variables y sin un solo valor real.
- [ ] `README.md` **no** cambió.
- [ ] `CLAUDE.md` documenta `/docs`, la condición de `NODE_ENV`, la ruta `GET /`, el 409 de `register`, los conteos corregidos y la convención de mantener los schemas de respuesta al agregar endpoints.

---

## Decisions

- **Sí:** `@nestjs/swagger` ^11 como dependencia de producción. Es el peer que `nestjs-zod@5.4.0` declara y el único camino soportado. Va en `dependencies` y no en `devDependencies` porque `main.ts` lo importa siempre, aunque el bloque sólo se ejecute fuera de producción.
- **No:** `patchNestJsSwagger()`. **No existe en `nestjs-zod@5`** — verificado contra los tipos de `node_modules`. Es lo que dicen casi todos los tutoriales y el build falla si se intenta.
- **Sí:** `cleanupOpenApiDoc()` sobre el documento antes del `setup`. Es el reemplazo oficial en la v5 y lo que hace que los schemas Zod salgan limpios.
- **Sí:** los DTOs de entrada se documentan solos. `createZodDto` define `_OPENAPI_METADATA_FACTORY`, así que los 11 DTOs actuales —incluidos los tres de filtros— se expanden sin escribir un `@ApiProperty`. Es la razón principal de que este spec cueste poco en la mitad de entrada.
- **Sí:** los 25 endpoints en este spec, no un módulo piloto. Decisión explícita del usuario. Un Swagger a medias documenta mal lo que no cubre y nadie sabe cuál mitad es cuál.
- **No:** un spec por módulo. Se descarta: la infraestructura de `main.ts` es común y partirla dejaría cinco módulos con documentación fantasma durante semanas.
- **Sí:** `/docs` y `/docs-json`. Decisión explícita del usuario. `api` queda libre por si algún día se descomenta `setGlobalPrefix('api/v1')`.
- **Sí:** montar sólo si `process.env.NODE_ENV !== 'production'`. Decisión explícita del usuario. En local y en staging funciona sin configurar nada.
- **No:** `NODE_ENV === 'development'`, que fallaría del lado seguro. Se descarta por decisión explícita: obligaría a agregar la variable para que la doc aparezca en local. Consecuencia asumida: si el deploy de producción no define `NODE_ENV`, la UI queda expuesta. Va a Risks y a `.env.example`.
- **No:** Basic Auth sobre `/docs`. Se descarta: agrega una dependencia y dos variables para un problema que la condición de `NODE_ENV` ya cubre en el caso normal.
- **Sí:** schemas Zod de respuesta con `createZodDto`. Decisión explícita del usuario. El proyecto ya es 100% Zod y meter clases con `@ApiProperty` introduciría un segundo estilo de declaración de tipos al lado del primero.
- **No:** clases con `@ApiProperty`. Se descarta por lo anterior, aunque sea el camino documentado por NestJS.
- **Sí:** los schemas de respuesta **sólo documentan**. Decisión explícita del usuario. No se registra `ZodSerializerInterceptor` y ninguna respuesta pasa por ellos.
- **No:** serializar con `ZodSerializerDto`. Se descarta: garantizaría que la doc no miente, pero un schema mal escrito rompería un endpoint en producción —y hay dos trampas listas para eso, los `DECIMAL` que llegan como string y el `BIGINT` de `pesajes.id`. Un spec de documentación no debe poder tumbar la API.
- **Sí:** sin helper. Cada schema declara `ok` y `msg` completos, 22 veces. Decisión explícita del usuario: cada respuesta se lee entera en un solo lugar, sin saltar a una función genérica.
- **Sí:** un archivo `responses.dto.ts` por módulo, dentro de su `dto/`. No lo fijó la pregunta; se elige por coherencia con la convención de módulos del proyecto, y para que `catalogos` y `permisos` ganen la carpeta `dto/` que les falta.
- **No:** un archivo por endpoint (~20 archivos de pocas líneas). Se descarta: mucha ceremonia para schemas de tres campos.
- **Sí:** se comparte clase sólo donde la respuesta es idéntica **y** el `msg` también: los dos `GET` de `clientes` y los tres de `lotes/cliente`. Los cuatro `PATCH` de `lotes` tienen cada uno la suya porque cada uno tiene su `msg`.
- **Sí:** schema de error compartido, con los mensajes reales. Decisión explícita del usuario. Es donde la doc aporta más: esos textos hoy sólo viven en `specs/` y en el código.
- **Sí:** **dos** clases de error, no una. `ZodValidationException` devuelve `{ statusCode, message: 'Validation failed', errors }` y las excepciones de Nest devuelven `{ message, error, statusCode }`. Verificado en el dist de `nestjs-zod`. Documentar una sola sería documentar mal el 400 más frecuente.
- **No:** un filtro de excepciones global que unifique las dos formas. Se descarta: cambiaría la respuesta de error de los 25 endpoints, y este spec no cambia runtime. Va en su propio spec si alguna vez molesta.
- **Sí:** la doc dice la verdad sobre el control de acceso. Decisión explícita del usuario. Las 14 rutas abiertas y la ausencia de enforcement de permisos aparecen endpoint por endpoint.
- **No:** callar las rutas abiertas o resumirlas en un párrafo general. Se descarta: el frontend lleva 21 specs asumiendo un filtro por `cliente_operador` que la mitad de las rutas no aplica, y una nota global no se lee al mirar un endpoint concreto.
- **Sí:** tags en minúscula, uno por módulo. Decisión explícita del usuario: son los nombres de las carpetas y de los prefijos de ruta, sin traducción intermedia.
- **No:** agrupar por el flujo del `diagram.jpeg`. Se descarta: un endpoint puede caer en dos grupos y se pierde la correspondencia 1:1 con los archivos.
- **Sí:** `addBearerAuth` + `@ApiBearerAuth` por controller, con los dos `@Public()` sin marca. Decisión explícita del usuario. La UI refleja exactamente qué exige token.
- **No:** seguridad global en el `DocumentBuilder`. Se descarta: marcaría `POST /auth/login` y `POST /auth/register` como protegidos, que es falso.
- **Sí:** `persistAuthorization: true`. El token sobrevive al refresco y probar 23 rutas protegidas deja de exigir volver a pegarlo.
- **Sí:** `@ApiExcludeController()` en `AppController`. Decisión explícita del usuario. `GET /` es resto del boilerplate, no es contrato, y documentarlo sólo agrega ruido.
- **No:** borrar `AppController`. Se descarta por decisión explícita: cambiaría el runtime dentro de un spec de documentación y podría romper un health check que alguien use sin que conste en ningún lado.
- **Sí:** `main.ts` sólo gana el bloque de Swagger. Decisión explícita del usuario. El doble `ZodValidationPipe`, el doble `JwtAuthGuard` y el `setGlobalPrefix` comentado quedan intactos.
- **No:** quitar el pipe duplicado de paso. Se descarta: arreglaría la trampa de los `.transform()` no idempotentes, pero cambiando el runtime de los 25 endpoints en un spec que dice ser sólo documentación. Sigue sin dueño, como desde SPEC 16.
- **Sí:** `.env.example` nuevo. Decisión explícita del usuario. `NODE_ENV` es la primera variable que el código lee y que nadie sabría que existe.
- **No:** tocar `README.md`. Se descarta por decisión explícita del usuario: sigue siendo el boilerplate de NestJS y este spec no lo adopta.
- **Sí:** los `DECIMAL` y el `BIGINT` se documentan como `string | number`. Es lo que el driver devuelve hoy y lo que el código no normaliza. Documentarlos como `number` sería una mentira que el frontend pagaría.
- **No:** normalizar esos tipos en los repositorios "ya que los estamos documentando". Se descarta: cambiaría la respuesta de seis endpoints.
- **Sí:** se corrigen los conteos de `CLAUDE.md` con los verificados sobre los decoradores. `lotes` son ocho endpoints y `pesajes` siete; el código es la verdad.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **Los schemas de respuesta pueden mentir.** No se aplican en runtime, así que si alguien cambia un `select` de un repositorio, la doc sigue anunciando los campos viejos sin que nada falle. | Aceptado por decisión: la alternativa —serializar— puede tumbar un endpoint. Se mitiga con proceso: el paso 20 agrega a `CLAUDE.md` la convención de actualizar el `responses.dto.ts` al tocar un `select`. |
| **Si el deploy de producción no define `NODE_ENV`, `/docs` queda expuesto** y publica el mapa completo de una API donde catorce rutas no validan acceso. | Parcialmente mitigado: `NODE_ENV` entra en `.env.example` y en `CLAUDE.md`. La verificación real es el paso 16. Si el hosting no permite fijar la variable, la salida es Basic Auth, y eso es otro spec. |
| **La UI de Swagger no pasa por el `JwtAuthGuard`.** No es una ruta de Nest sino middleware de express, así que el guard global no la ve y no hay forma de protegerla con el token del proyecto. | Es la razón de la condición de `NODE_ENV`. Anotado en `CLAUDE.md` para que nadie asuma que el guard la cubre. |
| **Los mensajes de error documentados envejecen.** El texto exacto de un `BadRequestException` está copiado en un decorador y en el repositorio; cambiar uno no cambia el otro. | Aceptado: sin el texto real el 400 no dice nada útil. Misma mitigación de proceso que los schemas. |
| **Tocar los seis controllers a la vez es el cambio más transversal del proyecto**, y un `@Get`/`@Patch` movido de lugar por accidente rompe rutas sin fallar al compilar. | Mitigado: los decoradores se **agregan encima** de los existentes, ningún método se reordena, y hay dos criterios de aceptación que fijan el orden de `PesajesController` y `ClientesController`. El paso 14 recorre los 25 endpoints después. |
| **`@nestjs/swagger` ^11 podría arrastrar un peer incompatible** con `@nestjs/common` ^11 o con `zod` ^4. | Verificable en el paso 2, antes de escribir una línea de decoradores. Si falla, el spec se detiene ahí y la decisión de versión se retoma con datos. |
| Documentar el 403 sólo en tres endpoints puede leerse como que el resto está protegido de otra forma. | Mitigado por las advertencias de `description`: las catorce rutas abiertas dicen explícitamente que no validan el vínculo. El 403 es raro precisamente porque casi nada lo comprueba. |
| `POST /lotes` documenta que no devuelve el id del lote creado, lo que puede parecer un error del spec y tentar a "arreglarlo". | Está en Decisions y en los criterios: es el comportamiento real del controller y cambiarlo es otro spec. |

---

## What is **not** in this spec

- Cambiar el comportamiento de cualquier endpoint: campos, filtros, códigos o mensajes.
- Quitar el doble registro global del `ZodValidationPipe` o del `JwtAuthGuard`.
- Descomentar `app.setGlobalPrefix('api/v1')` y versionar la API.
- Borrar `src/app.controller.ts` o la ruta `GET /`.
- Serializar respuestas con `ZodSerializerDto` o `ZodSerializerInterceptor`.
- Un filtro de excepciones global que unifique las dos formas de error.
- Proteger `/docs` con Basic Auth, con el JWT del proyecto o con cualquier credencial.
- Normalizar los `DECIMAL` a número o el `BIGINT` de `pesajes.id`.
- Devolver el id del lote creado en `POST /lotes`.
- Generar un cliente TypeScript o publicar el OpenAPI a un portal externo.
- Actualizar `README.md`.
- Tests de cualquier tipo.
- Sembrar filas en `catalogo_permisos` o en `permisos`, y cualquier avance sobre el `PermissionsGuard`.
- DDL de cualquier tipo y cambios a `src/database/types/types.ts`.

Cada uno de estos, si se necesita, va en su propio spec.
