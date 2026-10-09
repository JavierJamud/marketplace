# ZeuDin Group LLC: servidor de alojamiento

Esta carpeta (`/opt/zeudin`) es la raíz de todo lo que corre en este servidor.
Todo está bajo la marca ZeuDin y dividido en tres zonas. Si no sabes dónde va algo, lee esta página.

| Carpeta | Qué contiene |
| --- | --- |
| `plataforma/` | La infraestructura común del servidor: scripts, documentación, claves públicas de respaldo, registro de proyectos y puertos. |
| `organizacion/` | Los proyectos propios de ZeuDin (Baznova y los que vengan). |
| `clientes/` | Los proyectos de clientes y empresas externas, una carpeta por cliente. |

Las carpetas ocultas (`.pm2`, `.npm`, `.cache`) son del usuario de sistema `zeudin` y las usa PM2 y npm. No se tocan a mano.

## Regla de oro

Un proyecto vive entero dentro de su propia carpeta: código, sitio publicado, archivos subidos, secretos,
respaldos, logs, configuración de Nginx y de PM2. Nada de un proyecto se guarda fuera de su carpeta
(las únicas excepciones son la base de datos en PostgreSQL y los certificados SSL en `/etc/letsencrypt`).

## Estructura de un proyecto

```
<categoria>/<proyecto>/            (clientes/<cliente>/<proyecto>/ para clientes)
  README.md          qué es el proyecto y cómo se despliega
  proyecto.env       ficha: nombre, dominio, puerto, proceso PM2, base de datos (sin secretos)
  nginx.conf         sitio de Nginx de este proyecto (enlazado desde /etc/nginx)
  ecosystem.config.cjs   proceso de PM2 (solo si tiene backend)
  app/               código desplegado (backend/ y frontend/)
  app.prev/          versión anterior, para volver atrás
  web/               sitio publicado (lo que sirve Nginx)
  datos/             uploads/, secretos/ y release/
  respaldos/         respaldos cifrados locales
  logs/              registros del proyecto
  scripts/           scripts propios del proyecto
```

## Cómo agregar un proyecto nuevo

```bash
sudo /opt/zeudin/plataforma/scripts/nuevo-proyecto.sh organizacion mi-proyecto
sudo DOMINIO=empresa.com TIPO=fullstack /opt/zeudin/plataforma/scripts/nuevo-proyecto.sh clientes empresa web
```

Detalles en `plataforma/README.md`.
