# plataforma/nginx/

Nginx lee su configuración de `/etc/nginx` (eso no se puede mover), pero cada sitio es un enlace al `nginx.conf` que vive en la carpeta de su proyecto:

```
/etc/nginx/sites-enabled/<sitio>.conf -> sites-available/<sitio>.conf -> <proyecto>/nginx.conf
```

Piezas comunes (las crea `crear-estructura.sh`):
- `/etc/nginx/sites-available/00-default.conf`: sitio por defecto. Cierra la conexión si alguien entra por IP o por un dominio desconocido, y deja pasar solo la verificación de Let's Encrypt.
- `/etc/nginx/conf.d/00-zeudin-bots.conf`: detecta a WhatsApp, Facebook, Google, etc. para las vistas previas de links.
- `/etc/nginx/conf.d/cloudflare-ip-real.conf`: rangos de Cloudflare (lo mantiene `07-cloudflare-ip-real.sh`).

Para activar HTTPS en un dominio nuevo: `sudo certbot --nginx -d dominio.com -d www.dominio.com`.
