#!/usr/bin/env bash
# ZeuDin Marketplace — Respaldo completo, cifrado, guardado FUERA del servidor (Cloudflare R2).
# Lo ejecuta solo el temporizador "zeudin-respaldo" (cada domingo 3:00 a.m., hora de La Habana).
# Manual:  sudo bash /opt/zeudin/deploy/03-respaldo.sh
#
# Contenido de cada respaldo (un solo archivo .age):
#   db.dump              base de datos completa (pg_dump, sirve en ARM64 y en x86)
#   uploads.tar          fotos, logos, documentos KYC y demás archivos subidos
#   env.production       secretos de la app (sin esto no se pueden leer las integraciones cifradas)
#   release.tar.gz       el código exacto que estaba desplegado
set -euo pipefail
DATA=/opt/zeudin/data
DESTINO_R2="r2:zeudin-backups"          # remoto de rclone + bucket
SEMANAS_EN_R2=12                         # cuántas semanas se guardan en R2
LOCALES=2                                # cuántos se guardan también en el servidor
CLAVE_PUBLICA=$(cat $DATA/backup_public_key.txt)
FECHA=$(date +%Y-%m-%d_%H%M)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "[$(date)] Iniciando respaldo $FECHA"
sudo -u postgres pg_dump -Fc -d zeudin > "$TMP/db.dump"
tar -cf "$TMP/uploads.tar" -C $DATA uploads
cp $DATA/.env.production "$TMP/env.production"
cp $DATA/release.tar.gz "$TMP/release.tar.gz"
date -Is > "$TMP/fecha.txt"; uname -m >> "$TMP/fecha.txt"

ARCH="$DATA/backups/zeudin_${FECHA}.tar.zst.age"
tar -C "$TMP" -cf - db.dump uploads.tar env.production release.tar.gz fecha.txt \
  | zstd -q -10 | age -r "$CLAVE_PUBLICA" -o "$ARCH"
echo "Archivo: $ARCH ($(du -h "$ARCH" | cut -f1))"

if rclone listremotes | grep -q '^r2:'; then
  rclone copy "$ARCH" "$DESTINO_R2/" --s3-no-check-bucket
  rclone delete "$DESTINO_R2/" --min-age "$((SEMANAS_EN_R2 * 7))d" --include 'zeudin_*.age' || true
  echo "Subido a R2 ✔"
else
  echo "AVISO: Cloudflare R2 todavía no está configurado; el respaldo quedó solo en el servidor."
fi

ls -1t $DATA/backups/zeudin_*.age | tail -n +$((LOCALES + 1)) | xargs -r rm -f
echo "[$(date)] Respaldo terminado"
