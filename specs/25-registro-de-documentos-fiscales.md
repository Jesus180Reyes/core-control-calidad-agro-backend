# SPEC 25 — Registro de documentos fiscales

> **Status:** Approved
> **Depends on:** SPEC 02 (crea el módulo `lotes`), SPEC 11 (rechazo de clientes, que libera el `rtn` para reuso), SPEC 13 (escribe `aprobado_por`/`aprobado_en`), SPEC 20 (escribe la etapa `FINALIZADO` y el par `finalizado_por`/`finalizado_en`), SPEC 22 (Swagger, donde hay que documentar las rutas nuevas)
> **Date:** 2026-09-14
> **Objective:** Crear el módulo `documentos-fiscales`, que registra las facturas emitidas fuera del sistema y las amarra a los lotes finalizados que respaldan, con el régimen de cada país como dato y no como estructura, para que ante una auditoría la evidencia de trazabilidad de una exportación declarada se resuelva en una consulta.

---

## Why this spec exists

El SAR de Honduras audita exportaciones declaradas. Lo que pide en una auditoría es el respaldo: qué se exportó, cuánto, a quién, y con qué documento fiscal. Este backend tiene la mitad física de esa respuesta —pesajes, pesos netos, estados de calidad, quién aprobó y quién finalizó cada lote— y no tiene la mitad fiscal, ni el puente entre las dos.

Este spec construye el puente. No construye facturación.

Cinco cosas conviene tener claras antes de leer el resto.

**La primera: el sistema no emite el documento, lo registra.** No hay autorización propia, no hay rango, no hay generación de correlativo, no hay cálculo de impuesto y no hay PDF. La factura se emite donde se emita hoy —imprenta o sistema de facturación— y aquí se transcribe. Eso hace que el spec funcione igual sea la empresa autoimpresor o facture por imprenta, que es la pregunta que quedó sin responder durante el diseño y que este alcance vuelve irrelevante.

**La segunda: esto no vuelve a la empresa cumplida con ningún régimen de facturación.** El cumplimiento vive donde se emite la factura. Esto la vuelve **auditable**: cuando la autoridad pida el respaldo de una exportación, está en un `GET` y no en tres carpetas.

**La tercera: el software se va a usar en más de un país, así que el régimen es dato.** No hay columna `cai`, no hay columna `duca` y no hay regex de Honduras en ningún DTO. Hay una tabla `paises_config` con una fila por país, que guarda la moneda, las etiquetas y los patrones de validación. Honduras es una fila de esa tabla, no el esquema. Es la misma lección que ya se aplicó a la tarifa del impuesto, y la que `CLAUDE.md` señala desde el SPEC 19 con el `etapa_id = 2` hardcodeado de la bandeja del aprobador.

**La cuarta: la tarifa del impuesto también es dato.** No hay columnas `isv_15` ni `isv_18`. Los importes gravados viven en una tabla hija con su `tarifa` como valor, para que el día que el ISV pase de 15 a 16 —o que el país nuevo cobre 13— no haya DDL ni un `if` nuevo en cada reporte.

**La quinta: es el primer módulo operado por alguien que no es operador ni aprobador.** Lo llena un contador o un administrativo. Los roles en la base son `ADMIN` (id 2) y `OPERADOR` (id 1) y no hay ninguno para esto, pero como el proyecto no enforza roles en ninguna parte —no hay `PermissionsGuard`, no hay `@Permisos()`, `req.user` sigue siendo `{ userId, username }`— crear el rol no cambiaría nada. Se difiere junto con el enforcement.

---

## Scope

**In:**

- Cuatro tablas nuevas en MySQL: `paises_config`, `documentos_fiscales`, `documento_fiscal_impuesto` y `documento_fiscal_lote`.
- Una columna nueva en `clientes`: `constancia_exonerado VARCHAR(50) NULL`. Una sola, sin FK.
- Una fila semilla en `paises_config` para Honduras.
- Las cuatro interfaces nuevas y la columna nueva en `src/database/types/types.ts`, con sus claves en `Database`.
- Módulo nuevo `src/modules/documentos-fiscales/`, con la estructura de siempre: `*.module.ts` → `*.controller.ts` → `*.service.ts` → `repository/*.repository.ts` → `dto/*.dto.ts`.
- Registro del módulo en `src/app.module.ts`, con `imports: [DatabaseModule]`.
- Cinco endpoints nuevos, todos protegidos solo por el `JwtAuthGuard` global:
  - `POST /documentos-fiscales` — registra la cabecera, sus impuestos y sus lotes en **una** transacción.
  - `GET /documentos-fiscales` — listado, con tres query params opcionales.
  - `PATCH /documentos-fiscales/:id/completar` — escribe `documento_aduanero` y `archivo_url`, una sola vez cada uno.
  - `PATCH /documentos-fiscales/:id/anular` — anulación lógica con motivo.
  - `GET /documentos-fiscales/:id` — detalle con impuestos, lotes y la trazabilidad de cada lote. Declarado **último** en el controller.
- Cuatro DTOs con `createZodDto()`, siguiendo la convención del proyecto.
- `@ApiTags`, `@ApiBearerAuth`, `@ApiOperation` y `@ApiParam`, con el estilo del SPEC 22: resumen y descripción, sin ningún `@ApiResponse`.
- Actualizar `CLAUDE.md`: módulo nuevo, endpoints nuevos, tablas nuevas y todos los conteos que cambian.

**Out of scope (for future specs):**

