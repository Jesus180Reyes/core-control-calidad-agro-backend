# SPEC 06 — Tabla de permisos por rol

> **Status:** Implemented
> **Depends on:** —
> **Date:** 2026-08-28
> **Objective:** Crear la tabla `permisos`, relacionada a `roles` por `rol_id`, y sembrarla con los permisos de `Admin` y `Operador` que corresponden a los endpoints actuales.

---

## Why this spec exists

Hoy la tabla `roles` existe y `usuarios.rol_id` apunta a ella, pero **ningún endpoint discrimina por rol**: un `Operador` y un `Admin` pueden hacer exactamente lo mismo. No hay ningún lugar en el sistema donde esté escrito qué se supone que puede hacer cada rol.

Este spec crea ese lugar y nada más. Es un spec de **base de datos**: al terminar, la base declara que `Operador` no tiene `clientes.crear`, pero el backend **no lo lee ni lo aplica**. No hay endpoint nuevo, no hay guard, no hay módulo. Nadie recibe un 403 que no recibiera antes.

Esa separación es deliberada. Leer los permisos y aplicarlos toca el `JwtStrategy`, el payload del JWT, un guard nuevo y los cuatro módulos existentes. Cada una de esas cosas va en su propio spec, y este les deja la tabla y los datos listos.

---

## Scope

**In:**

- Nueva tabla `permisos` en MySQL, con `rol_id` como clave foránea a `roles`.
- Identificación de cada permiso por un `codigo` con formato `modulo.accion`.
- Columna `permisos.isActive` para retirar un permiso sin borrar la fila.
- Constraints en MySQL: `UNIQUE (rol_id, codigo)` y clave foránea de `rol_id` hacia `roles`.
- Datos semilla: los permisos que corresponden uno a uno con los endpoints ya implementados, asignados a `Admin` y a `Operador`.
- Interfaz `PermisosTable` en `src/database/types/types.ts` y su clave `permisos` en la interfaz `Database`.
- Actualizar `CLAUDE.md`: mencionar la tabla `permisos` en la sección de dominio y dejar anotado que **todavía no se aplica** en ningún endpoint.

**Out of scope (for future specs):**

- Cualquier código de NestJS: no hay módulo `permisos`, ni controller, ni service, ni repository. `src/app.module.ts` no cambia.
- Cualquier endpoint nuevo: no hay `GET /roles/:rolId/permisos` ni `GET /permisos`.
- **Aplicar** los permisos: no hay `PermissionsGuard` ni decorador `@Permisos('clientes.crear')`. Todo endpoint sigue accesible a cualquier usuario autenticado.
- Leer los permisos en runtime: `req.user` sigue siendo `{ userId, username }`.
- Cambios al payload del JWT o a la respuesta de `POST /auth/login`, que no devuelve `permisos`.
- CRUD de permisos: se administran por SQL a mano.
- CRUD de roles.
- Tabla puente `rol_permiso` para compartir un permiso entre roles.
- Permisos por usuario individual (una tabla `usuario_permiso` que sobrescriba los del rol).
- Tabla `modulos` para agrupar permisos.
- Permisos para funcionalidad que todavía no existe: cerrar lote, editar cliente, eliminar registros, reportes.
- Jerarquía o herencia entre roles.

---

## Data model

### DDL (aplicar a mano en MySQL)

```sql
CREATE TABLE permisos (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  rol_id       INT NOT NULL,
  codigo       VARCHAR(100) NOT NULL,
  nombre       VARCHAR(150) NOT NULL,
  descripcion  VARCHAR(255) NULL,
  isActive     TINYINT(1) NOT NULL DEFAULT 1,
  created_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_permisos_rol_codigo (rol_id, codigo),
  CONSTRAINT fk_permisos_rol FOREIGN KEY (rol_id) REFERENCES roles(id)
);
```

El `codigo` **no** es único de forma global: lo es por rol. Un mismo `codigo` aparece una vez por cada rol que lo tenga.

### Convención del `codigo`

Formato `modulo.accion`, en minúsculas y sin acentos. El `modulo` es el segmento de la ruta (`clientes`, `lotes`, `pesajes`, `usuarios`) y la `accion` es el verbo del dominio (`crear`, `listar`). Es la misma idea de `codigo` que ya usan `estados_calidad` y `etapas`.

