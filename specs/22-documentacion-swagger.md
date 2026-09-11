# SPEC 22 — Documentación OpenAPI con Swagger

> **Status:** Approved
> **Depends on:** SPEC 01 a SPEC 21 (documenta la superficie que dejaron; no modifica ninguna)
> **Date:** 2026-09-11
> **Objective:** Montar Swagger en `/docs` y describir los 25 endpoints del proyecto —qué hace cada uno, qué recibe y qué control de acceso no aplica— sin cambiar el comportamiento de ninguno.

---

## Cambio de alcance durante la implementación

Este spec se aprobó con schemas Zod de respuesta (7 archivos, 22 clases) y `@ApiResponse` con el texto exacto de cada error. **Durante la implementación el usuario redujo el alcance**: solo documentar los endpoints, sin schemas ni clases de ningún tipo.

Lo que se implementó, y lo que este documento describe a partir de aquí, es la versión reducida: `@ApiTags`, `@ApiBearerAuth`, `@ApiOperation` y `@ApiParam`, y nada más. **Cero archivos nuevos de código.** Las secciones de abajo ya están corregidas; lo que sigue es el registro de por qué difieren de lo aprobado el 2026-09-11 por la mañana.

Se cayeron: `src/swagger/error-response.dto.ts`, los seis `responses.dto.ts`, las 22 clases de respuesta, las dos de error, todos los `@ApiResponse` y la verificación de las dos formas de error. Se mantuvieron: el montaje, la condición de `NODE_ENV`, los tags, el bearer, las descripciones —incluidas las advertencias de `cliente_operador`—, `@ApiParam`, la exclusión de `GET /`, `.env.example` y `CLAUDE.md`.

---

## Why this spec exists

Hoy la documentación de la API son `specs/` y `CLAUDE.md`. Los dos están escritos para quien trabaja en el backend, no para quien lo consume. El frontend no tiene forma de saber qué hace `GET /lotes/cliente/:clienteId/all` frente a la ruta de al lado sin leer un repositorio de Kysely.

Este spec es documentación y nada más. **No hay DDL, no hay endpoint nuevo, no hay campo nuevo y ninguna respuesta cambia un solo byte.**

Cinco cosas conviene tener claras antes de leer el resto.

**La primera: son 25 endpoints, no 23.** El conteo verificado sobre el log de rutas de Nest es `auth` 2, `catalogos` 3, `clientes` 4, `lotes` 8, `permisos` 1 y `pesajes` 7. Hay además una ruta 26, `GET /` en `src/app.controller.ts`, que ningún spec menciona y que este spec **excluye** de la UI sin borrarla.

**La segunda: `patchNestJsSwagger()` ya no existe.** Es la función que aparece en casi todos los tutoriales de `nestjs-zod`, y fue eliminada en la v5. El proyecto tiene `nestjs-zod@5.4.0`, donde `createZodDto` define `_OPENAPI_METADATA_FACTORY` por su cuenta: los 11 DTOs de entrada que ya existen se documentan solos en cuanto `@nestjs/swagger` esté instalado, incluidos los query params de SPEC 16, 17 y 18, que se expanden uno por uno desde su schema Zod. Lo único que hace falta es pasar el documento por `cleanupOpenApiDoc()` antes del `SwaggerModule.setup`.

**La tercera: la doc describe entradas, no salidas.** Por la decisión de alcance de arriba, la UI dice qué hace cada endpoint y qué recibe —eso lo genera Zod solo— pero no qué devuelve. Las formas de respuesta siguen viviendo únicamente en `specs/` y en `CLAUDE.md`.

**La cuarta: la UI de Swagger no pasa por el `JwtAuthGuard` global.** No es una ruta de Nest sino middleware de express, así que el guard no la ve. Por eso se monta condicionada a `NODE_ENV !== 'production'`.

**La quinta: la doc dice la verdad.** Las 14 rutas que se saltan `validateVinculoOperador` a propósito y la ausencia total de enforcement de permisos aparecen en la descripción de cada endpoint afectado. El frontend lleva 21 specs asumiendo filtros que no existen.

---

## Scope

**In:**

