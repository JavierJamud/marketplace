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
DATABASE_URL="postgresql://$DB_USUARIO:$DB_PASS@localhost:5432/$DB_NOMBRE?schema=public&connection_limit=20&pool_timeout=20"
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

echo ">> Backend: dependencias (compiladas para $(uname -m)) y Prisma"
cd $APP.new/backend
sudo -u zeudin npm ci --no-audit --no-fund
sudo -u zeudin npx prisma generate

echo ">> Frontend: compilación (la API se llama por /api en el mismo dominio)"
cd $APP.new/frontend
sudo -u zeudin npm ci --no-audit --no-fund
# FRONTEND_URL es el dominio real: las etiquetas de vista previa (og:image) del index deben llevar la dirección pública, no localhost.
sudo -u zeudin env VITE_API_URL=/api FRONTEND_URL="$URL_PUBLICA" npm run build

# Las migraciones van aquí, con todo ya compilado, y no al principio: mientras se compila (unos 20 minutos) la versión vieja sigue
# atendiendo a los clientes, y si la base ya hubiera cambiado (una columna quitada, por ejemplo) esa versión fallaría todo ese
# tiempo. Así el código viejo convive con la base nueva solo los segundos que tarda el cambio de versión.
echo ">> Base de datos: migraciones y catálogos"
cd $APP.new/backend
sudo -u zeudin npx prisma migrate deploy
# Catálogo mundial de países (apagados): el admin enciende los que quiere recibir. Solo agrega los que faltan.
sudo -u zeudin node prisma/seed-countries.mjs
# Municipios de Cuba y ciudades de cada estado de los demás países: solo agrega los que faltan.
sudo -u zeudin node prisma/seed-ciudades.mjs
cd /

echo ">> Activando la versión nueva"
rm -rf $RAIZ/app.prev
if [ -d $APP/backend ]; then mv $APP $RAIZ/app.prev; else rm -rf $APP; fi
mv $APP.new $APP
# Los archivos con hash de la versión anterior se conservan 14 días: una pestaña abierta (o un visitante con la página ya cargada) sigue
# pidiendo sus archivos viejos y, si se borraran al instante, vería la pantalla de error hasta recargar. Lo demás se reemplaza entero.
mkdir -p $WEB/assets
rsync -a --delete --exclude='/assets/' $APP/frontend/dist/ $WEB/
rsync -a $APP/frontend/dist/assets/ $WEB/assets/
find $WEB/assets -type f -mtime +14 -delete 2>/dev/null || true
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
    kill_timeout: 10000,        // da tiempo a terminar las peticiones en curso antes de apagar
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
cat > $RAIZ/cabeceras-seguridad.conf <<'CABECERAS'
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
add_header X-Frame-Options SAMEORIGIN always;
add_header Permissions-Policy "camera=(self), microphone=(self), geolocation=(self), payment=()" always;
add_header Strict-Transport-Security "max-age=15552000" always;
CABECERAS
chown zeudin:zeudin $RAIZ/cabeceras-seguridad.conf

# Registro de accesos con tiempos (rt = lo que tardó en total, urt = lo que tardó la API): permite ver qué pantallas o consultas se ponen lentas.
cat > /etc/nginx/conf.d/10-baznova-tiempos.conf <<'TIEMPOS'
log_format baznova_tiempos '$remote_addr - [$time_local] "$request" $status $body_bytes_sent rt=$request_time urt=$upstream_response_time cf=$http_cf_ray "$http_user_agent"';
TIEMPOS

if [[ "$DOMINIO" =~ ^[0-9.]+$ ]]; then REDIR_WWW=""; else REDIR_WWW="if (\$host = www.$DOMINIO) { return 301 $URL_PUBLICA\$request_uri; }"; fi

