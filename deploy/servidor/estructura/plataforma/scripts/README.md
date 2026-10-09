# plataforma/scripts/

Se instalan desde el repositorio (`deploy/servidor/` del proyecto Baznova) con `crear-estructura.sh`; no se editan a mano en el servidor.

| Script | Para qué |
| --- | --- |
| `01-preparar-servidor.sh` | Servidor nuevo: actualizaciones, swap, firewall, fail2ban, Node, PM2, Nginx, PostgreSQL, Certbot y esta estructura. |
| `crear-estructura.sh` | Crea o repara las carpetas, la documentación y el sitio por defecto de Nginx. Se puede repetir sin riesgo. |
| `nuevo-proyecto.sh` | Crea un proyecto nuevo (organización o cliente) con su estructura, ficha, Nginx y registro. |
| `respaldo-todos.sh` | Respaldo cifrado de cada proyecto, local y en Cloudflare R2. |
| `05-activar-respaldos.sh` | Activa el temporizador semanal de respaldos. |
| `07-cloudflare-ip-real.sh` | Restaura la IP real del visitante detrás de Cloudflare. |
