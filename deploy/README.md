# Despliegue multi-tenant en una VPS (Contabo u otra)

Un **API por tenant** (empresa), cada uno con **su propia base** en un MySQL
compartido, todo en el mismo servidor con Docker Compose:

```
internet ──443──> Caddy ──> api-agrolibano ──┐
                     │                       ├──> MySQL (agro_agrolibano, agro_suragro, ...)
                     ├────> api-suragro ─────┘
                     └────> Dozzle (logs)
```

En el servidor:

| Carpeta | Que hay | Viene de |
| --- | --- | --- |
| `/opt/plataforma/` | Caddy, MySQL, Dozzle, `backup.sh`, `nuevo-tenant.sh`, `backups/`, `tenants/<slug>.caddy`, `db/`, `tenant/` (plantilla) | `deploy/plataforma/`, `deploy/tenant/`, `db/` |
| `/opt/<slug>/` | Solo el API del tenant: `docker-compose.yml` + `.env` | lo crea `nuevo-tenant.sh` |

- Todos los tenants corren **la misma imagen** de GHCR; lo que los distingue es
  su `.env`: `TENANT`, su base y un usuario MySQL del mismo nombre
  (`agro_<slug>` salvo que se elija otro),
  `JWT_SECRET` y `GEMINI_API_KEY` propios.
- El usuario MySQL de cada tenant solo tiene `SELECT/INSERT/UPDATE/DELETE`
  sobre **su** base: si un `.env` se filtra, no abre las demas. Root solo vive
  en `/opt/plataforma/.env`.
- Cada tenant se levanta, actualiza, fija a una version o da de baja por su
  lado. La plataforma crea la red docker `agro`; los tenants se unen a ella.
- Solo los puertos 80 y 443 quedan abiertos a internet; MySQL y los APIs no.

Cada push a `main` corre el CI (`.github/workflows/ci.yml`): lint, tests,
build y, si todo pasa, publica la imagen en
`ghcr.io/jesus180reyes/core-control-calidad-agro-backend` con los tags
`latest` y `sha-<commit>`.

---

## 1. Antes de contratar

- [ ] Un dominio, y decidir el subdominio de cada tenant
      (`agrolibano.tudominio.com`) y el de los logs (`logs.tudominio.com`).
      Mientras no haya dominio: `<slug>.IP-CON-GUIONES.sslip.io`, sin DNS.
- [ ] Una VPS con **Ubuntu 24.04**, 2 vCPU / 4 GB RAM como minimo. Cada API
      suma ~150 MB de RAM; MySQL es lo que mas pesa.

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

# Docker oficial (no la imagen "Docker" de Contabo: trae snap y rompe docker login)
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# Zona horaria del sistema (logs y cron). MySQL y la API ya fijan la suya
# (-06:00) en el compose y el Dockerfile.
timedatectl set-timezone America/Tegucigalpa
```

> Ojo: Docker publica puertos **saltandose ufw**. Por eso ningun compose
> publica los APIs y MySQL se publica solo en `127.0.0.1` (salvo `DB_BIND`,
> ver seccion 10); no agregues otros `ports:`.

### Si la VPS ya tenia el despliegue de un solo tenant (`/opt/agro`)

Sin datos reales que conservar, se baja y se borra entero (`-v` borra la
base):

```bash
cd /opt/agro && docker compose -f docker-compose.prod.yml down -v
sudo rm -rf /opt/agro
crontab -l   # quitar la linea de /opt/agro/backup.sh si estaba
```

## 3. DNS

Un registro **A** por dominio → IP del servidor: el de logs y uno por tenant.
Esperar a que resuelva (`nslookup agrolibano.tudominio.com`) **antes** de dar
de alta el tenant, o Caddy no podra sacar el certificado. Con Cloudflare y
proxy (nube naranja), SSL/TLS en **Full (strict)**.

## 4. Subir la plataforma

Desde tu PC, en la raiz del repo:

```bash
# -t: sudo pide la contrasena y sin terminal no puede leerla
ssh -t deploy@IP "sudo mkdir -p /opt/plataforma && sudo chown deploy:deploy /opt/plataforma"
scp deploy/plataforma/docker-compose.yml deploy/plataforma/Caddyfile \
    deploy/plataforma/backup.sh deploy/plataforma/nuevo-tenant.sh deploy@IP:/opt/plataforma/