- **Emitir documentos fiscales.** No hay tablas de emisor, punto de emisión ni autorizaciones, no se genera correlativo, no se calcula impuesto, no se produce el total en letras y no se genera PDF.
- **El segundo país como operación.** Este spec deja la estructura lista y siembra **una** fila. Habilitar un país nuevo es su propio spec, y arrastra tres cosas concretas: `clientes.pais_id` con su FK, la unicidad de `clientes.rtn` pasando de global a `(pais_id, rtn)` —hoy los dos validadores filtran solo `isActive = 1`— y `POST /clientes` recibiendo el país. Todo eso toca `ClientesRepository`, que este spec deja intacto.
- **`GET /catalogos/paises`.** Con una sola fila activa el `pais_id` se resuelve solo; ver Decisions. El selector lo agrega el spec del segundo país.
- **Factura electrónica** y cualquier transmisión a una autoridad tributaria. Hoy el régimen CAI de Honduras no transmite nada al emitir; cuando la factura electrónica sea obligatoria para esta empresa, o cuando entre un país que ya la exige, es otro spec y otro diseño.
- **`GET /documentos-fiscales/resumen-isv`**, el resumen mensual con las exportaciones separadas por destino. Se propuso durante el diseño y se difiere: sirve para *declarar*, no para *auditar*, que es el objetivo de este spec. `pais_destino` se guarda desde ya para que ese spec no necesite DDL.
- **Exportar archivos** para DET Live o para el contador, en cualquier formato.
- **Subir el archivo adjunto.** `archivo_url` guarda una URL o una ruta; este spec no implementa carga de archivos, ni almacenamiento, ni validación del contenido.
- **Notas de crédito y de débito como flujo.** `tipo_documento` las acepta como valor, pero no hay relación entre una nota y el documento que corrige, ni recálculo de nada.
- **Cuentas por cobrar, pagos, saldos y estados de cuenta.**
- **Precios.** No se agrega tabla de precios ni columna de precio unitario: los importes se transcriben del documento, no se calculan.
- **Validar que la cantidad facturada cuadre con el peso neto del lote.** Ver Decisions.
- **Deshacer una anulación** o editar un documento anulado.
- **Editar los importes, el número o la autorización** de un documento ya registrado. Corregir es anular y registrar de nuevo.
- **Un CRUD de `paises_config`.** La tabla se mantiene a mano en MySQL, como `etapas`, `estados_calidad` y los permisos.
- **El rol `CONTADOR`, las filas en `catalogo_permisos` y en `permisos`.** Decisión explícita del usuario; ver Decisions.
- **`PermissionsGuard`, `@Permisos()` y cualquier enforcement de roles o permisos.**
- **Validar el vínculo `cliente_operador`** en cualquiera de las cinco rutas.
- **Snapshot del nombre y el RTN del cliente** en la cabecera. Decisión explícita del usuario; ver Decisions y Risks.
- **`direccion_fiscal` en `clientes`.** Se propuso durante el diseño y se cae con la snapshot: la dirección está impresa en el documento y el sistema no la reproduce.
- **Un `PATCH /clientes/:id`** para mantener `constancia_exonerado`. La columna se llena a mano en MySQL, como el resto de los datos de referencia del proyecto.
- **Renombrar `clientes.rtn`.** Ver Decisions.
- **Paginación y límite** en el listado. No los tiene ninguna lectura del proyecto.
- **Cambios a cualquier endpoint de `lotes`, `pesajes`, `clientes`, `auth`, `permisos` o `catalogos`.**
- **Tests de cualquier tipo:** el proyecto sigue sin un solo `*.spec.ts`.

---

## Data model

### DDL

Se aplica a mano en MySQL, como todo el DDL del proyecto. El orden importa: `paises_config` primero, porque la cabecera la referencia, y las dos hijas al final.

```sql
CREATE TABLE paises_config (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  codigo_pais             CHAR(2)      NOT NULL,
  nombre                  VARCHAR(100) NOT NULL,
  moneda                  CHAR(3)      NOT NULL,
  etiqueta_autorizacion   VARCHAR(40)  NOT NULL,
  etiqueta_identificacion VARCHAR(40)  NOT NULL,
  patron_numero           VARCHAR(255) NULL,
  patron_autorizacion     VARCHAR(255) NULL,
  requiere_autorizacion   TINYINT(1)   NOT NULL DEFAULT 1,
  isActive                TINYINT(1)   NOT NULL DEFAULT 1,
  created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pais (codigo_pais)
) ENGINE=InnoDB;

CREATE TABLE documentos_fiscales (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  pais_id             INT           NOT NULL,
  cliente_id          INT           NOT NULL,
  tipo_documento      VARCHAR(20)   NOT NULL,
  numero_completo     VARCHAR(50)   NOT NULL,
  autorizacion        VARCHAR(100)  NULL,
  fecha_emision       DATE          NOT NULL,
  moneda              CHAR(3)       NOT NULL,
  tipo_cambio         DECIMAL(14,6) NOT NULL DEFAULT 1,
  importe_exento      DECIMAL(14,2) NOT NULL DEFAULT 0,
  importe_exonerado   DECIMAL(14,2) NOT NULL DEFAULT 0,
  total               DECIMAL(14,2) NOT NULL,
  referencia_exencion VARCHAR(50)   NULL,
  pais_destino        CHAR(2)       NULL,
  documento_aduanero  VARCHAR(50)   NULL,
  archivo_url         VARCHAR(255)  NULL,
  motivo_anulacion    VARCHAR(255)  NULL,
  anulado_por         INT           NULL,
  anulado_en          DATETIME      NULL,
  isActive            TINYINT(1)    NOT NULL DEFAULT 1,
  created_by          INT           NOT NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_doc_numero (pais_id, numero_completo),
  CONSTRAINT fk_doc_pais     FOREIGN KEY (pais_id)     REFERENCES paises_config(id),
  CONSTRAINT fk_doc_cliente  FOREIGN KEY (cliente_id)  REFERENCES clientes(id),
  CONSTRAINT fk_doc_creador  FOREIGN KEY (created_by)  REFERENCES usuarios(id),
  CONSTRAINT fk_doc_anulador FOREIGN KEY (anulado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB;

CREATE TABLE documento_fiscal_impuesto (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  documento_id INT           NOT NULL,
  tarifa       DECIMAL(5,2)  NOT NULL,
  base_gravada DECIMAL(14,2) NOT NULL,
  impuesto     DECIMAL(14,2) NOT NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_doc_tarifa (documento_id, tarifa),
  CONSTRAINT fk_dfi_doc FOREIGN KEY (documento_id) REFERENCES documentos_fiscales(id)
) ENGINE=InnoDB;

CREATE TABLE documento_fiscal_lote (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  documento_id     INT           NOT NULL,
  lote_id          INT           NOT NULL,
  cantidad         DECIMAL(14,4) NOT NULL,
  unidad_medida_id INT           NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_doc_lote (documento_id, lote_id),
  CONSTRAINT fk_dfl_doc    FOREIGN KEY (documento_id)     REFERENCES documentos_fiscales(id),
  CONSTRAINT fk_dfl_lote   FOREIGN KEY (lote_id)          REFERENCES lotes(id),
  CONSTRAINT fk_dfl_unidad FOREIGN KEY (unidad_medida_id) REFERENCES unidades_medida(id)
) ENGINE=InnoDB;

ALTER TABLE clientes
  ADD COLUMN constancia_exonerado VARCHAR(50) NULL AFTER direccion_planta;

INSERT INTO paises_config
  (codigo_pais, nombre, moneda, etiqueta_autorizacion, etiqueta_identificacion, patron_numero)
VALUES
  ('HN', 'Honduras', 'HNL', 'CAI', 'RTN', '^[0-9]{3}-[0-9]{3}-[0-9]{2}-[0-9]{8}$');
```

**Ocho FKs nuevas**, que llevan las excepciones a la regla de "relaciones solo en código" de 8 a **16**. La justificación es la del SPEC 14: nada de esto sirve si apunta a una fila que no existe, y aquí es evidencia de auditoría.

**Cuatro `UNIQUE` reales**, que llevan las restricciones de unicidad en MySQL de 2 a **6**. `uq_doc_numero` es la importante: un número de documento repetido en una auditoría es peor que un cliente duplicado, y no basta con validarlo en código por la ventana de carrera que `CLAUDE.md` documenta entre el `SELECT` y el `INSERT`. Va sobre `(pais_id, numero_completo)` y no sobre el número solo, porque dos países pueden emitir el mismo número.

### Qué hay en `paises_config` y por qué

