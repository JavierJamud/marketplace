# Baznova Showcase

Animación del teléfono y la laptop (fondo transparente, sin textos fuera de los dispositivos).

## Uso en tu sitio

1. Copia la carpeta `baznova-showcase/` a tu proyecto (por ejemplo en `/public/baznova-showcase/`).
2. Sírvela por HTTP (tu sitio o cualquier servidor; no abre con doble clic en file://).
3. En la sección donde la quieras, agrega:

```html
<section class="hero-showcase">
  <iframe
    src="/baznova-showcase/index.html"
    title="Baznova en teléfono y laptop"
    loading="lazy"
    allowtransparency="true"
    style="width:100%;aspect-ratio:16/9;border:0;background:transparent;display:block"></iframe>
</section>
```

El iframe es transparente: el fondo que tenga tu sección se ve detrás de los dispositivos. Es responsivo: se escala al ancho del contenedor (relación 16:9). Se pausa cuando no está visible.

## Contenido

- `index.html`: página de la animación.
- `app/runtime.jsx`: motor de tiempo y easings (loop de 30.1 s).
- `app/showcase.jsx`: teléfono, laptop, web móvil y panel del vendedor.
- `vendor/`: React 18 y Babel, local (sin CDN).
- `assets/`: fotos de productos y sello de verificado.

Las fuentes Montserrat e Inter se cargan de Google Fonts; si no hay conexión usa la fuente del sistema.

## Ajustes

- Duración de cada escena: `window.BAZNOVA_SCENES` en `index.html`.
- Pausar: `<BaznovaShowcase paused />`.
