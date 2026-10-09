# Despliegue de Baznova en el servidor de ZeuDin

Servidor: **Oracle Cloud**, `zeudin-server`, Ubuntu 26.04 ARM64, 2 OCPU / 12 GB, IP `147.224.137.53`.
Todo funciona igual en cualquier otro VPS con Ubuntu (Hostinger, Contabo...), ARM64 o x86.

El servidor aloja varios proyectos bajo la marca ZeuDin. La estructura completa y sus reglas están en
`/opt/zeudin/README.md` (fuente: `deploy/servidor/estructura/`). Baznova es el proyecto `organizacion/baznova`.

## Dónde está cada cosa

| Pieza | Dónde |
| --- | --- |
| Carpeta del proyecto | `/opt/zeudin/organizacion/baznova/` |
| Código desplegado | `.../baznova/app/` (la versión anterior en `app.prev/`) |
| Sitio publicado (React compilado) | `.../baznova/web/`, servido por Nginx |
| API (Express) | `.../baznova/app/backend`, puerto 4000 interno, publicada en `/api` |
| Proceso siempre encendido | PM2 `baznova-api` (servicio `pm2-zeudin`, arranca solo al reiniciar) |
| Base de datos | PostgreSQL local, base `baznova`, usuario `baznova_app` |
| Secretos | `.../baznova/datos/secretos/.env.production` (nunca en Git) |
| Archivos subidos | `.../baznova/datos/uploads/` (fuera del código: las actualizaciones no los tocan) |
| Respaldos | `.../baznova/respaldos/` + Cloudflare R2 (`organizacion/baznova/`) |
| Logs | `.../baznova/logs/` |
| Nginx | `.../baznova/nginx.conf` (enlazado desde `/etc/nginx/sites-enabled/organizacion-baznova.conf`) |
| Ficha del proyecto | `.../baznova/proyecto.env` |

## Qué hay en esta carpeta del repositorio

| Carpeta | Contenido |
| --- | --- |
| `servidor/` | Scripts de la plataforma (común a todos los proyectos): preparar servidor, crear estructura, nuevo proyecto, respaldos, IP real de Cloudflare, migración única. |
| `servidor/estructura/` | Documentos README que se instalan en cada carpeta del servidor. |
| `proyecto/` | Scripts propios de Baznova: instalar o actualizar, restaurar, dominio y SSL, código de emergencia. |

Los scripts de `servidor/` se instalan en `/opt/zeudin/plataforma/scripts/` con `crear-estructura.sh`.
Los de `proyecto/` quedan en `/opt/zeudin/organizacion/baznova/scripts/` después de cada despliegue.

## Actualizar el sitio con cambios nuevos

Desde la PC, en la carpeta del proyecto (PowerShell), con los cambios ya confirmados en Git:

```powershell
git archive --format=tar.gz -o zeudin-app.tar.gz HEAD
scp -i $HOME\.ssh\zeudin-oracle zeudin-app.tar.gz ubuntu@147.224.137.53:~
ssh -i $HOME\.ssh\zeudin-oracle ubuntu@147.224.137.53 "mkdir -p /tmp/zd && tar -xzf ~/zeudin-app.tar.gz -C /tmp/zd deploy && sudo bash /tmp/zd/deploy/proyecto/02-instalar-app.sh ~/zeudin-app.tar.gz; rm -rf /tmp/zd"
```

El script nunca borra la base de datos ni los archivos subidos. Antes de desplegar conviene un respaldo:
`sudo /opt/zeudin/plataforma/scripts/respaldo-todos.sh baznova`.

## Respaldos

- **Qué incluye cada respaldo:** base de datos, archivos subidos (incluye KYC), secretos, el código desplegado y la ficha del proyecto. Con un solo archivo se reconstruye todo.
- **Cifrado:** con `age`. El servidor solo tiene la clave pública (`plataforma/claves/`): puede cifrar, no descifrar.
  La **clave privada** está en la PC: `C:\Users\jjamu\.ssh\zeudin-clave-respaldo-PRIVADA.txt`.
  **Guárdala también en un gestor de contraseñas.** Sin ella, los respaldos no se pueden abrir.
