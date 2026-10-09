#!/usr/bin/env bash
# ZeuDin: crea o repara la estructura común del servidor (/opt/zeudin) y sus documentos.
# Se puede correr todas las veces que haga falta: nunca borra proyectos ni datos.
# Uso: sudo bash crear-estructura.sh
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
Z=/opt/zeudin
PLAT=$Z/plataforma

echo ">> Usuario de sistema 'zeudin' (los proyectos nunca corren como root)"
id zeudin >/dev/null 2>&1 || useradd --system --create-home --home-dir $Z --shell /bin/bash zeudin

echo ">> Carpetas"
mkdir -p $Z/organizacion $Z/clientes/_plantilla $PLAT/{scripts,nginx,claves,registro,logs}
# Nginx (www-data) necesita atravesar las carpetas hasta web/; el contenido sensible tiene sus propios permisos.
chmod 751 $Z $Z/organizacion $Z/clientes

echo ">> Documentación y scripts de la plataforma"
E=$DIR/estructura
install -m 644 $E/README.md $Z/README.md
install -m 644 $E/organizacion/README.md $Z/organizacion/README.md
install -m 644 $E/clientes/README.md $Z/clientes/README.md
install -m 644 $E/clientes/_plantilla/README.md $Z/clientes/_plantilla/README.md
for d in "" scripts nginx claves registro logs; do
  install -m 644 "$E/plataforma/${d:+$d/}README.md" "$PLAT/${d:+$d/}README.md"
done
for f in 01-preparar-servidor.sh crear-estructura.sh nuevo-proyecto.sh respaldo-todos.sh 05-activar-respaldos.sh 07-cloudflare-ip-real.sh; do
  [ -f "$DIR/$f" ] && install -m 750 "$DIR/$f" "$PLAT/scripts/$f"
done
rm -rf $PLAT/scripts/estructura && cp -r "$E" $PLAT/scripts/estructura   # nuevo-proyecto.sh lee las plantillas de aquí
if [ ! -f $PLAT/registro/PROYECTOS.md ]; then
  cat > $PLAT/registro/PROYECTOS.md <<'MD'
# Proyectos del servidor

| Proyecto | Categoría | Cliente | Dominio | Puerto API | Proceso PM2 | Base de datos | Carpeta |
| --- | --- | --- | --- | --- | --- | --- | --- |
MD
fi
chown -R zeudin:zeudin $Z/organizacion $Z/clientes $PLAT $Z/README.md
chmod 750 $PLAT/scripts

echo ">> Nginx: piezas comunes"
cat > /etc/nginx/conf.d/00-zeudin-bots.conf <<'NGX'
map $http_user_agent $zeudin_es_bot {
  default 0;
  ~*(facebookexternalhit|facebot|whatsapp|twitterbot|telegrambot|discordbot|slackbot|linkedinbot|pinterest|skypeuripreview|googlebot|bingbot) 1;
}
NGX
rm -f /etc/nginx/conf.d/zeudin-bots.conf
mkdir -p /var/www/html
cat > /etc/nginx/sites-available/00-default.conf <<'NGX'
# Sitio por defecto: quien entra por la IP o por un dominio que no es de ningún proyecto no recibe nada.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 444; }
}
NGX
ln -sfn /etc/nginx/sites-available/00-default.conf /etc/nginx/sites-enabled/00-default.conf
rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/zeudin-ip /etc/nginx/sites-available/zeudin-ip
nginx -t && systemctl reload nginx
echo "Estructura lista en $Z"