scp -r db deploy/tenant deploy@IP:/opt/plataforma/
scp deploy/plataforma/.env.example deploy@IP:/opt/plataforma/.env
```

En el servidor, rellenar `/opt/plataforma/.env` (`DB_ROOT_PASSWORD` con
`openssl rand -base64 48`, Dozzle segun la seccion 11) y:

```bash
cd /opt/plataforma
chmod 600 .env && chmod +x backup.sh nuevo-tenant.sh && mkdir -p tenants
```

`db/` y `tenant/` hay que volver a subirlos cuando cambien en el repo: son lo
que `nuevo-tenant.sh` usa para cada alta.

## 5. Acceso a la imagen

El paquete de GHCR es **privado** por defecto. En GitHub: *Settings →
Developer settings → Personal access tokens (classic)* con solo
`read:packages`. En el servidor:

```bash
echo TU_TOKEN | docker login ghcr.io -u Jesus180Reyes --password-stdin
```

(Alternativa: hacer publico el paquete en GitHub → *Packages*; la imagen no
lleva secretos.)

## 6. Arrancar la plataforma

```bash
cd /opt/plataforma
docker compose up -d
docker compose ps        # mysql "healthy", caddy y dozzle "running"
```

MySQL arranca vacio, solo con root: las bases las crea cada alta de tenant.

## 7. Dar de alta un tenant

Con el DNS del dominio ya resolviendo:

```bash
/opt/plataforma/nuevo-tenant.sh agrolibano agrolibano.tudominio.com
```

La base y su usuario MySQL se llaman `agro_<slug>`. Para otro nombre, un
tercer argumento (minusculas, numeros o `_`, empieza con letra, 3 a 32
caracteres):

```bash
/opt/plataforma/nuevo-tenant.sh agrolibano agrolibano.tudominio.com control_libano
```

El script pide los datos del primer **ADMIN** (username, nombre, cedula y una
contrasena temporal) y la contrasena de `sudo`, y luego:

1. Crea la base `agro_agrolibano` y el usuario MySQL `agro_agrolibano`, con
   permisos solo sobre ella y una contrasena aleatoria.
2. Carga `db/schema.sql` y `db/seed.sql` (catalogos, roles, permisos).
3. Inserta el ADMIN con `password_vence_en = NOW()`: en su primer login la API
   le pide cambiarla. Los demas usuarios los crea el con `POST /auth/register`.
4. Crea `/opt/agrolibano/` con el compose y un `.env` (`chmod 600`) con
   `JWT_SECRET` y la contrasena de MySQL generados.
5. Levanta `api-agrolibano`, escribe `tenants/agrolibano.caddy` y recarga
   Caddy sin cortar a los demas tenants.

Si falla a medias, imprime lo que hay que borrar para reintentar.

Despues, a mano:

- [ ] `curl -i https://agrolibano.tudominio.com/` responde **401** (API viva,
      pidiendo token) con certificado valido.
- [ ] `GEMINI_API_KEY` en `/opt/agrolibano/.env` (sin ella el resumen y el
      chat responden 503) y `cd /opt/agrolibano && docker compose up -d`.
      `API_NODE_ENV=development` ahi si es el entorno de dev (Swagger).
- [ ] **Productos**: `INSERT INTO productos ...` en `agro_agrolibano`.
      `POST /clientes` los necesita y no hay endpoint para crearlos.
- [ ] Revisar que `paises_config` tenga solo los paises que van a operar.

Entrar a la base de un tenant como root:

```bash
cd /opt/plataforma
docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" agro_agrolibano'
```

### Dar de baja un tenant

```bash
(cd /opt/agrolibano && docker compose down)
rm /opt/plataforma/tenants/agrolibano.caddy
cd /opt/plataforma && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

La base y el usuario MySQL quedan: hacer un backup final (`./backup.sh`) y
solo entonces, si se quiere, `DROP DATABASE agro_agrolibano; DROP USER
'agro_agrolibano'@'%';` y `sudo rm -rf /opt/agrolibano`.

## 8. Backups

```bash
crontab -e
# agregar:
0 3 * * * /opt/plataforma/backup.sh >> /opt/plataforma/backups/backup.log 2>&1
```

Un `mysqldump` por cada base que no sea del sistema de MySQL, se llame como se
llame (un tenant nuevo entra solo, sin tocar el cron), en
`/opt/plataforma/backups/<base>-AAAAMMDD-HHMMSS.sql.gz`,
14 dias. Si falla una base sigue con las demas y sale con error. **Eso no
basta**: si se pierde el servidor se pierden los backups. Copiarlos fuera
(Contabo Object Storage, S3, Backblaze) con `rclone` es el siguiente paso.

Restaurar un tenant (su API parado mientras tanto):

```bash
cd /opt/plataforma
gunzip -c backups/agro_agrolibano-AAAAMMDD-HHMMSS.sql.gz | \
  docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" agro_agrolibano'
