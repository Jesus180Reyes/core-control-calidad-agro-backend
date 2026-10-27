# Despliegue multi-tenant en una VPS

El manual completo: cómo montar un servidor desde cero, dar de alta empresas,
actualizar y respaldar. Si quieres ver el recorrido que hicimos en la VPS de
dev, está en `deploy/GUIA-PASO-A-PASO.md`.

- 💻 = se corre en **tu PC**, desde la raíz del repo
- 🖥️ = se corre **en el servidor** (después de `ssh deploy@IP`)
- `IP` = la IP del servidor. `agrolibano` = un ejemplo de empresa (tenant).

---

## 0. Cómo funciona

```
internet ──> Caddy ──> api-agrolibano ──┐
               │                        ├──> MySQL (una base por empresa)
               ├────> api-suragro ──────┘
               └────> Dozzle (logs)
```

| Carpeta en el servidor | Qué tiene |
| --- | --- |
| `/opt/plataforma/` | Lo que existe **una sola vez**: Caddy (HTTPS), MySQL, Dozzle (logs), los scripts y los backups |
| `/opt/<empresa>/` | **Una por empresa**: solo su API y su `.env` |

- Todas las empresas usan **la misma imagen** del API. Lo que las distingue es
  su `.env`: su base, su usuario de MySQL, su `JWT_SECRET` y su key de Gemini.
- El usuario de MySQL de cada empresa **solo ve su base**. Si se filtra un
  `.env`, las demás empresas no quedan expuestas.
- Cada empresa se levanta, actualiza o da de baja **sin tocar a las demás**.
- A internet solo quedan abiertos los puertos 80 y 443. MySQL y los APIs no.
- Cada push a `main` corre el CI (lint, tests, build) y publica la imagen
  nueva en `ghcr.io/jesus180reyes/core-control-calidad-agro-backend`, con los
  tags `latest` y `sha-<commit>`.
- Cada push a `develop` corre el mismo CI, publica la imagen con los tags
  `develop` y `sha-<commit>` (nunca `latest`) y la despliega sola en la VPS
  de dev (sección 9).

---

## 1. Antes de contratar

- [ ] Un dominio, con un subdominio por empresa (`agrolibano.tudominio.com`)
      y uno para los logs (`logs.tudominio.com`).
      Sin dominio todavía: `<algo>.IP-CON-GUIONES.sslip.io` funciona sin DNS.
- [ ] Una VPS con **Ubuntu 24.04**, mínimo 2 vCPU y 4 GB de RAM. Cada empresa
      suma unos 150 MB.

---

## 2. Preparar el servidor (una sola vez) 🖥️

Entra como root: `ssh root@IP`.

**Crear el usuario `deploy`** (para no trabajar como root):

```bash
adduser deploy && usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
```

- Crea el usuario, le da permiso de usar `sudo` y le copia tu llave SSH para
  que entres con ella.

**Entrar solo con llave SSH:**

```bash
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh
```

- Prohíbe entrar con contraseña y prohíbe entrar como root.
- ⚠️ Antes de cerrar la sesión, prueba en otra terminal que `ssh deploy@IP`
  funciona. Si no, te quedas fuera.

**Comprobar que de verdad quedó apagado:**

```bash
sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin)'
```

- Debe decir `passwordauthentication no` y `permitrootlogin no`.
- Si dice `yes`, lo está pisando un archivo de `/etc/ssh/sshd_config.d/`
  (en Ubuntu suele ser `50-cloud-init.conf`), que gana sobre `sshd_config`.
  Búscalo con `grep -Ri 'passwordauthentication\|permitrootlogin' /etc/ssh/sshd_config.d/`
  y corrígelo:

```bash
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config.d/*.conf
systemctl restart ssh
```

- Repite el `sshd -T` y la prueba de `ssh deploy@IP` desde otra terminal.

**Firewall:**

