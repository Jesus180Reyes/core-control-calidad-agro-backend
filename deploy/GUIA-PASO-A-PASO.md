# Guía paso a paso: la VPS multi-tenant

Lo que hicimos el 2026-10-27 para armar la VPS de dev, explicado comando por
comando. El runbook completo, con todos los casos, es `deploy/README.md`.

- **IP del servidor:** `62.84.184.57`
- **Usuario:** `deploy`
- 💻 = se corre en **tu PC**, desde la raíz del repo
- 🖥️ = se corre **en el servidor** (después de `ssh deploy@62.84.184.57`)

---

## La idea en un dibujo

```
internet ──> Caddy ──> api-demo ──────┐
               │                      ├──> MySQL (una base por empresa)
               ├────> api-otraempresa ┘
               └────> Dozzle (logs)
```

- **Plataforma** (`/opt/plataforma`): lo que existe una sola vez. Caddy pone
  el HTTPS y reparte cada dominio a su API, MySQL guarda las bases y Dozzle
  muestra los logs.
- **Tenant** (`/opt/<nombre>`): una empresa. Tiene solo su API y su `.env`
  propio: su base, su usuario de MySQL, su `JWT_SECRET` y su key de Gemini.
- Todos los tenants usan la misma imagen del API. Lo único que cambia entre
  ellos es el `.env`.

---

## Paso 1. Borrar el despliegue viejo 🖥️

```bash
cd /opt/agro && docker compose -f docker-compose.prod.yml down -v
sudo rm -rf /opt/agro
crontab -l
```

- `down -v` apaga los contenedores viejos y borra su base. Esto solo se hizo
  porque no tenía datos reales.
- `rm -rf /opt/agro` borra la carpeta vieja.
- `crontab -l` muestra las tareas programadas. Si aparece una línea con
  `/opt/agro/backup.sh`, se quita con `crontab -e`.

---

## Paso 2. Subir los archivos de la plataforma 💻

### 2.1 Crear la carpeta

```bash
ssh -t deploy@62.84.184.57 "sudo mkdir -p /opt/plataforma && sudo chown deploy:deploy /opt/plataforma"
```

- Crea `/opt/plataforma` y hace a `deploy` su dueño, para no necesitar `sudo`
  después.
- `-t` es necesario: sin él, `sudo` no puede pedirte la contraseña y falla con
  `a terminal is required`.
- Al final sale `Connection to ... closed.`: es normal, no es un error.

### 2.2 Copiar los archivos

```bash
scp deploy/plataforma/docker-compose.yml deploy/plataforma/Caddyfile deploy/plataforma/backup.sh deploy/plataforma/nuevo-tenant.sh deploy@62.84.184.57:/opt/plataforma/
scp -r db deploy/tenant deploy@62.84.184.57:/opt/plataforma/
scp deploy/plataforma/.env.example deploy@62.84.184.57:/opt/plataforma/.env
```

`scp` copia archivos de tu PC al servidor por SSH.

| Lo que se sube | Para qué sirve |
| --- | --- |
| `docker-compose.yml` | Define Caddy, MySQL y Dozzle |
| `Caddyfile` | Qué dominio va a qué API |
| `backup.sh` | Respalda todas las bases |
| `nuevo-tenant.sh` | Da de alta una empresa |
| `db/` | Las tablas (`schema.sql`) y los catálogos (`seed.sql`) de cada base nueva |
| `tenant/` | El molde que se copia para cada empresa |
| `.env` | La configuración de la plataforma (se llena en el paso 3) |

> Si después cambias `nuevo-tenant.sh`, `backup.sh`, `db/` o `tenant/` en el
> repo, vuelve a subir solo eso con el mismo `scp`.

---

## Paso 3. Configurar y levantar la plataforma 🖥️

### 3.1 Entrar al servidor

```bash
ssh deploy@62.84.184.57
cd /opt/plataforma
```

### 3.2 Generar la contraseña de root de MySQL

```bash
openssl rand -hex 32
```

- Imprime una contraseña aleatoria de 64 caracteres. Cópiala.
- Solo la usan los scripts. Los APIs nunca la ven, porque cada uno tiene su
  propio usuario.

### 3.3 Generar la contraseña de Dozzle

```bash
docker run --rm caddy:2 caddy hash-password --plaintext 'TuContraseña'
```

