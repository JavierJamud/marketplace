# datos/

Lo que debe sobrevivir a los despliegues.

| Carpeta | Qué lleva |
| --- | --- |
| `uploads/` | Fotos, logos, documentos y demás archivos que suben los usuarios. |
| `secretos/` | `.env.production` y contraseñas (permiso 600). Nunca van a Git. |
| `release/` | Copia del último paquete de código desplegado (va dentro de cada respaldo). |
