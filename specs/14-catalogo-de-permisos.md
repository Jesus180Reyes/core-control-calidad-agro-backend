# SPEC 14 — Catálogo de permisos

> **Status:** Approved
> **Depends on:** SPEC 06, SPEC 07, SPEC 08
> **Date:** 2026-09-03
> **Objective:** Extraer `codigo`, `nombre` y `descripcion` de `permisos` a una tabla nueva `catalogo_permisos`, y dejar `permisos` como puente `(rol_id, permiso_id)`, para que renombrar un permiso sea editar una sola fila.

---

## Why this spec exists

Hoy `permisos` guarda las tres cosas juntas: qué permiso es (`codigo`, `nombre`, `descripcion`) y a qué rol pertenece (`rol_id`). La consecuencia es que un permiso compartido se escribe una vez por rol. La tabla tiene **14 filas** y solo **9 códigos distintos**: cinco de ellos están duplicados.

Cambiar el `nombre` de `RECHAZAR-LOTE` obliga hoy a tocar dos filas. Con un tercer rol serían tres. Nada garantiza que queden iguales.

Hay que ser explícito con seis cosas.

**La primera: este spec revierte una decisión estructural de SPEC 06.** No es un descubrimiento nuevo. SPEC 06 evaluó el modelo de catálogo más tabla puente, lo descartó por decisión explícita del usuario, y dejó anotada la consecuencia con estas palabras: *"un permiso compartido se escribe una vez por rol, así que renombrar `lotes.crear` obliga a actualizar todas sus filas"*. También lo dejó como riesgo: *"al no haber catálogo, el `nombre` y la `descripcion` de un mismo `codigo` pueden divergir entre roles"*. Este spec es el que paga esa deuda. Es el primer spec del proyecto que deshace la forma de una tabla que otro spec creó.

**La segunda: es el primer DDL destructivo del proyecto.** Todo el DDL de SPEC 06, 10, 11, 12 y 13 fue aditivo: `CREATE TABLE` y `ADD COLUMN`. Este spec ejecuta `DROP COLUMN` sobre tres columnas de una tabla con datos, y un `DROP INDEX`. Sin herramienta de migraciones y sin `.sql` en el repo, eso solo se puede hacer con el orden de pasos escrito y verificado. Ese orden es la parte importante del plan: el `DROP COLUMN` es el **penúltimo** paso, no el primero, y no se ejecuta hasta que el repositorio ya dejó de leer esas columnas.

**La tercera: `permisos` conserva su nombre pero cambia de significado.** Deja de ser "los permisos" y pasa a ser "qué permisos tiene cada rol". El nombre queda peor de lo que describe, y eso se acepta a cambio de no renombrar una tabla ni tocar la clave `permisos` de la interfaz `Database`. La alternativa —`permisos` como catálogo y un `rol_permiso` nuevo— se presentó y se descartó.

**La cuarta: por fuera no cambia nada.** `GET /permisos/me` sigue respondiendo `{ ok, msg, permisos: string[] }`, con exactamente los mismos códigos que devuelve hoy para cada rol. El único cambio de código del proyecto es el `SELECT` de `PermisosRepository`, que pasa a llevar un `INNER JOIN`. No hay endpoint nuevo, no hay DTO nuevo y `src/app.module.ts` no se toca. Buena parte de los criterios de aceptación de este spec verifican que **nada** cambió.

**La quinta: sigue sin aplicarse nada.** No hay `PermissionsGuard` ni decorador `@Permisos()`, `req.user` sigue siendo `{ userId, username }` y el payload del JWT no cambia. El catálogo arranca con los mismos 9 códigos que ya están sembrados y no se agrega ninguno. Este spec **no** decide qué rol puede qué: deja las asignaciones exactamente donde estaban, en una estructura donde cambiarlas cuesta una fila en vez de una por rol.

**La sexta: la tabla real no es la que documentan SPEC 06, SPEC 08 y `CLAUDE.md`, y este spec lo corrige.** El paso 1 del plan lo descubrió. Lo documentado son 11 filas con 7 códigos en formato `modulo.accion` minúsculo; lo que hay son **14 filas con 9 códigos** en formato `MODULO-ACCION` mayúsculo con guiones, ninguno de los 7 documentados. Hay tres consecuencias. La primera: el formato en mayúsculas es justo el que SPEC 06 descartó por decisión explícita (*"No: códigos en MAYÚSCULAS tipo `CLIENTES_CREAR`"*), y aparecen además permisos de acceso a pantalla (`MODULO-CLIENTES`, `MODULO-CONTROL-CALIDAD`) que no son `modulo.accion` en absoluto. La segunda: **sí hay filas** para `APROBAR-LOTE`, `RECHAZAR-LOTE`, `RECHAZAR-CLIENTE` y `RECHAZAR-PESAJE-LOTE`, así que la afirmación que SPEC 10, 11, 12 y 13 repiten —que sus endpoints no tienen permiso sembrado y que la tabla sigue en 11 filas— es falsa desde que alguien las insertó a mano. La tercera: este spec **no normaliza nada**. Los 9 códigos se copian tal cual, porque cambiarlos cambiaría lo que `GET /permisos/me` devuelve, y eso está fuera de alcance. Lo que sí hace es dejarlos en un lugar donde renombrarlos sea un `UPDATE` de una fila, que es exactamente para lo que sirve el catálogo.

---

## Scope

**In:**

- DDL a mano en MySQL: nueva tabla `catalogo_permisos` con `codigo` único **global**, `nombre`, `descripcion` nullable, `isActive` y `created_at`.
- Semilla del catálogo por copia, no por transcripción a mano: `INSERT ... SELECT DISTINCT codigo, nombre, descripcion FROM permisos`. Quedan 9 filas.
- Corregir en este spec los conteos y los códigos que SPEC 06, SPEC 08 y `CLAUDE.md` documentan mal, verificados contra la base en el paso 1.
- DDL a mano en MySQL sobre `permisos`: nueva columna `permiso_id`, backfill por `codigo` con un `UPDATE ... JOIN`, y después `NOT NULL`.
- DDL destructivo a mano en MySQL sobre `permisos`, **solo después de que el código deje de leer esas columnas**: `DROP INDEX uq_permisos_rol_codigo`, `DROP COLUMN codigo`, `DROP COLUMN nombre`, `DROP COLUMN descripcion`.
- Constraints nuevos: `UNIQUE (codigo)` en `catalogo_permisos`, `UNIQUE (rol_id, permiso_id)` en `permisos` y FK de `permisos.permiso_id` a `catalogo_permisos(id)`.
- `permisos` conserva su nombre, su `id`, su `rol_id`, su FK a `roles(id)`, su `isActive` y su `created_at`.
- `catalogo_permisos.isActive` retira un permiso del sistema entero; `permisos.isActive` lo retira de un rol. Las dos columnas se conservan.
- Nueva interfaz `CatalogoPermisosTable` en `src/database/types/types.ts` y su clave `catalogo_permisos` en la interfaz `Database`.
- `PermisosTable` pierde `codigo`, `nombre` y `descripcion`, y gana `permiso_id`.
- Modificar el segundo `SELECT` de `getPermisosByUsuarioId` en `src/modules/permisos/repository/permisos.repository.ts` para que haga `INNER JOIN` contra `catalogo_permisos` y filtre los dos `isActive`.
- Actualizar `CLAUDE.md`: la tabla `catalogo_permisos` en la sección de dominio, el nuevo significado de `permisos`, los constraints nuevos, y la nota de que el `codigo` ya no vive en `permisos`.
- Corregir en `CLAUDE.md` dos afirmaciones que la base desmiente: que `permisos` tiene 11 filas con los 7 códigos de SPEC 06 y SPEC 08, y que los cuatro `PATCH` de escritura no tienen fila sembrada. Hay 14 filas, 9 códigos, y `APROBAR-LOTE`, `RECHAZAR-LOTE`, `RECHAZAR-CLIENTE` y `RECHAZAR-PESAJE-LOTE` existen.

