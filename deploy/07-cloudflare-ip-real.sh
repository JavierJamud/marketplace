#!/usr/bin/env bash
# ZeuDin Marketplace — Con el proxy de Cloudflare (nube naranja) activo, Nginx recibe la IP de Cloudflare.
# Esto restaura la IP REAL del visitante (necesaria para el límite de intentos de login, logs, etc.).
# Se puede correr varias veces; un cron semanal lo mantiene al día con la lista oficial de Cloudflare.
# Uso: sudo bash 07-cloudflare-ip-real.sh
set -euo pipefail
TMP=$(mktemp)
{
  echo "# Generado por 07-cloudflare-ip-real.sh — rangos oficiales de Cloudflare"
  for ip in $(curl -fsS https://www.cloudflare.com/ips-v4) $(curl -fsS https://www.cloudflare.com/ips-v6); do
    echo "set_real_ip_from $ip;"
  done
  echo "real_ip_header CF-Connecting-IP;"
} > "$TMP"
grep -q set_real_ip_from "$TMP" || { echo "No se pudo descargar la lista de Cloudflare"; exit 1; }
install -m 644 "$TMP" /etc/nginx/conf.d/cloudflare-ip-real.conf; rm -f "$TMP"
nginx -t && systemctl reload nginx
echo "0 4 * * 1 root bash /opt/zeudin/deploy/07-cloudflare-ip-real.sh >/dev/null 2>&1" > /etc/cron.d/zeudin-cloudflare-ips
echo "IP real de Cloudflare configurada ($(grep -c set_real_ip_from /etc/nginx/conf.d/cloudflare-ip-real.conf) rangos)."
