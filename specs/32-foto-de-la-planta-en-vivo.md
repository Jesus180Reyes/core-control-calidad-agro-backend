# SPEC 32 — Foto de la planta en vivo para el Mirador

> **Status:** Approved
> **Depends on:** SPEC 02 (crea `lotes` y su ciclo `abierto`/`cerrado`), SPEC 03 (crea `pesajes`), SPEC 04 (deriva `fuera_de_rango` y `estados_calidad`), SPEC 10 (anulación de pesajes con `isActive = 0`), SPEC 12 (rechazo de lotes), SPEC 13 (aprobación de lotes), SPEC 20 (finalización de lotes), SPEC 22 (Swagger)
> **Date:** 2026-10-05
> **Objective:** Agregar `GET /plantas/en-vivo`, que devuelve en una sola lectura los clientes con sus lotes vigentes (cada uno con su etapa en el tablero, sus totales y sus últimos diez pesajes) más los KPIs del día, para que el Mirador del front la pida cada 1 a 2 minutos.

---

## Why this spec exists

El front ya tiene armada la pantalla `/mirador`: una planta en 3D donde cada cliente es una fila, cada lote es una caja que avanza por tres casillas (en pesaje → por aprobar → finalizado) y cada pesaje nuevo se anima cayendo sobre su lote. Hoy corre contra un servidor simulado en el navegador (`plantSnapshotMock.ts`, en el repo del front) que devuelve la forma de este spec más una casilla `despacho` y un campo `documento_fiscal` que este spec quitó (ver Risks). Conectar el endpoint toca el interior de un hook del front y quitar esa casilla.

El front no anima eventos que le mande el backend. Pide una **foto** de la planta cada 1 a 2 minutos (con un desfase aleatorio de unos segundos, para que las pantallas no pidan todas a la vez) y reparte la animación de los pesajes nuevos a lo largo del intervalo. Calcula él solo qué cambió respecto de la anterior: lote nuevo, cambio de casilla, pesaje nuevo, pesaje anulado, lote que sale. Por eso este endpoint no guarda nada ni lleva estado entre llamadas. Pero la foto tiene que ser **consistente de una llamada a la otra**, y casi todas las reglas de abajo existen para eso.

Tres cosas conviene tener claras antes de leer el resto.

**La primera: "en pesaje" y "por aprobar" no existen en la base.** El tablero tiene tres casillas, y `lotes.estado` sólo vale `abierto`/`cerrado`. La casilla se **deriva** de la etapa del lote en `etapas` (`EN_PROCESO` → en pesaje, `CLIENTE_FINAL` → por aprobar, `FINALIZADO` → finalizado). El string `etapa` de la respuesta es vocabulario del tablero, no un código de la base. **No hay casilla de despacho**: `finalizado` es la última casilla y representa el lote listo para salir (decisión del usuario), así que el endpoint no lee documentos fiscales.

**La segunda: un lote nunca sale de planta en la base.** No hay columna de salida ni de embarque: un lote finalizado queda finalizado para siempre. Sin un corte, el tablero acumularía todos los lotes de la historia. El corte es por **ventanas de tiempo** (decisión del usuario): un finalizado se ve 7 días desde `finalizado_en` y un rechazado se ve 5 minutos. Cuando un lote sale de su ventana, desaparece de la foto, y el front lo anima como "salió de planta".

**La tercera: es la planta entera, sin cartera y sin permiso.** No se filtra por `cliente_operador` ni se siembra un permiso nuevo (decisión del usuario). Es una vista de planta, igual que el chat (SPEC 28) no filtra por cartera. Aprobadores y ADMIN no tienen filas en `cliente_operador`, así que con filtro verían el tablero vacío. Cualquier usuario autenticado lo ve; el `JwtAuthGuard` global es el único control.

---

## Scope

**In:**

