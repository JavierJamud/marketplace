#!/usr/bin/env bash
# ZeuDin: crea un proyecto nuevo con la estructura estándar.
#   sudo nuevo-proyecto.sh organizacion <proyecto>
#   sudo nuevo-proyecto.sh clientes <cliente> <proyecto>
# Opciones (variables de entorno):
#   TIPO=frontend|fullstack   (por defecto frontend: solo sitio estático; fullstack agrega API, PM2 y base de datos)
#   DOMINIO=midominio.com     (si se indica, crea y activa el sitio de Nginx; el HTTPS se pide aparte con certbot)
#   NOMBRE="Nombre visible"   EXISTENTE=1 (completa documentos y registro de un proyecto que ya existe)
set -euo pipefail
Z="${ZEUDIN_ROOT:-/opt/zeudin}"
PLAT=$Z/plataforma
E=$PLAT/scripts/estructura
[ "$(id -u)" = 0 ] || { echo "Usa sudo."; exit 1; }
CAT="${1:?Uso: nuevo-proyecto.sh organizacion <proyecto> | clientes <cliente> <proyecto>}"
case "$CAT" in
  organizacion) CLIENTE=""; PROYECTO="${2:?Falta el nombre del proyecto}"; RAIZ=$Z/organizacion/$PROYECTO; SITIO="organizacion-$PROYECTO"; PREFIJO="" ;;
  clientes) CLIENTE="${2:?Falta el nombre del cliente}"; PROYECTO="${3:?Falta el nombre del proyecto}"; RAIZ=$Z/clientes/$CLIENTE/$PROYECTO; SITIO="clientes-$CLIENTE-$PROYECTO"; PREFIJO="$CLIENTE-" ;;
  *) echo "La categoría es 'organizacion' o 'clientes'."; exit 1 ;;
