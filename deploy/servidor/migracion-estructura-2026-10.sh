#!/usr/bin/env bash
# ZeuDin: migración ÚNICA del servidor actual a la estructura estándar (octubre 2026).
# Pasa Baznova de /opt/zeudin/{app,data,logs} y /var/www/zeudin a /opt/zeudin/organizacion/baznova/,
# renombra la base de datos y el proceso PM2, y deja la plataforma lista para más proyectos.
# Hace un respaldo antes de empezar. Si algo falla, el respaldo y /root/baznova-pre-migracion.dump permiten volver.
# Uso: sudo bash migracion-estructura-2026-10.sh
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
Z=/opt/zeudin
R=$Z/organizacion/baznova
[ -d $R/app ] && { echo "Ya está migrado ($R/app existe)."; exit 0; }
[ -d $Z/app ] || { echo "No encuentro $Z/app: nada que migrar."; exit 1; }
zp() { sudo -u zeudin -H pm2 "$@"; }

echo ">> 1. Respaldo previo"
bash $Z/deploy/03-respaldo.sh
sudo -u postgres pg_dump -Fc zeudin > /root/baznova-pre-migracion.dump
ls -la /root/baznova-pre-migracion.dump

echo ">> 2. Estructura común (plataforma, organizacion, clientes)"
bash "$DIR/crear-estructura.sh"

echo ">> 3. Parando la API"
zp delete zeudin-api || true
zp save --force >/dev/null || true

echo ">> 4. Moviendo Baznova a $R"
mkdir -p $R/{datos/secretos,datos/release,respaldos,logs,web,scripts}
mv $Z/app $R/app
[ -d $Z/app.old ] && mv $Z/app.old $R/app.prev
mv $Z/data/uploads $R/datos/uploads
mv $Z/data/.env.production $R/datos/secretos/.env.production
mv $Z/data/db_password $R/datos/secretos/db_password
[ -f $Z/data/release.tar.gz ] && mv $Z/data/release.tar.gz $R/datos/release/release.tar.gz
mv $Z/data/backups/* $R/respaldos/ 2>/dev/null || true
mv $Z/data/backup_public_key.txt $Z/plataforma/claves/backup_public_key.txt
DOMINIO=$(cat $Z/data/dominio 2>/dev/null || echo baznova.com)
mv $Z/logs/* $R/logs/ 2>/dev/null || true
cp -a /var/www/zeudin/. $R/web/

echo ">> 5. Enlaces del código (uploads y secretos)"
for A in $R/app $R/app.prev; do
  [ -d $A/backend ] || continue
  rm -rf $A/backend/uploads
  ln -sfn $R/datos/uploads $A/backend/uploads
  ln -sfn $R/datos/secretos/.env.production $A/backend/.env.production
  ln -sfn $R/datos/secretos/.env.production $A/backend/.env
done

echo ">> 6. Base de datos: zeudin -> baznova, zeudin_app -> baznova_app"
DB_PASS=$(cat $R/datos/secretos/db_password)
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'zeudin';
ALTER DATABASE zeudin RENAME TO baznova;
ALTER ROLE zeudin_app RENAME TO baznova_app;
ALTER ROLE baznova_app PASSWORD '$DB_PASS';
SQL
ENVF=$R/datos/secretos/.env.production
sed -i "s#//zeudin_app:#//baznova_app:#; s#/zeudin?#/baznova?#; s#^BACKUP_DIR=.*#BACKUP_DIR=$R/respaldos#" $ENVF
grep -c '^DATABASE_URL=.*baznova_app.*/baznova?' $ENVF

echo ">> 7. Ficha, documentos y registro de Baznova"
NOMBRE="Baznova Marketplace" TIPO=fullstack DOMINIO=$DOMINIO PUERTO_API=4000 PM2_NOMBRE=baznova-api \
  DB_NOMBRE=baznova DB_USUARIO=baznova_app EXISTENTE=1 bash $Z/plataforma/scripts/nuevo-proyecto.sh organizacion baznova

echo ">> 8. PM2 con el nombre y las rutas nuevas"
cat > $R/ecosystem.config.cjs <<ECO
module.exports = {
  apps: [{
    name: "baznova-api",
    cwd: "$R/app/backend",
    script: "src/server.js",
    exec_mode: "fork",          // UNA sola instancia: los crons no deben correr duplicados
    instances: 1,
    max_memory_restart: "1500M",
    env: { NODE_ENV: "production", TZ: "America/Havana" },
    out_file: "$R/logs/api.out.log",
    error_file: "$R/logs/api.err.log",
    time: true,
  }],
};
ECO
chown -R zeudin:zeudin $R
chown -R www-data:www-data $R/web
rm -f $Z/ecosystem.config.cjs
zp start $R/ecosystem.config.cjs
zp save

echo ">> 9. Nginx: el sitio vive en la carpeta del proyecto"
mv /etc/nginx/sites-available/zeudin $R/nginx.conf
sed -i "s#/var/www/zeudin#$R/web#g" $R/nginx.conf
chown zeudin:zeudin $R/nginx.conf
ln -sfn $R/nginx.conf /etc/nginx/sites-available/organizacion-baznova.conf
ln -sfn /etc/nginx/sites-available/organizacion-baznova.conf /etc/nginx/sites-enabled/organizacion-baznova.conf
rm -f /etc/nginx/sites-enabled/zeudin
nginx -t && systemctl reload nginx

echo ">> 10. Respaldos y tareas con las rutas nuevas"
bash "$DIR/05-activar-respaldos.sh"
bash "$DIR/07-cloudflare-ip-real.sh" || true
if rclone listremotes | grep -q '^r2:'; then
  echo "   respaldos viejos de R2 -> organizacion/baznova/"
  rclone move r2:zeudin-backups/ r2:zeudin-backups/organizacion/baznova/ --include 'zeudin_*.age' --max-depth 1 --s3-no-check-bucket || true
fi

echo ">> 11. Limpieza de restos"
rmdir $Z/data/backups $Z/data $Z/logs 2>/dev/null || true
rm -rf $Z/deploy /var/www/zeudin
rm -rf /home/ubuntu/deploy-tmp /home/ubuntu/0*.sh /home/ubuntu/paso*.log /home/ubuntu/prueba_respaldo.sh
chmod 751 $Z

echo ">> 12. Verificación"
sleep 5
curl -fsS http://127.0.0.1:4000/health && echo
curl -fsS -o /dev/null -w "Sitio: HTTP %{http_code}\n" -H "Host: $DOMINIO" http://127.0.0.1/
echo "Migración terminada."
