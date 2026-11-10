# SPEC 51 — Parámetros del tenant (datos de la empresa)

> **Status:** Approved
> **Depends on:** SPEC 25 (`paises_config`, el antecedente de tabla que se mantiene a mano), SPEC 49 (un tenant, una base)
> **Date:** 2026-11-10
> **Objective:** Crear una tabla clave-valor `parametros` con la identidad legal y el contacto de la empresa del tenant, cargada a mano, y una ruta `GET /parametros?nombre=` que devuelve una clave a cualquier usuario autenticado.

---

## Why this spec exists

Hoy la base de un tenant no sabe a qué empresa pertenece. Lo único que la identifica es `TENANT` en el `.env`, que es un slug técnico. El nombre comercial, la razón social, el RTN, la dirección y los datos de contacto del emisor no existen en ninguna tabla. El front y el servicio de reportes, que comparte la base, no tienen de dónde leerlos.

Con una base por tenant, la tabla es la que distingue a cada empresa sin lógica de tenant en `src/`. Es clave-valor para que un dato nuevo sea un `INSERT` y no un `ALTER TABLE` aplicado a mano en cada base.

## Scope

**In:**

- Tabla nueva `parametros` (`clave` única, `valor`, `descripcion`, `isActive`, timestamps).
- Siete claves sembradas en `db/seed.sql` con `valor` `NULL`. Cuatro son de identidad legal: `EMPRESA_NOMBRE_COMERCIAL`, `EMPRESA_RAZON_SOCIAL`, `EMPRESA_RTN` y `EMPRESA_DIRECCION`. Tres son de contacto: `EMPRESA_TELEFONO`, `EMPRESA_CORREO` y `EMPRESA_SITIO_WEB`.
- Módulo nuevo `src/modules/parametros/` con una sola ruta, `GET /parametros?nombre=<CLAVE>`, con JWT, que devuelve una clave activa.
- `nombre` es obligatorio: sin él responde 400. Una clave que no existe o está inactiva responde 404. Una clave que existe sin completar responde 200 con `valor: null`.
- Los valores se cargan y se cambian **solo a mano** (`UPDATE` en MySQL). No hay ruta de escritura.
- Interfaz en `src/database/types/types.ts`, DDL en `db/schema.sql`, filas en `db/seed.sql` y el paso manual para los tenants existentes en `deploy/README.md`.
- `@ApiTags`, `@ApiBearerAuth`, `@ApiOperation` y `@ApiQuery` en el controller.

**Out of scope (for future specs):**

- Cualquier escritura por API (`PATCH /parametros`), con o sin rol ADMIN/SOPORTE.
- Listar todos los parámetros en una llamada (`GET /parametros` sin `nombre`).
- Un logo, colores o marca del front.
- Una columna `categoria` o un filtro por categoría.
- Parámetros de comportamiento que hoy viven en el `.env` (`PASSWORD_VIGENCIA_DIAS`, `CHAT_LIMITE_DIARIO`, `GEMINI_MODEL`), y la zona horaria por tenant.
- Consumidores dentro del API: el prompt de Agri (SPEC 28/30), el resumen IA (SPEC 27) y los documentos fiscales (SPEC 25) no leen la tabla.
- Que `nuevo-tenant.sh` reciba los datos de la empresa como argumentos.
- Tipos o validación por clave (formato del RTN, del correo o de la URL).
- Guardar secretos (claves de API, contraseñas). Siguen en el `.env`.

## Data model

DDL, en este orden, en cada base de tenant:

```sql
CREATE TABLE `parametros` (
  `id` int NOT NULL AUTO_INCREMENT,
  `clave` varchar(100) NOT NULL,
  `valor` varchar(500) DEFAULT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_parametros_clave` (`clave`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

Filas del seed, con `valor` `NULL`:

| `clave` | `descripcion` |
| --- | --- |
| `EMPRESA_NOMBRE_COMERCIAL` | Nombre comercial de la empresa |
| `EMPRESA_RAZON_SOCIAL` | Razón social registrada |
| `EMPRESA_RTN` | RTN de la empresa |
| `EMPRESA_DIRECCION` | Dirección fiscal de la empresa |
| `EMPRESA_TELEFONO` | Teléfono de contacto |
| `EMPRESA_CORREO` | Correo de contacto |
| `EMPRESA_SITIO_WEB` | Sitio web de la empresa |

Convenciones:

- Las claves van en MAYÚSCULAS con prefijo, como los `codigo` de los catálogos. La colación `ai_ci` hace que `?nombre=empresa_rtn` encuentre `EMPRESA_RTN`.
- `valor` siempre es texto. El código no interpreta ninguna clave.
- La tabla es pública para cualquier usuario autenticado. **Nunca guarda secretos.**

Interfaz en `src/database/types/types.ts`, con la clave `parametros` en `Database`:

```ts
export interface ParametroTable {
  id: Generated<number>;
  clave: string;
  valor: string | null;
  descripcion: string | null;
  isActive: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
```

DTO `src/modules/parametros/dto/obtener-parametro.dto.ts`:

```ts
z.object({ nombre: z.string().trim().min(1).max(100) })
```

Respuesta de `GET /parametros?nombre=EMPRESA_RTN` (200):

```json
{
  "ok": true,
  "msg": "Parametro obtenido correctamente",
  "parametro": { "clave": "EMPRESA_RTN", "valor": "08019000123456" }
}
```

Errores:

| Caso | Respuesta |
| --- | --- |
| Sin token | **401** (guard global) |
| Sin `nombre`, vacío o de más de 100 caracteres | **400** (pipe Zod) |
| La clave no existe o tiene `isActive = 0` | **404** `Parametro no encontrado` |
| La clave existe con `valor` `NULL` | **200** con `valor: null` |

## Implementation plan

1. Aplicar el `CREATE TABLE` y los siete `INSERT` en la base local. Comprobar con `DESCRIBE parametros` y `SELECT clave FROM parametros`.
2. Transcribir el `CREATE TABLE` a `db/schema.sql`, con el mismo formato de dump que `paises_config`. Agregar el bloque `LOCK TABLES parametros WRITE` con los siete `INSERT` a `db/seed.sql`.
3. Agregar `ParametroTable` y la clave `parametros` a `Database` en `src/database/types/types.ts`.
4. Crear `src/modules/parametros/` con la estructura de siempre:
   - `parametros.module.ts` con `imports: [DatabaseModule]`.
   - `parametros.controller.ts`.
   - `parametros.service.ts` como pass-through.
   - `repository/parametros.repository.ts`.
   - `dto/obtener-parametro.dto.ts`.

   Registrar el módulo en `src/app.module.ts`.
5. En `ParametrosRepository`, agregar `obtenerParametro(nombre)`. Hace un solo `SELECT clave, valor` sin transacción, con `WHERE clave = nombre AND isActive = 1` y `executeTakeFirst()`. Sin fila, lanza `NotFoundException('Parametro no encontrado')`.
6. En `ParametrosController`, agregar `@Get()` con `@Query() ObtenerParametroDto`, que responde `{ ok, msg, parametro }`. Lleva `@ApiTags('parametros')`, `@ApiBearerAuth()`, `@ApiQuery` para `nombre` y un `@ApiOperation` que dice tres cosas: que cualquier usuario autenticado lee cualquier clave, sin `cliente_operador`; que `valor` es texto o `null`; y la tabla de errores de arriba.
7. Agregar a `deploy/README.md` el paso manual para cada tenant existente: el `CREATE TABLE`, los siete `INSERT` y un ejemplo de `UPDATE parametros SET valor = '...' WHERE clave = 'EMPRESA_NOMBRE_COMERCIAL'`. Un tenant nuevo no lo necesita, porque `nuevo-tenant.sh` ya carga `schema.sql` y `seed.sql`.
8. Actualizar la documentación:
   - `src/modules/parametros/CLAUDE.md` (nuevo): la tabla, la ruta, las siete claves, que la escritura es solo a mano, que no hay tipos por clave y que la tabla nunca guarda secretos.
   - `src/database/CLAUDE.md`: `parametros` en "Hand-maintained tables" y `parametros.clave` en la lista de `UNIQUE` reales.
   - `CLAUDE.md` raíz:
     - `parametros` en la tabla de módulos y en la lista de tablas de "Domain".
     - `parametros` en la lista de tablas sin CRUD de "Caveats".
     - El conteo de rutas: 53 rutas, `parametros` 1; 52 operaciones bajo 48 `paths`.

## Acceptance criteria

- [ ] `DESCRIBE parametros` en la base local muestra las siete columnas del DDL. `SHOW CREATE TABLE` muestra `uq_parametros_clave`.
- [ ] Un volumen nuevo de Docker (`docker compose down -v && docker compose up -d --build`) nace con `parametros` y las siete claves con `valor` `NULL`.
- [ ] `GET /parametros?nombre=EMPRESA_RTN` con token responde 200 `{ ok, msg, parametro: { clave, valor } }`, y `valor` es `null` mientras nadie lo complete.
- [ ] Tras `UPDATE parametros SET valor = 'Agro S.A.' WHERE clave = 'EMPRESA_NOMBRE_COMERCIAL'`, `GET /parametros?nombre=EMPRESA_NOMBRE_COMERCIAL` devuelve `valor: 'Agro S.A.'` sin reiniciar el API.
- [ ] `GET /parametros?nombre=empresa_rtn` (minúsculas) devuelve la clave `EMPRESA_RTN`.
- [ ] `GET /parametros?nombre=NO_EXISTE` responde 404 `Parametro no encontrado`.
- [ ] Tras `UPDATE parametros SET isActive = 0 WHERE clave = 'EMPRESA_SITIO_WEB'`, `GET /parametros?nombre=EMPRESA_SITIO_WEB` responde 404.
- [ ] `GET /parametros` sin `nombre`, y `GET /parametros?nombre=` vacío, responden 400.
- [ ] `GET /parametros?nombre=EMPRESA_RTN` sin token responde 401.
- [ ] La respuesta no incluye `id`, `descripcion`, `isActive` ni timestamps.
- [ ] El log de rutas de Nest muestra 53 rutas, y `/docs-json` tiene 52 operaciones bajo 48 `paths`.
- [ ] Swagger (`/docs`) muestra `GET /parametros` con candado, el query `nombre` obligatorio y su descripción.
- [ ] `npm run lint` no da errores.

## Decisions

- **Yes:** clave-valor. Un dato nuevo es un `INSERT` en cada base, no un `ALTER TABLE`, y con una base por tenant cada DDL se aplica a mano en todas.
- **No:** una fila con columnas tipadas. Valida cada campo y le pone su tope, pero cada dato nuevo cuesta DDL en todos los tenants.
- **Yes:** `valor VARCHAR(500)`. Alcanza para una dirección. El tope del DTO no aplica porque no hay escritura por API.
- **No:** tipos o validación por clave. Sin escritura por API no hay dónde validar, y quien hace el `UPDATE` es responsable del formato.
- **Yes:** solo identidad legal y contacto. Es lo que hoy falta para encabezados y reportes.
- **No:** logo ni marca del front en este spec. Un logo en `VARCHAR(500)` no cabe, y la marca es otra conversación con el front.
- **Yes:** escritura solo a mano, como `paises_config`. Son datos que cambian casi nunca, y un RTN mal cambiado desde una pantalla es peor que un `UPDATE` hecho por soporte.
- **No:** `PATCH /parametros` para ADMIN/SOPORTE. Queda para cuando haya pantalla de configuración.
- **Yes:** la ruta exige JWT. La razón social, el RTN, el teléfono y el correo no quedan expuestos a quien llegue al dominio.
- **No:** `@Public()` para mostrar la empresa en el login. Haría pública toda la tabla.
- **Yes:** cualquier usuario autenticado lee cualquier clave, sin `cliente_operador` ni rol. Son datos del tenant, no de un cliente.
- **Yes:** `nombre` obligatorio, con un 400 si falta. Es la ruta que se pidió: una clave por llamada.
- **No:** devolver todos los parámetros sin `nombre`. Se descartó por ahora. El front hace una llamada por dato.
- **Yes:** el 400 por `nombre` faltante no sigue la convención de filtros del SPEC 16 (ignorar el valor inválido). `nombre` no es un filtro, es el identificador de lo que se pide.
- **Yes:** 404 para una clave inexistente o inactiva, y 200 con `valor: null` para una que existe sin completar. El front distingue una clave mal escrita de un dato que nadie llenó.
- **No:** 400 como en `resolveEtapa`. Aquí la clave es lo que se busca, no un catálogo referenciado por otra escritura, así que es el caso de `GET /documentos-fiscales/:id`.
- **Yes:** columnas `descripcion` e `isActive`. La primera explica cada clave a quien hace el `UPDATE`. La segunda retira una clave sin borrarla, como el resto del proyecto.
- **No:** columna `categoria`. El prefijo `EMPRESA_` ya agrupa.
- **Yes:** claves en MAYÚSCULAS con prefijo, como los `codigo` de los catálogos.
- **Yes:** la respuesta es `{ clave, valor }`, con la clave singular `parametro` por ser una sola fila. `descripcion` es para quien mantiene la tabla, no para el front.
- **Yes:** la lectura va sin transacción. Es un solo `SELECT`, y la convención de transacciones es del camino de escritura.
- **Yes:** el seed trae las siete claves con `valor` `NULL`, y `nuevo-tenant.sh` no cambia. La firma del script no crece, y un tenant nuevo nace con las claves listas para el `UPDATE`.
- **No:** ningún consumidor dentro del API. Poner el nombre de la empresa en el prompt de Agri o en el resumen IA lo enviaría a Google. Va en su propio spec.
- **Yes:** la tabla nunca guarda secretos. Cualquier usuario autenticado puede leer cualquier clave.

## Risks

| Risk | Mitigation |
| --- | --- |
| Un tenant existente no recibe el DDL y `GET /parametros` responde 500 (`ER_NO_SUCH_TABLE`) | El paso manual queda en `deploy/README.md`. Aplicarlo en cada base antes de publicar la imagen. Solo afecta a esa ruta. |
| Alguien guarda un secreto en `parametros` y cualquier usuario autenticado lo lee | Queda escrito en `src/modules/parametros/CLAUDE.md` y en la descripción de Swagger. Los secretos siguen en el `.env`. |
| Un `UPDATE` a mano deja un RTN o un correo mal formado | **Aceptado.** No hay validación por clave. Lo corrige el mismo `UPDATE`. |
| Un `UPDATE` a mano con un valor de más de 500 caracteres | MySQL lo rechaza por `STRICT_TRANS_TABLES`. La fila queda como estaba. |
| El front pide una clave mal escrita | Responde 404, no `null`, así que el error aparece en desarrollo. |

## What is **not** in this spec

- Escritura por API (`PATCH /parametros`).
- Listar todos los parámetros sin `nombre`.
- Logo, colores o marca del front.
- Columna `categoria`.
- Mover a la tabla los parámetros del `.env` o la zona horaria por tenant.
- Leer los parámetros desde el chat, el resumen IA o los documentos fiscales.
- Argumentos nuevos en `nuevo-tenant.sh`.
- Validación de formato por clave.
- Secretos.

Cada uno de esos, si llega, va en su propio spec.
