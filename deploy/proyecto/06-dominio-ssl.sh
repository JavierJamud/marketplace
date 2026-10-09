#!/usr/bin/env bash
# Baznova Marketplace: conectar el dominio y activar el certificado SSL (HTTPS, candado verde).
# Requisito: el dominio y www.dominio ya apuntan a la IP de este servidor (registro A en Cloudflare,
# con la nube en GRIS "Solo DNS" mientras se emite el certificado).
# Uso: sudo DOMINIO=midominio.com EMAIL=tu@correo.com bash 06-dominio-ssl.sh
# RAIZ=/opt/zeudin/organizacion/baznova (por defecto) es la carpeta del proyecto.
set -euo pipefail
RAIZ="${RAIZ:-/opt/zeudin/organizacion/baznova}"
DOMINIO="${DOMINIO:?Falta DOMINIO}"; EMAIL="${EMAIL:?Falta EMAIL (avisos de vencimiento del certificado)}"
# shellcheck disable=SC1091
source "$RAIZ/proyecto.env"
ENVF=$RAIZ/datos/secretos/.env.production
# La ficha recuerda el dominio: las actualizaciones (02-instalar-app.sh) lo reutilizan.
sed -i "s#^DOMINIO=.*#DOMINIO=$DOMINIO#" "$RAIZ/proyecto.env"

echo ">> URLs de la app -> https://$DOMINIO"
sed -i "s#^FRONTEND_URL=.*#FRONTEND_URL=https://$DOMINIO,https://www.$DOMINIO#; s#^BACKEND_URL=.*#BACKEND_URL=https://$DOMINIO/api#" "$ENVF"
sudo -u zeudin pm2 restart "$PM2_NOMBRE" --update-env

echo ">> Nginx responde a $DOMINIO y www.$DOMINIO"
sed -i -E "s#^(\s*server_name).*#\1 $DOMINIO www.$DOMINIO;#" "$RAIZ/nginx.conf"
nginx -t && systemctl reload nginx

echo ">> Certificado SSL gratuito de Let's Encrypt (se renueva solo cada 60-90 días)"
certbot --nginx -d "$DOMINIO" -d "www.$DOMINIO" -m "$EMAIL" --agree-tos -n --redirect
systemctl enable --now certbot.timer
certbot renew --dry-run

curl -fsS -o /dev/null -w "https://$DOMINIO -> HTTP %{http_code}\n" "https://$DOMINIO/"
curl -fsS "https://$DOMINIO/api/health" && echo