- **Dónde:** 2 últimos en `respaldos/` de cada proyecto + 12 semanas en Cloudflare R2 (bucket `zeudin-backups`, carpeta `<categoria>/<cliente>/<proyecto>/`).
- **Cuándo:** cada domingo 3:00 a.m. (hora de La Habana), para todos los proyectos.
- **Capa extra en Oracle:** política `zeudin-semanal-4-copias` (disco completo, domingos, 4 copias, gratis). Solo sirve dentro de Oracle.
- Manual: `sudo /opt/zeudin/plataforma/scripts/respaldo-todos.sh [proyecto]`. Historial: `sudo tail -50 /opt/zeudin/plataforma/logs/respaldo.log`.

### Conectar Cloudflare R2 (una sola vez)

1. Cloudflare, R2: crear el bucket `zeudin-backups`.
2. R2, *Manage API tokens*: token con permiso **Object Read & Write** solo para ese bucket.
3. En el servidor:

```bash
sudo rclone config create r2 s3 provider=Cloudflare \
  access_key_id=TU_ACCESS_KEY secret_access_key=TU_SECRET \
  endpoint=https://TU_ACCOUNT_ID.r2.cloudflarestorage.com acl=private
sudo /opt/zeudin/plataforma/scripts/respaldo-todos.sh   # prueba: debe decir "Subido a R2"
```

## Dominio (Squarespace) + SSL

1. Crea una cuenta gratis en Cloudflare y agrega tu dominio.
2. En Squarespace, Domains, DNS, **Nameservers**: pon los 2 que te da Cloudflare.
3. En Cloudflare, DNS: registros `A` para `@` y `www` hacia `147.224.137.53`, con la nube en **gris (Solo DNS)**.
4. En el servidor: `sudo DOMINIO=midominio.com EMAIL=tu@correo.com bash /opt/zeudin/organizacion/baznova/scripts/06-dominio-ssl.sh`
5. Después pon la nube en **naranja** y en Cloudflare, SSL/TLS, el modo **Full (strict)**.
6. Webhook de Stripe (si lo usas): `https://midominio.com/api/stripe/webhook`.

## Si Oracle falla: mudarse a otro VPS

1. Contrata un VPS con Ubuntu 24.04+ y entra por SSH.
2. Sube esta carpeta `deploy/`, el último respaldo (de R2) y tu clave privada.
3. Ejecuta:
   ```bash
   sudo bash deploy/servidor/01-preparar-servidor.sh
   sudo bash deploy/proyecto/04-restaurar.sh baznova_FECHA.tar.zst.age clave-respaldo-PRIVADA.txt
   sudo DOMINIO=midominio.com EMAIL=tu@correo.com bash deploy/proyecto/06-dominio-ssl.sh
   sudo bash deploy/servidor/05-activar-respaldos.sh   # y vuelve a conectar R2
   ```
4. En Cloudflare, DNS: cambia la IP de `@` y `www` a la del VPS nuevo.
5. Borra la clave privada del servidor nuevo cuando termines.

## Agregar otro proyecto al servidor

```bash
sudo /opt/zeudin/plataforma/scripts/nuevo-proyecto.sh organizacion <proyecto>
sudo DOMINIO=empresa.com TIPO=fullstack /opt/zeudin/plataforma/scripts/nuevo-proyecto.sh clientes <cliente> <proyecto>
```

Crea la carpeta con su estructura, ficha, documentación, Nginx y registro. Convenciones en `/opt/zeudin/plataforma/README.md`.

## Comandos útiles

```bash
sudo -u zeudin pm2 status                 # estado de las APIs
sudo -u zeudin pm2 logs baznova-api       # ver errores en vivo
sudo -u zeudin pm2 restart baznova-api
sudo systemctl list-timers zeudin-respaldo.timer
cat /opt/zeudin/plataforma/registro/PROYECTOS.md
```
