#!/usr/bin/env bash
# Endurecimiento basico del servidor. Se puede repetir sin problema. Ejecutar como root:  sudo bash 08-endurecer-servidor.sh [--reiniciar]
#  - Cierra rpcbind (puerto 111): no se usa en este servidor.
#  - SSH: mantiene vivas las sesiones, limita intentos y acorta la espera de las conexiones que no inician sesion.
#  - Instala las actualizaciones pendientes. Con --reiniciar reinicia el servidor al final si hace falta (PM2, Nginx,
#    PostgreSQL y fail2ban arrancan solos).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta con sudo."; exit 1; }

echo ">> Cerrando rpcbind"
systemctl disable --now rpcbind.service rpcbind.socket 2>/dev/null || true

echo ">> SSH"
cat > /etc/ssh/sshd_config.d/99-zeudin.conf <<'CFG'
ClientAliveInterval 60
ClientAliveCountMax 3
MaxAuthTries 3
LoginGraceTime 30
CFG
sshd -t && { systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true; }

echo ">> Actualizaciones"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get -y -qq -o Dpkg::Options::=--force-confold upgrade

if [ -f /var/run/reboot-required ]; then
  echo ">> Hace falta reiniciar el servidor (kernel nuevo)."
  if [ "${1:-}" = "--reiniciar" ]; then
    echo ">> Reiniciando en 5 segundos..."
    sleep 5
    systemctl reboot
  fi
else
  echo ">> No hace falta reiniciar."
fi
