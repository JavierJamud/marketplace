# plataforma/: infraestructura común del servidor

Lo que sirve a todos los proyectos. Nada de un proyecto concreto vive acá.

| Carpeta | Para qué |
| --- | --- |
| `scripts/` | Preparar el servidor, crear proyectos nuevos, respaldos de todos los proyectos, IP real de Cloudflare. |
| `nginx/` | Notas y plantillas de Nginx. El sitio de cada proyecto está en su carpeta (`nginx.conf`). |
| `claves/` | Clave pública de cifrado de los respaldos (la privada nunca se guarda en el servidor). |
| `registro/` | `PROYECTOS.md`: tabla de proyectos, dominios, puertos, procesos PM2 y bases de datos. |
| `logs/` | Registros comunes (respaldos). |

## Convenciones

- **Nombres:** minúsculas, números y guiones. Clientes: `clientes/<cliente>/<proyecto>`.
- **Puertos de API:** uno por proyecto con backend, desde 4000 hacia arriba, sin repetir. El siguiente libre lo asigna `nuevo-proyecto.sh`; el registro está en `registro/PROYECTOS.md`.
- **PM2:** proceso `<proyecto>-api` (clientes: `<cliente>-<proyecto>-api`), definido en `ecosystem.config.cjs` de cada proyecto.
- **Base de datos:** una base y un usuario por proyecto. Organización: `<proyecto>` y `<proyecto>_app`. Clientes: `<cliente>_<proyecto>` y `<cliente>_<proyecto>_app` (guiones pasan a guion bajo).
- **Nginx:** un sitio por proyecto, `/etc/nginx/sites-available/<categoria>-<cliente->-<proyecto>.conf`, que es un enlace al `nginx.conf` de la carpeta del proyecto.
- **Secretos:** solo en `datos/secretos/` de cada proyecto (permiso 600), nunca en Git ni en `proyecto.env`.
- **Respaldos:** el temporizador `zeudin-respaldo` recorre todos los proyectos que tengan `proyecto.env` (domingo 3:00, hora de La Habana). Local en `<proyecto>/respaldos/` y en Cloudflare R2 en `<categoria>/<cliente>/<proyecto>/`.

## Comandos

```bash
sudo /opt/zeudin/plataforma/scripts/nuevo-proyecto.sh organizacion <proyecto>
sudo /opt/zeudin/plataforma/scripts/nuevo-proyecto.sh clientes <cliente> <proyecto>
sudo /opt/zeudin/plataforma/scripts/respaldo-todos.sh          # respaldo manual de todo
sudo systemctl list-timers zeudin-respaldo.timer
sudo -u zeudin pm2 status
```
