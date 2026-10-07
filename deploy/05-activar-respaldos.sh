#!/usr/bin/env bash
# ZeuDin Marketplace — Activa el respaldo semanal automático (domingos 3:00 a.m., hora de La Habana).
# Uso: sudo bash 05-activar-respaldos.sh
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
DATA=/opt/zeudin/data
mkdir -p /opt/zeudin/deploy
cp "$DIR"/0*.sh /opt/zeudin/deploy/ && chmod 700 /opt/zeudin/deploy/*.sh

# Par de claves de cifrado: la PÚBLICA se queda en el servidor (solo sirve para cifrar);
# la PRIVADA (para descifrar) sale del servidor y se guarda en tu PC / gestor de contraseñas.
if [ ! -f $DATA/backup_public_key.txt ]; then
  age-keygen -o /root/clave-respaldo-PRIVADA.txt 2>/dev/null
  age-keygen -y /root/clave-respaldo-PRIVADA.txt > $DATA/backup_public_key.txt
  echo "Clave privada creada en /root/clave-respaldo-PRIVADA.txt — descárgala y bórrala del servidor."
fi

cat > /etc/systemd/system/zeudin-respaldo.service <<EOF
[Unit]
Description=Respaldo semanal ZeuDin Marketplace (cifrado, a Cloudflare R2)
After=postgresql.service network-online.target
[Service]
Type=oneshot
ExecStart=/opt/zeudin/deploy/03-respaldo.sh
StandardOutput=append:/opt/zeudin/logs/respaldo.log
StandardError=append:/opt/zeudin/logs/respaldo.log
EOF
cat > /etc/systemd/system/zeudin-respaldo.timer <<EOF
[Unit]
Description=Respaldo semanal ZeuDin (domingo 3:00 a.m.)
[Timer]
OnCalendar=Sun *-*-* 03:00:00 America/Havana
Persistent=true
RandomizedDelaySec=10m
[Install]
WantedBy=timers.target
EOF
mkdir -p /opt/zeudin/logs
systemctl daemon-reload
systemctl enable --now zeudin-respaldo.timer
systemctl list-timers zeudin-respaldo.timer --no-pager