cat > $RAIZ/nginx.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $NOMBRES;

    access_log /var/log/nginx/baznova-access.log baznova_tiempos;
    root $WEB;
    index index.html;
    client_max_body_size 60m;
    server_tokens off;
    charset utf-8;                 # llms.txt, robots.txt y demás texto con tildes

    gzip on;
    gzip_comp_level 5;
    gzip_types text/css application/javascript application/json image/svg+xml text/plain application/wasm font/ttf font/otf application/x-font-ttf;

    # Cabeceras de seguridad. Se incluyen también dentro de cada location que define su propio add_header, porque Nginx
    # no hereda los add_header del server cuando un location declara alguno.
    include $RAIZ/cabeceras-seguridad.conf;

    # \$es_portada = 1 solo en la portada (con o sin parámetros): el HTML la usa para precargar la imagen del encabezado.
    set \$es_portada 0;
    if (\$request_uri ~ "^/(\?.*)?\$") { set \$es_portada 1; }

    # Una sola dirección para Google: www redirige al dominio sin www (evita contenido duplicado).
    $REDIR_WWW

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
        proxy_connect_timeout 3s;       # si la API está reiniciando, falla rápido (el navegador reintenta solo)
    }

    # Canal en vivo (avisos y actualizaciones al instante): conexión larga que la API mantiene con un latido cada 20 segundos.
    location = /api/push/stream {
        proxy_pass http://127.0.0.1:$PUERTO_API/push/stream;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_connect_timeout 3s;
    }

    # PWA: el service worker y los manifiestos se revisan en cada visita (sin caché), para que una versión nueva o el
    # interruptor de emergencia lleguen de inmediato a los teléfonos.
    location ~ ^/(sw\.js|manifest-(cliente|tienda|admin)\.webmanifest)\$ {
        types { application/javascript js; application/manifest+json webmanifest; }
        add_header Cache-Control "no-cache";
        include $RAIZ/cabeceras-seguridad.conf;
        try_files \$uri =404;
    }

    # Precarga de la imagen del encabezado: nginx la pide a la API para armar el HTML de la portada (SSI). Esa llamada NUNCA debe
    # retrasar la página: con 1 segundo de tope, y si la API tarda o está reiniciando, la portada sale sin precarga (vacío) en vez
    # de quedarse en blanco esperando.
    location = /api/hero-preload {
        proxy_pass http://127.0.0.1:$PUERTO_API/hero-preload;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_connect_timeout 1s;
        proxy_read_timeout 1s;
        proxy_intercept_errors on;      # un error de la API (500...) tampoco debe colarse dentro del HTML
        error_page 500 502 503 504 = @sin_precarga;
    }
    # Texto real de la portada para Google y los asistentes de IA (SSI dentro de <div id="root">, ver index.html). Mismo tope que
    # la precarga: si la API tarda, la portada sale igual, sin ese texto.
    location = /api/seo-home {
        proxy_pass http://127.0.0.1:$PUERTO_API/seo-home;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_connect_timeout 1s;
        proxy_read_timeout 1s;
        proxy_intercept_errors on;
        error_page 500 502 503 504 = @sin_precarga;
    }
    location @sin_precarga {
        default_type text/html;
        return 200 '';
    }

    # Si la API no responde (reinicio o despliegue de unos segundos), el navegador recibe un aviso corto y reintenta solo.
    error_page 502 503 504 = @api_reiniciando;
    location @api_reiniciando {
        default_type application/json;
        add_header Retry-After 2 always;
        add_header Cache-Control "no-store" always;
        return 503 '{"error":"El servicio se esta reiniciando. Intenta de nuevo en unos segundos."}';
    }

    # Mapa del sitio para Google (lo arma la API con las tiendas y productos visibles)
    location = /sitemap.xml {
        proxy_pass http://127.0.0.1:$PUERTO_API/sitemap.xml;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        include $RAIZ/cabeceras-seguridad.conf;
    }

    # Tiendas y productos: los bots (Google, Bing, WhatsApp, Facebook...) reciben una página con título, descripción, imagen,
    # datos estructurados y los enlaces de ESA tienda o producto; las personas reciben la aplicación.
    location /tienda/ {
        if (\$zeudin_es_bot) { rewrite ^/tienda/(.*)\$ /api/og/tienda/\$1 last; }
        try_files \$uri /index.html;
    }
    location /producto/ {
        if (\$zeudin_es_bot) { rewrite ^/producto/([^/]+)/([^/]+)/?\$ /api/og/producto/\$1/\$2 last; }
        try_files \$uri /index.html;
    }

    # Zonas privadas: se sirve la aplicación pero se pide a los buscadores que no las indexen. "caja" son las pantallas de la caja
    # (enlace secreto) y "correos" la baja de correos (enlace firmado): nunca deben aparecer en un buscador.
    location ~ ^/(admin|vendedor|socio|cuenta|carrito|carrito-compartido|checkout|mesa|vender|caja|correos)(/|\$) {
        add_header X-Robots-Tag "noindex, nofollow" always;
        add_header Cache-Control "no-cache";
        include $RAIZ/cabeceras-seguridad.conf;
        # Se sirve index.html desde aquí mismo (con break): si se usara try_files hacia /index.html, Nginx saltaría a otro
        # location y se perdería la cabecera X-Robots-Tag.
        try_files \$uri @spa_privado;
    }
    location @spa_privado {
        add_header X-Robots-Tag "noindex, nofollow" always;
        add_header Cache-Control "no-cache";
        include $RAIZ/cabeceras-seguridad.conf;
        rewrite ^ /index.html break;
    }

    # Archivos fijos de public/ (fuente y script del preloader, íconos, sonidos, imagen para compartir): casi nunca cambian,
    # así que se guardan 30 días en el navegador. Si alguno cambia, se renombra (como og-baznova-3.png).
    location ~* ^/(opentype\.min\.js|logo-loader\.js|fonts/|flags/|sounds/|mediapipe/|blaze_face|favicon|apple-touch-icon|og-baznova|email-logo|pwa/) {
        expires 30d;
        add_header Cache-Control "public";
        include $RAIZ/cabeceras-seguridad.conf;
        try_files \$uri =404;
    }

    # Archivos del build con hash en el nombre: caché de 1 año
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        include $RAIZ/cabeceras-seguridad.conf;
        try_files \$uri =404;
    }

    # SPA de React: cualquier ruta cae en index.html (sin caché, para ver siempre la última versión)
    location / {
        # SSI: la portada recibe la precarga de su primera imagen (ver /api/hero-preload e index.html).
        ssi on;
        ssi_silent_errors on;           # si falla una inclusión, no se escribe ningún aviso dentro de la página
        add_header Cache-Control "no-cache";
        include $RAIZ/cabeceras-seguridad.conf;
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

echo ">> Nginx: capacidad de conexiones (por si llega mucho tráfico a la vez)"
if grep -q "worker_connections 768;" /etc/nginx/nginx.conf; then
  sed -i 's/worker_connections 768;/worker_connections 4096;/' /etc/nginx/nginx.conf
fi
if ! grep -q "^worker_rlimit_nofile" /etc/nginx/nginx.conf; then
  sed -i '0,/^pid /s//worker_rlimit_nofile 16384;\npid /' /etc/nginx/nginx.conf
fi
nginx -t && systemctl reload nginx

echo ">> Vigilante: cada minuto comprueba la API y Nginx y los reinicia si no responden"
cat > /usr/local/bin/baznova-vigilante.sh <<VIGILANTE
#!/usr/bin/env bash
# Comprueba que la API responda. Tres fallos seguidos (3 minutos) reinician la API; Nginx se levanta si estuviera caído.
ESTADO=/run/baznova-vigilante.fallos
if ! systemctl is-active --quiet nginx; then
  logger -t baznova-vigilante "Nginx caído: reiniciando"
  systemctl restart nginx
fi
if curl -fsS -m 8 http://127.0.0.1:$PUERTO_API/health >/dev/null 2>&1; then
  rm -f "\$ESTADO"
  exit 0
fi
N=\$(( \$(cat "\$ESTADO" 2>/dev/null || echo 0) + 1 ))
echo "\$N" > "\$ESTADO"
logger -t baznova-vigilante "La API no respondió (\$N/3)"
if [ "\$N" -ge 3 ]; then
  logger -t baznova-vigilante "Reiniciando la API"
  sudo -u zeudin pm2 restart $PM2_NOMBRE >/dev/null 2>&1
  rm -f "\$ESTADO"
fi
VIGILANTE
chmod 755 /usr/local/bin/baznova-vigilante.sh
cat > /etc/systemd/system/baznova-vigilante.service <<'UNIT'
[Unit]
Description=Vigilante de la API de Baznova
[Service]
Type=oneshot
ExecStart=/usr/local/bin/baznova-vigilante.sh
UNIT
cat > /etc/systemd/system/baznova-vigilante.timer <<'UNIT'
[Unit]
Description=Vigilante de la API de Baznova (cada minuto)
[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=10s
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now baznova-vigilante.timer >/dev/null 2>&1 || true

echo ">> Respaldo: diario a las 3:00 a.m. (hora de La Habana), cifrado y fuera del servidor"
if [ -f /etc/systemd/system/zeudin-respaldo.timer ] && grep -q "OnCalendar=Sun" /etc/systemd/system/zeudin-respaldo.timer; then
  sed -i 's/^OnCalendar=.*/OnCalendar=*-*-* 03:00:00 America\/Havana/' /etc/systemd/system/zeudin-respaldo.timer
  sed -i 's/^Description=Respaldo semanal.*/Description=Respaldo diario ZeuDin (3:00 a.m.)/' /etc/systemd/system/zeudin-respaldo.timer
  systemctl daemon-reload
  systemctl restart zeudin-respaldo.timer
fi

echo ">> Firewall: los puertos 80 y 443 solo aceptan a Cloudflare (nadie puede saltarse su protección)"
if [ -f /etc/nginx/conf.d/cloudflare-ip-real.conf ]; then
  install -m 755 $APP/deploy/proyecto/08-solo-cloudflare.sh /usr/local/bin/baznova-solo-cloudflare.sh
  cat > /etc/systemd/system/baznova-solo-cloudflare.service <<'UNIT'
[Unit]
Description=Puertos 80 y 443 solo para Cloudflare (Baznova)
After=network-online.target netfilter-persistent.service
Wants=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/baznova-solo-cloudflare.sh
[Install]
WantedBy=multi-user.target
UNIT
  cat > /etc/systemd/system/baznova-solo-cloudflare-semanal.service <<'UNIT'
[Unit]
Description=Actualiza los rangos de Cloudflare del firewall (Baznova)
[Service]
Type=oneshot
ExecStart=/usr/local/bin/baznova-solo-cloudflare.sh
UNIT
  cat > /etc/systemd/system/baznova-solo-cloudflare-semanal.timer <<'UNIT'
[Unit]
Description=Actualiza los rangos de Cloudflare del firewall cada semana
[Timer]
OnCalendar=Mon *-*-* 04:20:00
Persistent=true
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable baznova-solo-cloudflare.service baznova-solo-cloudflare-semanal.timer >/dev/null 2>&1 || true
  systemctl start baznova-solo-cloudflare-semanal.timer
  systemctl restart baznova-solo-cloudflare.service || echo "AVISO: no se pudo aplicar la restricción a Cloudflare (los puertos siguen abiertos)"
fi

echo ">> Verificación"
sleep 4
curl -fsS http://127.0.0.1:$PUERTO_API/health && echo
curl -fsS -o /dev/null -w "Sitio: HTTP %{http_code}\n" -H "Host: $DOMINIO" http://127.0.0.1/
echo "Listo: $URL_PUBLICA"