### Datos semilla

Los permisos corresponden uno a uno con los endpoints implementados en SPEC 01, 02 y 03. No se siembra ningún permiso para funcionalidad inexistente.

| `codigo` | `nombre` | Endpoint que representa | Admin | Operador |
| --- | --- | --- | :---: | :---: |
| `clientes.crear` | Crear clientes | `POST /clientes` | ✅ | ❌ |
| `clientes.listar` | Listar clientes | `GET /clientes` | ✅ | ✅ |
| `lotes.crear` | Crear lotes | `POST /lotes` | ✅ | ✅ |
| `lotes.listar` | Listar lotes por cliente | `GET /lotes/cliente/:clienteId` | ✅ | ✅ |
| `pesajes.crear` | Registrar pesajes | `POST /pesajes` | ✅ | ✅ |
| `usuarios.crear` | Crear usuarios | `POST /auth/register` | ✅ | ❌ |

Son **10 filas**: seis de `Admin` y cuatro de `Operador`.

La semilla resuelve el `rol_id` por nombre, no por id fijo, porque los ids de `roles` no están garantizados entre ambientes:

```sql
-- Admin: los seis
INSERT INTO permisos (rol_id, codigo, nombre, descripcion)
SELECT r.id, v.codigo, v.nombre, v.descripcion
FROM roles r
JOIN (
  SELECT 'clientes.crear'  AS codigo, 'Crear clientes'           AS nombre, 'Registrar un cliente nuevo'             AS descripcion
  UNION ALL SELECT 'clientes.listar', 'Listar clientes',           'Ver los clientes vinculados al usuario'
  UNION ALL SELECT 'lotes.crear',     'Crear lotes',               'Abrir un lote nuevo para un cliente'
  UNION ALL SELECT 'lotes.listar',    'Listar lotes por cliente',  'Ver los lotes de un cliente'
  UNION ALL SELECT 'pesajes.crear',   'Registrar pesajes',         'Guardar un pesaje contra un lote'
  UNION ALL SELECT 'usuarios.crear',  'Crear usuarios',            'Registrar un usuario nuevo'
) v
WHERE r.nombre = 'Admin';

-- Operador: cuatro
INSERT INTO permisos (rol_id, codigo, nombre, descripcion)
SELECT r.id, v.codigo, v.nombre, v.descripcion
FROM roles r
JOIN (
  SELECT 'clientes.listar' AS codigo, 'Listar clientes'          AS nombre, 'Ver los clientes vinculados al usuario' AS descripcion
  UNION ALL SELECT 'lotes.crear',     'Crear lotes',              'Abrir un lote nuevo para un cliente'
  UNION ALL SELECT 'lotes.listar',    'Listar lotes por cliente', 'Ver los lotes de un cliente'
  UNION ALL SELECT 'pesajes.crear',   'Registrar pesajes',        'Guardar un pesaje contra un lote'
) v
WHERE r.nombre = 'Operador';
```

Si los nombres reales de los roles en la base no son exactamente `Admin` y `Operador`, se ajustan los literales antes de ejecutar. Es lo primero a verificar con `SELECT id, nombre FROM roles;`.

### Tipo en `src/database/types/types.ts`

```ts
export interface PermisosTable {
  id: Generated<number>;
  rol_id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  isActive: Generated<number>;
  created_at: Generated<Date | string | null>;
}
```

Y en la interfaz `Database`, una clave nueva con el mismo nombre que la tabla:

```ts
permisos: PermisosTable;
```

---

## Implementation plan

1. Verificar los nombres e ids reales de los roles con `SELECT id, nombre FROM roles;` y ajustar los literales de la semilla si no son `Admin` y `Operador`.
2. Ejecutar a mano en MySQL el `CREATE TABLE permisos` del data model.
3. Ejecutar a mano los dos `INSERT` de la semilla y confirmar con `SELECT rol_id, COUNT(*) FROM permisos GROUP BY rol_id;` que Admin tiene seis filas y Operador cuatro.
4. Agregar `PermisosTable` a `src/database/types/types.ts` y la clave `permisos` a la interfaz `Database`.
5. Levantar la app con `npm run start:dev` y confirmar que compila sin errores.
6. Actualizar `CLAUDE.md`: mencionar `permisos` en la lista de tablas de la sección Domain y anotar explícitamente que la tabla existe pero **ningún endpoint la lee todavía**.