```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

- Solo deja pasar SSH, HTTP y HTTPS.

**Actualizaciones automáticas y protección contra ataques de contraseña:**

```bash
apt update && apt -y upgrade && apt -y install unattended-upgrades fail2ban
```

**Docker:**

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

- Instala el Docker oficial. No uses la imagen "Docker" de Contabo: trae una
  versión por snap que rompe `docker login`.
- La segunda línea deja a `deploy` usar Docker sin `sudo`.

**Zona horaria:**

```bash
timedatectl set-timezone America/Tegucigalpa
```

- Para que los logs y el cron usen hora de Honduras.

> ⚠️ Docker abre puertos **saltándose el firewall**. Por eso los compose no
> publican los APIs y MySQL solo escucha dentro del servidor. No agregues
> otros `ports:`.

### Si el servidor tenía el despliegue viejo (`/opt/agro`) 🖥️

```bash
cd /opt/agro && docker compose -f docker-compose.prod.yml down -v
sudo rm -rf /opt/agro
crontab -l
```

- Apaga lo viejo y **borra su base** (`-v`). Solo si no tiene datos reales.
- Si `crontab -l` muestra el backup viejo, quítalo con `crontab -e`.

---

## 3. DNS

Crea un registro **A** apuntando a la IP del servidor:

- uno para los logs (`logs.tudominio.com`)
- uno por cada empresa (`agrolibano.tudominio.com`)

Comprueba que ya resuelve con `nslookup agrolibano.tudominio.com` **antes**
de dar de alta la empresa. Si no, Caddy no puede sacar el certificado HTTPS.

Con Cloudflare y la nube naranja (proxy) activada: SSL/TLS en **Full
(strict)**.

---

## 4. Subir la plataforma 💻

```bash
ssh -t deploy@IP "sudo mkdir -p /opt/plataforma && sudo chown deploy:deploy /opt/plataforma"
scp deploy/plataforma/docker-compose.yml deploy/plataforma/Caddyfile deploy/plataforma/backup.sh deploy/plataforma/nuevo-tenant.sh deploy@IP:/opt/plataforma/
scp -r db deploy/tenant deploy@IP:/opt/plataforma/
scp deploy/plataforma/.env.example deploy@IP:/opt/plataforma/.env
```

- La primera línea crea la carpeta. El `-t` es necesario para que `sudo` pueda
  pedirte la contraseña. El `Connection closed` del final es normal.
- Las otras copian los archivos al servidor.

| Archivo | Para qué sirve |
| --- | --- |
| `docker-compose.yml` | Define Caddy, MySQL y Dozzle |
| `Caddyfile` | Qué dominio va a qué API |
| `backup.sh` | Respalda todas las bases |
| `nuevo-tenant.sh` | Da de alta una empresa |
| `db/` | Tablas y catálogos de cada base nueva |
| `tenant/` | El molde que se copia para cada empresa |

> Cuando cambien `db/`, `tenant/` o los scripts en el repo, vuelve a subirlos.
> `nuevo-tenant.sh` usa lo que esté en el servidor.

Después, en el servidor 🖥️, llena el `.env` y da permisos:

```bash
cd /opt/plataforma
openssl rand -hex 32          # copia esto: es la contraseña de root de MySQL
nano .env                     # pega DB_ROOT_PASSWORD y lo de Dozzle (sección 11)
chmod 600 .env && chmod +x backup.sh nuevo-tenant.sh && mkdir -p tenants
```

- `chmod 600 .env`: solo `deploy` puede leerlo, porque tiene la contraseña de
  root.
- `tenants/`: aquí va un archivo por empresa para Caddy.

---

## 5. Acceso a la imagen 🖥️

El paquete del API en GitHub es **privado**. Saca un token en GitHub:
*Settings → Developer settings → Personal access tokens (classic)*, solo con
el permiso `read:packages`. Luego:

```bash
echo TU_TOKEN | docker login ghcr.io -u Jesus180Reyes --password-stdin
```

- Se hace una sola vez. El login queda guardado en `/home/deploy/.docker/`.
- Otra opción: hacer público el paquete en GitHub → *Packages*. La imagen no
  lleva secretos.

---

## 6. Arrancar la plataforma 🖥️

```bash
cd /opt/plataforma
docker compose up -d
docker compose ps
```

- `up -d` crea los contenedores y los deja corriendo en segundo plano.
- `ps` muestra su estado: `mysql` debe decir `healthy`.
- MySQL arranca **vacío**, solo con root. Las bases las crea el paso 7.

---

## 7. Dar de alta una empresa 🖥️

Con el DNS del dominio ya resolviendo:

```bash
cd /opt/plataforma
./nuevo-tenant.sh agrolibano agrolibano.tudominio.com
```

O eligiendo tú el nombre de la base (tercer argumento):

```bash
./nuevo-tenant.sh agrolibano agrolibano.tudominio.com control_libano
```

| Argumento | Qué es |
| --- | --- |
| `agrolibano` | El **slug**: nombre del contenedor (`api-agrolibano`) y de la carpeta (`/opt/agrolibano`). Minúsculas y números. |
| `agrolibano.tudominio.com` | El **dominio** por el que el front llama a este API |
| `control_libano` | **Opcional**: nombre de la base y de su usuario MySQL. Si no lo pones: `agro_<slug>`. Minúsculas, números o `_`, de 3 a 32. |

El script te pide los datos del **primer ADMIN** (username, nombre, cédula y
una contraseña temporal) y la contraseña de `sudo`. Luego hace solo esto:

| Paso | Qué hace |
| --- | --- |
| 1/5 | Crea la base y un usuario MySQL que **solo** puede tocar esa base |
| 2/5 | Carga las tablas y los catálogos (roles, permisos, etapas…) |
| 3/5 | Crea el ADMIN con la contraseña vencida: en su primer login tiene que cambiarla |
| 4/5 | Crea `/opt/agrolibano` con su `.env` y contraseñas generadas |
| 5/5 | Levanta `api-agrolibano` y avisa a Caddy del dominio nuevo |

Si falla a la mitad, te dice exactamente qué borrar para reintentar.

**Comprobar:**

```bash
curl -i https://agrolibano.tudominio.com/
```

Debe responder **401**: el API está vivo y pide token. Eso es lo correcto.

**Después, a mano:**

- [ ] Key de Gemini, en `nano /opt/agrolibano/.env` → `GEMINI_API_KEY=...`.
      Sin ella, el resumen IA y el chat responden 503.
- [ ] Solo en dev: `API_NODE_ENV=development` en ese mismo `.env` activa
      Swagger en `/docs`.
- [ ] Para que tome los cambios: `cd /opt/agrolibano && docker compose up -d`.
- [ ] **Productos**: la base nace sin productos y no hay endpoint para
      crearlos, así que van a mano con `INSERT INTO productos ...`.
- [ ] Revisar que `paises_config` tenga solo los países que van a operar.

**Entrar a la base de una empresa como root:**

```bash
cd /opt/plataforma
docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" agro_agrolibano'
```

### Dar de baja una empresa 🖥️

```bash
(cd /opt/agrolibano && docker compose down)
rm /opt/plataforma/tenants/agrolibano.caddy
cd /opt/plataforma && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