| Columna | Para qué |
| --- | --- |
| `codigo_pais` | ISO 3166-1 alpha-2. `HN`, `GT`, `CR`, `PA`, `SV` |
| `moneda` | ISO 4217. Es el valor por defecto de `documentos_fiscales.moneda` |
| `etiqueta_autorizacion` | Cómo se llama el código de autorización en ese país: `CAI` en Honduras, `Autorización FEL` en Guatemala, `Clave` en Costa Rica |
| `etiqueta_identificacion` | Cómo se llama el identificador fiscal: `RTN`, `NIT`, `RUC`, `Cédula jurídica` |
| `patron_numero` | Expresión regular del número del documento. `NULL` significa no validar formato |
| `patron_autorizacion` | Ídem para el código de autorización |
| `requiere_autorizacion` | `1` si el país exige un código antes de emitir; `0` si no |

Las dos etiquetas existen para el frontend. El backend no las usa para nada más que devolverlas en el detalle.

### `src/database/types/types.ts`

```ts
export interface PaisesConfigTable {
  id: Generated<number>;
  codigo_pais: string;
  nombre: string;
  moneda: string;
  etiqueta_autorizacion: string;
  etiqueta_identificacion: string;
  patron_numero: string | null;
  patron_autorizacion: string | null;
  requiere_autorizacion: Generated<number>;
  isActive: Generated<number>;
  created_at: Generated<Date | string | null>;
}

export interface DocumentosFiscalesTable {
  id: Generated<number>;
  pais_id: number;
  cliente_id: number;
  tipo_documento: 'FACTURA' | 'NOTA_CREDITO' | 'NOTA_DEBITO';
  numero_completo: string;
  autorizacion: string | null;
  fecha_emision: Date | string;
  moneda: string;
  tipo_cambio: Generated<string | number>;
  importe_exento: Generated<string | number>;
  importe_exonerado: Generated<string | number>;
  total: string | number;
  referencia_exencion: string | null;
  pais_destino: string | null;
  documento_aduanero: string | null;
  archivo_url: string | null;
  motivo_anulacion: string | null;
  anulado_por: number | null;
  anulado_en: Date | string | null;
  isActive: Generated<number>;
  created_by: number;
  created_at: Generated<Date | string | null>;
}

export interface DocumentoFiscalImpuestoTable {
  id: Generated<number>;
  documento_id: number;
  tarifa: string | number;
  base_gravada: string | number;
  impuesto: string | number;
  created_at: Generated<Date | string | null>;
}

export interface DocumentoFiscalLoteTable {
  id: Generated<number>;
  documento_id: number;
  lote_id: number;
  cantidad: string | number;
  unidad_medida_id: number | null;
  created_at: Generated<Date | string | null>;
}
```

Cuatro claves nuevas en `Database`: `paises_config`, `documentos_fiscales`, `documento_fiscal_impuesto` y `documento_fiscal_lote`. Y una línea nueva en `ClientesTable`: `constancia_exonerado: string | null;`.

Dos detalles de convención que ya están en `CLAUDE.md` y que aplican aquí. Los `DECIMAL` van `string | number` porque el driver los devuelve como string, igual que `peso_minimo`. Y `requiere_autorizacion` se compara por truthiness, nunca con `=== false`, porque MySQL entrega el `TINYINT` como `0`/`1`.

### Archivos

| Archivo | Cambio |
| --- | --- |
| `src/database/types/types.ts` | Cuatro interfaces nuevas, cuatro claves en `Database`, una columna en `ClientesTable` |
| `src/modules/documentos-fiscales/documentos-fiscales.module.ts` | Nuevo |
| `src/modules/documentos-fiscales/documentos-fiscales.controller.ts` | Nuevo, cinco handlers |
| `src/modules/documentos-fiscales/documentos-fiscales.service.ts` | Nuevo, cinco pass-through |
| `src/modules/documentos-fiscales/repository/documentos-fiscales.repository.ts` | Nuevo, cinco métodos y nueve validadores privados |
| `src/modules/documentos-fiscales/dto/create-documento-fiscal.dto.ts` | Nuevo |
| `src/modules/documentos-fiscales/dto/completar-documento-fiscal.dto.ts` | Nuevo |
| `src/modules/documentos-fiscales/dto/anular-documento-fiscal.dto.ts` | Nuevo |
| `src/modules/documentos-fiscales/dto/filtros-documentos-fiscales.dto.ts` | Nuevo |
| `src/app.module.ts` | Registrar `DocumentosFiscalesModule` |
| `CLAUDE.md` | Módulo, tablas, endpoints y conteos |

### Los cinco endpoints

| Método | Ruta | Cuerpo | Respuesta |
| --- | --- | --- | --- |
| `POST` | `/documentos-fiscales` | `CreateDocumentoFiscalDto` | `{ ok, msg, documento_id }` |
| `GET` | `/documentos-fiscales` | — | `{ ok, msg, documentos }` |
| `PATCH` | `/documentos-fiscales/:id/completar` | `CompletarDocumentoFiscalDto` | `{ ok, msg }` |
| `PATCH` | `/documentos-fiscales/:id/anular` | `AnularDocumentoFiscalDto` | `{ ok, msg }` |
| `GET` | `/documentos-fiscales/:id` | — | `{ ok, msg, documento }` |

La clave del payload es el nombre del recurso, como en ocho de los once `GET` del proyecto, y singular en el detalle, como `pesaje` en el SPEC 21.

**El orden de declaración en el controller es parte del contrato.** `@Get(':id')` va **último**, después de `@Get()` y de los dos `@Patch`. Es la misma trampa que `CLAUDE.md` describe para `PesajesController` desde el SPEC 21.

### `POST /documentos-fiscales`

```ts
{
  pais_id?: number,                 // omitido: se resuelve al único país activo
  cliente_id: number,
  tipo_documento: 'FACTURA' | 'NOTA_CREDITO' | 'NOTA_DEBITO',
  numero_completo: string,
  autorizacion?: string,
  fecha_emision: string,            // YYYY-MM-DD
  moneda?: string,                  // omitido: la de paises_config
  tipo_cambio?: number,             // default 1
  importe_exento?: number,          // default 0
  importe_exonerado?: number,       // default 0
  total: number,
  referencia_exencion?: string,
  pais_destino?: string,            // ISO 3166-1 alpha-2
  impuestos?: [{ tarifa: number, base_gravada: number, impuesto: number }],
  lotes: [{ lote_id: number, cantidad: number, unidad_medida_id?: number }]
}
```

`documento_aduanero` y `archivo_url` **no se aceptan aquí**: llegan después, por `completar`.

**`numero_completo` se valida con `z.string().min(1)` y nada más.** El formato no lo puede validar Zod, porque depende del país y el DTO no consulta la base. Se valida en el repositorio, contra `patron_numero`. Esa es la diferencia principal con el diseño de un solo país, y es deliberada.

Los nueve validadores corren **dentro** de la transacción y reciben la `trx`, como en todo el proyecto. El orden importa: el primero devuelve la configuración que usan el segundo y el tercero.