---

## Acceptance criteria

- [X] La tabla `permisos` existe en MySQL con las columnas del data model.
- [X] `permisos.rol_id` tiene una clave foránea a `roles(id)`: insertar un `rol_id` inexistente falla.
- [X] Existe un índice único sobre `(rol_id, codigo)`: insertar dos veces `clientes.crear` para el mismo rol falla.
- [X] Insertar `lotes.crear` para `Admin` y también para `Operador` **no** falla: el `codigo` se repite entre roles.
- [X] La tabla tiene exactamente 10 filas después de la semilla.
- [X] El rol `Admin` tiene seis filas, con los seis `codigo` de la tabla del data model.
- [X] El rol `Operador` tiene exactamente cuatro: `clientes.listar`, `lotes.crear`, `lotes.listar` y `pesajes.crear`.
- [X] El rol `Operador` **no** tiene filas con `clientes.crear` ni `usuarios.crear`.
- [X] Toda fila sembrada tiene `isActive = 1` por defecto.
- [X] `src/database/types/types.ts` declara `PermisosTable` y la interfaz `Database` incluye la clave `permisos`.
- [X] La app arranca sin errores de compilación (`npm run start:dev`).
- [X] No se creó ningún archivo bajo `src/modules/`, y `src/app.module.ts` no cambió.
- [X] No existe ninguna ruta nueva: `GET /roles/:rolId/permisos` responde 404 de Nest.
- [X] `POST /clientes` sigue respondiendo 201 para un usuario con rol `Operador`: **este spec no bloquea nada**.
- [X] `POST /auth/login` responde exactamente igual que antes de este spec, sin clave `permisos`.
- [X] El payload del JWT no cambió: sigue siendo `sub`, `user_id` y `username`.
- [X] `POST /clientes`, `GET /clientes` (SPEC 01), `POST /lotes`, `GET /lotes/cliente/:clienteId` (SPEC 02), `POST /pesajes` (SPEC 03, SPEC 04) y `POST /auth/refresh` (SPEC 05) siguen funcionando igual.

---

## Decisions