- Instalar `@nestjs/swagger` en el rango `^11` como dependencia de producción.
- Bloque de Swagger en `src/main.ts`, montado **solo si `process.env.NODE_ENV !== 'production'`**, con la UI en `/docs` y el JSON en `/docs-json`.
- `DocumentBuilder` con título, descripción, versión, `addBearerAuth` y los seis tags en minúscula: `auth`, `catalogos`, `clientes`, `lotes`, `permisos`, `pesajes`.
- `cleanupOpenApiDoc()` de `nestjs-zod` aplicado al documento antes del `setup`.
- `swaggerOptions: { persistAuthorization: true }` para que el token sobreviva al refresco de la página.
- `@ApiTags` y `@ApiBearerAuth` a nivel de clase en los seis controllers, **salvo** en los dos endpoints `@Public()` de `auth`.
- `@ApiOperation` con `summary` y `description` en los 25 endpoints.
- `@ApiParam` en los 13 parámetros de ruta.
- Línea explícita en la `description` de las 14 rutas que se saltan `validateVinculoOperador`, y de las que aceptan query params que hoy se ignoran.
- `@ApiExcludeController()` en `src/app.controller.ts`.
- `.env.example` nuevo, con las seis variables actuales más `NODE_ENV`.
- Actualizar `CLAUDE.md` con la sección de Swagger, la variable nueva y los conteos verificados.

**Out of scope (for future specs):**

- **Documentar las respuestas:** schemas, clases, `@ApiResponse`, ejemplos y códigos de error. Cortado durante la implementación; si se retoma, va en un spec propio.
- Cambiar el comportamiento de **cualquier** endpoint: ni campos, ni filtros, ni códigos, ni mensajes.
- Implementar el filtro `?nombre` que SPEC 16 describe para `GET /pesajes/byLote/:loteId` y que nunca se escribió.
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

**Este spec no introduce estructuras de datos.** No hay DDL, no hay tabla nueva, no hay columna nueva, `src/database/types/types.ts` no cambia y —tras el recorte de alcance— **no se crea ningún archivo de código**. Lo único que se agrega al repositorio es `.env.example`.

### Archivos

| Archivo | Cambio |
| --- | --- |
| `src/main.ts` | Bloque de Swagger condicionado a `NODE_ENV` |
| `src/app.controller.ts` | `@ApiExcludeController()` |
| `src/modules/auth/auth.controller.ts` | Tag y `@ApiOperation` en 2 endpoints, **sin bearer** |
| `src/modules/catalogos/catalogos.controller.ts` | Tag, bearer y `@ApiOperation` en 3 |
| `src/modules/clientes/clientes.controller.ts` | Tag, bearer, `@ApiOperation` en 4 y 1 `@ApiParam` |
| `src/modules/lotes/lotes.controller.ts` | Tag, bearer, `@ApiOperation` en 8 y 7 `@ApiParam` |
| `src/modules/permisos/permisos.controller.ts` | Tag, bearer y `@ApiOperation` en 1 |
| `src/modules/pesajes/pesajes.controller.ts` | Tag, bearer, `@ApiOperation` en 7 y 5 `@ApiParam` |
| `package.json` / `package-lock.json` | `@nestjs/swagger@^11` |
| `.env.example` | **Nuevo** |
| `CLAUDE.md` | Sección de Swagger y conteos |

**Ningún `*.service.ts`, ningún `*.repository.ts`, ningún `*.module.ts` y ningún DTO de entrada.**

### El bloque de `main.ts`

Va después de `app.enableCors()` y antes de los pipes globales.

