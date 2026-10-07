#!/usr/bin/env bash
# ZeuDin Marketplace — Conectar el dominio y activar el certificado SSL (HTTPS, candado verde).
# Requisito: el dominio y www.dominio ya apuntan a la IP de este servidor (registro A en Cloudflare,
# con la nube en GRIS "Solo DNS" mientras se emite el certificado).
# Uso: sudo DOMINIO=midominio.com EMAIL=tu@correo.com bash 06-dominio-ssl.sh
set -euo pipefail
DOMINIO="${DOMINIO:?Falta DOMINIO}"; EMAIL="${EMAIL:?Falta EMAIL (avisos de vencimiento del certificado)}"
ENVF=/opt/zeudin/data/.env.production
echo "$DOMINIO" > /opt/zeudin/data/dominio   # las actualizaciones (paso 02) lo reutilizan

echo ">> La IP pública redirige a https://$DOMINIO"
cat > /etc/nginx/sites-available/zeudin-ip <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$DOMINIO\$request_uri; }
}
EOF
ln -sfn /etc/nginx/sites-available/zeudin-ip /etc/nginx/sites-enabled/zeudin-ip

echo ">> URLs de la app -> https://$DOMINIO"
sed -i "s#^FRONTEND_URL=.*#FRONTEND_URL=https://$DOMINIO,https://www.$DOMINIO#; s#^BACKEND_URL=.*#BACKEND_URL=https://$DOMINIO/api#" $ENVF
sudo -u zeudin pm2 restart zeudin-api --update-env

echo ">> Nginx responde a $DOMINIO y www.$DOMINIO"
sed -i -E "s#^(\s*server_name).*#\1 $DOMINIO www.$DOMINIO;#" /etc/nginx/sites-available/zeudin
nginx -t && systemctl reload nginx

echo ">> Certificado SSL gratuito de Let's Encrypt (se renueva solo cada 60-90 días)"
certbot --nginx -d "$DOMINIO" -d "www.$DOMINIO" -m "$EMAIL" --agree-tos -n --redirect
systemctl enable --now certbot.timer
certbot renew --dry-run

curl -fsS -o /dev/null -w "https://$DOMINIO -> HTTP %{http_code}\n" "https://$DOMINIO/"
curl -fsS "https://$DOMINIO/api/health" && echo
