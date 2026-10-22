// Mientras una imagen carga (o si falla), el navegador escribe su texto alternativo en la esquina del contenedor: se veía el
// nombre de la foto por un instante. Aquí se marca cada <img> con data-img="ok" o "error" al terminar, y el CSS (index.css)
// muestra un fondo de carga mientras no tiene marca y un ícono neutro si falló. El texto alternativo se sigue leyendo con
// lector de pantalla; solo deja de pintarse.
// Los eventos load/error no suben por el DOM, pero sí se capturan en la fase de captura: un solo oyente cubre todo el sitio,
// incluidas las imágenes que se montan después.

function mark(e) {
  const el = e.target;
  if (el && el.tagName === "IMG") el.setAttribute("data-img", e.type === "load" ? "ok" : "error");
}

export function installImageStates() {
  if (typeof document === "undefined") return;
  document.addEventListener("load", mark, true);
  document.addEventListener("error", mark, true);
  // Imágenes que ya terminaron antes de instalar el oyente (las de index.html).
  const imgs = document.images;
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    if (img.complete) img.setAttribute("data-img", img.naturalWidth > 0 ? "ok" : "error");
  }
}