esac
for n in "$PROYECTO" "$CLIENTE"; do
  [[ -z "$n" || "$n" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || { echo "Nombre inválido '$n': solo minúsculas, números y guiones."; exit 1; }
done
[ -d "$E" ] || { echo "Falta $E: corre primero crear-estructura.sh"; exit 1; }
if [ -e "$RAIZ/proyecto.env" ] && [ "${EXISTENTE:-0}" != 1 ]; then echo "Ya existe $RAIZ"; exit 1; fi

TIPO="${TIPO:-frontend}"
[[ "$TIPO" == frontend || "$TIPO" == fullstack ]] || { echo "TIPO es frontend o fullstack."; exit 1; }
SLUG="${PREFIJO}${PROYECTO}"; SLUG_DB="${SLUG//-/_}"
NOMBRE="${NOMBRE:-$SLUG}"
DOMINIO="${DOMINIO:-}"
PUERTO_API="${PUERTO_API:-}"; PM2_NOMBRE="${PM2_NOMBRE:-}"; DB_NOMBRE="${DB_NOMBRE:-}"; DB_USUARIO="${DB_USUARIO:-}"
if [ "$TIPO" = fullstack ]; then
  if [ -z "$PUERTO_API" ]; then
    ULTIMO=$(cat $Z/organizacion/*/proyecto.env $Z/clientes/*/*/proyecto.env 2>/dev/null | sed -n 's/^PUERTO_API=\([0-9]\+\).*/\1/p' | sort -n | tail -1 || true)
    PUERTO_API=$(( ${ULTIMO:-3999} + 1 ))
  fi
  PM2_NOMBRE="${PM2_NOMBRE:-$SLUG-api}"; DB_NOMBRE="${DB_NOMBRE:-$SLUG_DB}"; DB_USUARIO="${DB_USUARIO:-${SLUG_DB}_app}"
fi

echo ">> Carpetas de $RAIZ"
mkdir -p $RAIZ/{app,web,datos/uploads,datos/secretos,datos/release,respaldos,logs,scripts}
if [ ! -e $RAIZ/proyecto.env ]; then
  cat > $RAIZ/proyecto.env <<ENV
# Ficha técnica del proyecto (sin secretos; los secretos van en datos/secretos/).
PROYECTO=$PROYECTO
CATEGORIA=$CAT
CLIENTE=$CLIENTE
NOMBRE="$NOMBRE"
TIPO=$TIPO
DOMINIO=$DOMINIO
PUERTO_API=$PUERTO_API
PM2_NOMBRE=$PM2_NOMBRE
DB_NOMBRE=$DB_NOMBRE
DB_USUARIO=$DB_USUARIO
ENV
fi
dash() { [ -n "$1" ] && echo "$1" || echo "(sin asignar)"; }
if [ ! -e $RAIZ/README.md ]; then
  sed -e "s#@NOMBRE@#$NOMBRE#g; s#@RAIZ@#$RAIZ#g; s#@CATEGORIA_TXT@#$CAT${CLIENTE:+ / $CLIENTE}#; s#@TIPO@#$TIPO#" \
      -e "s#@DOMINIO_TXT@#$(dash "$DOMINIO")#; s#@PUERTO_TXT@#$(dash "$PUERTO_API")#; s#@PM2_TXT@#$(dash "$PM2_NOMBRE")#; s#@DB_TXT@#$(dash "$DB_NOMBRE")#" \
      $E/proyecto/README.md.plantilla > $RAIZ/README.md
fi
[ -z "$(ls -A $RAIZ/app)" ] && install -m 644 $E/proyecto/README.app.md $RAIZ/app/README.md   # si ya hay código, su propio README manda
install -m 644 $E/proyecto/README.web.md $RAIZ/web/README.md
install -m 644 $E/proyecto/README.datos.md $RAIZ/datos/README.md
install -m 644 $E/proyecto/README.respaldos.md $RAIZ/respaldos/README.md
install -m 644 $E/proyecto/README.logs.md $RAIZ/logs/README.md
install -m 644 $E/proyecto/README.scripts.md $RAIZ/scripts/README.md
[ -e $RAIZ/web/index.html ] || [ -n "$(ls -A $RAIZ/web | grep -v '^README.md$' || true)" ] || \
  echo "<!doctype html><meta charset=utf-8><title>$NOMBRE</title><p>$NOMBRE: sitio en construcción.</p>" > $RAIZ/web/index.html

if [ -n "$DOMINIO" ] && [ ! -e $RAIZ/nginx.conf ] && [ "${EXISTENTE:-0}" != 1 ]; then
  echo ">> Nginx para $DOMINIO"
  API_BLOCK=""
  if [ "$TIPO" = fullstack ]; then
    API_BLOCK="
    location /api/ {
        proxy_pass http://127.0.0.1:$PUERTO_API/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
"
  fi
  cat > $RAIZ/nginx.conf <<NGX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMINIO www.$DOMINIO;
    root $RAIZ/web;
    index index.html;
    client_max_body_size 60m;
    server_tokens off;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml text/plain;
    add_header X-Content-Type-Options nosniff always;
$API_BLOCK
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGX
  ln -sfn $RAIZ/nginx.conf /etc/nginx/sites-available/$SITIO.conf
  ln -sfn /etc/nginx/sites-available/$SITIO.conf /etc/nginx/sites-enabled/$SITIO.conf
  nginx -t && systemctl reload nginx
fi

# Permisos: el sitio lo lee Nginx (www-data); lo demás es de zeudin y lo sensible queda cerrado.
chown -R zeudin:zeudin $RAIZ
chown -R www-data:www-data $RAIZ/web
chmod 751 $RAIZ; [ -n "$CLIENTE" ] && chmod 751 $Z/clientes/$CLIENTE
chmod 750 $RAIZ/datos $RAIZ/respaldos; chmod 700 $RAIZ/datos/secretos

FILA="| $PROYECTO | $CAT | ${CLIENTE:--} | ${DOMINIO:--} | ${PUERTO_API:--} | ${PM2_NOMBRE:--} | ${DB_NOMBRE:--} | ${RAIZ#$Z/} |"
grep -qF "| ${RAIZ#$Z/} |" $PLAT/registro/PROYECTOS.md || echo "$FILA" >> $PLAT/registro/PROYECTOS.md
chown zeudin:zeudin $PLAT/registro/PROYECTOS.md

echo "Proyecto listo: $RAIZ"
[ "${EXISTENTE:-0}" = 1 ] && exit 0
echo "Siguientes pasos:"
echo "  1. Sube el código del proyecto a $RAIZ/app (o el sitio compilado a $RAIZ/web) y documenta el despliegue en $RAIZ/README.md"
[ "$TIPO" = fullstack ] && echo "  2. Backend: ecosystem.config.cjs con nombre $PM2_NOMBRE, puerto $PUERTO_API, logs en $RAIZ/logs; base de datos $DB_NOMBRE con usuario $DB_USUARIO"
[ -n "$DOMINIO" ] && echo "  3. HTTPS: sudo certbot --nginx -d $DOMINIO -d www.$DOMINIO"
exit 0