- Convierte tu contraseña en un hash (algo como `$2a$14$...`). Caddy guarda el
  hash, nunca la contraseña.
- La contraseña en texto plano es la que escribes en el navegador. Guárdala.

### 3.4 Llenar el `.env`

```bash
nano .env
```

```
DOZZLE_DOMAIN=logs.62-84-184-57.sslip.io
DOZZLE_USER=admin
DOZZLE_PASSWORD_HASH='$2a$14$...el hash...'
DB_ROOT_PASSWORD=...la del paso 3.2...
DB_BIND=0.0.0.0
```

- **El hash va entre comillas simples.** Si no, Docker interpreta los `$` y el
  login nunca funciona.
- `DB_BIND=0.0.0.0` deja entrar con Workbench desde internet. **Solo en dev.**
- Para guardar en `nano`: `Ctrl+O` y `Enter`. Para salir: `Ctrl+X`.

### 3.5 Permisos

```bash
chmod 600 .env && chmod +x backup.sh nuevo-tenant.sh && mkdir -p tenants
```

- `chmod 600 .env`: solo `deploy` puede leerlo, porque tiene la contraseña de
  root.
- `chmod +x`: deja ejecutar los scripts.
- `tenants/`: aquí va un archivo por empresa para Caddy.

### 3.6 Levantar

```bash
docker compose up -d
docker compose ps
```

- `up -d` crea los contenedores y los deja corriendo en segundo plano.
- `ps` muestra su estado. Espera a que `mysql` diga `healthy`.

### 3.7 Comprobar

Abre `https://logs.62-84-184-57.sslip.io`: pide usuario (`admin`) y
contraseña, y muestra los logs.

Si algo falla: `docker compose logs caddy` o `docker compose logs mysql`.

---

## Paso 4. Dar de alta una empresa (tenant) 🖥️

### 4.1 Comprobar el acceso a la imagen

```bash
docker pull ghcr.io/jesus180reyes/core-control-calidad-agro-backend:latest
```

- Descarga la imagen del API.
- Si sale `denied`, repite el login:
  `echo TU_TOKEN | docker login ghcr.io -u Jesus180Reyes --password-stdin`

### 4.2 Correr el script

```bash
cd /opt/plataforma
./nuevo-tenant.sh demo dev-api.62-84-184-57.sslip.io
```

O con un nombre de base elegido por ti (tercer argumento):

```bash
./nuevo-tenant.sh demo dev-api.62-84-184-57.sslip.io control_libano
```

- `demo` es el **slug**: da el nombre del contenedor (`api-demo`) y de la
  carpeta (`/opt/demo`).
- El segundo argumento es el **dominio** por el que el front llama al API.
- El tercero es opcional: el **nombre de la base** (y de su usuario MySQL). Si
  no lo pones, se llama `agro_<slug>`.

El script te pide:

1. Los datos del primer ADMIN: username, nombre, cédula y una contraseña
   temporal.
2. La contraseña de `sudo`.

Y luego hace solo esto:

| Paso | Qué hace |
| --- | --- |
| 1/5 | Crea la base y un usuario MySQL que **solo** puede tocar esa base |
| 2/5 | Carga las tablas y los catálogos |
| 3/5 | Crea el ADMIN, con la contraseña vencida para que la cambie al entrar |
| 4/5 | Crea `/opt/demo` con su `.env` y contraseñas generadas |
| 5/5 | Levanta `api-demo` y avisa a Caddy del dominio nuevo |

Si falla a la mitad, te dice exactamente qué borrar para reintentar.

### 4.3 Comprobar

```bash
curl -i https://dev-api.62-84-184-57.sslip.io/
```

- Debe responder **401**: el API está vivo y pide token. Eso es lo correcto.
- En Dozzle aparece `api-demo`.
- Entra desde el front con el ADMIN: te pide cambiar la contraseña.

### 4.4 Ajustes opcionales del tenant

```bash
nano /opt/demo/.env
```

- `API_NODE_ENV=development` activa Swagger en `/docs` (solo en dev).
- `GEMINI_API_KEY=...` activa el resumen IA y el chat.

Para que tome los cambios:

```bash
cd /opt/demo && docker compose up -d
```

Solo se reinicia `api-demo`; lo demás no se toca.