```

Probar una restauracion al menos una vez, en otra base, antes de confiar en
ellos.

## 9. Desplegar una version nueva

Merge a `main` → esperar el CI en verde → en el servidor, por cada tenant:

```bash
for t in /opt/*/; do
  grep -qs '^TENANT=.' "${t}.env" && (cd "$t" && docker compose pull && docker compose up -d)
done
```

O uno solo: `cd /opt/agrolibano && docker compose pull && docker compose up -d`.

**Rollback** de un tenant: en su `.env`,
`API_IMAGE=ghcr.io/jesus180reyes/core-control-calidad-agro-backend:sha-XXXXXXX`
(el tag del commit bueno, visible en GitHub → *Packages*) y repetir `pull` +
`up -d`. Un tenant con `sha-...` fijo no se mueve con el bucle de arriba hasta
que se le vuelva a poner `latest`.

**Cambios de esquema**: no hay migraciones. Una DDL nueva de un spec se aplica
a mano **en cada base de tenant** (`DB_NAME` de cada `/opt/<slug>/.env`), con backup previo, **antes** de desplegar
la imagen que la usa (como root: el usuario de cada tenant no tiene permisos
de DDL). `db/schema.sql` solo sirve para tenants nuevos, asi que hay que
transcribir la DDL ahi y volver a subir `db/`.

## 10. Entrar a MySQL desde tu PC

Por defecto MySQL solo escucha en el localhost del servidor
(`127.0.0.1:3306`), invisible desde internet. Con un tunel SSH,
DBeaver/Workbench se conectan a `127.0.0.1:3308` en tu PC:

```bash
ssh -N -L 3308:127.0.0.1:3306 deploy@IP
```

O, en el cliente, "TCP/IP over SSH" con `deploy` + tu llave y MySQL en
`127.0.0.1:3306`. Con el usuario del tenant (`DB_USER` y
`DB_PASSWORD` en `/opt/<slug>/.env`) se ve solo esa base; con root, todas.

**Solo en dev**: `DB_BIND=0.0.0.0` en `/opt/plataforma/.env` publica el 3306 a
internet y cualquier cliente conecta directo a `IP:3306`. Es aceptable solo
con datos de prueba y contrasenas de `openssl rand`; Docker se salta ufw, asi
que no hay firewall delante. **Nunca en produccion.** Despues de cambiarlo:
`cd /opt/plataforma && docker compose up -d mysql` (los APIs se reconectan
solos: abren su conexion por request).

## 11. Ver los logs (Dozzle)

Dozzle muestra en vivo los logs de todos los contenedores: `api-<slug>` de
cada tenant, `caddy` y `mysql`. No tiene login propio, monta el socket de
Docker y los logs llevan datos de clientes, asi que lo unico que lo protege en
internet es el `basic_auth` de Caddy.

**Desde el navegador**: `https://DOZZLE_DOMAIN`, con `DOZZLE_USER` y la
contrasena. Para configurarlo, en el servidor:

```bash
docker run --rm caddy:2 caddy hash-password --plaintext 'CONTRASENA'
```

Copiar el hash a `DOZZLE_PASSWORD_HASH` en `/opt/plataforma/.env`, **entre
comillas simples** (lleva `$`), poner `DOZZLE_DOMAIN` (registro A propio, o
`logs.IP-CON-GUIONES.sslip.io`) y recrear Caddy:
`cd /opt/plataforma && docker compose up -d caddy`.

**Por tunel SSH**, sin pasar por internet: Dozzle tambien escucha en
`127.0.0.1:8080` del servidor.

```bash
ssh -N -L 8080:127.0.0.1:8080 deploy@IP
```

Y abrir `http://localhost:8080` en tu PC. Los dos tuneles caben en una sola
conexion: `ssh -N -L 3308:127.0.0.1:3306 -L 8080:127.0.0.1:8080 deploy@IP`.
Lo que Dozzle muestra es lo que retiene `json-file` (`max-size`/`max-file` de
cada servicio), no un historico: los 5xx persistentes estan en `log_errores`
de cada base.

## Pendientes conocidos antes de produccion

- **Runner de migraciones**: con N tenants, aplicar la DDL a mano en N bases
  no escala ni es seguro. Lo ideal es que cada API migre su base al arrancar.
- **`GET /health`**: el healthcheck actual acepta cualquier respuesta HTTP.
- **CORS** abierto a cualquier origen.
- **Rate limiting** (spec 23): `/auth/login` y `/pesajes/validar-pin` sin
  limite de intentos. Caddy no lo trae de serie.
- **Monitoreo**: un chequeo externo (UptimeRobot, BetterStack) por cada
  dominio de tenant.
- **Limite de gasto** de cada API key de Gemini en Google AI Studio.
- **Zona horaria**: `-06:00` esta fijo en MySQL, en cada conexion del API y en
  la imagen; un tenant de otra zona necesita cambios en el codigo.
