// Mientras una imagen carga (o si falla), el navegador escribe su texto alternativo en la esquina del contenedor: se veía el
// nombre de la foto por un instante. Aquí se marca cada <img> con data-img al terminar y el CSS (index.css) la pinta según la
// marca: sin marca o "wait", el fondo de carga con brillo; "ok", la foto; "error", un ícono neutro. El texto alternativo se
// sigue leyendo con lector de pantalla; solo deja de pintarse.
// Los eventos load/error no suben por el DOM, pero sí se capturan en la fase de captura: un solo oyente cubre todo el sitio,
// incluidas las imágenes que se montan después.
//
// Sin conexión (o con una conexión tan mala que la foto no llega), una foto que falla no es una foto que no existe: se queda
// en "wait" con la animación de carga y se vuelve a pedir sola cuando vuelve la conexión. Solo pasa a "error" si el servidor
// responde que la foto no existe o si sigue fallando con conexión después de varios intentos. Al pasar a "error" se repite el
// evento error sobre la imagen para que el componente haga lo suyo (la tarjeta prueba la foto grande, el logo pone la inicial);
// mientras está en "wait", los componentes no deben hacer nada (ver isWaitingImage).

const RETRY_DELAYS = [2000, 4000, 8000, 15000, 30000, 30000];
const attempts = new WeakMap();
const finishing = new WeakSet();
const waiting = new Set();

export function isWaitingImage(img) {
  return img?.getAttribute("data-img") === "wait";
}

function finish(img) {
  attempts.delete(img);
  finishing.add(img);
  img.dispatchEvent(new Event("error"));
}

function retry(img, src) {
  waiting.delete(img);
  // La imagen ya no está en la página o el componente le puso otra foto: nada que hacer.
  if (!img.isConnected || img.getAttribute("src") !== src) return;
  img.removeAttribute("data-img");
  img.setAttribute("src", src);
}

function onFail(img) {
  const src = img.getAttribute("src");
  // Imágenes hechas en el navegador (vista previa de una foto elegida): no hay red de por medio.
  if (!src || /^(data|blob):/.test(src)) {
    img.setAttribute("data-img", "error");
    return;
  }
  img.setAttribute("data-img", "wait");
  if (!navigator.onLine) {
    waiting.add(img);
    return;
  }
  const n = attempts.get(img) ?? 0;
  if (n >= RETRY_DELAYS.length) return finish(img);
  attempts.set(img, n + 1);
  // Con conexión: se pregunta al servidor si la foto existe. Si responde que no, no tiene sentido seguir esperando. Si la
  // pregunta tampoco llega, la conexión es mala y se vuelve a intentar más tarde.
  fetch(img.currentSrc || img.src, { method: "HEAD", cache: "no-store" })
    .then((res) => (res.status === 404 || res.status === 410 ? "missing" : "retry"))
    .catch(() => "retry")
    .then((result) => {
      if (img.getAttribute("src") !== src) return;
      if (result === "missing") return finish(img);
      setTimeout(() => (navigator.onLine ? retry(img, src) : waiting.add(img)), RETRY_DELAYS[n]);
    });
}

function mark(e) {
  const img = e.target;
  if (!img || img.tagName !== "IMG") return;
  if (e.type === "load") {
    attempts.delete(img);
    img.setAttribute("data-img", "ok");
  } else if (finishing.has(img)) {
    finishing.delete(img);
    img.setAttribute("data-img", "error");
  } else {
    onFail(img);
  }
}

export function installImageStates() {
  if (typeof document === "undefined") return;
  document.addEventListener("load", mark, true);
  document.addEventListener("error", mark, true);
  // Al volver la conexión, todas las fotos que esperaban se piden otra vez.
  window.addEventListener("online", () => {
    for (const img of [...waiting]) retry(img, img.getAttribute("src"));
  });
  // Imágenes que ya terminaron antes de instalar el oyente (las de index.html).
  const imgs = document.images;
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    if (img.complete) img.setAttribute("data-img", img.naturalWidth > 0 ? "ok" : "error");
  }
}
