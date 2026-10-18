// Captura de lo que la persona ve en este momento (para los tickets de errores visuales). La librería se carga solo al usarla.
//
// La librería dibuja la página entera, no la ventana. Para que el resultado sea lo que había en pantalla:
//  1. Se anota dónde está ahora cada elemento fijo o pegajoso (barra de arriba, botones flotantes): dibujada la página
//     entera, sin scroll, quedarían arriba del todo y no donde la persona los veía.
//  2. En la copia que se dibuja, esos elementos se colocan en su lugar real dentro de la página.
//  3. Se recorta justo la ventana visible.
// Lo marcado con data-no-capture (el propio botón de reportar) no sale en la captura.

const MAX_PIXELS = 16_000_000; // tope de memoria del lienzo (página muy larga en una pantalla grande)

export async function captureViewport() {
  const { domToCanvas } = await import("modern-screenshot");
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const body = document.body;
  const pageW = Math.max(body.scrollWidth, vw);
  const pageH = Math.max(body.scrollHeight, vh);
  const scale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (pageW * pageH)));

  const pinned = new Map();
  let i = 0;
  for (const el of body.querySelectorAll("*")) {
    const pos = getComputedStyle(el).position;
    if (pos !== "fixed" && pos !== "sticky") continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const id = String(i++);
    el.setAttribute("data-capture-pin", id);
    pinned.set(id, { top: r.top + scrollY, left: r.left + scrollX, width: r.width, height: r.height });
  }

  try {
    const canvas = await domToCanvas(body, {
      width: pageW,
      height: pageH,
      scale,
      timeout: 8000,
      backgroundColor: getComputedStyle(body).backgroundColor || "#ffffff",
      // Sin esto la copia hereda el margen de 8 px del navegador y todo sale corrido.
      style: { margin: "0" },
      filter: (node) => !(node instanceof Element && node.hasAttribute("data-no-capture")),
      onCloneEachNode: (cloned) => {
        if (!(cloned instanceof Element)) return;
        // El desenfoque de fondo (efecto vidrio) no se puede dibujar en la copia y sale como un bloque borroso: se quita.
        if (cloned.style) {
          cloned.style.backdropFilter = "none";
          cloned.style.webkitBackdropFilter = "none";
        }
        const id = cloned.getAttribute("data-capture-pin");
        if (id == null) return;
        const p = pinned.get(id);
        if (!p) return;
        // En la página dibujada entera, "fixed" se mide desde arriba de la página (y no depende de los contenedores con
        // position relative, a diferencia de "absolute"): se pone en el sitio real donde la persona lo veía.
        Object.assign(cloned.style, { position: "fixed", top: `${p.top}px`, left: `${p.left}px`, width: `${p.width}px`, height: `${p.height}px`, right: "auto", bottom: "auto", margin: "0", transform: "none" });
      },
    });

    const out = document.createElement("canvas");
    out.width = Math.round(vw * scale);
    out.height = Math.round(vh * scale);
    out.getContext("2d").drawImage(canvas, Math.round(scrollX * scale), Math.round(scrollY * scale), out.width, out.height, 0, 0, out.width, out.height);
    const blob = await new Promise((resolve) => out.toBlob(resolve, "image/webp", 0.9));
    // Safari viejo no sabe WebP: devuelve null o un PNG; en ese caso, JPEG.
    if (blob && blob.type === "image/webp") return blob;
    return await new Promise((resolve) => out.toBlob(resolve, "image/jpeg", 0.9));
  } finally {
    for (const el of body.querySelectorAll("[data-capture-pin]")) el.removeAttribute("data-capture-pin");
  }
}
