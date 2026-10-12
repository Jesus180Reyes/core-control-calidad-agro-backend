#!/bin/sh
# Backup diario de MySQL. Se programa con cron en el servidor (ver README):
#   0 3 * * * /opt/agro/backup.sh >> /opt/agro/backups/backup.log 2>&1
set -eu

DIR=/opt/agro
DESTINO="$DIR/backups"
DIAS=14

mkdir -p "$DESTINO"
ARCHIVO="$DESTINO/agro-$(date +%Y%m%d-%H%M%S).sql.gz"

cd "$DIR"
docker compose -f docker-compose.prod.yml exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --triggers --events --set-gtid-purged=OFF "$MYSQL_DATABASE"' \
  | gzip > "$ARCHIVO"

# Un dump vacio significa que fallo aunque gzip haya salido bien.
if [ "$(gzip -dc "$ARCHIVO" | head -c 100 | wc -c)" -lt 100 ]; then
  echo "$(date) ERROR: backup vacio, se elimina $ARCHIVO"
  rm -f "$ARCHIVO"
  exit 1
fi

find "$DESTINO" -name 'agro-*.sql.gz' -mtime +"$DIAS" -delete
echo "$(date) OK $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"
