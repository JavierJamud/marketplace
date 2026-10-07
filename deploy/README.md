# Despliegue de ZeuDin Marketplace en un VPS

Servidor actual: **Oracle Cloud**, `zeudin-server`, Ubuntu 26.04 ARM64, 2 OCPU / 12 GB, IP `147.224.137.53`.
Todo funciona igual en cualquier otro VPS con Ubuntu (Hostinger, Contabo…), ARM64 o x86.

## Cómo está montado

| Pieza | Dónde |
| --- | --- |
| Sitio (React compilado) | `/var/www/zeudin`, servido por Nginx |
| API (Express) | `/opt/zeudin/app/backend`, puerto 4000 interno, publicada en `/api` |
| Proceso siempre encendido | PM2 como servicio `pm2-zeudin` (arranca solo al reiniciar) |
| Base de datos | PostgreSQL local, base `zeudin`, rol `zeudin_app` |
| Secretos | `/opt/zeudin/data/.env.production` (nunca en Git) |
| Archivos subidos | `/opt/zeudin/data/uploads` (fuera del código: las actualizaciones no los tocan) |
| Respaldos | `/opt/zeudin/data/backups` + Cloudflare R2 |
| Logs | `/opt/zeudin/logs`, y `sudo -u zeudin pm2 logs` |

## Scripts

| Script | Para qué |
| --- | --- |
| `01-preparar-servidor.sh` | Servidor nuevo: actualizaciones, swap, firewall, fail2ban, Node 24, PM2, Nginx, PostgreSQL, Certbot |
| `02-instalar-app.sh` | Instalar **o actualizar** la app (no borra datos) |
| `03-respaldo.sh` | Respaldo cifrado completo (lo corre solo el temporizador) |
| `04-restaurar.sh` | Restaurar todo en un servidor nuevo desde un respaldo |
| `05-activar-respaldos.sh` | Activa el respaldo semanal (domingo 3:00 a.m., hora de La Habana) |
| `06-dominio-ssl.sh` | Conecta el dominio y activa HTTPS |

## Actualizar el sitio con cambios nuevos

Desde tu PC (PowerShell), en la carpeta del proyecto:

```powershell
git archive --format=tar.gz -o zeudin-app.tar.gz HEAD
scp -i $HOME\.ssh\zeudin-oracle zeudin-app.tar.gz ubuntu@147.224.137.53:~
ssh -i $HOME\.ssh\zeudin-oracle ubuntu@147.224.137.53 "sudo DOMINIO=midominio.com bash /opt/zeudin/deploy/02-instalar-app.sh ~/zeudin-app.tar.gz"
```

## Respaldos

- **Qué incluye cada respaldo:** base de datos, archivos subidos (incluye KYC), secretos (`.env.production`) y el código desplegado. Con un solo archivo se reconstruye todo.
- **Cifrado:** con `age`. El servidor solo tiene la clave pública (puede cifrar, no descifrar).
  La **clave privada** está en tu PC: `C:\Users\jjamu\.ssh\zeudin-clave-respaldo-PRIVADA.txt`.
  **Guárdala también en un gestor de contraseñas.** Sin ella, los respaldos no se pueden abrir.
- **Dónde:** 2 últimos en el servidor + 12 semanas en Cloudflare R2 (bucket `zeudin-backups`).
- **Capa extra en Oracle:** política `zeudin-semanal-4-copias` (disco completo, domingos, 4 copias, gratis). Solo sirve dentro de Oracle.
- Respaldo manual en cualquier momento: `sudo bash /opt/zeudin/deploy/03-respaldo.sh`
- Historial: `sudo tail -50 /opt/zeudin/logs/respaldo.log`

### Conectar Cloudflare R2 (una sola vez)

1. Cloudflare → R2 → crear bucket `zeudin-backups`.
2. R2 → *Manage API tokens* → token con permiso **Object Read & Write** solo para ese bucket.
3. En el servidor:

```bash
sudo rclone config create r2 s3 provider=Cloudflare \
  access_key_id=TU_ACCESS_KEY secret_access_key=TU_SECRET \
  endpoint=https://TU_ACCOUNT_ID.r2.cloudflarestorage.com acl=private
sudo bash /opt/zeudin/deploy/03-respaldo.sh   # prueba: debe decir "Subido a R2 ✔"
```

## Dominio (Squarespace) + SSL

1. Crea una cuenta gratis en Cloudflare y agrega tu dominio.
2. En Squarespace → Domains → tu dominio → DNS → **Nameservers**: pon los 2 que te da Cloudflare.
3. En Cloudflare → DNS: registros `A` para `@` y `www` → `147.224.137.53`, con la nube en **gris (Solo DNS)**.
4. En el servidor: `sudo DOMINIO=midominio.com EMAIL=tu@correo.com bash /opt/zeudin/deploy/06-dominio-ssl.sh`
5. Después pon la nube en **naranja** y en Cloudflare → SSL/TLS el modo **Full (strict)**.
6. Webhook de Stripe (si lo usas): `https://midominio.com/api/stripe/webhook`.

## Si Oracle falla: mudarse a otro VPS

1. Contrata un VPS con Ubuntu 24.04+ y entra por SSH.
2. Sube los scripts de esta carpeta, el último respaldo (de R2) y tu clave privada.
3. Ejecuta:
   ```bash
   sudo bash 01-preparar-servidor.sh
   sudo DOMINIO=midominio.com bash 04-restaurar.sh zeudin_FECHA.tar.zst.age clave-respaldo-PRIVADA.txt
   sudo DOMINIO=midominio.com EMAIL=tu@correo.com bash 06-dominio-ssl.sh
   sudo bash 05-activar-respaldos.sh   # y vuelve a conectar R2
   ```
4. En Cloudflare → DNS cambia la IP de `@` y `www` a la del VPS nuevo.
5. Borra la clave privada del servidor nuevo cuando termines.

## Comandos útiles

```bash
sudo -u zeudin pm2 status            # estado de la API
sudo -u zeudin pm2 logs zeudin-api   # ver errores en vivo
sudo -u zeudin pm2 restart zeudin-api
sudo systemctl list-timers zeudin-respaldo.timer
```
