import { createImageUpload } from "../lib/imageOptimizer.js";
import { SITE_UPLOAD_DIR } from "../controllers/settings.controller.js";

// Imágenes del sitio subidas por el admin: hero de la Home, campañas,
// anuncios y ofertas dirigidas. Bloque 51: se guardan siempre como WebP
// optimizado (ver lib/imageOptimizer.js), sin importar el formato de origen.
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export const siteUpload = createImageUpload({
  dir: SITE_UPLOAD_DIR,
  allowedExt: ALLOWED_EXT,
  fileSize: 8 * 1024 * 1024,
  // El recuadro real del hero en Home.jsx es ~578×400 en escritorio y el
  // propio panel de admin recomienda subir 1200×800 — 1600 deja margen para
  // pantallas grandes sin guardar una foto de 4000px que nadie va a ver.
  maxWidth: 1600,
  quality: 82,
});
