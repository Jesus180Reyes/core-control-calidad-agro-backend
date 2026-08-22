# SPEC 01 — Vinculación de clientes con operadores

> **Status:** Draft
> **Depends on:** Approved
> **Date:** 2026-08-22
> **Objective:** Permitir vincular clientes con operadores (usuarios) mediante una relación muchos-a-muchos, de modo que `GET /clientes` solo muestre al operador autenticado los clientes a los que está vinculado.

---

## Scope

**In:**

- Nueva tabla intermedia `cliente_operador` que relaciona `clientes` con `usuarios` (muchos a muchos).
- Endpoint `POST /clientes` para crear un cliente, con un arreglo opcional `usuario_ids` para vincular operadores en el mismo paso.
- `GET /clientes` filtrado: solo devuelve los clientes vinculados (vía `cliente_operador`) al `usuario_id` del token JWT del solicitante. Aplica a cualquier usuario autenticado, sin distinción de rol.
- Un operador sin ningún cliente vinculado recibe un arreglo vacío en `GET /clientes`.

**Out of scope (for future specs):**

- Endpoints para agregar o quitar operadores de un cliente ya existente (gestión del vínculo después de la creación).
- Restricción de `GET /clientes/:id` por vínculo — este endpoint no cambia y sigue sin restricción.
- Restricción por rol (p. ej. que solo administradores puedan crear clientes o ver todos los clientes sin filtro).
- Endpoints `PUT`/`PATCH`/`DELETE` para clientes.
- Cambios a `POST /auth/register` (el registro de usuario no se modifica en este spec).
- Una entidad `empresas` separada de `clientes` — en este dominio, `cliente` ya representa una empresa/compañía, así que no se introduce una tabla nueva para ese concepto.

---

## Data model

Nueva tabla `cliente_operador` (relación muchos-a-muchos entre `clientes` y `usuarios`):

```sql
CREATE TABLE cliente_operador (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  usuario_id INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cliente_operador_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  CONSTRAINT fk_cliente_operador_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  UNIQUE KEY uq_cliente_operador (cliente_id, usuario_id)
);
```

Este DDL debe ejecutarse manualmente en MySQL (el repo no tiene herramienta de migraciones; el esquema se asume preexistente, igual que el resto de tablas en `src/database/types/types.ts`).

Tipo Kysely equivalente a agregar en `src/database/types/types.ts`:

```ts
export interface ClienteOperadorTable {
  id: Generated<number>;
  cliente_id: number;
  usuario_id: number;
  created_at: Generated<Date | string | null>;
}
```

Y registrarla en `Database`:

```ts
export interface Database {
  // ...existentes
  cliente_operador: ClienteOperadorTable;
}
```

DTO nuevo `src/modules/clientes/dto/create-cliente.dto.ts` (Zod, siguiendo el patrón de `register.dto.ts`):

- `nombre: string` — requerido.
- `rtn: string` — requerido.
- `codigo_exportacion`, `correo_contacto`, `telefono`, `direccion_planta`, `ubicacionLongitud`, `ubicacionLatitude` — todos opcionales (`nullable` en la tabla).
- `usuario_ids: z.array(z.number()).optional()` — ids de operadores a vincular al crear; puede omitirse o venir vacío.

---

## Implementation plan

1. Ejecutar en MySQL el `CREATE TABLE cliente_operador` documentado arriba.
2. Actualizar `src/database/types/types.ts`: agregar `ClienteOperadorTable` y registrarla en `Database`.
3. Crear `src/modules/clientes/dto/create-cliente.dto.ts` con el schema Zod descrito en el modelo de datos.
4. En `src/modules/clientes/repository/clientes.repository.ts`: agregar `createCliente(data)` (insert en `clientes`, `created_by` viene del usuario autenticado), `linkOperadores(clienteId, usuarioIds)` (insert masivo en `cliente_operador`), y `getAllClientesByOperador(usuarioId)` (select en `clientes` con `innerJoin('cliente_operador', ...)` filtrando por `usuario_id`, reemplazando el filtro actual de `getAllClientes`).
5. En `src/modules/clientes/clientes.service.ts`: agregar `create(dto, userId)` (llama a `createCliente` y, si `usuario_ids` tiene elementos, a `linkOperadores`) y modificar `findAll(userId)` para usar `getAllClientesByOperador`.
6. En `src/modules/clientes/clientes.controller.ts`: agregar `POST /clientes` (usa `@Body() dto: CreateClienteDto` y `@Req() req` para leer `req.user.userId` como `created_by`) y actualizar `GET /clientes` para leer `req.user.userId` del request y pasarlo a `findAll`.
7. Verificación manual: crear un cliente con `usuario_ids: [X]`, autenticarse como el usuario `X` y confirmar que `GET /clientes` devuelve solo ese cliente; autenticarse con un usuario sin vínculos y confirmar que devuelve un arreglo vacío.

---

## Acceptance criteria

- [ ] La tabla `cliente_operador` existe en la base de datos según el DDL de este spec.
- [ ] `src/database/types/types.ts` incluye `ClienteOperadorTable` registrada en `Database`.
- [ ] `POST /clientes` crea un cliente nuevo con `nombre` y `rtn` como únicos campos obligatorios.
- [ ] `POST /clientes` con `usuario_ids` no vacío crea los registros correspondientes en `cliente_operador`.
- [ ] `POST /clientes` sin `usuario_ids` (u omitido) crea el cliente sin ningún vínculo.
- [ ] El campo `created_by` del cliente creado corresponde al `userId` del token JWT usado en la petición.
- [ ] `GET /clientes` devuelve únicamente los clientes vinculados al `userId` del token JWT del solicitante.
- [ ] Un usuario autenticado sin ningún cliente vinculado recibe `clientes: []` en `GET /clientes`.
- [ ] `GET /clientes/:id` no cambia su comportamiento (sigue sin restricción por vínculo).

---

## Decisions

- **Sí:** reutilizar `clientes` como la "empresa" del operador, sin crear una tabla `empresas` nueva. Evita duplicar el concepto de compañía cuando `cliente` ya lo representa en este dominio.
- **No:** un campo único `cliente_id` en `usuarios` (relación uno a muchos). Se descarta porque un operador puede necesitar trabajar con varios clientes a la vez.
- **Sí:** tabla intermedia `cliente_operador` para modelar la relación muchos a muchos.
- **Sí:** el filtro de `GET /clientes` aplica a cualquier usuario autenticado, sin lógica condicional por rol. Simplifica esta iteración; una excepción por rol (p. ej. administradores viendo todo) queda fuera de alcance.
- **Sí:** el vínculo solo se gestiona al crear el cliente (`usuario_ids` opcional en `POST /clientes`). Se descartan endpoints separados de vinculación/desvinculación por ahora.
- **No:** restringir `GET /clientes/:id` por vínculo. Solo se filtra el listado.
- **Sí:** documentar el DDL SQL directamente en el spec en vez de usar una herramienta de migraciones, siguiendo la convención existente del repo (esquema preexistente, sin migraciones versionadas).

---

## What is **not** in this spec

- Endpoints para agregar o quitar operadores de un cliente después de creado.
- Restricción de acceso en `GET /clientes/:id`.
- Restricción por rol sobre quién puede crear clientes o ver el listado sin filtro.
- Actualización o eliminación de clientes (`PUT`/`PATCH`/`DELETE`).
- Cambios al flujo de registro de usuarios (`POST /auth/register`).
- Una tabla `empresas` independiente de `clientes`.

Cada uno de estos, si se necesita, va en su propio spec.
