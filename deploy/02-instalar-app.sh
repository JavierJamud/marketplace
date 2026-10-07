#!/usr/bin/env bash
# ZeuDin Marketplace — Paso 2: instalar o ACTUALIZAR la aplicación.
# Uso:  sudo DOMINIO=midominio.com bash 02-instalar-app.sh /ruta/zeudin-app.tar.gz
#       (sin DOMINIO usa la IP pública del servidor, para probar antes del dominio)
# Es seguro correrlo varias veces: nunca borra la base de datos ni los archivos subidos.
set -euo pipefail
ARCHIVO="${1:?Falta la ruta del .tar.gz del código}"
BASE=/opt/zeudin
DATA=$BASE/data
APP=$BASE/app
WEB=/var/www/zeudin
IP_PUBLICA=$(curl -fs4 https://ifconfig.me || hostname -I | awk '{print $1}')
# Si ya se conectó un dominio (paso 06), se recuerda en data/dominio y se reutiliza en cada actualización.
DOMINIO="${DOMINIO:-$(cat $DATA/dominio 2>/dev/null || echo $IP_PUBLICA)}"
if [[ "$DOMINIO" =~ ^[0-9.]+$ ]]; then ESQUEMA=http; else ESQUEMA=https; fi
URL_PUBLICA="$ESQUEMA://$DOMINIO"
if [ "$ESQUEMA" = https ]; then URLS_FRONT="$URL_PUBLICA,https://www.$DOMINIO"; else URLS_FRONT="$URL_PUBLICA"; fi

command -v rsync >/dev/null || apt-get install -y rsync
pm2 kill >/dev/null 2>&1 || true   # por si quedó un PM2 de root de la instalación

echo ">> Usuario de sistema 'zeudin' (la app nunca corre como root)"
id zeudin >/dev/null 2>&1 || useradd --system --create-home --home-dir $BASE --shell /bin/bash zeudin
mkdir -p $DATA/uploads $DATA/backups $WEB
chown -R zeudin:zeudin $BASE

echo ">> Base de datos PostgreSQL"
if [ ! -f $DATA/db_password ]; then
  openssl rand -hex 24 > $DATA/db_password
  chmod 600 $DATA/db_password; chown zeudin:zeudin $DATA/db_password
fi
DB_PASS=$(cat $DATA/db_password)
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zeudin_app') THEN
    CREATE ROLE zeudin_app LOGIN PASSWORD '$DB_PASS';
  ELSE
    ALTER ROLE zeudin_app PASSWORD '$DB_PASS';
  END IF;
END \$\$;
SQL
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='zeudin'" | grep -q 1 || \
  sudo -u postgres createdb -O zeudin_app zeudin
# Las extensiones necesitan superusuario; la app no lo es (a propósito).
sudo -u postgres psql -d zeudin -c "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;"

echo ">> Variables de entorno de producción (se generan una sola vez)"
ENVF=$DATA/.env.production
if [ ! -f $ENVF ]; then
  cat > $ENVF <<EOF
NODE_ENV=production
PORT=4000
FRONTEND_URL=$URLS_FRONT
BACKEND_URL=$URL_PUBLICA/api
DATABASE_URL="postgresql://zeudin_app:$DB_PASS@localhost:5432/zeudin?schema=public"
JWT_SECRET=$(openssl rand -hex 48)
JWT_REFRESH_SECRET=$(openssl rand -hex 48)
INTEGRATIONS_ENCRYPTION_KEY=$(openssl rand -hex 32)
BACKUP_DIR=$DATA/backups
EOF
else
  # Si cambió el dominio, se actualizan solo las URLs (los secretos se conservan).
  sed -i "s#^FRONTEND_URL=.*#FRONTEND_URL=$URLS_FRONT#; s#^BACKEND_URL=.*#BACKEND_URL=$URL_PUBLICA/api#" $ENVF
fi
chmod 600 $ENVF; chown zeudin:zeudin $ENVF

echo ">> Código nuevo"
rm -rf $APP.new && mkdir -p $APP.new
tar -xzf "$ARCHIVO" -C $APP.new
# Copia del código desplegado: va dentro de cada respaldo para poder restaurar sin GitHub.
[ "$(readlink -f "$ARCHIVO")" = "$DATA/release.tar.gz" ] || cp "$ARCHIVO" $DATA/release.tar.gz
# Los archivos subidos y el .env viven FUERA del código, así una actualización nunca los toca.
rm -rf $APP.new/backend/uploads
ln -sfn $DATA/uploads $APP.new/backend/uploads
ln -sfn $ENVF $APP.new/backend/.env.production
ln -sfn $ENVF $APP.new/backend/.env
chown -R zeudin:zeudin $APP.new

echo ">> Backend: dependencias (compiladas para $(uname -m)), Prisma y migraciones"
cd $APP.new/backend
sudo -u zeudin npm ci --no-audit --no-fund
sudo -u zeudin npx prisma generate
sudo -u zeudin npx prisma migrate deploy

echo ">> Frontend: compilación (la API se llama por /api en el mismo dominio)"
cd $APP.new/frontend
sudo -u zeudin npm ci --no-audit --no-fund
sudo -u zeudin env VITE_API_URL=/api npm run build

echo ">> Activando la versión nueva"
rm -rf $APP.old
if [ -d $APP/backend ]; then mv $APP $APP.old; else rm -rf $APP; fi
mv $APP.new $APP
rsync -a --delete $APP/frontend/dist/ $WEB/
chown -R www-data:www-data $WEB

echo ">> PM2: mantiene la API siempre encendida y la reinicia sola si falla o si el servidor se reinicia"
cat > $BASE/ecosystem.config.cjs <<EOF
module.exports = {
  apps: [{
    name: "zeudin-api",
    cwd: "$APP/backend",
    script: "src/server.js",
    exec_mode: "fork",          // UNA sola instancia: los crons no deben correr duplicados
    instances: 1,
    max_memory_restart: "1500M",
    env: { NODE_ENV: "production", TZ: "America/Havana" },
    out_file: "$BASE/logs/api.out.log",
    error_file: "$BASE/logs/api.err.log",
    time: true,
  }],
};
EOF
mkdir -p $BASE/logs && chown -R zeudin:zeudin $BASE/ecosystem.config.cjs $BASE/logs
sudo -u zeudin pm2 startOrReload $BASE/ecosystem.config.cjs --update-env
sudo -u zeudin pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u zeudin --hp $BASE >/dev/null
systemctl enable pm2-zeudin >/dev/null 2>&1 || true

echo ">> Rotación de logs de PM2"
sudo -u zeudin pm2 install pm2-logrotate >/dev/null 2>&1 || true
sudo -u zeudin pm2 set pm2-logrotate:max_size 20M >/dev/null 2>&1 || true
sudo -u zeudin pm2 set pm2-logrotate:retain 10 >/dev/null 2>&1 || true

echo ">> Nginx (sitio + API en /api + vista previa de tiendas para WhatsApp/Facebook)"
if [[ "$DOMINIO" =~ ^[0-9.]+$ ]]; then NOMBRES="$DOMINIO _"; else NOMBRES="$DOMINIO www.$DOMINIO"; fi
cat > /etc/nginx/conf.d/zeudin-bots.conf <<'EOF'
map $http_user_agent $zeudin_es_bot {
  default 0;
  ~*(facebookexternalhit|facebot|whatsapp|twitterbot|telegrambot|discordbot|slackbot|linkedinbot|pinterest|skypeuripreview|googlebot|bingbot) 1;
}
EOF
cat > /etc/nginx/sites-available/zeudin <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $NOMBRES;

    root $WEB;
    index index.html;
    client_max_body_size 60m;
    server_tokens off;

    gzip on;
    gzip_comp_level 5;
    gzip_types text/css application/javascript application/json image/svg+xml text/plain;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # API Express (todas sus rutas viven bajo /api en producción)
    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;            # respuestas del asistente en tiempo real
        proxy_read_timeout 180s;
    }

    # Links de tienda compartidos: los bots reciben la página con la foto/datos de ESA tienda
    location /tienda/ {
        if (\$zeudin_es_bot) { rewrite ^/tienda/(.*)\$ /api/og/tienda/\$1 last; }
        try_files \$uri /index.html;
    }

    # Archivos del build con hash en el nombre: caché de 1 año
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    # SPA de React: cualquier ruta cae en index.html (sin caché, para ver siempre la última versión)
    location / {
        add_header Cache-Control "no-cache";
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
ln -sfn /etc/nginx/sites-available/zeudin /etc/nginx/sites-enabled/zeudin
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Si el dominio ya tiene certificado SSL, se vuelve a aplicar al Nginx recién escrito (sin pedir uno nuevo).
if [ -d /etc/letsencrypt/live/$DOMINIO ]; then
  echo ">> Reaplicando el certificado SSL de $DOMINIO"
  certbot install --nginx --cert-name "$DOMINIO" -d "$DOMINIO" -d "www.$DOMINIO" --redirect -n
  nginx -t && systemctl reload nginx
fi

echo ">> Verificación"
sleep 4
curl -fsS http://127.0.0.1:4000/health && echo
curl -fsS -o /dev/null -w "Sitio: HTTP %{http_code}\n" http://127.0.0.1/
echo "Listo: $URL_PUBLICA"
