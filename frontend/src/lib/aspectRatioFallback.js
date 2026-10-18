// El sitio se compila también para navegadores viejos (Safari 12, Chrome 70: ver build.target en vite.config.js), muy comunes
// en teléfonos usados en Cuba. Esos navegadores no entienden `aspect-ratio`, así que las cajas `aspect-[4/3]`, `aspect-square`,
// etc. quedan sin alto: la cámara de verificación muestra el video a su tamaño real (1280 px o más) y saca el formulario de la
// pantalla, y las fotos de tarjetas quedan aplastadas. Aquí, solo en esos navegadores, se calcula el alto a partir del ancho.
// En los navegadores actuales no hace nada.

const NAMED = { square: 1, video: 16 / 9 };

function ratioOf(el) {
  const m = /(?:^|\s)aspect-(?:\[(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\]|(square|video))(?:\s|$)/.exec(el.getAttribute("class") || "");
  if (!m) return null;
  return m[3] ? NAMED[m[3]] : Number(m[1]) / Number(m[2]);
}

// Con un alto fijo propio (h-12, h-full...) el navegador moderno ignora aspect-ratio; aquí también.
const HAS_HEIGHT = /(?:^|\s)(?:[a-z]+:)?h-/;

function apply(root) {
  const nodes = root.querySelectorAll ? root.querySelectorAll('[class*="aspect-"]') : [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const ratio = ratioOf(el);
    if (!ratio || HAS_HEIGHT.test(el.getAttribute("class"))) continue;
    const w = el.getBoundingClientRect().width;
    if (w > 0) el.style.height = `${Math.round(w / ratio)}px`;
  }
}

export function installAspectRatioFallback() {
  if (typeof window === "undefined" || !window.CSS || !CSS.supports) return;
  if (CSS.supports("aspect-ratio", "1 / 1")) return;
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      apply(document);
    });
  };
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  schedule();
}