1. `resolvePais` — si viene `pais_id`, lo busca y exige `isActive = 1`. Si no viene, busca el único país activo; si hay más de uno, lanza 400 pidiendo el campo. Devuelve la fila de `paises_config`.
2. `validateFormatoNumero` — si `patron_numero` no es `NULL`, `numero_completo` debe coincidir.
3. `validateAutorizacion` — si `requiere_autorizacion` es `1`, `autorizacion` es obligatoria; si además `patron_autorizacion` no es `NULL`, debe coincidir.
4. `validateClienteActivo` — el cliente existe y tiene `isActive = 1`.
5. `validateNumeroDisponible` — no hay otro documento con ese `(pais_id, numero_completo)`. El `UNIQUE` es la red; esto da el mensaje legible.
6. `validateLotesExistenYSonDelCliente` — cada `lote_id` existe y su `cliente_id` es el del documento.
7. `validateLotesFinalizados` — cada lote tiene `finalizado_por IS NOT NULL`.
8. `validateLotesNoFacturados` — ningún `lote_id` está ya en `documento_fiscal_lote` de un documento con `isActive = 1`.
9. `validateTotalesCuadran` — `total` es igual a `importe_exento + importe_exonerado + Σ base_gravada + Σ impuesto`, con tolerancia de 0.01 por redondeo.

`moneda`, si no viene en el cuerpo, se toma de `paises_config.moneda`.

Los tres `INSERT` —cabecera, impuestos, lotes— van en la misma transacción. El método devuelve `Number(result.insertId)`, como todos los `create` del proyecto.

**`validateLotesFinalizados` no necesita mirar `motivo_rechazo`.** El SPEC 20 congela el lote al finalizarlo: `PATCH /lotes/:id/rechazar/byApprover` exige la etapa `CLIENTE_FINAL` y empieza a responder 400. Un lote finalizado no puede rechazarse después, así que `finalizado_por IS NOT NULL` implica que no está rechazado. Se documenta aquí para que nadie agregue la condición "por si acaso".

### `PATCH /documentos-fiscales/:id/completar`

Cuerpo con `documento_aduanero` y `archivo_url`, ambos opcionales, **al menos uno** presente. Escribe solo los que vengan y solo si la columna está en `NULL`; un campo ya escrito responde 400.

Es la única escritura del proyecto que actualiza un campo que no es de auditoría ni de ciclo de vida, y tiene motivo: **el documento aduanero llega después de la factura**. Se emite el documento, después embarca, después cierra aduana. Exigirlo al registrar significa o que nadie registra a tiempo, o que alguien inventa un número.

400 si el documento no existe, si está anulado, o si el campo que se manda ya tiene valor.

### `PATCH /documentos-fiscales/:id/anular`

Cuerpo con un `motivo` obligatorio de 5 a 255 caracteres, igual que los cinco `rechazar` del proyecto. Escribe `isActive = 0`, `motivo_anulacion`, `anulado_por` y `anulado_en = NOW()`. Responde `{ ok, msg }` sin payload del recurso, como sus cinco hermanos.

400 si el documento no existe o ya está anulado.

**No borra las filas hijas.** Los impuestos y los lotes del documento anulado quedan donde están: se anula el documento, no se destruye la evidencia. La consecuencia útil es que `validateLotesNoFacturados` filtra por `isActive = 1`, así que **anular libera los lotes** para volver a facturarlos en el documento correcto.

### `GET /documentos-fiscales`

Tres query params opcionales, con la convención del SPEC 16: `.optional().catch(undefined)`, de modo que **ningún valor inválido produce 400**, se ignora y la consulta corre sin él.

| Param | Filtro |
| --- | --- |
| `cliente_id` | `=` sobre `documentos_fiscales.cliente_id` |
| `desde` | `>=` sobre `fecha_emision`, `YYYY-MM-DD` |
| `hasta` | `<=` sobre `fecha_emision`, inclusivo del día |

`isActive = 1` se aplica siempre y ningún param lo levanta: los documentos anulados no se listan. Orden `fecha_emision DESC`.

Ninguna transformación cambia de tipo salvo `z.coerce.number()` en `cliente_id`, que es idempotente. Eso importa por lo que `CLAUDE.md` documenta desde el SPEC 16: el `ZodValidationPipe` está registrado **dos veces** —como `APP_PIPE` y en `main.ts`— y una transformación no idempotente pierde el campo en silencio en la segunda pasada.

Cada elemento trae la cabecera más `cliente` (`clientes.nombre`, por `INNER JOIN`), `cliente_rtn` (`clientes.rtn`) y `pais` (`paises_config.codigo_pais`). No trae impuestos ni lotes: para eso está el detalle.

### `GET /documentos-fiscales/:id`

**Es el endpoint que este spec existe para construir.** Devuelve la cabecera, su cliente, su país, sus impuestos, sus lotes y, por cada lote, la trazabilidad que ya está en la base:

- `nombre_lote`, `variedad_o_talla`, `producto`, `unidad_medida`
- `aprobado_por` y `finalizado_por`, resueltos a `usuarios.complete_name`, con `aprobado_en` y `finalizado_en`
- el conteo de pesajes con `isActive = 1` y la suma de sus `peso_neto`

Esa última línea es lo que cierra el caso en una auditoría: el número declarado y el peso físico que lo respalda, con firma y fecha, en la misma respuesta.

Del país devuelve `codigo_pais`, `etiqueta_autorizacion` y `etiqueta_identificacion`, para que el frontend rotule `CAI` o `NIT` sin conocer el país.

**Devuelve el documento aunque esté anulado**, con `isActive: 0` y su `motivo_anulacion` como campo. Es lo contrario del SPEC 21, donde un pesaje anulado responde 400 y el motivo viaja dentro del mensaje de error. La razón es el propósito: un endpoint de auditoría que esconde lo anulado no sirve para auditar.

404 si el id no existe, como `GET /pesajes/:id` y `GET /permisos/me`. No hay 400 por estado.

### Lo que cambia en los conteos

| Conteo | Antes | Después |
| --- | --- | --- |
| Rutas que mapea Nest | 27 | **32** |
| Módulos de negocio | 6 | **7** |
| Operaciones en `/docs-json` | 26 | **31** |
| Claves en `paths` | 25 | **29** |
| Endpoints `POST` | 3 | **4** |
| Endpoints `PATCH` / `UPDATE`s | 8 | **10** |
| `GET` por id | 1 | **2** |
| Rutas que se saltan `validateVinculoOperador` | 16 | **21** |
| Escrituras abiertas a cualquier autenticado | 8 | **11** |
| Lecturas abiertas a cualquier autenticado | 16 | **18** |
| Tablas en `Database` | 13 | **17** |
| FKs reales en MySQL | 8 | **16** |
| `UNIQUE` reales en MySQL | 2 | **6** |
| Filas en `catalogo_permisos` / `permisos` | 9 / 14 | **9 / 14**, sin cambio |
| Filas en `roles` | 2 | **2**, sin cambio |

---

## Implementation plan

