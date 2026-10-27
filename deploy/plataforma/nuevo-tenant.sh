#!/bin/sh
# Alta de un tenant, de punta a punta:
#   1. base (agro_<slug> o la que se pase) y un usuario MySQL del mismo nombre
#      con permisos SOLO sobre ella
#   2. db/schema.sql + db/seed.sql cargados en esa base
#   3. primer usuario ADMIN (el seed no trae usuarios)
#   4. /opt/<slug> con el compose del tenant y su .env (secretos generados)
#   5. el API y el servicio de reportes levantados y el dominio dado de alta
#      en Caddy
#
# Uso, en el servidor, como deploy y con la plataforma ya levantada:
#   /opt/plataforma/nuevo-tenant.sh <slug> <dominio> [base]
#   /opt/plataforma/nuevo-tenant.sh agrolibano agrolibano.tudominio.com
#   /opt/plataforma/nuevo-tenant.sh agrolibano agrolibano.tudominio.com control_libano
#
# Sin [base], la base es agro_<slug>.
#
# Pide los datos del ADMIN por teclado y sudo para crear /opt/<slug>. El DNS
# del dominio tiene que apuntar ya a la VPS, o Caddy no saca el certificado.
set -eu

PLATAFORMA=/opt/plataforma
SLUG=${1:-}
DOMINIO=${2:-}
BASE=${3:-agro_$SLUG}

uso() {
  echo "Uso: $0 <slug> <dominio> [base]"
  echo "  slug: minusculas y numeros, empieza con letra, 2 a 20 caracteres"
  echo "  base: opcional, minusculas, numeros o _, empieza con letra, 3 a 32"
  echo "        caracteres (por defecto agro_<slug>)"
  exit 1
}

[ -n "$SLUG" ] && [ -n "$DOMINIO" ] || uso
echo "$SLUG" | grep -Eq '^[a-z][a-z0-9]{1,19}$' || uso
echo "$DOMINIO" | grep -Eq '^[a-z0-9.-]+$' || { echo "ERROR: dominio invalido: $DOMINIO"; exit 1; }
# 32 es el maximo de un usuario MySQL, que se llama igual que la base.
echo "$BASE" | grep -Eq '^[a-z][a-z0-9_]{2,31}$' || uso
case "$BASE" in
  mysql|sys) echo "ERROR: $BASE es una base del sistema de MySQL"; exit 1 ;;
esac
DIR_TENANT="/opt/$SLUG"
SITIO="$PLATAFORMA/tenants/$SLUG.caddy"

cd "$PLATAFORMA"

mysql_root() {
  docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$@"' mysql "$@"
}

# --- Comprobaciones, antes de tocar nada ---
[ -f tenant/docker-compose.yml ] && [ -f tenant/.env.example ] || { echo "ERROR: falta $PLATAFORMA/tenant/"; exit 1; }
[ -f db/schema.sql ] && [ -f db/seed.sql ] || { echo "ERROR: falta $PLATAFORMA/db/"; exit 1; }
[ ! -e "$DIR_TENANT" ] || { echo "ERROR: $DIR_TENANT ya existe"; exit 1; }
[ ! -e "$SITIO" ] || { echo "ERROR: $SITIO ya existe"; exit 1; }
if [ -n "$(mysql_root -N -e "SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '$BASE'")" ]; then
  echo "ERROR: la base $BASE ya existe"
  exit 1
fi

# --- Datos del primer ADMIN ---
echo "Primer ADMIN de $SLUG"
printf '  username (con el que entra): '; read -r ADMIN_USER
printf '  nombre completo: '; read -r ADMIN_NOMBRE
printf '  cedula: '; read -r ADMIN_CEDULA
trap 'stty echo 2>/dev/null || true' EXIT
stty -echo
printf '  contrasena temporal (se le pide cambiarla al entrar): '; read -r ADMIN_PASS
stty echo
echo

echo "$ADMIN_USER" | grep -Eq '^[A-Za-z0-9._]{3,20}$' || { echo "ERROR: username: letras, numeros, . o _, 3 a 20"; exit 1; }
[ -n "$ADMIN_NOMBRE" ] && [ "${#ADMIN_NOMBRE}" -le 100 ] || { echo "ERROR: nombre vacio o de mas de 100"; exit 1; }
echo "$ADMIN_CEDULA" | grep -Eq '^[A-Za-z0-9-]{1,30}$' || { echo "ERROR: cedula: letras, numeros o guiones"; exit 1; }
[ "${#ADMIN_PASS}" -ge 8 ] || { echo "ERROR: la contrasena necesita al menos 8 caracteres"; exit 1; }

# El nombre es texto libre: se escapa para meterlo en un literal SQL.
ADMIN_NOMBRE_SQL=$(printf '%s' "$ADMIN_NOMBRE" | sed -e 's/\\/\\\\/g' -e "s/'/''/g")

