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
internet ──> Caddy ──> api-agrolibano ──────┐
               │  └─> reporte-agrolibano ───┤   (/reportes/*)
               │                            ├──> MySQL (una base por empresa)
               ├────> api-suragro ──────────┤
               │  └─> reporte-suragro ──────┘
               └────> Dozzle (logs)
```

| Carpeta en el servidor | Qué tiene |
| --- | --- |
| `/opt/plataforma/` | Lo que existe **una sola vez**: Caddy (HTTPS), MySQL, Dozzle (logs), los scripts y los backups |
| `/opt/<empresa>/` | **Una por empresa**: su API, su servicio de reportes, su front (opcional) y su `.env` |
| `/opt/frontend-src/` | El código del front, compartido por todas las empresas que lo llevan (sección 13) |

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
- El **servicio de reportes** (PDF/Excel) es otro repo con su propia imagen,
  pero corre en el mismo `/opt/<empresa>` y bajo el mismo dominio
  (sección 12).
- El **front** no viene de GHCR: se construye en el servidor con las URLs del
  `.env` de cada empresa y se sirve en `app-<empresa>.tudominio.com`
  (sección 13).

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
- uno por cada empresa con front (`app-agrolibano.tudominio.com`, sección 13)

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

Los paquetes del API y del servicio de reportes en GitHub son **privados**
(el mismo token sirve para los dos). Saca un token en GitHub:
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
| 5/5 | Levanta `api-agrolibano` y `reporte-agrolibano` y avisa a Caddy del dominio nuevo |

Si falla a la mitad, te dice exactamente qué borrar para reintentar.

**Comprobar:**

```bash
curl -i https://agrolibano.tudominio.com/
```

Debe responder **401**: el API está vivo y pide token. Eso es lo correcto.
`curl -i https://agrolibano.tudominio.com/reportes/lotes/finalizados-por-aprobador/pdf`
también debe dar **401**, del servicio de reportes (sección 12).

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

- `pull` baja las imágenes nuevas y `up -d` reinicia el API y el servicio de
  reportes con ellas. Para tocar solo uno: `docker compose pull api && docker
  compose up -d api` (o `reporte`).

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

**Cambios en las tablas (DDL):** no hay migraciones automáticas.

1. Haz un backup.
2. Aplica el `ALTER TABLE` a mano, como root, **en la base de cada empresa**
   (`DB_NAME` de cada `/opt/<empresa>/.env`). El usuario de cada empresa no
   tiene permiso para cambiar tablas.
3. Solo después, despliega la imagen que usa ese cambio.
4. Copia el cambio a `db/schema.sql` y vuelve a subir `db/`, para que las
   empresas nuevas nazcan con él.

### Deploy automático a dev (rama `develop`)

```
push a develop ──> lint, tests, build ──> imagen :develop ──> SSH a la VPS ──> pull + up -d
```

- Un push a `develop` corre el CI y publica la imagen con los tags
  `develop` y `sha-<commit>`. Nunca mueve `latest`, que es de producción.
- Después, el job `deploy-dev` de `.github/workflows/ci.yml` entra por SSH
  como `deploy` y hace `docker compose pull api && docker compose up -d api`
  **solo en las empresas cuyo `.env` tenga `API_IMAGE=...:develop`**. Las
  demás (sin `API_IMAGE`, en `latest` o fijadas a un `sha-xxx`) no se tocan.
- Solo actualiza los APIs; el servicio de reportes tiene su propio deploy
  igual, en su repo (sección 12). `db/`, `tenant/` y los archivos de
  `/opt/plataforma` se siguen subiendo a mano (sección 4), y un DDL se
  aplica a mano **antes** del push.

#### Configurarlo (una sola vez)

**1. Crear la llave de deploy** 🖥️. Es más fácil hacerlo en la propia VPS,
como `deploy`:

```bash
cd ~ && ssh-keygen -t ed25519 -N "" -C github-deploy-dev -f deploy_dev
cat ~/deploy_dev.pub >> ~/.ssh/authorized_keys
grep -c github-deploy-dev ~/.ssh/authorized_keys
ssh -i ~/deploy_dev -o IdentitiesOnly=yes -o PasswordAuthentication=no deploy@127.0.0.1 echo ok
```

- `-N ""`: sin contraseña. GitHub no puede escribirla.
- El `grep` debe dar `1` o más. Si da `0`, la llave no quedó autorizada y
  el deploy falla con `Permission denied (publickey)`.
- La última línea debe responder `ok` **sin pedir contraseña**. Si pide
  contraseña, la llave no está funcionando.

**2. Sacar los valores** 🖥️:

```bash
cat ~/deploy_dev                                     # -> DEV_SSH_KEY
ssh-keyscan IP 2>/dev/null | grep -v '^#'            # -> DEV_SSH_KNOWN_HOSTS
```

- `DEV_SSH_KEY` es la llave **privada** (`deploy_dev`, no `deploy_dev.pub`),
  completa: desde `-----BEGIN OPENSSH PRIVATE KEY-----` hasta
  `-----END OPENSSH PRIVATE KEY-----`, esas dos líneas incluidas.
- `DEV_SSH_KNOWN_HOSTS` son las 3 líneas que empiezan con la IP. Son
  públicas: sirven para que GitHub compruebe que entra a tu servidor y no a
  otro.

**3. Guardarlos en GitHub.** Repo → **⚙️ Settings** (la pestaña del
repositorio, no la de tu cuenta) → **Environments** → **`dev`** (si no
existe, *New environment* → `dev`) → **Environment secrets** → *Add
environment secret*, uno por uno:

| Name (exacto) | Value |
| --- | --- |
| `DEV_SSH_HOST` | La IP de la VPS, por ejemplo `62.84.184.57` |
| `DEV_SSH_USER` | `deploy` |
| `DEV_SSH_KEY` | La salida de `cat ~/deploy_dev` |
| `DEV_SSH_KNOWN_HOSTS` | La salida de `ssh-keyscan` |

- Van en **Environment secrets**, no en *Environment variables* (están en la
  misma página). Las variables no llegan al job.
- Al terminar, la lista de Environments debe decir **`dev` · 4 secrets**.
- Para cambiar uno que ya existe: el lápiz ✏️, borrar y pegar de nuevo.

**4. Borrar la llave de la VPS** 🖥️, ya que está en GitHub:
`rm ~/deploy_dev ~/deploy_dev.pub`. La pública sigue en `authorized_keys`.

**5. Apuntar cada empresa de dev a `:develop`** 🖥️. En `/opt/<empresa>/.env`:

```
API_IMAGE=ghcr.io/jesus180reyes/core-control-calidad-agro-backend:develop
```

y la primera vez, a mano: `cd /opt/<empresa> && docker compose pull && docker compose up -d`.
La imagen `:develop` existe a partir del primer push a `develop`; antes, el
`pull` falla.

**6. Probar.** En GitHub → *Actions* → el último run de `develop` → *Re-run
all jobs*. El log del paso "Pull y reinicio de los tenants en :develop" debe
terminar con `Tenants actualizados: 1, con fallo: 0` (o cuantas empresas
haya). Y desde tu PC, `curl -i https://<dominio-de-la-empresa>/` debe
responder 401.

#### Si falla

El paso **"Revisar secrets y conexion"** revisa todo antes de desplegar y
deja el motivo en el log del job (y como anotación en el resumen del run):

| Mensaje | Qué pasa | Cómo arreglarlo |
| --- | --- | --- |
| `Faltan los secrets: ...` | Esos secrets no existen, tienen otro nombre o se guardaron como variables | Paso 3: revisa el nombre exacto y que estén en *Environment secrets* de `dev` |
| `DEV_SSH_KEY no es una llave privada valida` | Se pegó la pública, o la privada incompleta (sin `BEGIN`/`END`, cortada) | Paso 2: `cat ~/deploy_dev` y pegarla entera. Si ya la borraste, vuelve al paso 1 |
| `DEV_SSH_KNOWN_HOSTS no tiene la huella de ...` | Huellas vacías, de otra IP, o el servidor se reinstaló | Paso 2: vuelve a sacar el `ssh-keyscan` |
| `Permission denied (publickey)` | La pública no está en `authorized_keys` de `deploy` | Paso 1: el `grep -c` debe dar 1 o más |
| `Host key verification failed` | `DEV_SSH_KNOWN_HOSTS` no coincide con el servidor | Paso 2 |
| `Connection timed out` / `refused` | IP equivocada, o el firewall cierra el 22 | Revisa `DEV_SSH_HOST` y `ufw status` |
| Aviso `Ningun tenant usa API_IMAGE=...:develop` | El deploy entró bien pero ninguna empresa usa `:develop` | Paso 5 |
| `!! fallo en /opt/<empresa>/` | Falló el `pull` o el `up` de esa empresa; las demás siguen | En la VPS: `cd /opt/<empresa> && docker compose pull && docker compose up -d` y lee el error |

Después de arreglarlo, *Re-run failed jobs* en el run: no hace falta otro
push. GitHub lee los secrets otra vez en cada intento.

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
`api-<empresa>`, cada `reporte-<empresa>`, `caddy` y `mysql`.

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

## 12. Servicio de reportes

El repo `core-control-calidad-agro-report-service` genera los PDF y Excel
(acta de entrega, etiqueta de pesaje, lotes finalizados). Cada empresa tiene el
suyo, `reporte-<empresa>`, en el mismo `docker-compose.yml` que su API.

- **Mismo dominio.** Caddy manda `/reportes/*` a `reporte-<empresa>:4001` y
  todo lo demás al API (snippet `api_tenant` del `Caddyfile`). El front se
  compila con `VITE_REPORT_SERVICE_URL` igual a `VITE_API_URL`.
- **Mismo `.env`.** Lee la misma base con el mismo usuario MySQL y valida los
  tokens con el mismo `JWT_SECRET`: no hay nada que generar al dar de alta.
  El servicio solo hace `SELECT`, pero el usuario puede escribir: nada lo
  impide fuera del código.
- **Su propia imagen**, `ghcr.io/jesus180reyes/core-control-calidad-agro-report-service`,
  con los mismos tags (`latest` en `main`, `develop`, `sha-<commit>`) y fijada
  por empresa con `REPORTE_IMAGE=` en su `.env`, igual que `API_IMAGE=`.
- Trae su propio Chromium para los PDF: la imagen pesa bastante más que la del
  API. `GET /health` (sin token, solo dentro de la red) responde 503 si no
  alcanza MySQL, y el healthcheck de Docker lo usa.

**Agregarlo a una empresa que ya existía** 🖥️ (las nuevas lo traen de
`nuevo-tenant.sh`):

1. 💻 Subir `deploy/tenant/` y el `Caddyfile` nuevos (sección 4).
2. 🖥️ `cp /opt/plataforma/tenant/docker-compose.yml /opt/<empresa>/`
3. 🖥️ En `/opt/<empresa>/.env`, agregar
   `REPORTE_IMAGE=ghcr.io/jesus180reyes/core-control-calidad-agro-report-service:latest`
   (o `:develop` en dev).
4. 🖥️ `cd /opt/<empresa> && docker compose pull reporte && docker compose up -d reporte`
5. 🖥️ `cd /opt/plataforma && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`
6. 💻 `curl -i https://<dominio>/reportes/lotes/finalizados-por-aprobador/pdf`
   debe dar **401**. Un **404** es del API: Caddy todavía no enruta
   `/reportes/*` (paso 5).

**Deploy automático a dev:** el repo del reporte tiene el mismo job
`deploy-dev` que el API. Hay que cargar **otra vez** los 4 secrets
`DEV_SSH_*` en *Settings → Environments → `dev`* de ese repo (mismos valores
que en la sección 9, paso 3). Actualiza solo el servicio `reporte` de las
empresas con `REPORTE_IMAGE=...:develop`, y avisa con `!! ... no tiene el
servicio reporte` si su `docker-compose.yml` es el viejo (paso 2).

---

## 13. Front por empresa

El front (repo `core-control-calidad-agro`) de cada empresa vive en su propio
subdominio, `app-<empresa>.tudominio.com`, y llama al API de su empresa en
`<empresa>.tudominio.com`. Es `frontend-<empresa>`, en `/opt/<empresa>`, al
lado de su API.

```
push a develop (front) ──> test + build en GitHub ──> SSH a la VPS
    ──> git reset en /opt/frontend-src ──> build + up -d frontend en cada empresa
```

- **Se construye en el servidor, no viene de GHCR.** Vite escribe
  `VITE_API_URL` dentro del código al compilar: una imagen hecha en GitHub
  tendría una sola URL para todas. Aquí cada empresa construye la suya
  (`frontend-<empresa>:local`) con las URLs de **su** `.env`.
- **Los `.env` no los toca ningún deploy.** Las URLs se escriben a mano una
  vez; el deploy solo las lee.
- **Archivo aparte, `docker-compose.frontend.yml`.** Una empresa lo activa
  con `COMPOSE_FILE` en su `.env`; sin esa línea, su compose es el de
  siempre. No es un perfil del compose base porque Compose exige las `VITE_*`
  aunque el perfil esté apagado, y rompería a las empresas sin front.
- **Un solo código para todas**, en `/opt/frontend-src`: todas corren la
  misma versión del front.
- **Sin secretos.** `frontend-<empresa>` no recibe el `.env`: no ve
  `DB_PASSWORD` ni `JWT_SECRET`.
- Cada build gasta CPU y RAM del mismo servidor que MySQL y los APIs (un
  `npm run build` por empresa, uno tras otro).

### Preparar el servidor (una sola vez) 🖥️

Como `deploy`, que es el usuario con el que entra el deploy automático.

**1. Llave para leer el repo** (solo si el repo del front es privado):

```bash
ssh-keygen -t ed25519 -N "" -C frontend-src -f ~/.ssh/frontend_deploy
cat ~/.ssh/frontend_deploy.pub
```

En GitHub, repo del front → **⚙️ Settings** → **Deploy keys** → *Add deploy
key*: pega la pública, **sin** marcar *Allow write access*. Luego:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-frontend
  HostName github.com
  User git
  IdentityFile ~/.ssh/frontend_deploy
  IdentitiesOnly yes
EOF
ssh -T github-frontend    # debe decir "successfully authenticated"
```

- Es otra llave, distinta de la del deploy (sección 9): esta la usa el
  servidor para leer GitHub; aquella la usa GitHub para entrar al servidor.

**2. Clonar el front:**

```bash
sudo mkdir -p /opt/frontend-src && sudo chown deploy:deploy /opt/frontend-src
git clone -b develop git@github-frontend:Jesus180Reyes/core-control-calidad-agro.git /opt/frontend-src
```

- Si el repo es público: `https://github.com/Jesus180Reyes/core-control-calidad-agro.git`
  y sin el paso 1.
- ⚠️ No edites nada en `/opt/frontend-src`: cada deploy hace
  `git reset --hard` y lo borra.

### Activarlo en una empresa 🖥️

1. 💻 Subir `deploy/tenant/` nuevo (sección 4).
2. 🖥️ `cp /opt/plataforma/tenant/docker-compose.frontend.yml /opt/<empresa>/`
   (`nuevo-tenant.sh` no lo copia: ninguna empresa nace con front).
3. 🖥️ En `/opt/<empresa>/.env`, agregar **las tres juntas**:

   ```
   COMPOSE_FILE=docker-compose.yml:docker-compose.frontend.yml
   VITE_API_URL=https://<empresa>.tudominio.com
   VITE_REPORT_SERVICE_URL=https://<empresa>.tudominio.com
   ```

   - `VITE_REPORT_SERVICE_URL` es el mismo dominio del API: Caddy ya manda
     `/reportes/*` al servicio de reportes (sección 12).
   - Separador `:`, no `;` (eso es Windows).
   - ⚠️ Con `COMPOSE_FILE` y sin las `VITE_*`, **todo** comando de Compose
     de esa empresa falla (también el deploy del API) con
     `falta VITE_API_URL en .env`.
4. 🖥️ Primer build, a mano:

   ```bash
   cd /opt/<empresa>
   docker compose config --services     # api, frontend, reporte
   docker compose build frontend && docker compose up -d frontend
   ```

   Nombra siempre el servicio: `api` y `reporte` no se reinician.
5. DNS: registro **A** de `app-<empresa>` a la IP del servidor (sección 3).
6. 🖥️ Al final de `/opt/plataforma/tenants/<empresa>.caddy`:

   ```
   app-<empresa>.tudominio.com {
   	encode gzip
   	reverse_proxy frontend-<empresa>:3000
   }
   ```

   y `cd /opt/plataforma && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`.
7. 💻 Abrir `https://app-<empresa>.tudominio.com`, iniciar sesión y revisar en
   la pestaña *Network* del navegador que las llamadas vayan a
   `https://<empresa>.tudominio.com`.

### Deploy automático a dev

El repo del front tiene su propio `.github/workflows/ci.yml`:

- En cada PR y push: `npm ci`, `npm test`, `npm run build`. Un error de
  compilación falla en GitHub, no en el servidor.
- En cada push a `develop`, el job `deploy-dev` entra por SSH, hace
  `git fetch` + `git reset --hard origin/develop` en `/opt/frontend-src` y,
  en cada empresa cuyo `COMPOSE_FILE` incluye `docker-compose.frontend.yml`,
  `docker compose build frontend && docker compose up -d frontend`.
- Hay que cargar **otra vez** los 4 secrets `DEV_SSH_*` en *Settings →
  Environments → `dev`* del repo del front (mismos valores que en la
  sección 9, paso 3).
- El log termina con `Tenants actualizados: N, con fallo: 0`. Un
  `!! fallo en /opt/<empresa>/` se revisa en el servidor con el comando del
  paso 4 de arriba.
- El deploy del API (sección 9) solo toca `api`: no reinicia ningún
  `frontend-<empresa>`.

**Desactivarlo en una empresa** 🖥️: quitar las tres líneas del `.env`,
`docker rm -f frontend-<empresa>`, borrar su bloque de
`tenants/<empresa>.caddy` y recargar Caddy.

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
