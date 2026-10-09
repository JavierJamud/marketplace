#!/usr/bin/env bash
# Baznova Marketplace: instalar o ACTUALIZAR la aplicación (proyecto organizacion/baznova).
# Uso:  sudo bash 02-instalar-app.sh /ruta/zeudin-app.tar.gz
#       RAIZ=/opt/zeudin/organizacion/baznova (por defecto) es la carpeta del proyecto; su ficha es proyecto.env.
#       DOMINIO_OVERRIDE=otro.com cambia el dominio guardado en la ficha.
# Es seguro correrlo varias veces: nunca borra la base de datos ni los archivos subidos.
set -euo pipefail
ARCHIVO="${1:?Falta la ruta del .tar.gz del código}"
BASE=/opt/zeudin
RAIZ="${RAIZ:-$BASE/organizacion/baznova}"
[ -f "$RAIZ/proyecto.env" ] || { echo "Falta $RAIZ/proyecto.env (la ficha del proyecto). Crea el proyecto con nuevo-proyecto.sh."; exit 1; }
# shellcheck disable=SC1091
source "$RAIZ/proyecto.env"
DATA=$RAIZ/datos
APP=$RAIZ/app
WEB=$RAIZ/web
SITIO="${CATEGORIA}-${CLIENTE:+$CLIENTE-}${PROYECTO}"
IP_PUBLICA=$(curl -fs4 https://ifconfig.me || hostname -I | awk '{print $1}')
# El dominio sale de la ficha; si se pasa DOMINIO_OVERRIDE, se guarda en ella para las próximas veces.
if [ -n "${DOMINIO_OVERRIDE:-}" ]; then DOMINIO="$DOMINIO_OVERRIDE"; sed -i "s#^DOMINIO=.*#DOMINIO=$DOMINIO#" "$RAIZ/proyecto.env"; fi
DOMINIO="${DOMINIO:-$IP_PUBLICA}"
if [[ "$DOMINIO" =~ ^[0-9.]+$ ]]; then ESQUEMA=http; else ESQUEMA=https; fi
URL_PUBLICA="$ESQUEMA://$DOMINIO"
if [ "$ESQUEMA" = https ]; then URLS_FRONT="$URL_PUBLICA,https://www.$DOMINIO"; else URLS_FRONT="$URL_PUBLICA"; fi

command -v rsync >/dev/null || apt-get install -y rsync
pm2 kill >/dev/null 2>&1 || true   # por si quedó un PM2 de root de la instalación

echo ">> Usuario de sistema 'zeudin' (la app nunca corre como root)"
id zeudin >/dev/null 2>&1 || useradd --system --create-home --home-dir $BASE --shell /bin/bash zeudin
mkdir -p $DATA/uploads $DATA/secretos $DATA/release $RAIZ/respaldos $RAIZ/logs $RAIZ/scripts $WEB
chown -R zeudin:zeudin $RAIZ
chmod 751 $RAIZ; chmod 750 $DATA $RAIZ/respaldos; chmod 700 $DATA/secretos

echo ">> Base de datos PostgreSQL"
if [ ! -f $DATA/secretos/db_password ]; then
  openssl rand -hex 24 > $DATA/secretos/db_password
  chmod 600 $DATA/secretos/db_password; chown zeudin:zeudin $DATA/secretos/db_password
fi
DB_PASS=$(cat $DATA/secretos/db_password)
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USUARIO') THEN
    CREATE ROLE $DB_USUARIO LOGIN PASSWORD '$DB_PASS';
  ELSE
    ALTER ROLE $DB_USUARIO PASSWORD '$DB_PASS';
  END IF;
END \$\$;
SQL
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NOMBRE'" | grep -q 1 || \
  sudo -u postgres createdb -O $DB_USUARIO $DB_NOMBRE
# Las extensiones necesitan superusuario; la app no lo es (a propósito).
sudo -u postgres psql -d $DB_NOMBRE -c "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;"

echo ">> Variables de entorno de producción (se generan una sola vez)"
ENVF=$DATA/secretos/.env.production
if [ ! -f $ENVF ]; then
  cat > $ENVF <<EOF
NODE_ENV=production
PORT=$PUERTO_API
FRONTEND_URL=$URLS_FRONT
BACKEND_URL=$URL_PUBLICA/api
DATABASE_URL="postgresql://$DB_USUARIO:$DB_PASS@localhost:5432/$DB_NOMBRE?schema=public"
JWT_SECRET=$(openssl rand -hex 48)
JWT_REFRESH_SECRET=$(openssl rand -hex 48)
INTEGRATIONS_ENCRYPTION_KEY=$(openssl rand -hex 32)
BACKUP_DIR=$RAIZ/respaldos
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
[ "$(readlink -f "$ARCHIVO")" = "$DATA/release/release.tar.gz" ] || cp "$ARCHIVO" $DATA/release/release.tar.gz
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
rm -rf $RAIZ/app.prev
if [ -d $APP/backend ]; then mv $APP $RAIZ/app.prev; else rm -rf $APP; fi
mv $APP.new $APP
rsync -a --delete $APP/frontend/dist/ $WEB/
install -m 644 $APP/deploy/servidor/estructura/proyecto/README.web.md $WEB/README.md
chown -R www-data:www-data $WEB
# Scripts propios del proyecto (los trae el mismo paquete de código)
mkdir -p $RAIZ/scripts
cp $APP/deploy/proyecto/*.sh $RAIZ/scripts/ && chmod 750 $RAIZ/scripts/*.sh
cp $APP/deploy/README.md $RAIZ/scripts/README-despliegue.md
chown -R zeudin:zeudin $RAIZ/scripts

echo ">> PM2: mantiene la API siempre encendida y la reinicia sola si falla o si el servidor se reinicia"
cat > $RAIZ/ecosystem.config.cjs <<EOF
module.exports = {
  apps: [{
    name: "$PM2_NOMBRE",
    cwd: "$APP/backend",
    script: "src/server.js",
    exec_mode: "fork",          // UNA sola instancia: los crons no deben correr duplicados
    instances: 1,
    max_memory_restart: "1500M",
    env: { NODE_ENV: "production", TZ: "America/Havana" },
    out_file: "$RAIZ/logs/api.out.log",
    error_file: "$RAIZ/logs/api.err.log",
    time: true,
  }],
};
EOF
chown -R zeudin:zeudin $RAIZ/ecosystem.config.cjs $RAIZ/logs
sudo -u zeudin pm2 startOrReload $RAIZ/ecosystem.config.cjs --update-env
sudo -u zeudin pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u zeudin --hp $BASE >/dev/null
systemctl enable pm2-zeudin >/dev/null 2>&1 || true

echo ">> Rotación de logs de PM2"
sudo -u zeudin pm2 install pm2-logrotate >/dev/null 2>&1 || true
sudo -u zeudin pm2 set pm2-logrotate:max_size 20M >/dev/null 2>&1 || true
sudo -u zeudin pm2 set pm2-logrotate:retain 10 >/dev/null 2>&1 || true

echo ">> Nginx (sitio + API en /api + vista previa de tiendas para WhatsApp/Facebook)"
if [[ "$DOMINIO" =~ ^[0-9.]+$ ]]; then NOMBRES="$DOMINIO _"; else NOMBRES="$DOMINIO www.$DOMINIO"; fi
# El detector de bots (variable zeudin_es_bot) es común a todos los proyectos: lo crea crear-estructura.sh.
[ -f /etc/nginx/conf.d/00-zeudin-bots.conf ] || { echo "Falta 00-zeudin-bots.conf: corre /opt/zeudin/plataforma/scripts/crear-estructura.sh"; exit 1; }
cat > $RAIZ/nginx.conf <<EOF
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
        proxy_pass http://127.0.0.1:$PUERTO_API/;
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
chown zeudin:zeudin $RAIZ/nginx.conf
ln -sfn $RAIZ/nginx.conf /etc/nginx/sites-available/$SITIO.conf
ln -sfn /etc/nginx/sites-available/$SITIO.conf /etc/nginx/sites-enabled/$SITIO.conf
nginx -t && systemctl reload nginx

# Si el dominio ya tiene certificado SSL, se vuelve a aplicar al Nginx recién escrito (sin pedir uno nuevo).
if [ -d /etc/letsencrypt/live/$DOMINIO ]; then
  echo ">> Reaplicando el certificado SSL de $DOMINIO"
  certbot install --nginx --cert-name "$DOMINIO" -d "$DOMINIO" -d "www.$DOMINIO" --redirect -n
  nginx -t && systemctl reload nginx
fi

echo ">> Verificación"
sleep 4
curl -fsS http://127.0.0.1:$PUERTO_API/health && echo
curl -fsS -o /dev/null -w "Sitio: HTTP %{http_code}\n" -H "Host: $DOMINIO" http://127.0.0.1/
echo "Listo: $URL_PUBLICA"