```ts
if (process.env.NODE_ENV !== 'production') {
  const config = new DocumentBuilder()
    .setTitle('Core Control Calidad Agro API')
    .setDescription('...')
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addTag('auth', '...')
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

La versión también importa: **`@nestjs/swagger` debe fijarse a `^11`**. Sin rango, npm resuelve la 12.x, que exige `@nestjs/common@^12`, y el install aborta con `ERESOLVE` porque el proyecto está en Nest 11.

### Lo que la entrada documenta sola

Sin escribir un `@ApiProperty`, `createZodDto` produce:

- Los 8 DTOs de body como schemas en `components.schemas`.
- Los 3 DTOs de filtros expandidos en query params sueltos.

Los conteos reales de query params, verificados contra el DTO y contra el repositorio:

| Endpoint | Query params |
| --- | --- |
| `GET /pesajes/historial` | **7** (`lote_id`, `cliente_id`, `estado_calidad_id`, `fuera_de_rango`, `nombre`, `desde`, `hasta`) |
| `GET /pesajes/byLote/:loteId` | **5** (`usuario_id`, `estado_calidad_id`, `fuera_de_rango`, `desde`, `hasta`) |
| `GET /clientes/all` | **4** (`nombre`, `producto_id`, `codigo_exportacion`, `rtn`) |
| `GET /clientes` | **0** — el handler no tiene `@Query()` |

**`GET /pesajes/byLote/:loteId` tiene cinco, no seis.** El `?nombre` sobre `usuarios.complete_name` que describen SPEC 16 y `CLAUDE.md` **nunca se implementó**: no está en `FiltrosPesajesLoteDto` ni en `getPesajesByLote`. Swagger documenta los cinco reales. Por decisión explícita del usuario, este spec **no corrige** el texto de SPEC 16 ni el de `CLAUDE.md`, que siguen diciendo seis.

### Las advertencias que van en la `description`

Texto que aparece en la UI, no sólo en `specs/`:

- **Las 14 rutas que se saltan `validateVinculoOperador`** llevan una línea que lo dice.
- **`GET /lotes/cliente/:clienteId/all`**, que nunca lo tuvo y ningún spec lo decidió, lleva la misma línea.
- **Las tres rutas que sí lo validan** —`GET /lotes/cliente/:clienteId`, `POST /lotes` y `POST /pesajes`— dicen que responden 403.
- **`GET /clientes`** dice que no acepta query params y que un query string se ignora, no se rechaza.
- **`GET /clientes/all`** dice que sus filtros **sí** devuelven 400 ante un valor inválido, al revés que los de `pesajes`.
- **Los filtros de `pesajes`** dicen que un valor inválido se ignora y que `fuera_de_rango` acepta `true`/`false`, no `1`/`0`.
- **`GET /permisos/me`** dice que es informativo y que ningún endpoint valida permisos.
- **`GET /lotes/cliente/:clienteId/all/approver`** dice que filtra la etapa con un id `2` hardcodeado y que puede estar mal en otro ambiente.
- **Las cuatro rutas del aprobador** dicen que exigen el lote **cerrado** en `CLIENTE_FINAL`, la precondición contraria al resto.
- **`PATCH /lotes/:id/finalizar/byApprover`** dice que congela el lote y lo saca de todas las lecturas.
- **`GET /pesajes/:id`** dice que su única condición es el id y que los ids son secuenciales.

---

## Implementation plan

1. Verificar el punto de partida: `npm run start:dev`, anotar del log de rutas de Nest las **26** rutas mapeadas y confirmar el reparto `auth` 2, `catalogos` 3, `clientes` 4, `lotes` 8, `permisos` 1, `pesajes` 7, más `GET /`. Guardar la lista.
2. `npm install @nestjs/swagger@^11` —con el rango explícito, porque sin él resuelve a la 12 y falla— y confirmar que la app sigue arrancando sin cambios de código.
3. Agregar el bloque de Swagger a `src/main.ts`. Verificación: `/docs` carga y ya lista las 26 rutas con sus DTOs de entrada, **sin haber tocado un solo controller**.
4. Agregar `@ApiExcludeController()` a `src/app.controller.ts`. Verificación: la UI baja a 25 operaciones y `GET /` sigue respondiendo igual por HTTP.
5. `AuthController`: `@ApiTags('auth')` y `@ApiOperation` en los dos endpoints. **Sin `@ApiBearerAuth`**: los dos son `@Public()`.
6. `CatalogosController`: tag, bearer y `@ApiOperation` en los tres, anotando que la clave del payload es `data` y que `usuarios` devuelve **todos** los activos, `ADMIN` incluidos.
7. `PermisosController`: tag, bearer y `@ApiOperation`, anotando que nada se enforcea.
8. `ClientesController`: tag, bearer, `@ApiOperation` en los cuatro y `@ApiParam` en el `:id`.
9. `LotesController`: tag, bearer, `@ApiOperation` en los ocho y `@ApiParam` en los siete parámetros de ruta.
10. `PesajesController`: tag, bearer, `@ApiOperation` en los siete y `@ApiParam` en los cinco. **No reordenar los métodos**: `@Get(':id')` sigue siendo el último, y eso es contrato desde SPEC 21.
11. Verificación de los DTOs de entrada en la UI, con los conteos de la tabla de arriba.
12. Verificación del bearer: pegar un token en *Authorize*, ejecutar `GET /permisos/me` desde la UI y recibir 200. Refrescar y confirmar que el token sigue cargado.
13. Verificación de que nada cambió en runtime: recorrer los 25 endpoints con el cliente HTTP de siempre —no desde la UI— y confirmar que devuelven exactamente lo mismo que antes del paso 2.
14. Verificación del apagado: `npm run build` y arrancar con `NODE_ENV=production`; `/docs` y `/docs-json` devuelven **404** y los 25 endpoints siguen respondiendo. Arrancar sin la variable y confirmar que `/docs` vuelve.
15. Verificación del JSON: `GET /docs-json` devuelve un OpenAPI válido con **25 operaciones** —24 claves en `paths`, porque `/clientes` agrupa `GET` y `POST`—, sin `GET /`, y con los seis tags.
16. Crear `.env.example` con `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `PORT` y `NODE_ENV`, sin valores reales. **No se toca el `.env`**.
17. `npm run lint` y `npm run build` sin errores nuevos.
18. Actualizar `CLAUDE.md`:
    - Sección nueva de Swagger: `/docs` y `/docs-json`, la condición `NODE_ENV !== 'production'`, que la UI **no** pasa por el `JwtAuthGuard`, que `patchNestJsSwagger` no existe en `nestjs-zod@5` y que `@nestjs/swagger` va fijado a `^11`.
    - Agregar `NODE_ENV` a la lista de variables de entorno y mencionar `.env.example`.
    - Anotar que **no hay documentación de respuestas** y que las formas siguen viviendo solo en `specs/` y en este archivo.
    - Anotar la convención: al agregar un endpoint hay que agregarle su `@ApiOperation`, porque nada lo valida y la UI se queda muda sin avisar.
    - Corregir los conteos con los verificados: **26** rutas mapeadas, **25** documentadas, `lotes` **ocho** y `pesajes` **siete**.
    - Documentar la ruta `GET /` y que este spec la excluye de la UI sin borrarla.