1. Anotar el punto de partida. Arrancar con `npm run start:dev` y confirmar las **27** rutas del log. En MySQL, identificar un cliente con al menos un lote en la etapa `FINALIZADO`; si no hay ninguno, llevar uno por el flujo completo (`POST /lotes` → `POST /pesajes` → `PATCH /lotes/:id/aprobar` → `PATCH /pesajes/:id/aprobar/byApprover` → `PATCH /lotes/:id/finalizar/byApprover`). Guardar ese `cliente_id` y ese `lote_id`.
2. Aplicar el DDL a mano en MySQL, en el orden del bloque de arriba: `paises_config`, `documentos_fiscales`, las dos hijas, el `ALTER` de `clientes` y la fila semilla de Honduras. Verificación: `SHOW CREATE TABLE documentos_fiscales` muestra las cuatro FKs y el `UNIQUE (pais_id, numero_completo)`; `SELECT * FROM paises_config` devuelve una fila.
3. Actualizar `src/database/types/types.ts` con las cuatro interfaces, las cuatro claves de `Database` y la columna de `ClientesTable`. Verificación: `npm run build` pasa.
4. Crear el módulo vacío: `documentos-fiscales.module.ts` con `imports: [DatabaseModule]`, el controller y el service vacíos, y registrarlo en `src/app.module.ts`. Verificación: el log arranca con **27** rutas, ninguna nueva todavía.
5. Crear los cuatro DTOs. Verificación: `npm run build` pasa. `numero_completo` queda como `z.string().min(1)`, sin regex.
6. Implementar `createDocumentoFiscal` en el repositorio, con la transacción, los nueve validadores privados y los tres `INSERT`. Verificación: `npm run build` pasa.
7. Agregar el service y el handler `@Post()`. Verificación: el log arranca con **28** rutas. Registrar un documento contra el lote del paso 1, **sin** mandar `pais_id` ni `moneda`, y confirmar en MySQL que quedaron el país sembrado y `HNL`.
8. Implementar `getDocumentosFiscales` con sus tres filtros, el service y el handler `@Get()`. Verificación: **29** rutas; el documento del paso 7 aparece; los tres params filtran; un valor inválido se ignora y responde 200.
9. Implementar `completarDocumentoFiscal`, el service y el handler `@Patch(':id/completar')`. Verificación: **30** rutas; escribe `documento_aduanero`, y un segundo intento sobre el mismo campo responde 400.
10. Implementar `anularDocumentoFiscal`, el service y el handler `@Patch(':id/anular')`. Verificación: **31** rutas; el documento desaparece del listado y sus filas hijas siguen en MySQL.
11. Implementar `getDocumentoFiscalById` con el país, los impuestos, los lotes y la trazabilidad, el service y el handler `@Get(':id')` **declarado último en la clase**. Verificación: **32** rutas; el detalle trae las dos etiquetas del país, el conteo de pesajes y la suma de pesos netos; un id inexistente responde 404.
12. Verificación del comportamiento multi-país, sin habilitar un país nuevo en producción: insertar una segunda fila de prueba en `paises_config` con `patron_numero` distinto y `requiere_autorizacion = 0`. Confirmar, uno por uno, que un `POST` sin `pais_id` responde **400** pidiendo el campo; que con el `pais_id` de la fila de prueba acepta un `numero_completo` que Honduras rechaza; que no exige `autorizacion`; que toma la moneda de esa fila; y que el mismo `numero_completo` puede existir en los dos países. Borrar la fila de prueba y sus documentos al terminar.
13. Verificación de los bordes de `POST`, uno por uno: un `cliente_id` inexistente o rechazado responde 400; un `numero_completo` repetido en el mismo país responde 400; un `numero_completo` que no cumple `patron_numero` responde 400; un lote **abierto** responde 400; un lote **aprobado y no finalizado** responde 400; un lote de **otro cliente** responde 400; un lote ya facturado responde 400; un `total` que no cuadra responde 400; `lotes: []` responde 400; un `pais_id` inexistente o inactivo responde 400.
14. Verificar que **anular libera el lote**: anular el documento del paso 7 y registrar uno nuevo con el mismo `lote_id` responde 201.
15. Verificación de no regresión: llamar a los 27 endpoints previos y confirmar que ninguno cambió de forma. En particular `GET /clientes` y `GET /clientes/all`, que siguen devolviendo sus **seis** campos pese a la columna nueva en `clientes`.
16. Agregar `@ApiTags('documentos-fiscales')`, `@ApiBearerAuth()`, y `@ApiOperation` y `@ApiParam` en los cinco handlers. Verificación: `/docs` muestra el tag nuevo con cinco rutas, y `/docs-json` tiene **31** operaciones en **29** claves de `paths`.
17. `npm run lint` y `npm run build` sin errores nuevos.
18. Actualizar `CLAUDE.md`:
    - El módulo nuevo en la tabla de endpoints, con las cinco rutas y sus respuestas.
    - Las cuatro tablas nuevas y la columna de `clientes` en la sección Domain.
    - Que **`paises_config` es la primera tabla del proyecto que parametriza comportamiento**, y que por eso el formato del número se valida en el repositorio y no en el DTO.
    - Que el proyecto pasa de 8 a **10** `UPDATE`s, y que dos de ellos son de un módulo nuevo.
    - Que `PATCH /documentos-fiscales/:id/completar` es la **primera** escritura que actualiza un campo que no es de auditoría ni de ciclo de vida, y por qué.
    - Que `GET /documentos-fiscales/:id` es el **segundo** `GET` por id y que su `@Get(':id')` va último en el controller.
    - Que es el **primer** endpoint que devuelve un registro anulado en vez de esconderlo o responder 400, y por qué se aparta del SPEC 21.
    - Los conteos nuevos de la tabla de arriba, incluidas las 16 FKs y los 6 `UNIQUE`.
    - Que no se sembró ninguna fila en `catalogo_permisos`, `permisos` ni `roles`, y que es el decimocuarto spec seguido que se salta la regla del SPEC 06.
    - Que el sistema **registra** documentos fiscales y no los emite, y que eso no equivale a cumplir con ningún régimen de facturación.
    - Que habilitar un segundo país exige `clientes.pais_id`, la unicidad de `rtn` por país y un cambio en `POST /clientes`, y que eso es un spec aparte.

---

## Acceptance criteria