- Módulo nuevo `src/modules/plantas/` (module, controller, service, repository), registrado en `src/app.module.ts`.
- `GET /plantas/en-vivo`, sin parámetros, protegido por el `JwtAuthGuard` global.
- La derivación de la casilla de cada lote y las ventanas de tiempo que deciden qué lotes entran en la foto.
- Por lote: rango de peso, conteos y peso neto total de sus pesajes activos y sus últimos 10 pesajes activos.
- KPIs del día calculados con `CURDATE()`.
- Swagger del endpoint (`@ApiTags('Plantas')`, `@ApiBearerAuth`, `@ApiOperation`).

**Out of scope (for future specs):**

- **Una casilla de despacho** separada de `finalizado`, ya sea derivada del documento fiscal (SPEC 25) o de una columna de salida de planta (`lotes.despachado_en` y un `PATCH` para marcarla). Hoy `finalizado` hace de despacho.
- **Filtro por cartera** (`cliente_operador`). Ver Decisions.
- **Un permiso `MODULO-MIRADOR`.** Ver Decisions.
- **Push en vez de polling** (SSE o WebSocket). El front pide cada 1 a 2 minutos y sólo con la pestaña visible; con esa frecuencia la carga es menor a una petición por segundo incluso con 50 pantallas.
- **Varias plantas.** El nombre de la ruta es `plantas` por el recurso, pero hoy hay una sola planta: ni `:id` ni filtro.
- **Paginación o filtros** de la foto.
- **Detalle de pesajes de un lote.** El front ya usa `GET /pesajes/byLote/:loteId` para eso; no se toca.
- **Cache del lado del servidor.**

---

## Data model

Este spec **no** crea tablas ni columnas. Lee `clientes`, `lotes`, `etapas`, `productos`, `unidades_medida`, `pesajes`, `usuarios` y `estados_calidad`. **No** lee `documentos_fiscales` ni `documento_fiscal_lote`.

### Archivos

| Archivo | Cambio |
| --- | --- |
| `src/modules/plantas/plantas.module.ts` | Nuevo. `imports: [DatabaseModule]`. |
| `src/modules/plantas/plantas.controller.ts` | Nuevo. `@Controller('plantas')`, un `@Get('en-vivo')`. |
| `src/modules/plantas/plantas.service.ts` | Nuevo. Pass-through al repository. |
| `src/modules/plantas/repository/plantas.repository.ts` | Nuevo. Las consultas y el armado de la foto. |
| `src/app.module.ts` | Registrar `PlantasModule`. |

No hay DTO: el endpoint no recibe query params ni body.

### La casilla de cada lote (`etapa`)

Sale de la fila de `etapas` a la que apunta `lotes.etapa_id`, leída por `codigo` con un `LEFT JOIN`. Cada lote está en una sola etapa, así que las reglas no compiten y **el orden no importa**: es un `CASE etapas.codigo` directo, más las ventanas.

| `etapas.codigo` | `etapa` | Ventana para entrar en la foto |
| --- | --- | --- |
| `EN_PROCESO` | `en-pesaje` | Siempre |
| `CLIENTE_FINAL` | `por-aprobar` | Siempre |
| `FINALIZADO` | `finalizado` | `finalizado_en >= NOW() - INTERVAL 7 DAY` |
| `RECHAZADO` | `rechazado` | `rechazado_en >= NOW() - INTERVAL 5 MINUTE` |
| Otro, o `etapa_id` en `NULL` (dato viejo) | — | No entra |

Se compara siempre **por `codigo`**, nunca por los ids 1 a 4: los ids cambian entre ambientes. Esto se aparta de la tabla de discriminadores de `CLAUDE.md`, que mira `motivo_rechazo`, `finalizado_por`, `aprobado_por` y `estado`. Para lotes movidos por la API las dos lecturas dan lo mismo, porque cada ruta que cambia la etapa escribe sus columnas de auditoría en el mismo `UPDATE`:

| Etapa | Quién la escribe | Equivale a |
| --- | --- | --- |
| `EN_PROCESO` | `POST /lotes` | `estado = 'abierto'` |
| `CLIENTE_FINAL` | `PATCH /lotes/:id/aprobar` | `aprobado_por IS NOT NULL AND finalizado_por IS NULL AND motivo_rechazo IS NULL` |
| `FINALIZADO` | `PATCH /lotes/:id/finalizar/byApprover` | `finalizado_por IS NOT NULL` |
| `RECHAZADO` | `PATCH /lotes/:id/rechazar` y `/rechazar/byApprover` | `motivo_rechazo IS NOT NULL` |

Lo que en la tabla de `CLAUDE.md` exige un orden (revisar el rechazo antes que `aprobado_por`, porque un lote rechazado por el aprobador ya tiene `aprobado_por`) acá no hace falta: ese lote pasa a `RECHAZADO` y deja de estar en `CLIENTE_FINAL`.

Tres casos donde la etapa y las columnas pueden no coincidir:

- **`createLote` escribe `etapa_id: 1` a mano** en vez de resolver `EN_PROCESO` por `codigo` (contraejemplo conocido de `CLAUDE.md`). En un ambiente donde `EN_PROCESO` no sea el id 1, los lotes nuevos no entran en la foto. Este spec no corrige `createLote`.
- **Un lote con `etapa_id` en `NULL`** (la columna lo admite) no aparece, aunque esté abierto.
- **Un lote movido de etapa a mano** sin escribir la fecha de su ventana (`finalizado_en` o `rechazado_en`) no entra en la foto, porque la comparación con `NULL` da falso.

El paso 3 del plan verifica los dos primeros.

Un lote cuya etapa tiene ventana y está fuera de ella **no entra en la foto**: un finalizado de hace 8 días simplemente desaparece.

`finalizado` es la última casilla del tablero. Que el lote tenga o no un documento fiscal no cambia nada: no hay casilla de despacho.

`rechazado` no tiene casilla en el tablero. Viaja sólo para que el front anime la caja saliendo en rojo en vez de como "salió de planta". Los 5 minutos son más del doble del intervalo máximo de polling (2 min), así que una pantalla activa siempre ve al menos una foto con el lote rechazado. Si el front no llega a verlo (pestaña dormida), el lote simplemente desaparece. **Si el intervalo sube, esta ventana tiene que subir con él.**

Sólo entran lotes de clientes con `clientes.isActive = 1`. Un cliente rechazado desaparece del tablero con todos sus lotes.

### Respuesta