---

## Acceptance criteria

- [ ] `@nestjs/swagger` está en `dependencies` de `package.json`, en el rango `^11`.
- [ ] No se agregó ninguna otra dependencia: ni `swagger-ui-express`, ni `express-basic-auth`, ni `zod-to-openapi`.
- [ ] La app arranca sin errores y `npm run build` pasa.
- [ ] `npm run lint` no introduce errores nuevos.
- [ ] `GET /docs` carga la UI de Swagger cuando `NODE_ENV` no está definido.
- [ ] `GET /docs-json` devuelve un documento OpenAPI válido.
- [ ] Con `NODE_ENV=production`, `/docs` y `/docs-json` devuelven **404** y los 25 endpoints siguen respondiendo igual.
- [ ] El documento tiene exactamente **25 operaciones**, repartidas en 24 claves de `paths`.
- [ ] `GET /` **no** aparece en la UI, pero sigue respondiendo 401 por HTTP: `AppController` lleva `@ApiExcludeController()` y no se borró.
- [ ] Hay exactamente seis tags, en minúscula: `auth`, `catalogos`, `clientes`, `lotes`, `permisos`, `pesajes`.
- [ ] El reparto por tag es `auth` 2, `catalogos` 3, `clientes` 4, `lotes` 8, `permisos` 1, `pesajes` 7.
- [ ] Los 23 endpoints protegidos muestran candado; `POST /auth/login` y `POST /auth/register` **no**.
- [ ] Los 25 endpoints tienen `@ApiOperation` con `summary` y `description` no vacíos.
- [ ] Los 13 parámetros de ruta tienen `@ApiParam` con descripción.
- [ ] `POST /pesajes` muestra su body con todos los campos de `CreatePesajeDto`.
- [ ] `GET /pesajes/historial` muestra sus **siete** query params y **no** muestra `usuario_id`.
- [ ] `GET /pesajes/byLote/:loteId` muestra sus **cinco** query params.
- [ ] `GET /clientes/all` muestra sus **cuatro** query params.
- [ ] `GET /clientes` no muestra ningún query param, y su descripción dice que un query string se ignora.
- [ ] Las 14 rutas que se saltan `validateVinculoOperador`, más `GET /lotes/cliente/:clienteId/all`, lo dicen en su `description`.
- [ ] `GET /permisos/me` dice en su `description` que ningún endpoint valida permisos.
- [ ] **No se creó ningún archivo de código**: no existe `src/swagger/`, ni ningún `responses.dto.ts`.
- [ ] No hay un solo `@ApiResponse`, `@ApiOkResponse` ni equivalente en el proyecto.
- [ ] **Ninguna respuesta de la API cambió**: los 25 endpoints devuelven los mismos campos, códigos y mensajes que antes de este spec, verificados fuera de la UI.
- [ ] No se registró `ZodSerializerInterceptor` ni se usó `@ZodSerializerDto` en ningún endpoint.
- [ ] `src/main.ts` conserva **las dos** registraciones del `ZodValidationPipe` y **las dos** del `JwtAuthGuard`, y `setGlobalPrefix` sigue comentado.
- [ ] No se modificó ningún `*.service.ts`, `*.repository.ts`, `*.module.ts` ni ningún DTO de entrada.
- [ ] `src/database/types/types.ts` no cambió y no se aplicó ningún DDL.
- [ ] `@Get(':id')` sigue siendo el **último** método de `PesajesController`, y `@Get('all')` sigue antes que `@Get()` en `ClientesController`.
- [ ] `GET /pesajes/historial` y `GET /pesajes/byLote/12` siguen respondiendo 200 con un token válido, no un 400 de `ParseIntPipe`.
- [ ] `permisos` sigue con **14** filas y `catalogo_permisos` con **9**.
- [ ] Existe `.env.example` con las siete variables, sin un solo valor real y sin estar ignorado por git.
- [ ] `README.md` **no** cambió.
- [ ] `CLAUDE.md` documenta `/docs`, la condición de `NODE_ENV`, el pin de `^11`, la ruta `GET /`, los conteos corregidos y que no hay documentación de respuestas.

