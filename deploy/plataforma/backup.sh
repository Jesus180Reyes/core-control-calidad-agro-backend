#!/bin/sh
# Backup diario de MySQL: un dump por cada base que no sea del sistema (una
# por tenant, con el nombre que se le haya dado). Se programa con cron en el
# servidor (ver README):
#   0 3 * * * /opt/plataforma/backup.sh >> /opt/plataforma/backups/backup.log 2>&1
set -eu

DIR=/opt/plataforma
DESTINO="$DIR/backups"
DIAS=14

mkdir -p "$DESTINO"
cd "$DIR"

mysql_root() {
  docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$@"' mysql "$@"
}

# Todas menos las de MySQL: una base creada a mano o de un alta a medias
# tambien entra, en vez de quedarse sin backup sin que nadie lo note.
BASES=$(mysql_root -N -e "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('mysql', 'sys', 'information_schema', 'performance_schema')")

if [ -z "$BASES" ]; then
  echo "$(date) Sin bases de tenants: nada que respaldar"
  exit 0
fi

FALLOS=0
for BASE in $BASES; do
  ARCHIVO="$DESTINO/$BASE-$(date +%Y%m%d-%H%M%S).sql.gz"

  docker compose exec -T mysql sh -c \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --triggers --events --set-gtid-purged=OFF "$1"' \
    mysqldump "$BASE" \
    | gzip > "$ARCHIVO"

  # Un dump vacio significa que fallo aunque gzip haya salido bien. Se sigue
  # con las demas bases: el fallo de un tenant no deja sin backup al resto.
  if [ "$(gzip -dc "$ARCHIVO" | head -c 100 | wc -c)" -lt 100 ]; then
    echo "$(date) ERROR: backup vacio de $BASE, se elimina $ARCHIVO"
    rm -f "$ARCHIVO"
    FALLOS=$((FALLOS + 1))
  else
    echo "$(date) OK $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"
  fi
done

find "$DESTINO" -name '*.sql.gz' -mtime +"$DIAS" -delete

[ "$FALLOS" -eq 0 ] || exit 1
