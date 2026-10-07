#!/usr/bin/env bash
# ZeuDin Marketplace — Paso 1: preparar un servidor Ubuntu nuevo (ARM64 o x86).
# Sirve para Oracle o para cualquier otro VPS. Ejecutar como: sudo bash 01-preparar-servidor.sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo ">> Zona horaria (America/Havana: la misma que usan los crons del proyecto)"
timedatectl set-timezone America/Havana || true

echo ">> Actualizando el sistema"
apt-get update -y
apt-get -o Dpkg::Options::="--force-confold" upgrade -y

echo ">> Paquetes base"
apt-get install -y curl git ufw fail2ban unattended-upgrades ca-certificates gnupg \
  nginx postgresql postgresql-contrib certbot python3-certbot-nginx rclone age zstd jq

echo ">> Memoria swap de 4 GB (colchón si la RAM se llena)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf && sysctl -p /etc/sysctl.d/99-swap.conf
fi

echo ">> Actualizaciones de seguridad automáticas"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo ">> fail2ban (bloquea intentos de entrar por SSH a la fuerza)"
systemctl enable --now fail2ban

echo ">> Firewall: solo SSH (22), HTTP (80) y HTTPS (443)"
# Las imágenes de Oracle traen reglas iptables que bloquean todo menos el 22.
if [ -f /etc/iptables/rules.v4 ]; then
  for p in 80 443; do
    iptables -C INPUT -m state --state NEW -p tcp --dport $p -j ACCEPT 2>/dev/null || \
      iptables -I INPUT 5 -m state --state NEW -p tcp --dport $p -j ACCEPT
  done
  iptables-save > /etc/iptables/rules.v4
  command -v netfilter-persistent >/dev/null || apt-get install -y iptables-persistent
  netfilter-persistent save || true
else
  ufw allow OpenSSH; ufw allow 80/tcp; ufw allow 443/tcp; ufw --force enable
fi

echo ">> Node.js 24 LTS + PM2"
if ! command -v node >/dev/null || ! node -v | grep -q '^v24'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2@latest

echo ">> Listo. Versiones:"
node -v; npm -v; pm2 -v; nginx -v 2>&1; psql --version; certbot --version; rclone version | head -1