- **Sí:** una sola tabla `permisos` con `rol_id` apuntando a `roles`. Decisión explícita del usuario. Es lo mínimo que responde la pregunta "qué permisos tiene este rol" con un solo `SELECT`.
- **No:** catálogo `permisos` más tabla puente `rol_permiso`. Se descarta por decisión explícita del usuario: es el modelo más normalizado, pero exige dos tablas y un join para algo que hoy tiene dos roles y diez filas. Se anota la consecuencia asumida: un permiso compartido se escribe una vez por rol, así que renombrar `lotes.crear` obliga a actualizar todas sus filas.
- **No:** una columna JSON `roles.permisos` con un array de códigos. Se descarta: sin integridad referencial y sin poder consultar "qué roles tienen este permiso".
- **Sí:** `UNIQUE (rol_id, codigo)` en vez de `UNIQUE (codigo)`. Es la única forma coherente con el modelo elegido: el `codigo` se repite entre roles a propósito, y lo que no puede repetirse es el par.
- **Sí:** identificar los permisos por un `codigo` string con formato `modulo.accion`. Decisión explícita del usuario. Es legible en el código del futuro guard y sobrevive a que los ids cambien entre ambientes.
- **No:** códigos en MAYÚSCULAS tipo `CLIENTES_CREAR`. Se descarta por consistencia con `estados_calidad.codigo` y `etapas.codigo`, que ya existen en minúsculas.
- **Sí:** constraints reales en MySQL (`UNIQUE` y la clave foránea). Es una **excepción deliberada** a la decisión de los SPEC 01–03 de validar unicidad solo en código. La razón: aquí no hay código que valide nada, porque este spec no trae ni una línea de NestJS y la tabla se llena a mano por SQL. Sin constraints, un typo al insertar quedaría en silencio.
- **Sí:** `permisos.isActive`. Decisión explícita del usuario. Permite retirar un permiso sin borrar la fila ni perder el registro de que existió.
- **Sí:** el spec es solo base de datos más `types.ts`. Decisión explícita del usuario. Nada de módulo, controller ni endpoint.
- **No:** un `GET /roles/:rolId/permisos` para poder consultarlos por la API. Se descarta en este spec: la verificación se hace con `SELECT` contra MySQL, y el endpoint entra cuando algo lo consuma de verdad.
- **Sí:** actualizar `types.ts` aunque todavía ningún repositorio consulte la tabla. Decisión explícita del usuario. `src/database/types/types.ts` es el espejo del esquema y dejarlo desactualizado es justamente lo que `CLAUDE.md` advierte que no se haga.
- **No:** devolver `permisos` en la respuesta de `POST /auth/login`. Se descarta: cambiaría el contrato del login, que SPEC 05 acaba de modificar.
- **No:** aplicar los permisos con un guard en este spec. Decisión explícita del usuario. Tocaría el `JwtStrategy`, el payload del JWT y los cuatro módulos existentes; va en su propio spec.
- **Sí:** sembrar solo los permisos que corresponden a endpoints existentes. Decisión explícita del usuario. La tabla describe lo que el sistema hace hoy, no lo que se planea.
- **No:** sembrar permisos para funcionalidad futura (cerrar lote, editar cliente, reportes). Se descarta: serían filas que nada valida y que envejecen mal si la funcionalidad se diseña distinta.
- **No:** darle los seis permisos también a `Operador` para replicar el comportamiento actual. Se descarta: el valor de este spec es justamente dejar escrito que `Operador` no crea clientes ni usuarios. Como nada se aplica todavía, la diferencia no rompe a nadie.
- **Sí:** resolver el `rol_id` por nombre en los `INSERT` de la semilla. Los ids de `roles` no están garantizados entre la base local y la de producción.
- **No:** permisos por usuario individual (`usuario_permiso`). Se descarta: complica el modelo antes de que exista una necesidad real, y el permiso por rol cubre el caso Admin/Operador que motivó este spec.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Se asume que existen roles llamados exactamente `Admin` y `Operador`, y podrían llamarse distinto o no existir | El paso 1 del plan es verificar `SELECT id, nombre FROM roles;` antes de ejecutar la semilla. Si los nombres difieren, se ajustan los literales del SQL. |
| Al no haber catálogo, el `nombre` y la `descripcion` de un mismo `codigo` pueden divergir entre roles | Sin mitigar: es la contrapartida directa del modelo de una sola tabla. La semilla los escribe idénticos, pero nada lo obliga después. |
| La semilla queda desalineada con el código: se agrega un endpoint nuevo y nadie inserta su permiso | Sin mitigación automática: no hay migraciones ni validación en arranque. Se anota en `CLAUDE.md` que agregar un endpoint implica insertar su permiso a mano, una fila por rol. |
| `usuarios.crear` representa `POST /auth/register`, que hoy es `@Public()` y por tanto no tiene usuario autenticado a quien pedirle un permiso | El permiso queda sembrado como declaración de intención. El spec del guard tendrá que decidir si `register` deja de ser público; se anota aquí para que no se descubra tarde. |
| Alguien ve la tabla y asume que los permisos ya se aplican | Se documenta explícitamente en `CLAUDE.md`, y hay un criterio de aceptación que verifica que un `Operador` **sigue pudiendo** hacer `POST /clientes`. |
| La clave foránea falla al crearse si `roles.id` no es `INT` o si los motores de tabla no coinciden | Se detecta al ejecutar el `CREATE TABLE` del paso 2, antes de tocar código. Si falla, se ajusta el tipo de columna al de `roles.id`. |

---

## What is **not** in this spec

- Cualquier código de NestJS: módulo, controller, service o repository. `src/app.module.ts` no cambia.
- Cualquier endpoint nuevo.
- Aplicar los permisos: no hay guard ni decorador `@Permisos()`, y ningún endpoint devuelve 403 por falta de permiso.
- Leer los permisos en runtime; `req.user` no cambia.
- Cambios al payload del JWT ni a la respuesta de `POST /auth/login`.
- CRUD de permisos y CRUD de roles.
- Tabla puente `rol_permiso`.
- Permisos por usuario individual.
- Tabla `modulos` para agrupar permisos.
- Permisos para funcionalidad que todavía no existe.
- Jerarquía o herencia entre roles.

Cada uno de estos, si se necesita, va en su propio spec.
