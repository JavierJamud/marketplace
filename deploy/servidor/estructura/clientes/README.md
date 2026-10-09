# clientes/: proyectos de clientes y empresas

Una carpeta por cliente, y dentro una carpeta por cada proyecto de ese cliente:

```
clientes/
  empresa-ejemplo/
    web/            proyecto "web" de esa empresa (estructura estándar)
    tienda/         otro proyecto de la misma empresa
```

Para agregar un cliente nuevo: `sudo DOMINIO=empresa.com TIPO=fullstack /opt/zeudin/plataforma/scripts/nuevo-proyecto.sh clientes empresa-ejemplo web`.
`TIPO` es `frontend` (solo sitio estático) o `fullstack` (sitio más API con PM2 y base de datos).

Los nombres van en minúsculas, números y guiones. `_plantilla/` muestra la estructura vacía y no se despliega.