- Apaga su API, quita su dominio de Caddy y recarga Caddy.
- La base **no se borra**. Primero haz un backup final (`./backup.sh`). Solo
  después, si quieres borrarlo todo:
  - en MySQL: `DROP DATABASE agro_agrolibano; DROP USER 'agro_agrolibano'@'%';`
  - en el servidor: `sudo rm -rf /opt/agrolibano`

---

## 8. Backups 🖥️

**Backup automático todas las noches:**

```bash
crontab -e
```

Agrega al final:

```
0 3 * * * /opt/plataforma/backup.sh >> /opt/plataforma/backups/backup.log 2>&1
```

| Parte | Significado |
| --- | --- |
| `0 3 * * *` | Todos los días a las 3:00 a. m. |
| `backup.sh` | Respalda **cada base** menos las internas de MySQL. Una empresa nueva entra sola. |
| `>> backup.log 2>&1` | Guarda lo que pasó, incluidos los errores, en un log |

- Los backups quedan en `/opt/plataforma/backups/<base>-AAAAMMDD-HHMMSS.sql.gz`.
- Se borran solos a los 14 días.
- Si falla una base, sigue con las demás.
- Revisar: `tail /opt/plataforma/backups/backup.log`.

> ⚠️ **Esto no basta**: si se pierde el servidor, se pierden también los
> backups. Falta copiarlos fuera (Contabo Object Storage, S3, Backblaze) con
> `rclone`.