# Hash bcrypt con la propia imagen del API (trae bcrypt): no hace falta Node
# en el servidor. De paso comprueba que hay acceso a GHCR antes de crear nada.
API_IMAGE=$(sed -n 's/^API_IMAGE=//p' tenant/.env.example)
echo "Generando el hash con $API_IMAGE ..."
ADMIN_HASH=$(docker run --rm -e P="$ADMIN_PASS" --entrypoint node "$API_IMAGE" \
  -e "process.stdout.write(require('bcrypt').hashSync(process.env.P, 10))")
echo "$ADMIN_HASH" | grep -q '^\$2[aby]\$' || { echo "ERROR: no se pudo generar el hash"; exit 1; }

DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 48)

# Si algo falla de aqui en adelante, el alta queda a medias.
trap 'R=$?; stty echo 2>/dev/null || true; if [ $R -ne 0 ]; then
  echo
  echo "ERROR: el alta de $SLUG quedo a medias. Para limpiar y reintentar:"
  echo "  (cd $DIR_TENANT && docker compose down) 2>/dev/null; sudo rm -rf $DIR_TENANT"
  echo "  rm -f $SITIO"
  echo "  y en MySQL como root: DROP DATABASE IF EXISTS \`$BASE\`; DROP USER IF EXISTS '"'"'$BASE'"'"'@'"'"'%'"'"';"
fi' EXIT

# --- 1. Base y usuario ---
# En GRANT el "_" del nombre de la base es comodin: se escapa para que el
# permiso cubra solo esta base y no, por ejemplo, agroX<slug>.
BASE_GRANT=$(printf '%s' "$BASE" | sed 's/_/\\_/g')
echo "[1/5] Base $BASE y usuario $BASE"
# Solo DML: el API no ejecuta DDL. Un futuro runner de migraciones necesitara
# ademas CREATE/ALTER/INDEX/DROP/REFERENCES sobre su base.
mysql_root -e "
  CREATE DATABASE \`$BASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
  CREATE USER '$BASE'@'%' IDENTIFIED BY '$DB_PASSWORD';
  GRANT SELECT, INSERT, UPDATE, DELETE ON \`$BASE_GRANT\`.* TO '$BASE'@'%';
"

# --- 2. Esquema y catalogos ---
echo "[2/5] Cargando db/schema.sql y db/seed.sql"
mysql_root "$BASE" < db/schema.sql
mysql_root "$BASE" < db/seed.sql

# --- 3. Primer ADMIN ---
# Rol resuelto por nombre, no por id. password_vence_en = NOW(): el primer
# login responde 403 passwordVencida y el front lo manda a renovarla.
echo "[3/5] ADMIN $ADMIN_USER"
INSERTADOS=$(mysql_root -N "$BASE" -e "
  INSERT INTO usuarios (username, complete_name, rol_id, password, password_vence_en, cedula)
  SELECT '$ADMIN_USER', '$ADMIN_NOMBRE_SQL', id, '$ADMIN_HASH', NOW(), '$ADMIN_CEDULA'
  FROM roles WHERE nombre = 'ADMIN';
  SELECT ROW_COUNT();
")
[ "$INSERTADOS" = "1" ] || { echo "ERROR: no se inserto el ADMIN (falta el rol ADMIN en roles?)"; exit 1; }

# --- 4. /opt/<slug> ---
echo "[4/5] $DIR_TENANT"
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 750 "$DIR_TENANT"
cp tenant/docker-compose.yml "$DIR_TENANT/docker-compose.yml"
(
  umask 077
  sed -e "s|^TENANT=.*|TENANT=$SLUG|" \
      -e "s|^DOMAIN=.*|DOMAIN=$DOMINIO|" \
      -e "s|^DB_NAME=.*|DB_NAME=$BASE|" \
      -e "s|^DB_USER=.*|DB_USER=$BASE|" \
      -e "s|^DB_PASSWORD=.*|DB_PASSWORD=$DB_PASSWORD|" \
      -e "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" \
      tenant/.env.example > "$DIR_TENANT/.env"
)

# --- 5. API y Caddy ---
echo "[5/5] Levantando api-$SLUG y reporte-$SLUG y dando de alta $DOMINIO en Caddy"
(cd "$DIR_TENANT" && docker compose up -d)

mkdir -p tenants
printf '%s {\n\timport api_tenant %s\n}\n' "$DOMINIO" "$SLUG" > "$SITIO"
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

echo
echo "Listo: $SLUG en https://$DOMINIO"
echo "  - Comprobar: curl -i https://$DOMINIO/   (debe responder 401)"
echo "              curl -i https://$DOMINIO/reportes/lotes/finalizados-por-aprobador/pdf"
echo "              (401 del servicio de reportes; un 404 es que Caddy no lo enruta)"
echo "  - Entrar con $ADMIN_USER y la contrasena temporal: se le pedira cambiarla."
echo "  - Pendiente a mano: GEMINI_API_KEY en $DIR_TENANT/.env (y luego"
echo "    'cd $DIR_TENANT && docker compose up -d'), productos y paises_config."