---

## Decisions

- **Sí:** solo se documentan los endpoints —qué hacen y qué reciben—, sin schemas de respuesta ni `@ApiResponse`. **Decisión explícita del usuario tomada durante la implementación**, que revierte lo aprobado por la mañana. Consecuencia asumida: la UI no dice qué devuelve ninguna ruta, y las formas de respuesta siguen viviendo solo en `specs/` y en `CLAUDE.md`.
- **No:** los 7 archivos y 22 clases de respuesta que este spec aprobó. Se descartan por lo anterior. Si se retoman, van en un spec propio.
- **No:** `@ApiResponse` con los códigos y el texto real de cada error. Se descarta con el mismo recorte. Era la parte con más valor documental del spec original —esos mensajes solo están en el código— y es lo primero que habría que recuperar.
- **Sí:** `@nestjs/swagger` fijado a `^11` como dependencia de producción. Es el peer que `nestjs-zod@5.4.0` declara, y la 12.x exige Nest 12: sin el rango explícito, `npm install` aborta con `ERESOLVE`. Va en `dependencies` y no en `devDependencies` porque `main.ts` lo importa siempre, aunque el bloque sólo se ejecute fuera de producción.
- **No:** `patchNestJsSwagger()`. **No existe en `nestjs-zod@5`** — verificado contra el paquete instalado, donde el export es `undefined`. Es lo que dicen casi todos los tutoriales y el build falla si se intenta.
- **Sí:** `cleanupOpenApiDoc()` sobre el documento antes del `setup`. Es el reemplazo oficial en la v5.
- **Sí:** los DTOs de entrada se documentan solos. `createZodDto` define `_OPENAPI_METADATA_FACTORY`, así que los 11 DTOs actuales —incluidos los tres de filtros— se expanden sin escribir un `@ApiProperty`. Tras el recorte de alcance, es de donde sale casi todo el contenido de la UI.
- **Sí:** los 25 endpoints en este spec, no un módulo piloto. Decisión explícita del usuario. Un Swagger a medias documenta mal lo que no cubre y nadie sabe cuál mitad es cuál.
- **Sí:** `/docs` y `/docs-json`. Decisión explícita del usuario. `api` queda libre por si algún día se descomenta `setGlobalPrefix('api/v1')`.
- **Sí:** montar sólo si `process.env.NODE_ENV !== 'production'`. Decisión explícita del usuario. En local y en staging funciona sin configurar nada.
- **No:** `NODE_ENV === 'development'`, que fallaría del lado seguro. Se descarta por decisión explícita: obligaría a agregar la variable para que la doc aparezca en local. Consecuencia asumida: si el deploy de producción no define `NODE_ENV`, la UI queda expuesta. Va a Risks y a `.env.example`.
- **No:** Basic Auth sobre `/docs`. Se descarta: agrega una dependencia y dos variables para un problema que la condición de `NODE_ENV` ya cubre en el caso normal.
- **Sí:** la doc dice la verdad sobre el control de acceso. Decisión explícita del usuario. Las 14 rutas abiertas y la ausencia de enforcement de permisos aparecen endpoint por endpoint. Sobrevivió al recorte porque es texto, no schema.
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
- **Sí:** Swagger documenta los **cinco** query params reales de `GET /pesajes/byLote/:loteId`.
- **No:** corregir SPEC 16 y `CLAUDE.md`, que dicen seis, ni implementar el `?nombre` que falta. **Decisión explícita del usuario** al descubrirse durante la implementación. Consecuencia asumida: los dos documentos siguen afirmando algo que el código no hace, y el próximo que los lea volverá a tropezar. La UI es hoy la única fuente correcta de ese conteo.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **La UI no dice qué devuelve ningún endpoint.** Quien consuma la API sigue necesitando leer `specs/` o el repositorio para saber la forma de una respuesta, que es justo lo que este spec nació para evitar. | Aceptado por decisión de alcance. Recuperarlo es un spec propio; lo más barato de ese trabajo son los `@ApiResponse` con los mensajes de error reales. |
| **Las descripciones envejecen y nada las valida.** Un endpoint nuevo sin `@ApiOperation` aparece en la UI sin una línea de prosa y nadie se entera. | Mitigado con proceso: el paso 18 lo anota como convención en `CLAUDE.md`. No hay mitigación técnica. |
| **Si el deploy de producción no define `NODE_ENV`, `/docs` queda expuesto** y publica el mapa completo de una API donde catorce rutas no validan acceso. | Parcialmente mitigado: `NODE_ENV` entra en `.env.example` y en `CLAUDE.md`, y el paso 14 verifica el apagado. Si el hosting no permite fijar la variable, la salida es Basic Auth, y eso es otro spec. |
| **La UI de Swagger no pasa por el `JwtAuthGuard`.** No es una ruta de Nest sino middleware de express, así que no hay forma de protegerla con el token del proyecto. | Es la razón de la condición de `NODE_ENV`. Anotado en `CLAUDE.md` para que nadie asuma que el guard la cubre. |
| **Tocar los seis controllers a la vez es el cambio más transversal del proyecto**, y un `@Get`/`@Patch` movido de lugar por accidente rompe rutas sin fallar al compilar. | Mitigado: los decoradores se **agregan encima** de los existentes, ningún método se reordena, y hay un criterio de aceptación que fija el orden de `PesajesController` y `ClientesController`. |
| **`SPEC 16` y `CLAUDE.md` quedan diciendo que `byLote` tiene seis filtros cuando tiene cinco**, y por decisión no se corrigen. | Sin mitigar, a propósito. Queda registrado en Decisions y en el Data model de este spec, que es el único sitio donde el conteo correcto está escrito. |
| `@nestjs/swagger` 12.x saldrá al paso en cualquier `npm update`: exige Nest 12 y rompería el install. | El rango `^11` en `package.json` lo contiene. Subir a Nest 12 es su propio trabajo. |

---

## What is **not** in this spec

- **Documentar las respuestas**: schemas, clases, `@ApiResponse`, ejemplos y códigos de error.
- Cambiar el comportamiento de cualquier endpoint: campos, filtros, códigos o mensajes.
- Implementar el `?nombre` que falta en `GET /pesajes/byLote/:loteId`, ni corregir SPEC 16 o `CLAUDE.md` sobre ese conteo.
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
