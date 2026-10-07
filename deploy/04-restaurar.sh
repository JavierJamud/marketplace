#!/usr/bin/env bash
# ZeuDin Marketplace — Restaurar TODO desde un respaldo en un servidor (nuevo o el mismo).
# Funciona en cualquier VPS con Ubuntu (ARM64 u x86): Oracle, Hostinger, Contabo...
#
# Uso (en el servidor, después de correr 01-preparar-servidor.sh):
#   sudo DOMINIO=midominio.com bash 04-restaurar.sh zeudin_FECHA.tar.zst.age clave-respaldo.txt
set -euo pipefail
RESPALDO="${1:?Falta el archivo de respaldo (.age)}"
CLAVE="${2:?Falta la clave privada de respaldo (clave-respaldo.txt)}"
DIR=$(cd "$(dirname "$0")" && pwd)
DATA=/opt/zeudin/data
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

echo ">> Descifrando el respaldo"
age -d -i "$CLAVE" "$RESPALDO" | zstd -dq | tar -xf - -C "$TMP"
cat "$TMP/fecha.txt"

echo ">> Recuperando los secretos de la app (claves JWT, cifrado de integraciones, base de datos)"
mkdir -p $DATA
cp "$TMP/env.production" $DATA/.env.production
grep '^DATABASE_URL=' $DATA/.env.production | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#' > $DATA/db_password
chmod 600 $DATA/.env.production $DATA/db_password

echo ">> Instalando la app con el código que estaba desplegado"
cp "$TMP/release.tar.gz" /tmp/zeudin-release.tar.gz
DOMINIO="${DOMINIO:-}" bash "$DIR/02-instalar-app.sh" /tmp/zeudin-release.tar.gz

echo ">> Restaurando la base de datos"
sudo -u zeudin pm2 stop zeudin-api || true
sudo -u postgres dropdb --if-exists zeudin
sudo -u postgres createdb -O zeudin_app zeudin
sudo -u postgres psql -d zeudin -c "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;"
sudo -u postgres pg_restore --no-owner --role=zeudin_app -d zeudin "$TMP/db.dump" || true
sudo -u postgres psql -d zeudin -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO zeudin_app; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO zeudin_app;"

echo ">> Restaurando fotos y documentos subidos"
rm -rf $DATA/uploads && tar -xf "$TMP/uploads.tar" -C $DATA
chown -R zeudin:zeudin /opt/zeudin

echo ">> Encendiendo"
cd /opt/zeudin/app/backend && sudo -u zeudin npx prisma migrate deploy
sudo -u zeudin pm2 restart zeudin-api
sleep 4; curl -fsS http://127.0.0.1:4000/health && echo
echo "Restauración completa. Si el dominio apunta a una IP nueva, cámbiala en Cloudflare (DNS)."