```json
{
  "ok": true,
  "msg": "Planta obtenida correctamente",
  "planta": {
    "generado_en": "2026-10-05T15:42:10.000Z",
    "kpis": {
      "pesajes_hoy": 214,
      "peso_neto_hoy": 9876.4,
      "pct_en_rango_hoy": 96.26,
      "lotes_activos": 11,
      "clientes_con_actividad_hoy": 4
    },
    "clientes": [
      {
        "id": 101,
        "nombre": "Beneficio Montaña Azul",
        "producto": "Café oro",
        "codigo_exportacion": "EXP-0142",
        "lotes": [
          {
            "id": 901,
            "nombre_lote": "L-2610-06",
            "producto": "Café oro",
            "unidad_medida": "kg",
            "etapa": "en-pesaje",
            "peso_minimo": "68.60",
            "peso_ideal": "69.00",
            "peso_maximo": "69.50",
            "bultos": 18,
            "bultos_fuera_rango": 1,
            "peso_neto_total": 1242.37,
            "ultimos_pesajes": [
              {
                "id": 45213,
                "peso_neto": "69.04",
                "fuera_de_rango": false,
                "estado_calidad_codigo": "IDEAL",
                "usuario": "María Castillo",
                "created_at": "2026-10-05T15:41:58.000Z"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

### Campos

**`planta`**

| Campo | Origen | Nota |
| --- | --- | --- |
| `generado_en` | `SELECT NOW()` | El reloj de MySQL, el mismo que escribió los `created_at`. Se devuelve como sale, sin convertir zona (como el resto de las fechas). |
| `clientes` | Clientes con al menos un lote en la foto | Un cliente sin lotes en la foto **no** viaja. Orden: `clientes.id` ascendente. |

**`kpis`** — sobre **todos** los pesajes activos de hoy de la planta, no sólo los de los lotes de la foto. "Hoy" es `pesajes.created_at >= CURDATE() AND pesajes.created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`, la regla de SPEC 28.

| Campo | Tipo | Cálculo |
| --- | --- | --- |
| `pesajes_hoy` | `number` | `COUNT(*)` de pesajes activos de hoy. |
| `peso_neto_hoy` | `number` | `SUM(peso_neto)` de esos pesajes, con `Number()` y redondeado a 2 decimales. `0` sin pesajes. |
| `pct_en_rango_hoy` | `number \| null` | `100 * (pesajes con fuera_de_rango = 0) / pesajes_hoy`, redondeado a 2 decimales. **`null` si `pesajes_hoy = 0`**, nunca `0` ni `NaN`. |
| `lotes_activos` | `number` | Lotes de la foto con `etapa` `en-pesaje` o `por-aprobar`. |
| `clientes_con_actividad_hoy` | `number` | `COUNT(DISTINCT lotes.cliente_id)` de los pesajes activos de hoy. |

**`clientes[]`**

| Campo | Origen |
| --- | --- |
| `id`, `nombre`, `codigo_exportacion` | `clientes` |
| `producto` | `productos.nombre` por `clientes.producto_id`; `null` si no tiene. |
| `lotes` | Sus lotes en la foto, orden `lotes.id` ascendente. |

**`lotes[]`**

| Campo | Origen | Nota |
| --- | --- | --- |
| `id`, `nombre_lote` | `lotes` | |
| `producto`, `unidad_medida` | `productos.nombre`, `unidades_medida.nombre` | Mismos joins que `GET /lotes/cliente/:clienteId/all`. |
| `etapa` | Tabla de arriba | `'en-pesaje' \| 'por-aprobar' \| 'finalizado' \| 'rechazado'`, con guiones y en minúscula. Las etiquetas visibles ("En pesaje", "Por aprobar", "Finalizado") las pone el front; el backend no manda texto para mostrar. |
| `peso_minimo`, `peso_ideal`, `peso_maximo` | `lotes` | El decimal **tal como sale** de mysql2 (string), igual que en `/lotes`. |
| `bultos` | `COUNT` de pesajes del lote con `isActive = 1` | Es **la verdad del conteo**: el front la usa para detectar anulaciones. Con `Number()`. |
| `bultos_fuera_rango` | Los mismos, con `fuera_de_rango = 1` | Con `Number()`. |
| `peso_neto_total` | `SUM(peso_neto)` de los mismos | `number`, 2 decimales; `0` si no tiene pesajes. |
| `ultimos_pesajes` | Ver abajo | |

**`ultimos_pesajes[]`** — los **10** pesajes activos (`isActive = 1`) de mayor `id` del lote, **del más nuevo al más viejo** (`id DESC`). Menos de 10 si el lote tiene menos; `[]` si no tiene.

| Campo | Origen | Nota |
| --- | --- | --- |
| `id` | `pesajes.id` | |
| `peso_neto` | `pesajes.peso_neto` | String, como en `GET /pesajes/byLote/:loteId`. |
| `fuera_de_rango` | `pesajes.fuera_de_rango` | **Boolean**, como en `byLote`. |
| `estado_calidad_codigo` | `estados_calidad.codigo` | `IDEAL`, `MAXIMO` o `MINIMO` (SPEC 04). |
| `usuario` | `usuarios.complete_name` | El mismo campo que `byLote`. |
| `created_at` | `pesajes.created_at` | Sin convertir. |

### Las dos reglas de las que depende el front

Si alguna de estas dos se rompe, la pantalla anima cosas que no pasaron.

1. **Los ids de pesaje son correlativos y nunca se reutilizan.** El front decide que un pesaje es nuevo porque su `id` es mayor que el mayor `id` que ya veía en ese lote. Por eso `ultimos_pesajes` se ordena por `id` y no por `created_at`. El `AUTO_INCREMENT` de `pesajes` ya lo garantiza; este spec sólo prohíbe ordenar distinto.
2. **`bultos` cuenta todo el lote, y `ultimos_pesajes` es sólo una ventana.** El front detecta una anulación porque `bultos` baja más de lo que explican los pesajes nuevos. Si `bultos` contara sólo los 10 últimos, cada pesaje nuevo se leería como una anulación.

### Las consultas

Todo en el repository, con Kysely sobre `this.dbService.client`. Son cuatro lecturas, ninguna por lote: nada de N+1, porque el endpoint se llama periódicamente por cada pantalla abierta.

1. **Lotes de la foto.** `lotes` ⨝ `clientes` (`isActive = 1`) ⨝ `productos` ⨝ `unidades_medida`, más un `LEFT JOIN` a `etapas` por `lotes.etapa_id` para la casilla (en la misma consulta, sin un `resolveEtapa` aparte). La `etapa` sale de un `CASE` con el orden de la tabla, y las ventanas van en el `WHERE`. También trae los datos del cliente y `productos.nombre` del cliente (un segundo join a `productos` por `clientes.producto_id`, con alias). **No usar `selectAll()`** sobre `lotes` (arrastra `firma_aprobador`).
2. **Totales por lote.** `pesajes` con `isActive = 1` y `lote_id IN (ids de 1)`, `GROUP BY lote_id`: `COUNT(*)`, `SUM(fuera_de_rango = 1)`, `SUM(peso_neto)`. Un lote sin pesajes no sale del `GROUP BY` y se completa con ceros en Node.
3. **Últimos pesajes.** Sobre los mismos ids, `ROW_NUMBER() OVER (PARTITION BY lote_id ORDER BY id DESC)` en una subconsulta, quedándose con `rn <= 10`, más los joins a `usuarios` y `estados_calidad`. Necesita MySQL 8 (ver el paso 1 del plan).
4. **KPIs del día.** Una sola consulta sobre `pesajes` activos de hoy ⨝ `lotes`, más `SELECT NOW()` para `generado_en`.

Si la consulta 1 no devuelve lotes, las 2 y 3 **no se ejecutan** (un `IN ()` vacío es un error de SQL): `clientes` es `[]` y los KPIs se calculan igual.

El armado del árbol cliente → lotes → pesajes se hace en Node, agrupando los resultados de las cuatro consultas.

---

## Implementation plan

1. **Verificar la versión de MySQL.** `SELECT VERSION()` contra el ambiente de desarrollo y el de producción. Con 8.x, la consulta 3 usa `ROW_NUMBER()`. Con 5.7 se trae todos los pesajes activos de los lotes de la foto, ordenados por `lote_id, id DESC`, y se cortan a 10 en Node; anotarlo en este spec antes de seguir. Verificación: la versión queda escrita en el spec.
   - **Resultado (2026-10-06):** `SELECT VERSION()` devuelve `8.0.46` en desarrollo y en producción. La consulta 3 usa `ROW_NUMBER()`; el plan alternativo de 5.7 no se aplica.
2. **Esqueleto del módulo.** Crear `plantas.module.ts`, `plantas.controller.ts`, `plantas.service.ts` y `repository/plantas.repository.ts`, y registrar el módulo en `app.module.ts`. El controller devuelve `{ ok: true, msg: 'Planta obtenida correctamente', planta }` con una foto vacía (`clientes: []`, KPIs en cero, `pct_en_rango_hoy: null`). Verificación: `GET /plantas/en-vivo` con token responde 200 con esa forma; sin token, 401.
3. **Consulta 1 y la `etapa`.** Implementar la lectura de lotes con el `CASE`, las ventanas y el agrupado por cliente; `bultos`, totales y `ultimos_pesajes` todavía en cero/`[]`. Verificación: comparar con un `SELECT` a mano que haya un lote de cada casilla en la base de desarrollo, más un finalizado de hace más de 7 días que **no** aparece. Además, confirmar con `SELECT` que no hay lotes con `estado = 'abierto'` cuya etapa no sea `EN_PROCESO` (incluidos los de `etapa_id` en `NULL`); si los hay, anotarlo en este spec antes de seguir.
   - **Resultado (2026-10-06, desarrollo):** hay **tres** lotes con `estado = 'abierto'` y `etapa_id` en `NULL`: id 1 (`PDK-2123`), id 7 (`AGROBFN2122`) e id 8 (`AGROBFN2123`). Ningún lote abierto apunta a una etapa distinta de `EN_PROCESO`. Esos tres **no aparecen en la foto**, por la regla de la tabla de casillas (`etapa_id` en `NULL` no entra); este spec no los corrige ni cambia la regla. Si deben verse en el Mirador, se arreglan con un `UPDATE` a mano que les asigne la etapa `EN_PROCESO` resuelta por `codigo`, fuera de este spec.
4. **Consultas 2 y 3.** Totales por lote y últimos 10 pesajes. Verificación: para un lote, `bultos` coincide con la cantidad de filas de `GET /pesajes/byLote/:loteId`, y `ultimos_pesajes[0].id` es el mayor id de esa lista.
5. **Consulta 4 y `generado_en`.** Verificación: `pesajes_hoy` coincide con un `COUNT(*)` a mano con `created_at >= CURDATE()` e `isActive = 1`.
6. **Swagger.** `@ApiTags('Plantas')`, `@ApiBearerAuth()`, `@ApiOperation` con un `summary` y una `description` que explique las casillas y las ventanas. Sin `@ApiResponse`. Verificación: el endpoint aparece en `/docs` con su descripción.

---

## Acceptance criteria

- [ ] `npm run build` pasa sin errores.
- [ ] `GET /plantas/en-vivo` sin token responde 401.
- [ ] Con token de cualquier rol (OPERADOR o ADMIN) responde 200 con `{ ok: true, msg: 'Planta obtenida correctamente', planta: { generado_en, kpis, clientes } }`.
- [ ] Un OPERADOR sin filas en `cliente_operador` ve los mismos clientes que un ADMIN.
- [ ] Un lote recién creado con `POST /lotes` aparece en la foto siguiente con `etapa: 'en-pesaje'`, `bultos: 0`, `peso_neto_total: 0` y `ultimos_pesajes: []`.
- [ ] Después de un `POST /pesajes` sobre ese lote, la foto siguiente trae `bultos` uno mayor y el pesaje nuevo como `ultimos_pesajes[0]`.
- [ ] Un lote con 15 pesajes activos trae `bultos: 15` y exactamente 10 elementos en `ultimos_pesajes`, ordenados por `id` descendente.
- [ ] Después de anular un pesaje (`isActive = 0`), la foto siguiente trae `bultos` uno menor y ese pesaje no aparece en `ultimos_pesajes`.
- [ ] Después de `PATCH /lotes/:id/aprobar`, el lote viaja con `etapa: 'por-aprobar'`.
- [ ] Después de `PATCH /lotes/:id/finalizar/byApprover`, el lote viaja con `etapa: 'finalizado'`.
- [ ] Un lote finalizado que además está en un documento fiscal activo sigue viajando con `etapa: 'finalizado'`.
- [ ] Un lote finalizado hace más de 7 días no aparece en la foto.
- [ ] Ningún lote viaja con `etapa: 'despacho'`, y los lotes no traen el campo `documento_fiscal`.
- [ ] Un lote rechazado (por `PATCH /lotes/:id/rechazar` o por `/rechazar/byApprover`) viaja con `etapa: 'rechazado'` durante 5 minutos y después deja de aparecer.
- [ ] Un cliente con `isActive = 0` no aparece, aunque tenga lotes abiertos.
- [ ] Un cliente sin lotes en la foto no aparece en `clientes`.
- [ ] Con ningún pesaje activo hoy, `pesajes_hoy` es `0`, `peso_neto_hoy` es `0` y `pct_en_rango_hoy` es `null`.
- [ ] Con la base sin lotes vigentes, responde 200 con `clientes: []` (sin error de `IN ()` vacío).
- [ ] `fuera_de_rango` viaja como boolean y `estado_calidad_codigo` como `IDEAL`, `MAXIMO` o `MINIMO`.
- [ ] `bultos`, `bultos_fuera_rango`, `peso_neto_total` y los KPIs viajan como `number`, no como string.
- [ ] El endpoint ejecuta como máximo cinco consultas por llamada, cualquiera sea la cantidad de lotes.
- [ ] El endpoint aparece en Swagger bajo la etiqueta `Plantas`.
- [ ] Ningún endpoint existente cambia su respuesta.

---

## Decisions

- **Sí:** una foto completa por polling, no eventos. El front ya calcula el diff entre fotos y con eso anima; el backend no guarda qué vio cada pantalla.
- **No:** un endpoint de eventos (`?desde=<timestamp>`). Obliga al backend a llevar un historial de cambios de etapa que hoy no existe (las transiciones pisan columnas) y a resolver la pantalla que se perdió eventos.
- **Sí:** el tablero llega sólo hasta `finalizado`, y `finalizado` hace de despacho. Decisión explícita del usuario. Así el endpoint no depende del módulo fiscal (SPEC 25), y anular un documento no mueve cajas hacia atrás en el tablero.
- **No:** una casilla `despacho` derivada del documento fiscal vigente. Se descarta: mezcla facturación con flujo físico de planta, y el lote saltaría de casilla por algo que pasa en otra oficina.
- **Sí:** ventanas por tiempo para sacar lotes del tablero: 7 días para finalizado, 5 min para rechazado. Decisión explícita del usuario.
- **Sí:** polling cada 1 a 2 minutos, no cada 10 s. Decisión explícita del usuario: el front reparte la animación a lo largo del intervalo, y la carga queda por debajo de una petición por segundo. El costo es que el tablero va hasta 2 minutos atrasado respecto de la báscula.
- **No:** polling cada 10 a 15 minutos. Se descarta: los 10 `ultimos_pesajes` no alcanzarían para los pesajes de ese lapso, y el rechazado tendría que verse 30 minutos o más.
- **No:** sólo lo de hoy (`CURDATE()`) para finalizados. Se descarta: a medianoche el tablero se vaciaría de golpe y el front lo animaría como diez camiones saliendo a la vez.
- **No:** una columna `lotes.despachado_en` con su `PATCH`. Se descarta para este spec: agrega un paso al flujo de planta que hoy nadie hace. Queda en Out of scope.
- **Sí:** planta entera, sin filtro de cartera. Decisión explícita del usuario. Aprobadores y ADMIN no tienen filas en `cliente_operador`, y es una vista de planta, como el chat de SPEC 28.
- **No:** sembrar un permiso `MODULO-MIRADOR`. Decisión explícita del usuario: cualquier usuario autenticado ve el Mirador. Como no hay guard de permisos, el permiso sólo habría servido para esconder el menú en el front.
- **Sí:** `etapa` como vocabulario del tablero (`en-pesaje`, `por-aprobar`, `finalizado`, `rechazado`), no los códigos de `etapas`. El front no tiene por qué conocer los códigos de la base.
- **Sí:** la casilla sale de `etapas.codigo` (por `lotes.etapa_id`, en un `LEFT JOIN`), no de la tabla de discriminadores de `CLAUDE.md` (`motivo_rechazo`, `finalizado_por`, `aprobado_por`, `estado`). Decisión del usuario. Para lotes movidos por la API las dos lecturas coinciden, y con la etapa el `CASE` no depende del orden de las reglas. El costo es depender del `etapa_id: 1` que `createLote` escribe a mano (ver la nota bajo la tabla de casillas).
- **Sí:** `fuera_de_rango` boolean y los códigos reales de `estados_calidad`, igual que `GET /pesajes/byLote/:loteId`. El front usa esa misma lectura para el detalle del lote, y el pesaje tiene que tener la misma forma en los dos lados.
- **Sí:** `ultimos_pesajes` ordenado por `id`, no por `created_at`. El diff del front depende de que los ids crezcan; dos pesajes en el mismo segundo empatarían por `created_at`.
- **Sí:** KPIs sobre todos los pesajes de hoy, no sólo los de los lotes de la foto. Un lote que se rechazó a la mañana igual pesó.
- **Sí:** cuatro consultas fijas y el árbol armado en Node. Una consulta por lote sería un N+1 repetido en cada llamada de cada pantalla abierta.
- **No:** cache en el servidor. Con cuatro consultas indexadas por `lote_id` y por `created_at`, no hace falta todavía; ver Risks.
- **Sí:** módulo propio `plantas`, no una ruta dentro de `lotes`. La foto lee cinco recursos y no es "un lote".

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Muchas pantallas abiertas a la vez (un televisor por galera) multiplican las lecturas. | Con 1 a 2 minutos de intervalo, 50 pantallas son menos de una petición por segundo. El front sólo pide con la pestaña visible y con desfase aleatorio. Si la carga se nota, un cache en memoria de 5 s es un cambio local al service. Sin mitigar en este spec. |
| `pesajes` sin índice por `created_at` hace lenta la consulta de KPIs. | Verificar con `EXPLAIN` en el paso 5; si falta, el índice va en este spec. |
| MySQL 5.7 no tiene `ROW_NUMBER()`. | El paso 1 lo verifica y deja escrito el plan alternativo (cortar en Node). |
| Un cliente con mucho movimiento acumula finalizados durante 7 días y su fila se llena. | El front ya maneja el desborde: muestra los que caben y un "+N" por casilla. Aceptado. |
| La ventana de 7 días no refleja la salida real del camión: un lote puede salir antes y seguir en el tablero como `finalizado`. | Aceptado por decisión. La casilla de despacho y la columna de salida quedan en Out of scope. |
| Un lote que recibe más de 10 pesajes dentro de un intervalo: el front no tiene el detalle de todos para animarlos. | El front anima los que faltan a partir del delta de `bultos`, sin detalle de peso. Con una báscula a un bulto cada 20–30 s, 2 minutos son unos 4–6 pesajes, así que es raro. |
| El mock del front (`plantSnapshotMock.ts`) devuelve la casilla `despacho` y el campo `documento_fiscal`. | Confirmado: el front pasa a tres casillas ("En pesaje", "Por aprobar", "Finalizado") y quita `despacho` del mock. |
| `NOW()`/`CURDATE()` dependen de la zona del servidor MySQL, que nadie fija. | Es la misma regla que SPEC 28 y la misma zona que escribió los `created_at`. Aceptado. |
| Un OPERADOR ve lotes y pesos de clientes que no son de su cartera. | Aceptado por decisión del usuario. Ya pasa con el chat. |

---

## What is **not** in this spec

- Casilla de despacho, lectura de documentos fiscales, columna de salida de planta (`despachado_en`) ni endpoint para marcarla.
- Filtro por cartera.
- Permiso `MODULO-MIRADOR` y su siembra.
- SSE, WebSocket o cualquier push.
- Varias plantas, paginación o filtros de la foto.
- Cambios en `GET /pesajes/byLote/:loteId` o en cualquier otro endpoint existente.
- Cache del lado del servidor.

Cada uno de estos, si se necesita, va en su propio spec.