### 4.5 Entrar con Workbench

- **Host:** `62.84.184.57` · **Puerto:** `3306`
- **Usuario y contraseña del tenant:** `grep DB_ /opt/demo/.env`
- O `root` con la contraseña del paso 3.2, para ver todas las bases.

> La base nace **sin productos**: hay que insertarlos a mano antes de crear
> clientes.

---

## Paso 5. Backup manual 🖥️

```bash
/opt/plataforma/backup.sh
ls -lh /opt/plataforma/backups
```

- Hace un respaldo comprimido de **cada base** (menos las internas de MySQL).
- Los archivos quedan como `agro_demo-20261027-101500.sql.gz`.
- Borra solos los de más de 14 días.

---

## Paso 6. Backup automático todas las noches 🖥️

```bash
crontab -e
```

Agrega al final:

```
0 3 * * * /opt/plataforma/backup.sh >> /opt/plataforma/backups/backup.log 2>&1
```

| Parte | Significado |
| --- | --- |
| `0 3 * * *` | Todos los días a las 3:00 a. m. (hora de Honduras) |
| `>> backup.log` | Guarda lo que pasó en un log |
| `2>&1` | Guarda también los errores en ese log |

Comprobar:

```bash
crontab -l
tail /opt/plataforma/backups/backup.log
```

---

## Paso 7. Prueba de restauración 🖥️

Se restaura en una **base aparte** para no tocar la de verdad.

```bash
cd /opt/plataforma
```

**1. Crear la base de prueba**

```bash
docker compose exec mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "CREATE DATABASE prueba_restauracion"'
```

**2. Cargar el backup en ella**

```bash
gunzip -c backups/agro_demo-AAAAMMDD-HHMMSS.sql.gz | \
  docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot prueba_restauracion'
```

- `gunzip -c` descomprime y `|` se lo pasa a MySQL.
- Si no imprime nada, salió bien.

**3. Comparar** (dentro de MySQL)

```bash
docker compose exec mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot'
```

```sql
SELECT TABLE_SCHEMA, COUNT(*) AS tablas
FROM information_schema.TABLES
WHERE TABLE_SCHEMA IN ('agro_demo', 'prueba_restauracion')
GROUP BY TABLE_SCHEMA;

SELECT COUNT(*) FROM agro_demo.usuarios;
SELECT COUNT(*) FROM prueba_restauracion.usuarios;
```

Los números deben ser iguales. Para salir: `exit`.

**4. Borrar la base de prueba (no te lo saltes)**

```bash
docker compose exec mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "DROP DATABASE prueba_restauracion"'
```

Si se queda, el backup nocturno la respalda cada noche como si fuera una
empresa.

---

## Comandos del día a día 🖥️

| Quiero… | Comando |
| --- | --- |
| Ver qué está corriendo | `docker ps` |
| Ver los logs de un tenant | Dozzle, o `docker logs -f api-demo` |
| Reiniciar un tenant | `cd /opt/demo && docker compose restart` |
| Actualizar un tenant a la última versión | `cd /opt/demo && docker compose pull && docker compose up -d` |
| Volver a una versión anterior | En `/opt/demo/.env`: `API_IMAGE=ghcr.io/jesus180reyes/core-control-calidad-agro-backend:sha-XXXXXXX`, y luego `pull` + `up -d` |
| Dar de alta otra empresa | `cd /opt/plataforma && ./nuevo-tenant.sh <slug> <dominio> [base]` |
| Hacer un backup ya | `/opt/plataforma/backup.sh` |

Actualizar **todos** los tenants de una vez:

```bash
for t in /opt/*/; do
  grep -qs '^TENANT=.' "${t}.env" && (cd "$t" && docker compose pull && docker compose up -d)
done
```

Este bucle entra a cada carpeta de `/opt` que tenga un `.env` de tenant (es
decir, con `TENANT=`), baja la imagen nueva y reinicia ese API.

---

## Lo que falta

- [ ] **Copia de los backups fuera del servidor** (`rclone`). Si se pierde la
      VPS, hoy se pierden también los backups.
- [ ] **Workflow de deploy**: que cada merge a `main` actualice los tenants
      solo.
- [ ] **Runner de migraciones**: hoy un cambio de tablas hay que aplicarlo a
      mano en cada base.