**Restaurar una empresa:**

```bash
(cd /opt/agrolibano && docker compose stop)
cd /opt/plataforma
gunzip -c backups/agro_agrolibano-AAAAMMDD-HHMMSS.sql.gz | \
  docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" agro_agrolibano'
(cd /opt/agrolibano && docker compose start)
```

- Primero se para su API, para que nadie escriba mientras se restaura.
- `gunzip -c` descomprime el backup y `|` se lo pasa a MySQL.
- Lo guardado entre el backup y el desastre se pierde.

Para **probar** un backup sin tocar la base real, restáuralo en una base
aparte. Los pasos están en `GUIA-PASO-A-PASO.md`, paso 7.

---

## 9. Desplegar una versión nueva 🖥️

Merge a `main` → esperar el CI en verde → en el servidor:

**Una empresa:**

```bash
cd /opt/agrolibano && docker compose pull && docker compose up -d
```

- `pull` baja la imagen nueva y `up -d` reinicia ese API con ella.

**Todas las empresas:**

```bash
for t in /opt/*/; do
  grep -qs '^TENANT=.' "${t}.env" && (cd "$t" && docker compose pull && docker compose up -d)
done
```

- Recorre cada carpeta de `/opt` que tenga un `.env` de empresa (con
  `TENANT=`) y la actualiza.

**Volver a una versión anterior (rollback):**

1. Busca el tag del commit bueno en GitHub → *Packages* (algo como
   `sha-4d897a5`).
2. En el `.env` de esa empresa:
   `API_IMAGE=ghcr.io/jesus180reyes/core-control-calidad-agro-backend:sha-4d897a5`
3. `docker compose pull && docker compose up -d`.

Esa empresa se queda fija en esa versión hasta que le vuelvas a poner
`latest`.

### Deploy automático a dev (rama `develop`)

Push a `develop` → CI en verde → el job `deploy-dev` de `ci.yml` entra por
SSH a la VPS de dev y hace `docker compose pull && docker compose up -d` en
**cada empresa cuyo `.env` tenga `API_IMAGE=...:develop`**. Las demás (sin
`API_IMAGE`, en `latest` o fijadas a un `sha-xxx`) no se tocan. Solo
actualiza los APIs: `db/`, `tenant/` y los archivos de `/opt/plataforma` se
siguen subiendo a mano (sección 4), y un DDL se aplica a mano **antes** del
push.

**Configurarlo (una sola vez):**

1. 💻 Una llave solo para el deploy, sin contraseña:
   `ssh-keygen -t ed25519 -N "" -C github-deploy-dev -f deploy_dev`
2. 🖥️ Añade `deploy_dev.pub` a `/home/deploy/.ssh/authorized_keys`.
3. 💻 La huella del servidor: `ssh-keyscan IP`.
4. En GitHub → *Settings → Environments* crea el environment **`dev`** y,
   dentro, estos secrets:

   | Secret | Valor |
   | --- | --- |
   | `DEV_SSH_HOST` | La IP de la VPS de dev |
   | `DEV_SSH_USER` | `deploy` |
   | `DEV_SSH_KEY` | El contenido de `deploy_dev` (la privada) |
   | `DEV_SSH_KNOWN_HOSTS` | La salida completa de `ssh-keyscan IP` |

5. 🖥️ En el `.env` de cada empresa de dev:
   `API_IMAGE=ghcr.io/jesus180reyes/core-control-calidad-agro-backend:develop`.
   El primer push a `develop` crea esa imagen; hasta entonces el `pull` de
   esa empresa falla.
6. Borra `deploy_dev` de tu PC cuando ya esté en GitHub.

Si ninguna empresa usa `:develop`, el job pasa en verde con un aviso. Si
falla una empresa, sigue con las demás y el job queda en rojo.

**Cambios en las tablas (DDL):** no hay migraciones automáticas.