- [X] La app arranca, `npm run build` pasa y `npm run lint` no introduce errores nuevos.
- [X] El log de Nest mapea **32** rutas, con el reparto `auth` 2, `catalogos` 3, `clientes` 4, `lotes` 9, `permisos` 1, `pesajes` 7, `documentos-fiscales` **5**, más `GET /`.
- [X] Las cuatro tablas existen en MySQL con sus ocho FKs y sus cuatro `UNIQUE`.
- [X] `paises_config` tiene la fila de Honduras con `moneda = 'HNL'`, `etiqueta_autorizacion = 'CAI'` y `etiqueta_identificacion = 'RTN'`.
- [X] `clientes` tiene la columna `constancia_exonerado` y **no** tiene `pais_id`.
- [X] `POST /documentos-fiscales` responde **201** con `{ ok, msg, documento_id }` y crea las filas de las tres tablas en una sola transacción.
- [X] Un `POST` **sin** `pais_id` se registra contra el único país activo.
- [X] Con dos países activos, un `POST` sin `pais_id` responde **400** pidiendo el campo.
- [X] Un `pais_id` inexistente o con `isActive = 0` responde **400**.
- [X] Un `POST` **sin** `moneda` guarda la moneda de `paises_config`.
- [X] Un `numero_completo` que no cumple `patron_numero` del país responde **400**.
- [X] Con `patron_numero` en `NULL`, cualquier `numero_completo` se acepta.
- [X] Con `requiere_autorizacion = 1`, un `POST` sin `autorizacion` responde **400**; con `0`, se acepta.
- [X] El mismo `numero_completo` puede existir en dos países distintos.
- [X] Un `numero_completo` ya registrado **en el mismo país** responde **400** con mensaje legible, no un error de MySQL.
- [X] **No hay ninguna expresión regular de Honduras en ningún DTO ni en ningún archivo de código.** El único lugar donde vive es la fila de `paises_config`.
- [X] **No existen las columnas `cai`, `duca`, `orden_compra_exenta` ni `es_centroamerica`** en ninguna tabla.
- [X] Un `POST` con `impuestos` vacío o ausente crea el documento sin filas en `documento_fiscal_impuesto`.
- [X] Un `POST` con dos impuestos de tarifas distintas crea dos filas; con dos de la misma tarifa responde 400.
- [X] Un `cliente_id` inexistente o con `isActive = 0` responde **400**.
- [X] Un lote **abierto** responde **400**.
- [X] Un lote **aprobado y no finalizado** responde **400**.
- [X] Un lote **rechazado** responde **400**.
- [X] Un lote de **otro cliente** responde **400**.
- [X] Un lote ya vinculado a un documento con `isActive = 1` responde **400**.
- [X] `lotes: []` responde **400**.
- [X] Un `total` que no cuadra con la suma de importes responde **400**; una diferencia de 0.01 se acepta.
- [X] `documento_aduanero` y `archivo_url` enviados en el `POST` se ignoran y quedan en `NULL`.
- [X] `GET /documentos-fiscales` responde **200** con `{ ok, msg, documentos }`, ordenado por `fecha_emision` descendente.
- [X] Los tres query params filtran, se combinan con `AND`, y **ningún valor inválido produce 400**.
- [X] Sin params, el listado no incluye documentos anulados.
- [X] `PATCH /documentos-fiscales/:id/completar` escribe `documento_aduanero` y `archivo_url` cuando están en `NULL` y responde `{ ok, msg }`.
- [X] Un segundo `completar` sobre un campo ya escrito responde **400**, y el otro campo puede completarse por separado.
- [X] Un `completar` sin ninguno de los dos campos responde **400**.
- [X] `PATCH /documentos-fiscales/:id/anular` escribe `isActive = 0`, `motivo_anulacion`, `anulado_por` y `anulado_en`, y responde `{ ok, msg }` sin payload.
- [X] Un `motivo` de menos de 5 o más de 255 caracteres responde **400**.
- [X] Anular dos veces responde **400** la segunda.
- [X] Anular **no borra** las filas de `documento_fiscal_impuesto` ni de `documento_fiscal_lote`.
- [X] Después de anular, el mismo `lote_id` puede registrarse en un documento nuevo.
- [X] `GET /documentos-fiscales/:id` responde **200** con `{ ok, msg, documento }`, incluyendo país, impuestos, lotes y, por cada lote, `nombre_lote`, `producto`, `unidad_medida`, `aprobado_por`, `aprobado_en`, `finalizado_por`, `finalizado_en`, el conteo de pesajes activos y la suma de `peso_neto`.
- [X] El detalle devuelve `etiqueta_autorizacion` y `etiqueta_identificacion` del país.
- [X] `aprobado_por` y `finalizado_por` traen el nombre completo del usuario, no un id.
- [X] Un documento **anulado** responde **200** en el detalle, con `isActive: 0` y su `motivo_anulacion`.
- [X] Un id inexistente responde **404**; un id no numérico responde **400** del `ParseIntPipe`.
- [X] `@Get(':id')` está declarado **último** en `DocumentosFiscalesController`, y `GET /documentos-fiscales` sigue respondiendo el listado.
- [X] Las cinco rutas responden **401** sin token.
- [X] Un usuario **sin** fila en `cliente_operador` para ese cliente responde **200**/**201**, no 403, en las cinco rutas.
- [X] Los cinco handlers tienen `@ApiOperation` con resumen y descripción; los tres con `:id` tienen `@ApiParam`.
- [X] La clase tiene `@ApiTags` y `@ApiBearerAuth`, y no se agregó ningún `@ApiResponse`.
- [X] `/docs-json` tiene **31** operaciones en **29** claves de `paths`.
- [X] Los 27 endpoints previos devuelven exactamente los mismos campos y filas que antes de este spec.
- [X] `GET /clientes` y `GET /clientes/all` siguen devolviendo **seis** campos: la columna nueva de `clientes` no se filtró a ninguna respuesta.
- [X] `ClientesRepository` no cambió: los validadores de `rtn` y `codigo_exportacion` siguen filtrando solo `isActive = 1`.
- [X] `catalogo_permisos` sigue con **9** filas, `permisos` con **14** y `roles` con **2**.
- [X] No existe ningún `PermissionsGuard` ni decorador `@Permisos()`.
- [X] No se generó ningún correlativo, ninguna autorización, ningún cálculo de impuesto y ningún PDF.
- [X] `README.md` no cambió.
- [X] `CLAUDE.md` documenta el módulo, las tablas, los cinco endpoints, todos los conteos nuevos y lo que exige habilitar un segundo país.

---

## Decisions

- **Sí:** el sistema **registra** documentos fiscales, no los emite. Decisión explícita del usuario, tomada al simplificar el alcance. Elimina las tablas de emisor, punto de emisión y autorizaciones, la generación de correlativo con su `SELECT ... FOR UPDATE`, la rotación de autorización, el cálculo de impuesto, el total en letras y el PDF. Y vuelve irrelevante la pregunta que bloqueaba el diseño: funciona igual sea la empresa autoimpresor o facture por imprenta.
- **No:** emitir facturas desde este backend. Se descarta por lo anterior. Si algún día se emite, es un spec propio y arrastra las tres tablas de configuración.
- **Sí:** el régimen de cada país es dato en `paises_config`, no estructura. Decisión explícita del usuario, que pidió que el software sirva fuera de Honduras. Elimina las columnas `cai`, `duca`, `orden_compra_exenta` y `es_centroamerica`, todas específicas de un país, y las reemplaza por `autorizacion`, `documento_aduanero`, `referencia_exencion` y `pais_destino`.
- **Sí:** `numero_completo` es `VARCHAR(50)`, no `VARCHAR(20)`. La clave numérica de Costa Rica tiene 50 dígitos y no cabe en el ancho que pedía el formato hondureño.
- **Sí:** `autorizacion` es nullable. No todo país entrega un código antes de emitir; `requiere_autorizacion` decide si se exige.
- **Sí:** el `UNIQUE` va sobre `(pais_id, numero_completo)`, no sobre el número solo. Dos países pueden emitir el mismo número y un `UNIQUE` global los haría chocar sin razón.
- **Sí:** `pais_destino` es `CHAR(2)` ISO 3166, no texto libre. Texto libre no agrupa en un reporte, y el destino es exactamente lo que un reporte de exportaciones necesita agrupar.
- **No:** guardar `es_centroamerica`. Se descarta: es derivable de `pais_destino` comparando contra la lista de la región, y guardar un dato calculable obliga a mantenerlo sincronizado. El reporte lo deriva.
- **Sí:** el formato del número se valida en el repositorio, no en el DTO. Zod no consulta la base y por tanto no conoce el país. Es la única regla de validación del proyecto que no vive en su DTO, y la razón queda escrita aquí y en `CLAUDE.md`.
- **Sí:** `pais_id` es opcional en el cuerpo y se resuelve al único país activo cuando se omite. Con un país, el frontend no manda nada y no hace falta un selector. Con dos o más, responde 400 pidiendo el campo, que es un error explícito y no una elección silenciosa.
- **No:** `GET /catalogos/paises`. Se descarta mientras haya una sola fila activa: sería un selector de un elemento. Lo agrega el spec del segundo país.
- **No:** `clientes.pais_id` en este spec. Decisión explícita del usuario. La columna solo sirve cuando existe el segundo país, y agregarla ahora obliga a tocar `POST /clientes`, su DTO y los dos validadores de unicidad para nada. Se difiere entera, con su salida escrita en `Out of scope`.
- **No:** renombrar `clientes.rtn` a algo neutral. Se descarta por tres razones concretas: el SPEC 17 expone `?rtn` como query param, los dos validadores de unicidad usan la columna, y renombrarla cambia respuestas ya publicadas. Queda como identificador fiscal genérico, y `paises_config.etiqueta_identificacion` dice cómo rotularlo.
- **Sí:** la tarifa del impuesto es un dato en `documento_fiscal_impuesto`, no un nombre de columna. Decisión explícita del usuario, por el miedo a que el ISV pase de 15 a 16. El costo real de columnas con tarifa en el nombre no es agregar `isv_16`: es que cada consulta y cada reporte tiene que conocer todas las tarifas históricas para siempre. Multi-país lo agrava: cada país trae su propio juego de tarifas.
- **Sí:** `importe_exento` e `importe_exonerado` se quedan en la cabecera. No tienen tarifa, son categorías distintas entre sí, y en las declaraciones van en casillas propias. No son "gravado al 0%".
- **Sí:** una tabla hija que va a estar casi siempre vacía. Son exportadores y las exportaciones van exentas, así que `documento_fiscal_impuesto` solo se llena en la venta local ocasional. Se paga una tabla más a cambio de no volver a tocar DDL cuando cambie la tarifa o entre un país nuevo.
- **No:** guardar `cliente_nombre` y `cliente_rtn` como snapshot en la cabecera. Decisión explícita del usuario. El argumento a favor era la inmutabilidad del documento fiscal; el argumento en contra es que hoy **no existe ningún endpoint que actualice un cliente** —el módulo tiene `POST`, tres `GET` y el `PATCH /:id/rechazar`— así que la mutación contra la que protegía solo puede ocurrir a mano en MySQL. Nombre y RTN salen por `INNER JOIN`. Queda como riesgo registrado, con la salida conocida.
- **No:** `direccion_fiscal` en `clientes`. Se cae con la snapshot: la dirección está impresa en el documento y el sistema no lo reproduce.
- **Sí:** `constancia_exonerado` va en `clientes` y `referencia_exencion` en `documentos_fiscales`. La constancia es un registro permanente del cliente; la referencia de exención es por operación.
- **Sí:** el `lote_id` va en `documento_fiscal_lote`, no en la cabecera. Permite una factura que cubra varios lotes y un lote facturado junto a otros. Al revés —`documentos_fiscales.lote_id`, o peor, `lotes.documento_id`— encierra en 1:1 y mete facturación dentro del módulo de calidad.
- **Sí:** solo se facturan lotes en la etapa `FINALIZADO`. Antes de finalizar, la cantidad todavía puede moverse; el SPEC 20 garantiza que al finalizar todo pesaje activo está revisado.
- **No:** validar que `cantidad` cuadre con la suma de `peso_neto` del lote. Se descarta: una factura puede cubrir parte de un lote, puede haber merma entre el pesaje y el embarque, y el documento fiscal es la verdad de lo facturado. Cuadrar las dos cifras es trabajo del auditor, y para eso el detalle devuelve ambas.
- **Sí:** un lote no puede estar en dos documentos activos a la vez. Evita el doble registro, que es el error más probable en digitación manual.
- **Sí:** anular libera el lote. Es la consecuencia de que `validateLotesNoFacturados` filtre por `isActive = 1`, y es lo que permite corregir un documento mal digitado sin tocar filas.
- **Sí:** corregir es anular y registrar de nuevo. Nunca `UPDATE` sobre los importes, el número o la autorización. Es la misma forma que los cinco `rechazar` del proyecto y lo que hace que el registro sirva como evidencia.
- **Sí:** `completar` es la excepción a lo anterior, y solo para `documento_aduanero` y `archivo_url`. El documento aduanero llega después de la factura, cuando cierra aduana. Exigirlo al registrar significa o que nadie registra a tiempo, o que alguien inventa un número. Se escribe una sola vez cada campo.
- **Sí:** el detalle devuelve documentos anulados con **200**. Se aparta a propósito del SPEC 21, donde un pesaje anulado responde 400: un endpoint que existe para auditar no puede esconder lo anulado, que es justo lo que un auditor quiere ver.
- **Sí:** `404` en el detalle cuando el id no existe, como `GET /pesajes/:id` y `GET /permisos/me`.
- **Sí:** el `UNIQUE` sobre el número es una restricción real de MySQL. Tercera y decisiva excepción a la regla de "unicidad solo en código": la ventana de carrera que `CLAUDE.md` documenta produce, en `clientes`, un RTN duplicado molesto; aquí produciría dos documentos con el mismo número, que es sanción.
- **Sí:** ocho FKs reales. Misma justificación que el SPEC 14 y que las columnas de auditoría de los SPEC 10 a 13: es evidencia que no sirve de nada apuntando a una fila inexistente.
- **Sí:** los filtros del listado siguen la convención del SPEC 16 y **no producen 400**. Se elige el SPEC 16 y no el comportamiento que shippeó el SPEC 17 —donde `.optional()` sin `.catch()` sí lanza— porque el SPEC 16 es el que está escrito como convención y el del 17 no lo recoge ningún spec.
- **No:** un CRUD de `paises_config`. La tabla se mantiene a mano, como `etapas`, `estados_calidad` y los permisos. Un país nuevo es una decisión de negocio, no una operación de pantalla.
- **No:** el rol `CONTADOR` y las filas en `catalogo_permisos` y `permisos`. Decisión explícita del usuario, que las quitó del diseño. Decimocuarto spec seguido que se salta la regla del SPEC 06. El argumento es el del SPEC 09 y siguientes: sin `PermissionsGuard` la fila no cambia nada, y un rol sin permisos y sin enforcement es dato muerto. Consecuencia asumida y registrada abajo.
- **No:** `GET /documentos-fiscales/resumen-isv`. Se difiere: sirve para declarar, no para auditar. `pais_destino` se guarda desde ya para que ese spec no necesite DDL.
- **No:** carga de archivos. `archivo_url` guarda una cadena; dónde vive el archivo y quién lo sube es otro problema.
- **No:** paginación. No la tiene ninguna lectura del proyecto y este spec no es el lugar para estrenarla.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **Sin snapshot del cliente, editar `clientes.nombre` o `clientes.rtn` en MySQL cambia retroactivamente lo que reportan todos los documentos históricos.** `clientes` no tiene `updated_by` ni historial, y así se administran los datos de referencia en este proyecto. | Aceptado por decisión. Hoy no existe endpoint que actualice un cliente, así que solo ocurre a mano. Mitigación práctica: `archivo_url` con el escaneo del documento es la prueba de lo que se imprimió. Salida conocida: si aparece un `PATCH /clientes/:id`, hay que agregar las dos columnas y backfillear, y es más barato hacerlo con poco volumen. |
| **`archivo_url` es nullable, así que un documento sin adjunto y sin snapshot no tiene cómo probar qué decía el papel.** | Sin mitigar en código, y es la consecuencia directa del riesgo anterior. Se recomienda que el flujo operativo exija el adjunto. Anotado en `CLAUDE.md`. |
| **`patron_numero` es una expresión regular guardada en la base y ejecutada por el backend.** Una expresión mal escrita rechaza documentos válidos; una con retroceso catastrófico cuelga la petición. | La tabla se mantiene a mano por quien administra la base, no por un endpoint, así que la superficie es la misma que la de `etapas`. Anotado: revisar cada patrón antes de sembrarlo, y preferir patrones anclados y sin cuantificadores anidados. |
| **La unicidad de `clientes.rtn` sigue siendo global.** El día que entre el segundo país, dos clientes de países distintos con el mismo número chocarán sin razón. | Aceptado mientras haya un país, donde la regla es correcta. La salida está escrita en `Out of scope`: pasa a `(pais_id, rtn)` en el spec del segundo país, junto con `clientes.pais_id`. |
| **Las tres escrituras están abiertas a cualquier autenticado.** Un operador de báscula puede registrar y **anular** un documento fiscal. Anular borra del listado la evidencia que este módulo existe para conservar. | Aceptado por decisión, con la consecuencia sobre la mesa. Es de otra categoría que las ocho escrituras abiertas del módulo de calidad, y así queda dicho en `CLAUDE.md`. Mitigación parcial en el diseño: anular no borra filas, deja rastro con `anulado_por` y `anulado_en`, y el detalle sigue devolviendo el documento anulado. La salida real es el `PermissionsGuard`, sin dueño desde el SPEC 06. |
| **Las dos lecturas están abiertas a cualquier autenticado**, con `id` secuencial. Cualquiera recorre todas las facturas de la empresa: clientes, montos y destinos. | Aceptado por decisión, como las otras dieciséis rutas abiertas. Es la información comercialmente más sensible que el proyecto haya expuesto, y así se documenta. |
| **Doble digitación.** El número, la autorización y los importes ya están escritos en otro lado; transcribirlos introduce errores, y un identificador o un total mal tecleado en una auditoría es peor que no tener el registro. | Cuatro redes: el `UNIQUE` corta el duplicado, `patron_numero` corta el formato inválido, `validateTotalesCuadran` corta la suma incoherente, y `archivo_url` permite contrastar contra la imagen. Ninguna cubre un importe mal tecleado que sí cuadre. |
| **Un lote facturado puede quedar huérfano de documento si se anula y nadie registra el correcto.** No hay alerta. | Sin mitigar en este spec. La consulta que lo detecta es "lotes con `finalizado_por IS NOT NULL` sin fila en `documento_fiscal_lote` de un documento activo", y es exactamente el listado de pendientes por facturar que un spec futuro puede exponer. |
| **`validateTotalesCuadran` usa una tolerancia fija de 0.01.** Con muchas líneas de impuesto el redondeo acumulado podría exceder la tolerancia y rechazar un documento correcto. | Aceptado: en exportaciones habrá cero o una fila de impuesto. Anotado por si aparece venta local con varias tarifas. |
| **La factura electrónica puede volverse obligatoria**, en Honduras o en el país que entre después, y entonces el registro manual queda corto. | Anotado y fuera de alcance. La forma de las tablas no estorba: un documento transmitido se registra igual, con campos adicionales. |
| **La columna nueva en `clientes` puede filtrarse a las respuestas** si alguien usa `selectAll()` al tocar ese módulo. | `ClientesRepository` selecciona campos explícitos en sus tres lecturas. Hay un criterio de aceptación que verifica que los seis campos no cambiaron. |

---

## What is **not** in this spec

- Emitir documentos fiscales: tablas de emisor, punto de emisión y autorizaciones, correlativo, cálculo de impuesto, total en letras y PDF.
- Habilitar el segundo país como operación: `clientes.pais_id`, la unicidad de `rtn` por país, `POST /clientes` con país y `GET /catalogos/paises`.
- Un CRUD de `paises_config`.
- Factura electrónica y cualquier transmisión a una autoridad tributaria.
- `GET /documentos-fiscales/resumen-isv` y cualquier exportación de archivos para DET Live o para el contador.
- Carga y almacenamiento del archivo adjunto.
- Notas de crédito y de débito como flujo, con relación al documento que corrigen.
- Cuentas por cobrar, pagos, saldos y estados de cuenta.
- Precios: tabla de precios, precio unitario y cualquier cálculo de importes.
- Validar la cantidad facturada contra el peso neto del lote.
- Deshacer una anulación, editar un documento anulado, o editar importes, número o autorización de uno registrado.
- Snapshot de nombre y RTN del cliente, `direccion_fiscal` en `clientes` y renombrar `clientes.rtn`.
- Un `PATCH /clientes/:id` para mantener `constancia_exonerado`.
- El rol `CONTADOR`, las filas en `catalogo_permisos` y en `permisos`.
- `PermissionsGuard`, `@Permisos()` y cualquier enforcement de roles o permisos.
- Validar el vínculo `cliente_operador` en cualquiera de las cinco rutas.
- Un listado de lotes finalizados pendientes por facturar.
- Paginación y límite.
- Cambios a cualquier endpoint de `lotes`, `pesajes`, `clientes`, `auth`, `permisos` o `catalogos`.
- Tests de cualquier tipo.

Cada uno de estos, si se necesita, va en su propio spec.
