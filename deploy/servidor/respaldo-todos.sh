#!/usr/bin/env bash
# ZeuDin: respaldo completo, cifrado y guardado FUERA del servidor (Cloudflare R2), de TODOS los proyectos.
# Lo ejecuta solo el temporizador "zeudin-respaldo" (cada domingo 3:00 a.m., hora de La Habana).
# Manual:  sudo bash /opt/zeudin/plataforma/scripts/respaldo-todos.sh [proyecto-opcional]
#
# Recorre cada carpeta con un proyecto.env dentro de organizacion/ y clientes/. Cada respaldo es un archivo .age con:
#   db.dump          base de datos del proyecto (si tiene)
#   uploads.tar      archivos subidos (si tiene)
#   secretos.tar     datos/secretos (env y contraseñas)
#   release.tar.gz   el código exacto que estaba desplegado (si hay)
#   proyecto.env     la ficha del proyecto
set -uo pipefail
Z="${ZEUDIN_ROOT:-/opt/zeudin}"
DESTINO_R2="r2:zeudin-backups"     # remoto de rclone + bucket
SEMANAS_EN_R2=12                   # cuántas semanas se guardan en R2
LOCALES=2                          # cuántos se guardan también en el servidor, por proyecto
CLAVE_PUBLICA=$(cat $Z/plataforma/claves/backup_public_key.txt)
FILTRO="${1:-}"
FALLOS=0

respaldar() {
  local FICHA="$1" RAIZ; RAIZ=$(dirname "$FICHA")
  # shellcheck disable=SC1090
  source "$FICHA"
  local SLUG="${CLIENTE:+$CLIENTE-}$PROYECTO" FECHA TMP ARCH RUTA_R2
  FECHA=$(date +%Y-%m-%d_%H%M)
  TMP=$(mktemp -d); trap 'rm -rf "$TMP"' RETURN
  RUTA_R2="$CATEGORIA/${CLIENTE:+$CLIENTE/}$PROYECTO"
  echo "[$(date)] Respaldo de $SLUG"
  [ -n "${DB_NOMBRE:-}" ] && { sudo -u postgres pg_dump -Fc -d "$DB_NOMBRE" > "$TMP/db.dump" || return 1; }
  [ -d "$RAIZ/datos/uploads" ] && tar -cf "$TMP/uploads.tar" -C "$RAIZ/datos" uploads
  [ -d "$RAIZ/datos/secretos" ] && tar -cf "$TMP/secretos.tar" -C "$RAIZ/datos" secretos
  [ -f "$RAIZ/datos/release/release.tar.gz" ] && cp "$RAIZ/datos/release/release.tar.gz" "$TMP/release.tar.gz"
  cp "$FICHA" "$TMP/proyecto.env"
  { date -Is; uname -m; } > "$TMP/fecha.txt"
  mkdir -p "$RAIZ/respaldos"
  ARCH="$RAIZ/respaldos/${SLUG}_${FECHA}.tar.zst.age"
  ( cd "$TMP" && tar -cf - $(ls) ) | zstd -q -10 | age -r "$CLAVE_PUBLICA" -o "$ARCH" || return 1
  echo "Archivo: $ARCH ($(du -h "$ARCH" | cut -f1))"
  if rclone listremotes | grep -q '^r2:'; then
    rclone copy "$ARCH" "$DESTINO_R2/$RUTA_R2/" --s3-no-check-bucket \
      && rclone delete "$DESTINO_R2/$RUTA_R2/" --min-age "$((SEMANAS_EN_R2 * 7))d" --include '*.age' || echo "AVISO: no se pudo subir a R2"
    echo "Subido a R2: $RUTA_R2"
  else
    echo "AVISO: Cloudflare R2 no está configurado; el respaldo quedó solo en el servidor."
  fi
  ls -1t "$RAIZ"/respaldos/*.age 2>/dev/null | tail -n +$((LOCALES + 1)) | xargs -r rm -f
  chown -R zeudin:zeudin "$RAIZ/respaldos"
}

while IFS= read -r ficha; do
  [ -n "$FILTRO" ] && [[ "$ficha" != *"/$FILTRO/"* ]] && continue
  ( respaldar "$ficha" ) || { echo "ERROR: falló el respaldo de $ficha"; FALLOS=$((FALLOS + 1)); }
done < <(find $Z/organizacion $Z/clientes -mindepth 2 -maxdepth 3 -name proyecto.env -not -path '*/_plantilla/*' | sort)

echo "[$(date)] Respaldos terminados (fallos: $FALLOS)"
exit $((FALLOS > 0 ? 1 : 0))
