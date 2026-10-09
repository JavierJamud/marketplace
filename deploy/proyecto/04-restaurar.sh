#!/usr/bin/env bash
# Baznova Marketplace: restaurar TODO desde un respaldo en un servidor (nuevo o el mismo).
# Funciona en cualquier VPS con Ubuntu (ARM64 o x86): Oracle, Hostinger, Contabo...
#
# Uso (en el servidor, después de correr servidor/01-preparar-servidor.sh):
#   sudo bash 04-restaurar.sh baznova_FECHA.tar.zst.age clave-respaldo.txt
# RAIZ=/opt/zeudin/organizacion/baznova (por defecto) es la carpeta del proyecto.
set -euo pipefail
RESPALDO="${1:?Falta el archivo de respaldo (.age)}"
CLAVE="${2:?Falta la clave privada de respaldo (clave-respaldo.txt)}"
DIR=$(cd "$(dirname "$0")" && pwd)
RAIZ="${RAIZ:-/opt/zeudin/organizacion/baznova}"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

echo ">> Descifrando el respaldo"
age -d -i "$CLAVE" "$RESPALDO" | zstd -dq | tar -xf - -C "$TMP"
cat "$TMP/fecha.txt"

echo ">> Ficha del proyecto"
mkdir -p "$RAIZ"
if [ -f "$TMP/proyecto.env" ]; then cp -n "$TMP/proyecto.env" "$RAIZ/proyecto.env"; fi
[ -f "$RAIZ/proyecto.env" ] || { echo "El respaldo no trae proyecto.env y $RAIZ no tiene uno: crea el proyecto con nuevo-proyecto.sh y repite."; exit 1; }
# shellcheck disable=SC1091
source "$RAIZ/proyecto.env"
DATA=$RAIZ/datos
mkdir -p "$DATA/secretos" "$DATA/release"

echo ">> Recuperando los secretos de la app (claves JWT, cifrado de integraciones, base de datos)"
if [ -f "$TMP/secretos.tar" ]; then
  tar -xf "$TMP/secretos.tar" -C "$DATA"
else   # respaldos anteriores a la reorganización
  cp "$TMP/env.production" "$DATA/secretos/.env.production"
fi
ENVF=$DATA/secretos/.env.production
grep '^DATABASE_URL=' "$ENVF" | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#' > "$DATA/secretos/db_password"
# Respaldos viejos traen el nombre antiguo de la base y del usuario: se adaptan a los de la ficha.
sed -i -E "s#//[^:]+:([^@]+)@localhost:5432/[^?]+#//$DB_USUARIO:\1@localhost:5432/$DB_NOMBRE#" "$ENVF"
chmod 600 "$ENVF" "$DATA/secretos/db_password"

echo ">> Instalando la app con el código que estaba desplegado"
cp "$TMP/release.tar.gz" /tmp/zeudin-release.tar.gz
RAIZ="$RAIZ" bash "$DIR/02-instalar-app.sh" /tmp/zeudin-release.tar.gz

echo ">> Restaurando la base de datos"
sudo -u zeudin pm2 stop "$PM2_NOMBRE" || true
sudo -u postgres dropdb --if-exists "$DB_NOMBRE"
sudo -u postgres createdb -O "$DB_USUARIO" "$DB_NOMBRE"
sudo -u postgres psql -d "$DB_NOMBRE" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;"
sudo -u postgres pg_restore --no-owner --role="$DB_USUARIO" -d "$DB_NOMBRE" "$TMP/db.dump" || true
sudo -u postgres psql -d "$DB_NOMBRE" -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO $DB_USUARIO; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO $DB_USUARIO;"

echo ">> Restaurando fotos y documentos subidos"
rm -rf "$DATA/uploads" && tar -xf "$TMP/uploads.tar" -C "$DATA"
chown -R zeudin:zeudin "$RAIZ"

echo ">> Encendiendo"
cd "$RAIZ/app/backend" && sudo -u zeudin npx prisma migrate deploy
sudo -u zeudin pm2 restart "$PM2_NOMBRE"
sleep 4; curl -fsS "http://127.0.0.1:$PUERTO_API/health" && echo
echo "Restauración completa. Si el dominio apunta a una IP nueva, cámbiala en Cloudflare (DNS)."
