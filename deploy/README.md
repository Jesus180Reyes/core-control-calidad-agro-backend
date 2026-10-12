# Despliegue en una VPS (Contabo u otra)

Arquitectura: **Caddy** (HTTPS automatico) → **API** (imagen de GHCR) →
**MySQL 8.0**, los tres con Docker Compose en un solo servidor. Solo los
puertos 80 y 443 quedan abiertos a internet; MySQL y la API no.

Cada push a `main` corre el CI (`.github/workflows/ci.yml`): lint, tests,
build y, si todo pasa, publica la imagen en
`ghcr.io/jesus180reyes/core-control-calidad-agro-backend` con los tags
`latest` y `sha-<commit>`.

---

## 1. Antes de contratar

- [ ] Un dominio, y decidir el subdominio de la API (`api.tudominio.com`).
- [ ] Una VPS con **Ubuntu 24.04**, 2 vCPU / 4 GB RAM como minimo (MySQL y
      Node juntos).

## 2. Preparar el servidor (una sola vez)

```bash
ssh root@IP_DEL_SERVIDOR

# Usuario sin root para operar
adduser deploy && usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh

# Entrar solo con llave SSH, nunca con contrasena ni como root
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh

# Firewall: solo SSH, HTTP y HTTPS
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable

# Actualizaciones de seguridad automaticas
apt update && apt -y upgrade && apt -y install unattended-upgrades fail2ban

# Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# Zona horaria del sistema (logs y cron); la de MySQL es otro tema, ver abajo
timedatectl set-timezone America/Tegucigalpa
```

> Ojo: Docker publica puertos **saltandose ufw**. Por eso
> `docker-compose.prod.yml` no publica ni MySQL ni la API; no agregues
> `ports:` a esos servicios.

## 3. DNS

Crear un registro **A**: `api.tudominio.com` → IP del servidor. Esperar a que
resuelva (`nslookup api.tudominio.com`) **antes** del primer arranque, o Caddy
no podra sacar el certificado.

## 4. Subir los archivos

Desde tu PC, en la raiz del repo:

```bash
ssh deploy@IP "sudo mkdir -p /opt/agro && sudo chown deploy:deploy /opt/agro"
scp deploy/docker-compose.prod.yml deploy/Caddyfile deploy/backup.sh deploy@IP:/opt/agro/
scp -r db deploy@IP:/opt/agro/
scp deploy/.env.prod.example deploy@IP:/opt/agro/.env
```

En el servidor, rellenar `/opt/agro/.env` (`nano /opt/agro/.env`). Secretos con
`openssl rand -base64 48`. Luego `chmod 600 /opt/agro/.env && chmod +x /opt/agro/backup.sh`.

## 5. Acceso a la imagen

El paquete de GHCR es **privado** por defecto. En GitHub: *Settings →
Developer settings → Personal access tokens (classic)* con solo
`read:packages`. En el servidor:

```bash
echo TU_TOKEN | docker login ghcr.io -u Jesus180Reyes --password-stdin
```

(Alternativa: hacer publico el paquete en GitHub → *Packages*; la imagen no
lleva secretos.)

## 6. Primer arranque

```bash
cd /opt/agro
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f
```

MySQL carga `db/schema.sql` y `db/seed.sql` solo en este primer arranque.
Comprobar: `curl -i https://api.tudominio.com/` debe responder **401** (la API
viva, pidiendo token) con un certificado valido.

## 7. Datos iniciales (a mano)

La BD nace sin usuarios ni productos. Entrar a MySQL:

```bash
docker compose -f docker-compose.prod.yml exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
```

- [ ] **Primer ADMIN**: generar el hash con bcrypt (en tu PC, dentro del repo:
      `node -e "console.log(require('bcrypt').hashSync('UnaClave123', 10))"`) e
      insertarlo en `usuarios` con el `rol_id` de `ADMIN` y
      `password_vence_en = NOW()`, para que la cambie en el primer login. Los
      demas usuarios se crean con `POST /auth/register`.
- [ ] **Productos**: `INSERT INTO productos ...`. `POST /clientes` los necesita
      y no hay endpoint para crearlos.
- [ ] Revisar que `paises_config` tenga solo los paises que van a operar.

## 8. Backups

```bash
crontab -e
# agregar:
0 3 * * * /opt/agro/backup.sh >> /opt/agro/backups/backup.log 2>&1
```

Guarda 14 dias en `/opt/agro/backups`. **Eso no basta**: si se pierde el
servidor se pierden los backups. Copiarlos fuera (Contabo Object Storage, S3,
Backblaze) con `rclone` es el siguiente paso.

Restaurar:

```bash
gunzip -c backups/agro-AAAAMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
```

Probar una restauracion al menos una vez, en otra BD, antes de confiar en
ellos.

## 9. Desplegar una version nueva

Merge a `main` → esperar el CI en verde → en el servidor:

```bash
cd /opt/agro
docker compose -f docker-compose.prod.yml pull api
docker compose -f docker-compose.prod.yml up -d api
```

**Rollback**: poner en `.env` `API_IMAGE=ghcr.io/jesus180reyes/core-control-calidad-agro-backend:sha-XXXXXXX`
(el tag del commit bueno, visible en GitHub → *Packages*) y repetir `pull` + `up -d`.

**Cambios de esquema**: no hay migraciones. Una DDL nueva de un spec se aplica
a mano en MySQL **antes** de desplegar la imagen que la usa, con backup
previo. `db/schema.sql` solo sirve para BDs nuevas.

## 10. Entrar a MySQL desde tu PC

MySQL no esta expuesto. Con un tunel SSH, phpMyAdmin/DBeaver/Workbench se
conectan a `127.0.0.1:3308`:

```bash
ssh -L 3308:IP_INTERNA_MYSQL:3306 deploy@IP
# IP_INTERNA_MYSQL: docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' agro-mysql-1
```

## Pendientes conocidos antes de produccion

- **Zona horaria de MySQL**: el contenedor corre en UTC, asi que `NOW()` y
  `CURDATE()` van 6 horas adelantados respecto a Honduras. Corregirlo cambia
  lo que devuelve la API y obliga a migrar las columnas `DATETIME`
  existentes: necesita su propio spec, idealmente **antes** de cargar datos
  reales en produccion.
- **`GET /health`**: el healthcheck actual acepta cualquier respuesta HTTP.
- **CORS** abierto a cualquier origen.
- **Rate limiting** (spec 23): `/auth/login` y `/pesajes/validar-pin` sin
  limite de intentos. Caddy no lo trae de serie.
- **Monitoreo**: un chequeo externo (UptimeRobot, BetterStack) contra la URL.
- **Limite de gasto** de la API key de Gemini en Google AI Studio.