**Out of scope (for future specs):**

- Cualquier endpoint sobre el catálogo: no hay `GET /permisos/catalogo`, ni `GET /catalogos/permisos`, ni CRUD. El catálogo se administra por SQL a mano, que es la decisión que SPEC 06 y SPEC 07 ya tomaron para `permisos`.
- Cambios al contrato de `GET /permisos/me`: sigue devolviendo `permisos: string[]`, no `[{ codigo, nombre }]`.
- Devolver `nombre`, `descripcion` o el `id` del permiso en algún endpoint.
- Sembrar códigos nuevos en el catálogo. Arranca con los mismos 9 que ya están en la base y no se agrega ninguno.
- **Normalizar el formato de los `codigo`.** Los 9 están en `MAYÚSCULAS-CON-GUIONES`, que es el formato que SPEC 06 descartó, y se copian tal cual. Pasarlos a `modulo.accion` cambiaría lo que devuelve `GET /permisos/me` y va en su propio spec — que después de este cuesta un `UPDATE` por código.
- Decidir qué significan `MODULO-CLIENTES` y `MODULO-CONTROL-CALIDAD`, que no son `modulo.accion` sino permisos de acceso a pantalla, ni mapear los 9 códigos a los endpoints que representan.
- Asignar permisos a roles: las 14 filas de `permisos` siguen siendo las mismas 14, y ninguna cambia de rol.
- Corregir SPEC 06, SPEC 08 y los specs 10 a 13, que documentan una tabla que ya no es la que hay. Este spec corrige `CLAUDE.md` y se documenta a sí mismo; reescribir specs ya implementados es otro trabajo.
- **Aplicar** permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`. Ningún endpoint devuelve 403 por falta de permiso.
- Cambios al payload del JWT, a `req.user`, a `POST /auth/login` o a `POST /auth/refresh`.
- Renombrar `permisos` a `rol_permiso` o a `rol_permisos`. La tabla conserva su nombre pese a que ahora es un puente.
- Una tabla `modulos` para agrupar los permisos por su prefijo, ni una columna `catalogo_permisos.modulo` derivada del `codigo`.
- Permisos por usuario individual (`usuario_permiso`).
- Jerarquía o herencia entre roles.
- CRUD de roles.
- Herramienta de migraciones o archivos `.sql` en el repo. El DDL se sigue aplicando a mano y este spec es su única fuente.
- `ON DELETE CASCADE` u `ON UPDATE` en la FK nueva. Queda con el comportamiento por defecto (`RESTRICT`).
- Ordenar la respuesta de `GET /permisos/me`. Sigue sin `ORDER BY`, como decidió SPEC 07.
- Caché de la respuesta.
- Validar `usuarios.isActive`.
- Rellenar `catalogo_permisos.descripcion` donde hoy esté en `NULL`.
- Cambios a los módulos `auth`, `clientes`, `lotes`, `pesajes` y `catalogos`, y a cualquier otro endpoint del proyecto.

---

## Data model

### Estado inicial

`permisos` hoy, verificado contra la base en el paso 1 del plan. **No es lo que documentan SPEC 06, SPEC 08 ni `CLAUDE.md`** — ver el sexto punto de la sección anterior:

| `codigo` | `ADMIN` | `OPERADOR` | Filas |
| --- | :---: | :---: | :---: |
| `APROBAR-LOTE` | ✅ | ✅ | 2 |
| `CREAR-CLIENTE-LOTE-NUEVO` | ❌ | ✅ | 1 |
| `CREAR-CLIENTE-NUEVO` | ❌ | ✅ | 1 |
| `MODULO-CLIENTES` | ✅ | ✅ | 2 |
| `MODULO-CONTROL-CALIDAD` | ✅ | ✅ | 2 |
| `RECHAZAR-CLIENTE` | ✅ | ❌ | 1 |
| `RECHAZAR-LOTE` | ✅ | ✅ | 2 |
| `RECHAZAR-PESAJE-LOTE` | ✅ | ❌ | 1 |
| `VER-CLIENTE-LOTES` | ✅ | ✅ | 2 |

**14 filas, 9 códigos distintos, 5 duplicados: 7 de `ADMIN` y 7 de `OPERADOR`.** Los cinco con 2 filas son los que hacen falta el catálogo: hoy su `nombre` está escrito dos veces. Todas las filas tienen `isActive = 1`, así que `GET /permisos/me` devuelve hoy los 7 códigos de la columna correspondiente. **Esta tabla es la referencia del paso 2 del plan** y contra ella se verifica al final que la migración no cambió nada.

Después de este spec: **9 filas** en `catalogo_permisos` y las mismas **14** en `permisos`.

Los roles se llaman `ADMIN` (id 2) y `OPERADOR` (id 1), en mayúsculas. Los specs anteriores los escriben `Admin` y `Operador`, así que el `INSERT ... SELECT ... WHERE r.nombre = 'Admin'` de la semilla de SPEC 06 hoy no encontraría ninguna fila. Este spec no ejecuta esa semilla y no renombra nada; se anota porque cualquier SQL copiado de SPEC 06 fallaría en silencio.

Este spec **no** mueve ninguna asignación. Queda anotado, sin cambiarlo, que el reparto real no es el que SPEC 06 sembró: `OPERADOR` tiene los dos permisos de creación de clientes y `ADMIN` no, mientras que `RECHAZAR-CLIENTE` y `RECHAZAR-PESAJE-LOTE` son solo de `ADMIN`. Revisar si ese reparto es el deseado es su propio trabajo.

### Contenido del catálogo después de la semilla

Los 9 códigos con el `nombre` y la `descripcion` que ya tenían en `permisos`, tal como quedaron copiados en el paso 3. La última columna **no la decide este spec**: es lo que la `descripcion` de cada fila dice, transcrito, y ningún spec lo confirma:

| `codigo` | `nombre` | `descripcion` | Endpoint que la descripción sugiere |
| --- | --- | --- | --- |
| `APROBAR-LOTE` | Aprobar Lote | Aprueba el lote del cliente activo | `PATCH /lotes/:id/aprobar` |
| `CREAR-CLIENTE-LOTE-NUEVO` | Crear un lote nuevo del cliente | Crea un lote nuevo vinculado al cliente seleccionado | `POST /lotes` |
| `CREAR-CLIENTE-NUEVO` | Crear un cliente nuevo | Crear de un cliente nuevo | `POST /clientes` |
| `MODULO-CLIENTES` | Modulo de Clientes | Ingreso al Modulo de Clientes | Ninguno: acceso a pantalla |
| `MODULO-CONTROL-CALIDAD` | Modulo de Control de Calidad | Ingreso al modulo de control de calidad | Ninguno: acceso a pantalla |
| `RECHAZAR-CLIENTE` | Rechazar Cliente | Rechaza el cliente activo | `PATCH /clientes/:id/rechazar` |
| `RECHAZAR-LOTE` | Rechazar Lote | Rechaza Lote de cliente activo | `PATCH /lotes/:id/rechazar` |
| `RECHAZAR-PESAJE-LOTE` | Rechazar el pesaje de lote | Rechaza el pesaje de un lote activo | `PATCH /pesajes/:id/rechazar` |
| `VER-CLIENTE-LOTES` | Ver Lotes de cliente | Ver lotes de cliente activo registrado | `GET /lotes/cliente/:clienteId` |

Dos observaciones que le sirven al spec del `PermissionsGuard` y que este spec no resuelve. La primera: **los cuatro `PATCH` de escritura del proyecto sí tienen código de permiso**, contra lo que dicen SPEC 10 a 13 y `CLAUDE.md`. La segunda: **hay endpoints sin ningún código**, entre ellos `POST /pesajes`, `GET /clientes`, `GET /clientes/all`, los tres `GET /catalogos/*` y `POST /auth/register` — y dos códigos que no son endpoints sino acceso a pantalla.

Los `id` no siguen el orden alfabético (`MODULO-CONTROL-CALIDAD` es 1 y `APROBAR-LOTE` es 9) porque los asignó el `DISTINCT`. No importa: todo se resuelve por `codigo` o por el `JOIN`, y ningún id se escribe a mano en ninguna parte.

### Estado final

```
catalogo_permisos                 permisos (puente)
  id            <-------------      permiso_id
  codigo  UNIQUE                    rol_id  ------> roles(id)
  nombre                            id
  descripcion                       isActive
  isActive                          created_at
  created_at
                                  UNIQUE (rol_id, permiso_id)
  9 filas                           14 filas
```

### DDL — paso 1: crear y sembrar el catálogo

```sql
CREATE TABLE catalogo_permisos (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  codigo       VARCHAR(100) NOT NULL,
  nombre       VARCHAR(150) NOT NULL,
  descripcion  VARCHAR(255) NULL,
  isActive     TINYINT(1) NOT NULL DEFAULT 1,
  created_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_catalogo_permisos_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO catalogo_permisos (codigo, nombre, descripcion)
SELECT DISTINCT codigo, nombre, descripcion
FROM permisos;
```

Los tipos de `codigo`, `nombre`, `descripcion`, `isActive` y `created_at` son **exactamente** los que tiene `permisos` en la base, verificados con `SHOW CREATE TABLE permisos;` en el paso 3 del plan. La tabla nueva hereda las columnas tal cual.

El `ENGINE`, el `CHARSET` y el `COLLATE` van **explícitos** y copiados de `permisos`, no heredados del default de la base. Son dos razones concretas, no cosmética: el `UPDATE ... JOIN` del paso siguiente compara `c.codigo = p.codigo`, y dos `VARCHAR` con collations distintas fallan con `Illegal mix of collations` a mitad de la migración; y la FK del paso 3 del DDL exige InnoDB en las dos tablas.

El `UNIQUE (codigo)` es **global**, no por rol. Es la diferencia de fondo con el `UNIQUE (rol_id, codigo)` de SPEC 06: a partir de aquí un `codigo` existe una vez en todo el sistema y es imposible que tenga dos `nombre` distintos.

La semilla **copia** los textos que ya están en la base; no se transcriben a mano. Así es imposible que el spec sobrescriba un `nombre` que se haya editado después de SPEC 06. El paso 1 del plan verifica antes que ningún `codigo` tenga dos `nombre` o dos `descripcion`, porque en ese caso el `DISTINCT` produciría dos filas con el mismo `codigo` y el `UNIQUE` fallaría.

### DDL — paso 2: agregar y rellenar `permisos.permiso_id`

```sql
ALTER TABLE permisos
  ADD COLUMN permiso_id INT NULL AFTER rol_id;

UPDATE permisos p
JOIN catalogo_permisos c ON c.codigo = p.codigo
SET p.permiso_id = c.id;

ALTER TABLE permisos
  MODIFY COLUMN permiso_id INT NOT NULL;
```

La columna nace nullable para poder rellenarla, y pasa a `NOT NULL` una vez confirmado que las 14 filas la tienen. Es aditivo: la app sigue funcionando igual mientras esto corre.

### DDL — paso 3: quitar las columnas viejas y poner los constraints

**Este bloque se ejecuta después de cambiar el repositorio**, no antes:

```sql
ALTER TABLE permisos
  DROP INDEX uq_permisos_rol_codigo;

ALTER TABLE permisos
  DROP COLUMN codigo,
  DROP COLUMN nombre,
  DROP COLUMN descripcion;

ALTER TABLE permisos
  ADD UNIQUE KEY uq_permisos_rol_permiso (rol_id, permiso_id);

ALTER TABLE permisos
  ADD CONSTRAINT fk_permisos_permiso
  FOREIGN KEY (permiso_id) REFERENCES catalogo_permisos(id);
```

El `DROP INDEX` va primero y explícito: el índice único incluye `codigo`, así que borrar la columna sin quitarlo antes deja el resultado a criterio del motor.

La FK a `roles(id)` **no se toca**: `fk_permisos_rol` sigue en su lugar. `permisos` queda con dos FK.

`fk_permisos_permiso` es la sexta excepción del proyecto a la regla de validar solo en código, después de `permisos` → `roles` y las cuatro columnas de auditoría de SPEC 10, 11, 12 y 13. Se justifica igual que la primera: **ninguna línea de la aplicación escribe en estas dos tablas**, se llenan a mano por SQL, y sin la FK un `permiso_id` mal tecleado dejaría una fila que el `INNER JOIN` descarta en silencio.

### Cambio en `src/database/types/types.ts`

Interfaz nueva, calcada de la `PermisosTable` que SPEC 06 escribió:

```ts
export interface CatalogoPermisosTable {
  id: Generated<number>;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  isActive: Generated<number>;
  created_at: Generated<Date | string | null>;
}
```

`PermisosTable` pierde tres claves y gana una:

```ts
export interface PermisosTable {
  id: Generated<number>;
  rol_id: number;
  permiso_id: number;
  isActive: Generated<number>;
  created_at: Generated<Date | string | null>;
}
```

`permiso_id` no es `Generated<>`: no tiene `DEFAULT` y es obligatoria.

Y en la interfaz `Database`, una clave nueva con el mismo nombre que la tabla, junto a la de `permisos`:

```ts
catalogo_permisos: CatalogoPermisosTable;
permisos: PermisosTable;
```

Nótese que la clave es `catalogo_permisos`, idéntica al nombre real de la tabla. `CLAUDE.md` advierte que `unidades_medida` es el único caso donde la clave y la interfaz no coinciden; este spec no agrega un segundo caso.

### Los dos `isActive`

| Columna | Qué significa poner 0 |
| --- | --- |
| `catalogo_permisos.isActive` | El permiso se retira del **sistema entero**. Desaparece de la respuesta de todos los roles con una sola fila editada. |
| `permisos.isActive` | El permiso se retira de **ese rol**. Los demás roles lo conservan. Es exactamente lo que hacía antes de este spec. |

`GET /permisos/me` exige los dos en `1`. Un permiso aparece si el rol lo tiene asignado y activo **y** el permiso está activo en el catálogo.

Esto conserva el criterio de aceptación de SPEC 07 —poner `isActive = 0` en una fila de `permisos` hace desaparecer ese `codigo` del rol— y agrega el interruptor global que antes no existía.

### La consulta de `PermisosRepository`

`getPermisosByUsuarioId` sigue haciendo **dos** consultas, igual que en SPEC 07. La primera no cambia:

```sql
-- 1. Resolver el rol. Si no hay fila -> 404 'Usuario no encontrado'.
SELECT rol_id FROM usuarios WHERE id = ?;
```

La segunda gana el join y un filtro:

```sql
-- 2. Codigos activos de ese rol. Si no hay filas -> [].
SELECT c.codigo
FROM permisos p
INNER JOIN catalogo_permisos c ON c.id = p.permiso_id
WHERE p.rol_id = ?
  AND p.isActive = 1
  AND c.isActive = 1;
```

En Kysely:

```ts
.selectFrom('permisos')
.innerJoin('catalogo_permisos', 'catalogo_permisos.id', 'permisos.permiso_id')
.select('catalogo_permisos.codigo')
.where('permisos.rol_id', '=', usuario.rol_id)
.where('permisos.isActive', '=', 1)
.where('catalogo_permisos.isActive', '=', 1)
.execute();
```

Es `INNER JOIN`, no `LEFT JOIN`: una fila de `permisos` con un `permiso_id` que no exista en el catálogo se descarta. Con la FK y el `NOT NULL` puestos, esa fila no puede existir.

El `return` no cambia: sigue siendo `permisos.map((permiso) => permiso.codigo)`. Sigue sin `ORDER BY`, como decidió SPEC 07.

Las columnas se nombran con prefijo de tabla (`permisos.rol_id`, `catalogo_permisos.codigo`) porque el join las hace ambiguas de otro modo. `catalogo_permisos.isActive` y `permisos.isActive` se llaman igual y **hay que distinguirlas**.

### Respuesta de `GET /permisos/me`

Idéntica a la de SPEC 07, byte a byte. Para un `ADMIN`:

```json
{
  "ok": true,
  "msg": "Permisos obtenidos correctamente",
  "permisos": [
    "APROBAR-LOTE",
    "MODULO-CLIENTES",
    "MODULO-CONTROL-CALIDAD",
    "RECHAZAR-CLIENTE",
    "RECHAZAR-LOTE",
    "RECHAZAR-PESAJE-LOTE",
    "VER-CLIENTE-LOTES"
  ]
}
```

Para un `OPERADOR`, los otros 7: `APROBAR-LOTE`, `CREAR-CLIENTE-LOTE-NUEVO`, `CREAR-CLIENTE-NUEVO`, `MODULO-CLIENTES`, `MODULO-CONTROL-CALIDAD`, `RECHAZAR-LOTE` y `VER-CLIENTE-LOTES`.

**El orden no es parte del contrato.** La consulta va sin `ORDER BY` por decisión de SPEC 07, y el `INNER JOIN` puede devolver las filas en otro orden que la consulta actual. Se compara por contenido y por cantidad, nunca por posición. El 404 `Usuario no encontrado` y el 200 con `permisos: []` no cambian.

### Lo que este spec hace más fácil, y no hace

Con el catálogo puesto, estas operaciones pasan a ser una fila:

| Operación | Antes | Después |
| --- | --- | --- |
| Renombrar `RECHAZAR-LOTE` | Un `UPDATE` por cada rol que lo tenga (hoy 2) | Un `UPDATE` en `catalogo_permisos` |
| Retirar un permiso del sistema | Un `UPDATE isActive = 0` por rol | Un `UPDATE` en `catalogo_permisos` |
| Crear un permiso nuevo | Un `INSERT` por rol, con los textos repetidos | Un `INSERT` en el catálogo, más un `INSERT` por rol con solo dos ids |
| Saber qué roles tienen un permiso | `WHERE codigo = ?` sobre 14 filas de texto | Un join por `permiso_id` |
| Pasar los 9 códigos a `modulo.accion` | 14 `UPDATE`, uno por fila | 9 `UPDATE`, uno por código — y es un spec aparte |

Lo que **no** cambia: sigue habiendo una fila de `permisos` por cada par rol-permiso. Eso no es duplicación, es la asignación misma. Lo que se quitó es la repetición del **texto**.

---

## Implementation plan

1. Verificar que ningún `codigo` tenga textos divergentes entre roles, con `SELECT codigo, COUNT(*) AS filas, COUNT(DISTINCT nombre) AS nombres, COUNT(DISTINCT COALESCE(descripcion,'')) AS descripciones FROM permisos GROUP BY codigo;`. Todas las filas deben salir con `nombres = 1` y `descripciones = 1`. **Si alguna sale con 2, detenerse:** unificar a mano el `nombre` o la `descripcion` en `permisos` y volver a correr el `SELECT` hasta que dé 1. Sin esto, el `INSERT ... SELECT DISTINCT` produciría dos filas con el mismo `codigo` y el `UNIQUE` del catálogo fallaría. **Resultado real: 9 filas, todas con 1 y 1 — el gate pasa.** Ese `SELECT` es también el que reveló que la tabla no es la que documentan SPEC 06 y SPEC 08; los 9 códigos quedaron anotados en el modelo de datos de este spec.
2. Anotar el estado inicial para comparar al final, con `SELECT r.nombre AS rol, p.codigo, p.isActive FROM permisos p JOIN roles r ON r.id = p.rol_id ORDER BY r.nombre, p.codigo;` y con la respuesta actual de `GET /permisos/me` para un token de cada rol. **Es la referencia de todo el spec**: al terminar, las dos cosas tienen que ser idénticas. **Resultado real: 14 filas, 7 por rol, todas con `isActive = 1`** — quedaron en la tabla del modelo de datos. La respuesta esperada de `GET /permisos/me` es por tanto los 7 códigos de la columna de cada rol. Capturar la respuesta real del endpoint **antes del paso 6**, que es el que cambia la consulta; los pasos 3, 4 y 5 no la afectan.
3. Verificar primero con `SHOW CREATE TABLE permisos;` los tipos, el motor y la collation reales, y ajustar el `CREATE TABLE` del modelo de datos si difieren — el catálogo hereda el tipo real, nunca uno más angosto. **Resultado real: `varchar(100)`, `varchar(150)`, `varchar(255) NULL`, `tinyint(1) NOT NULL DEFAULT 1`, `ENGINE=InnoDB`, `utf8mb4_0900_ai_ci`; coincide con el spec y el DDL declara esos tres últimos explícitos.** Después ejecutar el `CREATE TABLE catalogo_permisos` y el `INSERT ... SELECT DISTINCT`. Confirmar con `SELECT COUNT(*) FROM catalogo_permisos;` que hay exactamente **9** filas, y con `SELECT id, codigo, nombre, descripcion, isActive FROM catalogo_permisos ORDER BY codigo;` que son los 9 códigos del modelo de datos, con su texto tal cual estaba y todos con `isActive = 1`. La app no se toca en este paso y sigue funcionando igual.
4. Ejecutar el `ALTER TABLE permisos ADD COLUMN permiso_id INT NULL` y el `UPDATE ... JOIN` del backfill. Confirmar con `SELECT COUNT(*) FROM permisos WHERE permiso_id IS NULL;` que da **0**, y con `SELECT COUNT(*) FROM permisos p JOIN catalogo_permisos c ON c.id = p.permiso_id WHERE c.codigo <> p.codigo;` que también da **0**: cada una de las 14 filas apunta a su propio código. Solo entonces ejecutar el `MODIFY COLUMN permiso_id INT NOT NULL`. **Resultado real: 0, 0 y 14 — el backfill quedó completo y correcto.** La app sigue funcionando igual: el cambio es aditivo y `codigo` todavía está.

Nota práctica del `UPDATE`: conviene escribirlo con un `WHERE p.id > 0` redundante. Es lógicamente innecesario, pero evita el error 1175 de MySQL en clientes con *safe updates* activo —MySQL Workbench lo trae por defecto— sin tener que tocar `SQL_SAFE_UPDATES`.
5. Agregar `CatalogoPermisosTable` a `src/database/types/types.ts`, agregar la clave `catalogo_permisos` a la interfaz `Database`, y agregar `permiso_id: number` a `PermisosTable` **sin quitarle todavía** `codigo`, `nombre` ni `descripcion`. Confirmar que compila (`npm run build`).
6. Cambiar el segundo `SELECT` de `getPermisosByUsuarioId` por la versión con `INNER JOIN` y los dos filtros de `isActive`. No se cambia la firma del método, ni la primera consulta, ni el `NotFoundException`, ni el `map` final. Confirmar que compila.
7. Levantar con `npm run start:dev` y verificar con los dos tokens del paso 2 que `GET /permisos/me` devuelve **exactamente** la misma respuesta que antes, código por código, contra la referencia anotada en ese paso. En este punto ninguna línea del proyecto lee `permisos.codigo`.
8. Ejecutar el DDL destructivo: el `DROP INDEX uq_permisos_rol_codigo`, los tres `DROP COLUMN`, el `ADD UNIQUE KEY uq_permisos_rol_permiso (rol_id, permiso_id)` y el `ADD CONSTRAINT fk_permisos_permiso`. Confirmar con `DESCRIBE permisos;` que quedan cinco columnas (`id`, `rol_id`, `permiso_id`, `isActive`, `created_at`) y con `SHOW CREATE TABLE permisos;` que están las dos FK (`fk_permisos_rol` y `fk_permisos_permiso`), el `UNIQUE` nuevo, y que el viejo `uq_permisos_rol_codigo` ya no está.
9. Quitar `codigo`, `nombre` y `descripcion` de `PermisosTable` en `src/database/types/types.ts`. Confirmar que compila: si algún archivo todavía las usaba, el compilador lo dice aquí.
10. Volver a levantar y verificar que `GET /permisos/me` sigue devolviendo lo mismo con los dos tokens, ahora contra la tabla ya reducida.
11. Verificación manual de los dos `isActive`, usando `RECHAZAR-LOTE` porque es uno de los cinco códigos que tienen dos filas: poner `permisos.isActive = 0` en la fila de `RECHAZAR-LOTE` de **uno** de sus dos roles y confirmar que ese código desaparece solo de la respuesta de ese rol y sigue en la del otro; devolverla a `1`. Después poner `catalogo_permisos.isActive = 0` en la fila de `RECHAZAR-LOTE` y confirmar que desaparece de **los dos** roles con una sola edición; devolverla a `1`.
12. Verificación manual de los constraints: confirmar que `INSERT INTO catalogo_permisos (codigo, nombre) VALUES ('RECHAZAR-LOTE', 'X');` falla por el `UNIQUE (codigo)`; que insertar dos veces el mismo par `(rol_id, permiso_id)` en `permisos` falla por `uq_permisos_rol_permiso`; que insertar en `permisos` un `permiso_id` inexistente falla por `fk_permisos_permiso`; y que insertar un `rol_id` inexistente sigue fallando por `fk_permisos_rol`.
13. Verificación manual del renombre, que es el motivo del spec: `UPDATE catalogo_permisos SET nombre = 'Anular lote' WHERE codigo = 'RECHAZAR-LOTE';` — **una sola fila afectada**, donde antes de este spec habrían sido dos. Y `GET /permisos/me` sigue devolviendo el mismo array de códigos para los dos roles, porque el endpoint no expone el `nombre`.
14. Verificación manual de que nada más cambió: `POST /clientes` sigue respondiendo 201 para un `Operador`, `POST /auth/login` responde sin clave `permisos`, y los endpoints de `clientes`, `lotes`, `pesajes` y `catalogos` responden igual.
15. Actualizar `CLAUDE.md`: agregar `catalogo_permisos` a la lista de tablas de la sección Domain; cambiar la descripción de `permisos` de "una fila por `(rol_id, codigo)`" a "una fila por `(rol_id, permiso_id)`, sin texto propio"; anotar que el `codigo` ahora vive en `catalogo_permisos` y es único global; anotar la FK nueva como sexta excepción a la regla de validar solo en código; anotar los dos `isActive` y qué significa cada uno; y dejar escrito que **sigue sin aplicarse nada**.
16. Corregir en `CLAUDE.md` lo que la base desmiente, que es la parte del paso 15 que más importa: que la tabla tiene 11 filas con los 7 códigos `modulo.accion` de SPEC 06 y SPEC 08 —son **14 filas y 9 códigos** en `MAYÚSCULAS-CON-GUIONES`—, y que los cuatro `PATCH` de escritura y sus specs 10 a 13 no tienen fila sembrada: `APROBAR-LOTE`, `RECHAZAR-LOTE`, `RECHAZAR-CLIENTE` y `RECHAZAR-PESAJE-LOTE` **existen**. Dejar escrito que el formato real contradice la decisión de SPEC 06 sobre minúsculas, que este spec no lo normaliza, y que quién sembró esas filas y con qué criterio no está registrado en ningún spec. Anotar también que los roles se llaman `ADMIN` y `OPERADOR` en mayúsculas —así que cualquier SQL copiado de la semilla de SPEC 06, que busca `'Admin'`, no encuentra nada— y que el reparto real es 7 y 7, con `OPERADOR` teniendo los permisos de creación de clientes que `ADMIN` no tiene.

---

## Acceptance criteria

- [ ] `SELECT codigo, COUNT(DISTINCT nombre) FROM permisos GROUP BY codigo;` se corrió **antes** de crear el catálogo y devolvió 1 para los 9 códigos.
- [ ] La tabla `catalogo_permisos` existe en MySQL con las columnas `id`, `codigo`, `nombre`, `descripcion`, `isActive` y `created_at`.
- [ ] `catalogo_permisos` tiene exactamente **9 filas**.
- [ ] Los 9 `codigo` son `APROBAR-LOTE`, `CREAR-CLIENTE-LOTE-NUEVO`, `CREAR-CLIENTE-NUEVO`, `MODULO-CLIENTES`, `MODULO-CONTROL-CALIDAD`, `RECHAZAR-CLIENTE`, `RECHAZAR-LOTE`, `RECHAZAR-PESAJE-LOTE` y `VER-CLIENTE-LOTES`.
- [ ] Los 9 `codigo` están escritos **exactamente** como estaban en `permisos`, en mayúsculas con guiones: este spec no los normalizó a `modulo.accion`.
- [ ] El `nombre` y la `descripcion` de cada fila del catálogo son **los mismos textos** que tenía `permisos` antes del refactor: se copiaron con un `SELECT`, no se teclearon.
- [ ] `catalogo_permisos` tiene un índice único sobre `codigo`: insertar `RECHAZAR-LOTE` una segunda vez falla.
- [ ] Toda fila del catálogo tiene `isActive = 1`.
- [ ] `DESCRIBE permisos;` muestra exactamente cinco columnas: `id`, `rol_id`, `permiso_id`, `isActive` y `created_at`.
- [ ] `permisos` **ya no tiene** las columnas `codigo`, `nombre` ni `descripcion`.
- [ ] `permisos.permiso_id` es `INT NOT NULL`.
- [ ] `permisos` sigue teniendo exactamente **14 filas**, con el mismo reparto por rol que anotó el paso 2. Ninguna se perdió ni se duplicó en la migración.
- [ ] Cada fila de `permisos` apunta al `id` del catálogo cuyo `codigo` era el suyo antes del refactor: el `JOIN` reproduce los **14** pares rol-código originales, idénticos a la referencia del paso 2.
- [ ] `SHOW CREATE TABLE permisos;` muestra la FK `fk_permisos_permiso` hacia `catalogo_permisos(id)`.
- [ ] `SHOW CREATE TABLE permisos;` sigue mostrando la FK `fk_permisos_rol` hacia `roles(id)`: no se tocó.
- [ ] `SHOW CREATE TABLE permisos;` muestra el índice único `(rol_id, permiso_id)` y **ya no** muestra `uq_permisos_rol_codigo`.
- [ ] Insertar en `permisos` un `permiso_id` que no existe en el catálogo falla por la FK.
- [ ] Insertar dos veces el mismo par `(rol_id, permiso_id)` falla por el `UNIQUE`.
- [ ] Insertar el mismo `permiso_id` para dos `rol_id` distintos **no** falla: es el caso normal, los 5 códigos compartidos.
- [ ] `src/database/types/types.ts` declara `CatalogoPermisosTable` y la interfaz `Database` incluye la clave `catalogo_permisos`, escrita igual que el nombre real de la tabla.
- [ ] `PermisosTable` declara `permiso_id: number` y **no** declara `codigo`, `nombre` ni `descripcion`.
- [ ] La app arranca sin errores de compilación (`npm run start:dev`).
- [ ] `GET /permisos/me` devuelve para cada rol **exactamente los mismos códigos, y la misma cantidad**, que la referencia anotada en el paso 2 antes de tocar la base. Es el criterio central del spec.
- [ ] Con el token de un `ADMIN`, la respuesta tiene 7 strings: `APROBAR-LOTE`, `MODULO-CLIENTES`, `MODULO-CONTROL-CALIDAD`, `RECHAZAR-CLIENTE`, `RECHAZAR-LOTE`, `RECHAZAR-PESAJE-LOTE` y `VER-CLIENTE-LOTES`.
- [ ] Con el token de un `OPERADOR`, la respuesta tiene 7 strings: `APROBAR-LOTE`, `CREAR-CLIENTE-LOTE-NUEVO`, `CREAR-CLIENTE-NUEVO`, `MODULO-CLIENTES`, `MODULO-CONTROL-CALIDAD`, `RECHAZAR-LOTE` y `VER-CLIENTE-LOTES`.
- [ ] Las dos comparaciones se hacen por contenido y cantidad, **no por posición**: el `INNER JOIN` puede reordenar y eso no es una regresión.
- [ ] Ningún código aparece o desaparece de la respuesta de ningún rol como efecto de la migración.
- [ ] Los elementos del array siguen siendo strings planos, no objetos: `permisos[0]` es `"MODULO-CLIENTES"` y no `{ codigo: "MODULO-CLIENTES" }`.
- [ ] La respuesta sigue siendo exactamente `{ ok, msg, permisos }` con `msg = 'Permisos obtenidos correctamente'`, y **no** incluye `nombre`, `descripcion`, `id` ni datos del rol.
- [ ] Un token válido cuyo `user_id` no existe en `usuarios` sigue recibiendo 404 con `Usuario no encontrado`.
- [ ] Un usuario cuyo rol no tiene ninguna asignación activa recibe 200 con `permisos: []`, no un 404.
- [ ] `GET /permisos/me` sin header `Authorization` responde 401, y con un token expirado o de otro secreto también.
- [ ] Poner `permisos.isActive = 0` en la fila de `RECHAZAR-LOTE` de uno de sus dos roles hace desaparecer ese código de la respuesta de ese rol y **no** de la del otro.
- [ ] Poner `catalogo_permisos.isActive = 0` en la fila de `RECHAZAR-LOTE` hace desaparecer ese código de la respuesta de **los dos** roles, con una sola fila editada.
- [ ] Devolver cualquiera de esos dos `isActive` a `1` hace reaparecer el código.
- [ ] `UPDATE catalogo_permisos SET nombre = ... WHERE codigo = 'RECHAZAR-LOTE';` afecta **exactamente una fila**, donde antes de este spec habría afectado dos. Es el objetivo del spec.
- [ ] Después de ese renombre, `GET /permisos/me` devuelve el mismo array de códigos para los dos roles: el endpoint no expone el `nombre`.
- [ ] La consulta del repositorio usa `INNER JOIN`, no `LEFT JOIN`, y filtra los dos `isActive` con el prefijo de tabla.
- [ ] `getPermisosByUsuarioId` sigue haciendo **dos** consultas: `usuarios` primero y `permisos` después. No se unificaron en una.
- [ ] La consulta sigue **sin** `ORDER BY`: la decisión de SPEC 07 no cambió.
- [ ] No se creó ningún archivo nuevo bajo `src/modules/`: solo se modificaron `src/modules/permisos/repository/permisos.repository.ts` y `src/database/types/types.ts`.
- [ ] `permisos.controller.ts` y `permisos.service.ts` no cambiaron.
- [ ] `src/app.module.ts` no cambió.
- [ ] No existe ninguna ruta nueva: `GET /permisos/catalogo` y `GET /catalogos/permisos` responden 404 de Nest.
- [ ] El log de rutas de Nest al arrancar es idéntico al de antes de este spec.
- [ ] El catálogo tiene exactamente los 9 códigos que ya estaban en `permisos` y **ni uno más**: este spec no sembró ningún código nuevo.
- [ ] `POST /clientes` sigue respondiendo 201 para un usuario con rol `Operador`: **este spec no bloquea nada** y no hay `PermissionsGuard`.
- [ ] `PATCH /lotes/:id/aprobar` y los tres `rechazar` siguen respondiendo 200 a cualquier usuario autenticado.
- [ ] `POST /auth/login` responde exactamente igual que antes, sin clave `permisos`.
- [ ] El payload del JWT no cambió y `req.user` sigue siendo `{ userId, username }`.
- [ ] `POST /clientes`, `GET /clientes`, `GET /clientes/all`, `PATCH /clientes/:id/rechazar`, `POST /lotes`, los dos `GET /lotes/cliente/:clienteId*`, `PATCH /lotes/:id/rechazar`, `PATCH /lotes/:id/aprobar`, `POST /pesajes`, `GET /pesajes/byLote/:loteId`, `PATCH /pesajes/:id/rechazar`, `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh` y los tres `GET /catalogos/*` siguen funcionando igual.
- [ ] `CLAUDE.md` documenta `catalogo_permisos`, describe `permisos` como una fila por `(rol_id, permiso_id)` sin texto propio, y ya no dice que el `codigo` viva en `permisos`.
- [ ] `CLAUDE.md` sigue advirtiendo que los permisos **no se aplican en ningún endpoint**.
- [ ] `CLAUDE.md` ya **no** afirma que `permisos` tenga 11 filas ni que sus códigos sean los 7 `modulo.accion` de SPEC 06 y SPEC 08: dice 14 filas y 9 códigos en `MAYÚSCULAS-CON-GUIONES`.
- [ ] `CLAUDE.md` ya **no** afirma que los tres `rechazar` y `PATCH /lotes/:id/aprobar` no tengan fila sembrada: deja escrito que `APROBAR-LOTE`, `RECHAZAR-LOTE`, `RECHAZAR-CLIENTE` y `RECHAZAR-PESAJE-LOTE` existen, y que ningún spec registra quién las insertó.

---

## Decisions

- **Sí:** catálogo nuevo `catalogo_permisos` con las definiciones, y `permisos` como puente `(rol_id, permiso_id)`. Decisión explícita del usuario. Es el modelo que SPEC 06 evaluó y descartó, y este spec lo revierte porque la consecuencia que ese spec anotó —renombrar un permiso obliga a tocar una fila por rol— se volvió el problema real.
- **No:** `permisos` como catálogo y una tabla puente nueva `rol_permiso`. Se descarta por decisión explícita del usuario, pese a que los nombres habrían quedado más honestos. Habría cambiado el significado de una tabla existente y sacado a `permisos` de ser la tabla principal de `GET /permisos/me`. Consecuencia asumida: `permisos` conserva un nombre que ahora describe una asignación, no un permiso.
- **No:** renombrar `permisos` a `rol_permiso` después del refactor. Se descarta: obligaría a cambiar la clave de la interfaz `Database` y el `selectFrom` del repositorio sin ganar nada funcional.
- **Sí:** el nombre de la tabla nueva es `catalogo_permisos`. Decisión explícita del usuario. Es la primera tabla del proyecto con prefijo, y se acepta porque dice sin ambigüedad qué es.
- **No:** `acciones`, que seguía el estilo de una palabra en plural de `etapas`, `roles` y `productos`. Se descarta: "accion" ya es la segunda mitad del formato `modulo.accion`, así que el nombre habría sugerido que la tabla guarda solo esa mitad.
- **No:** `permisos_catalogo`. Se descarta por la decisión anterior; era la misma idea con las palabras al revés.
- **Sí:** `codigo`, `nombre` y `descripcion` viven **solo** en el catálogo. Decisión explícita del usuario. Es el objetivo del spec, y elimina de raíz el riesgo que SPEC 06 anotó de que los textos divergieran entre roles.
- **No:** dejar `nombre` y `descripcion` nullables en el puente para permitir un texto distinto por rol. Se descarta: reintroduce exactamente la duplicación que el spec quita.
- **Sí:** `UNIQUE (codigo)` global en el catálogo. Es la contrapartida directa del cambio de modelo: donde SPEC 06 necesitaba `UNIQUE (rol_id, codigo)` porque el código se repetía a propósito, ahora un código existe una sola vez en el sistema.
- **Sí:** `UNIQUE (rol_id, permiso_id)` en el puente. Es el mismo constraint de SPEC 06 con la columna nueva: lo que no puede repetirse sigue siendo el par.
- **Sí:** FK real de `permiso_id` a `catalogo_permisos(id)`. Sexta excepción del proyecto a la regla de validar solo en código, con la **misma** justificación que la primera de SPEC 06: ninguna línea de la aplicación escribe estas tablas, se llenan a mano por SQL, y sin la FK un `permiso_id` mal tecleado dejaría una fila que el `INNER JOIN` descarta en silencio.
- **No:** `ON DELETE CASCADE` en esa FK. Se descarta: borrar un permiso del catálogo debe fallar mientras algún rol lo tenga asignado. Para retirarlo está `isActive`.
- **Sí:** los textos se copian con `INSERT ... SELECT DISTINCT` desde `permisos`. Decisión explícita del usuario. Es imposible que el spec sobrescriba un `nombre` que se haya editado a mano después de SPEC 06, y no hay que teclear 7 filas.
- **No:** un `INSERT` con las 7 filas escritas a mano en el spec, como hizo la semilla de SPEC 06. Se descarta: sería más legible como documentación, pero impondría los textos de SPEC 06 sobre los que la base tenga hoy.
- **Sí:** si un `codigo` tiene dos `nombre` o dos `descripcion` distintos entre roles, la migración **se detiene** y se unifica a mano antes de seguir. Decisión explícita del usuario. El paso 1 del plan es ese `SELECT` de verificación.
- **No:** desempatar en silencio con un `GROUP BY` tomando la fila de menor `id` o la del rol `Admin`. Se descarta: no fallaría nunca, pero elegiría por su cuenta y podría descartar el texto que se quería conservar.
- **Sí:** se conservan **los dos** `isActive`. Decisión explícita del usuario. `catalogo_permisos.isActive` retira el permiso del sistema entero con una fila; `permisos.isActive` lo retira de un rol, que es lo que hacía antes. `GET /permisos/me` exige los dos en 1.
- **No:** dejar `isActive` solo en el puente. Se descarta: retirar un permiso del sistema seguiría costando una fila por rol, que es el tipo de repetición que este spec quita.
- **No:** dejar `isActive` solo en el catálogo. Se descarta: retirar un permiso a un solo rol pasaría a hacerse borrando la fila del puente, y rompería el criterio de aceptación de SPEC 07 sobre `permisos.isActive`.
- **Sí:** el contrato de `GET /permisos/me` no cambia. Decisión explícita del usuario. Sigue devolviendo `permisos: string[]` y la app móvil no se toca. Este spec es de esquema, y por fuera es invisible.
- **No:** aprovechar el catálogo para devolver `[{ codigo, nombre }]`. Se descarta pese a que ahora saldría gratis: rompería el contrato de SPEC 07, que ya descartó esa forma, y obligaría a tocar la app. Si se necesita, va en su propio spec.
- **Sí:** `INNER JOIN`. Una fila del puente sin fila en el catálogo se descarta. Con la FK y el `NOT NULL` puestos, no puede existir.
- **No:** `LEFT JOIN` con un filtro por `codigo` no nulo. Se descarta: mismo resultado con más ruido, y sugeriría que la fila huérfana es un caso esperado.
- **Sí:** se siguen haciendo dos consultas, `usuarios` y luego `permisos`. Se mantiene la decisión de SPEC 07: es la única forma legible de distinguir "el usuario no existe" (404) de "el rol no tiene permisos" (`[]`).
- **Sí:** el `DROP COLUMN` va **después** de cambiar el repositorio, no antes. Es el punto crítico del plan: entre el paso 6 y el paso 8 la tabla tiene las columnas viejas y el código ya no las usa, así que en ningún momento hay una app apuntando a columnas que no existen.
- **Sí:** las tres columnas viejas se borran en este mismo spec. Decisión explícita del usuario. Si se quedaran, la duplicación seguiría ahí y nada impediría que alguien las siguiera escribiendo.
- **No:** dejarlas como columnas muertas por si algo se rompe. Se descarta: dejaría la tabla con dos fuentes de verdad para el mismo dato y sin nada que las mantenga sincronizadas.
- **Sí:** `permiso_id` nace nullable y pasa a `NOT NULL` después del backfill. Es la única forma de rellenarla sin vaciar la tabla.
- **Sí:** el catálogo arranca con los mismos 9 códigos que ya están en la base. Decisión explícita del usuario. El spec es un refactor puro: mismas 14 asignaciones, misma respuesta de `GET /permisos/me`.
- **No:** sembrar códigos para los endpoints que no tengan uno, aprovechando el viaje. Se descarta: mezclaría un refactor de esquema con una decisión de diseño de permisos que le corresponde al spec del `PermissionsGuard`. Y hay una razón extra descubierta en el paso 1: nadie sabe hoy qué endpoint representa cada uno de los 9 códigos, porque ningún spec los documenta.
- **Sí:** los 9 `codigo` se copian tal cual, en `MAYÚSCULAS-CON-GUIONES`. Decisión explícita del usuario, tomada después de que el paso 1 mostrara que el formato real contradice la decisión de SPEC 06 sobre minúsculas. Normalizarlos cambiaría lo que `GET /permisos/me` devuelve, y el spec prohíbe tocar ese contrato.
- **No:** normalizar a `modulo.accion` durante la migración, que ahora sería un solo lugar. Se descarta por la decisión anterior. Consecuencia registrada como ventaja: después de este spec esa normalización cuesta 9 `UPDATE` en vez de 14, y es un spec de una tarde.
- **Sí:** este spec corrige los conteos y los códigos en su propio texto y en `CLAUDE.md`. Decisión explícita del usuario, tomada en el paso 1 antes de tocar la base. La alternativa era implementar 14 pasos contra criterios de aceptación que ya se sabían falsos.
- **No:** reescribir SPEC 06, SPEC 08 y los specs 10 a 13, que documentan una tabla que ya no existe. Se descarta: son specs implementados y su valor es registrar lo que se decidió entonces, no lo que hay ahora. `CLAUDE.md` es el documento que debe decir la verdad del presente, y es el que se corrige.
- **No:** aplicar los permisos con un guard en este spec. Se mantiene la decisión de SPEC 06 y SPEC 07: el guard toca el `JwtStrategy`, el payload del JWT y todos los módulos, y va en su propio spec.
- **Sí:** ningún endpoint para el catálogo. Decisión explícita del usuario. Se administra por SQL a mano, igual que `permisos` desde SPEC 06.
- **No:** un `GET /permisos/catalogo` de solo lectura. Se descarta: no tiene consumidor hoy y mezclaría una ruta nueva con un refactor de esquema.
- **No:** CRUD del catálogo por API, que es lo que lo volvería útil de verdad. Se descarta: es un módulo entero y merece su propio spec.
- **No:** una tabla `modulos` para agrupar por el prefijo del `codigo`, ni una columna `modulo` derivada. Se mantiene la decisión de SPEC 06: el prefijo se lee del `codigo` y no hace falta materializarlo.
- **No:** permisos por usuario individual (`usuario_permiso`). Se mantiene la decisión de SPEC 06.
- **Sí:** la clave de la interfaz `Database` se llama `catalogo_permisos`, igual que la tabla. `unidades_medida` sigue siendo el único caso del proyecto donde la clave y la interfaz no coinciden, y este spec no agrega un segundo.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| **Es el primer DDL destructivo del proyecto.** Un `DROP COLUMN` sobre una tabla con datos y sin herramienta de migraciones no se deshace: si algo falla después, las 11 filas quedaron sin su `codigo`. | Mitigado por el orden del plan, que es su parte más importante: el catálogo se crea y se verifica (paso 3), el backfill se verifica con dos `SELECT` que deben dar 0 (paso 4), el repositorio se cambia y se prueba contra la respuesta real (pasos 6 y 7), y **solo entonces** se borra (paso 8). Antes del paso 8, el `codigo` sigue en la tabla y todo es reversible tirando el catálogo. |
| El DDL se aplica en un ambiente y no en otro: en el que falta, el `INNER JOIN` apunta a una tabla que no existe y `GET /permisos/me` responde 500. Es el riesgo heredado de no tener migraciones. | Sin mitigación automática. Los pasos 3, 4 y 8 verifican con `DESCRIBE` y `SHOW CREATE TABLE`, y este spec es la única fuente del DDL. Agrava el riesgo respecto de los specs anteriores: los de SPEC 10–13 eran columnas nuevas que solo un endpoint escribía, este cambia una tabla que un endpoint **lee**. |
| Un mismo `codigo` tiene `nombre` o `descripcion` distintos entre `Admin` y `Operador`, el `DISTINCT` produce dos filas con el mismo `codigo` y el `UNIQUE` del catálogo falla a mitad de la migración. | Mitigado: el paso 1 del plan es el `SELECT` que lo detecta **antes** de crear la tabla, y la decisión es detenerse y unificar a mano. Si el `INSERT` fallara igual, el catálogo queda vacío y `permisos` intacta, así que no hay estado a medias. |
| Alguien ejecuta el `DROP COLUMN` antes de cambiar el repositorio y `GET /permisos/me` empieza a responder 500 en producción. | Mitigado documentalmente: el DDL está partido en tres bloques numerados, el tercero dice explícitamente que va después del cambio de código, y el paso 7 del plan es la verificación que lo habilita. |
| El `INNER JOIN` cambia el orden en que vuelven las filas, y algo del cliente dependía del orden anterior. | SPEC 07 ya decidió que la consulta va sin `ORDER BY` y dejó anotado que el orden no está garantizado ni entre ambientes. La app consulta con `includes`. Ningún criterio de aceptación de este spec compara el array posicionalmente. |
| `catalogo_permisos.isActive` y `permisos.isActive` se llaman igual, y en el join es fácil filtrar la equivocada o solo una de las dos. | Mitigado: la consulta nombra las dos columnas con prefijo de tabla, y hay dos criterios de aceptación que verifican por separado el efecto de cada `isActive` — uno afecta a un rol, el otro a los dos. |
| Alguien lee el nombre `permisos` y asume que la tabla sigue guardando el `codigo`, y escribe un `SELECT codigo FROM permisos` que falla. | Sin mitigar en el esquema, por la decisión de no renombrar la tabla. La mitigación es documental: el paso 15 lo reescribe en `CLAUDE.md`, y el fallo es inmediato y evidente (columna inexistente), no silencioso. |
| Alguien ve el catálogo y asume que ahora los permisos se aplican. | Se documenta en `CLAUDE.md` y hay criterios de aceptación que verifican que un `Operador` **sigue pudiendo** hacer `POST /clientes` y que los cuatro `PATCH` siguen abiertos a cualquier usuario autenticado. Es el mismo riesgo que SPEC 06 y SPEC 07 ya anotaron, sin cambios. |
| El catálogo hace fácil crear permisos, y alguien siembra códigos para funcionalidad que no existe. | Sin mitigar automáticamente. Hay un criterio de aceptación que verifica que el catálogo tiene exactamente los 9 códigos que ya estaban y ni uno más. Nótese que el riesgo ya se materializó **antes** de este spec: las filas de `APROBAR-LOTE` y las tres de rechazo se sembraron a mano sin que ningún spec lo registre. |
| **Ningún spec documenta qué endpoint representa cada uno de los 9 códigos**, y dos de ellos (`MODULO-CLIENTES`, `MODULO-CONTROL-CALIDAD`) no son endpoints sino acceso a pantalla. El `PermissionsGuard` futuro va a tener que adivinar el mapeo. | **Parcialmente mitigado por lo que apareció en el paso 3:** las `descripcion` del catálogo dicen qué hace cada permiso, y quedaron transcritas en la tabla de contenido del modelo de datos junto con el endpoint que cada una sugiere. Eso es una pista fuerte, **no** una decisión de este spec y nada la confirma. Queda igual el hueco al revés: hay endpoints sin ningún código, entre ellos `POST /pesajes` y los tres `GET /catalogos/*`. El paso 16 lo escribe en `CLAUDE.md`. |
| El formato real de los códigos contradice la decisión de SPEC 06 sobre minúsculas, y este spec lo copia tal cual, así que la contradicción queda consagrada en una tabla nueva. | Asumido por decisión explícita. La mitigación es estructural y es el punto del spec: normalizarlos pasa a costar 9 `UPDATE` de una columna en un solo lugar. |
| Agregar un endpoint sigue exigiendo insertar su permiso a mano, y nada avisa si no se hace. | Sin mitigación: es el riesgo que SPEC 06 y SPEC 07 ya anotaron y este spec no lo resuelve. Lo único que cambia es el costo: un `INSERT` en el catálogo más uno por rol con dos ids, en vez de un `INSERT` con los textos repetidos por rol. |

---

## What is **not** in this spec

- Cualquier endpoint sobre el catálogo: no hay `GET /permisos/catalogo`, ni `GET /catalogos/permisos`, ni CRUD. Se administra por SQL a mano.
- Cambios al contrato de `GET /permisos/me`: sigue devolviendo `permisos: string[]`.
- Devolver `nombre`, `descripcion` o el `id` del permiso en algún endpoint.
- Sembrar códigos nuevos en el catálogo, incluidos los de los tres `rechazar`, `PATCH /lotes/:id/aprobar` y los tres `GET /catalogos/*`.
- Cambiar qué permisos tiene cada rol: las 14 asignaciones son las mismas 14.
- Normalizar los 9 `codigo` a `modulo.accion`, y decidir qué endpoint representa cada uno.
- Reescribir SPEC 06, SPEC 08 y los specs 10 a 13, que documentan una tabla que ya no es la que hay.
- Aplicar permisos: no hay `PermissionsGuard` ni decorador `@Permisos()`, y ningún endpoint devuelve 403 por falta de permiso.
- Cambios al payload del JWT, a `req.user`, a `POST /auth/login` o a `POST /auth/refresh`.
- Renombrar `permisos` a `rol_permiso`.
- Una tabla `modulos` ni una columna `modulo` en el catálogo.
- Permisos por usuario individual (`usuario_permiso`).
- Jerarquía o herencia entre roles, y CRUD de roles.
- Herramienta de migraciones o archivos `.sql` en el repo.
- `ON DELETE CASCADE` en la FK nueva.
- `ORDER BY` en la respuesta, y caché.
- Validar `usuarios.isActive`.
- Rellenar las `descripcion` que queden en `NULL`.
- Cambios a los módulos `auth`, `clientes`, `lotes`, `pesajes` y `catalogos`.

Cada uno de estos, si se necesita, va en su propio spec.