1. Haz un backup.
2. Aplica el `ALTER TABLE` a mano, como root, **en la base de cada empresa**
   (`DB_NAME` de cada `/opt/<empresa>/.env`). El usuario de cada empresa no
   tiene permiso para cambiar tablas.
3. Solo después, despliega la imagen que usa ese cambio.
4. Copia el cambio a `db/schema.sql` y vuelve a subir `db/`, para que las
   empresas nuevas nazcan con él.

---

## 10. Entrar a MySQL desde tu PC 💻

**Con túnel SSH** (lo normal, y lo único en producción):

```bash
ssh -N -L 3308:127.0.0.1:3306 deploy@IP
```

- Deja esa terminal abierta. En Workbench o DBeaver conéctate a
  `127.0.0.1:3308`.
- El túnel lleva tu puerto 3308 al MySQL del servidor, sin que MySQL quede
  abierto a internet.
- También puedes usar la opción "TCP/IP over SSH" del cliente, con `deploy` y
  tu llave.

| Usuario | Qué ve | Dónde está la contraseña |
| --- | --- | --- |
| El de la empresa | Solo su base | `DB_USER` y `DB_PASSWORD` en `/opt/<empresa>/.env` |
| `root` | Todas las bases | `DB_ROOT_PASSWORD` en `/opt/plataforma/.env` |

**Directo, sin túnel (solo en dev):**

- En `/opt/plataforma/.env`: `DB_BIND=0.0.0.0`, y luego
  `cd /opt/plataforma && docker compose up -d mysql`.
- Te conectas a `IP:3306`.
- ⚠️ Deja MySQL abierto a internet, sin firewall delante. Solo con datos de
  prueba y contraseñas generadas con `openssl rand`. **Nunca en producción.**

---

## 11. Ver los logs (Dozzle)

Dozzle muestra en vivo los logs de todos los contenedores: cada
`api-<empresa>`, `caddy` y `mysql`.

> ⚠️ Dozzle no tiene login propio, y los logs llevan datos de clientes. Lo
> único que lo protege es el usuario y contraseña que pone Caddy delante.

**Configurarlo** 🖥️:

```bash
docker run --rm caddy:2 caddy hash-password --plaintext 'TuContraseña'
```

- Convierte la contraseña en un hash (`$2a$14$...`). Caddy guarda el hash,
  nunca la contraseña.

En `/opt/plataforma/.env`:

```
DOZZLE_DOMAIN=logs.tudominio.com
DOZZLE_USER=admin
DOZZLE_PASSWORD_HASH='$2a$14$...'
```

- El hash va **entre comillas simples**. Si no, Docker interpreta los `$` y
  el login nunca funciona.
- Aplicar: `cd /opt/plataforma && docker compose up -d caddy`.

**Entrar:**

- Desde el navegador: `https://logs.tudominio.com`, con `admin` y tu
  contraseña.
- O por túnel 💻: `ssh -N -L 8080:127.0.0.1:8080 deploy@IP` y abrir
  `http://localhost:8080`.
- Los dos túneles en uno:
  `ssh -N -L 3308:127.0.0.1:3306 -L 8080:127.0.0.1:8080 deploy@IP`.

Dozzle solo muestra los logs recientes (los últimos ~100 MB por contenedor).
Los errores 500 quedan guardados en la tabla `log_errores` de cada base.

---

## Pendientes antes de producción

- [ ] **Migraciones automáticas**: hoy cada cambio de tablas se aplica a mano
      en cada base. No escala con varias empresas.
- [ ] **Copia de los backups fuera del servidor** (`rclone`).
- [ ] **`GET /health`**: hoy Docker da por vivo al API con cualquier
      respuesta.
- [ ] **CORS**: abierto a cualquier origen.
- [ ] **Límite de intentos** en `/auth/login` y `/pesajes/validar-pin`
      (spec 23).
- [ ] **Monitoreo externo** (UptimeRobot, BetterStack) por cada dominio.
- [ ] **Límite de gasto** de cada key de Gemini en Google AI Studio.
- [ ] **Zona horaria**: `-06:00` está fijo en el código. Una empresa de otra
      zona horaria necesita cambios.
