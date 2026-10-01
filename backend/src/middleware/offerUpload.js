import { createImageUpload } from "../lib/imageOptimizer.js";
import { OFFER_UPLOAD_DIR } from "../controllers/offers.controller.js";

// Imagen de una oferta (del admin o del propio vendedor). Se muestra en las
// tarjetas de OffersSlider (relación 12:5, nunca a pantalla completa), así
// que 1200px de ancho ya sobra para verse nítida.
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export const offerUpload = createImageUpload({
  dir: OFFER_UPLOAD_DIR,
  allowedExt: ALLOWED_EXT,
  fileSize: 6 * 1024 * 1024,
  maxWidth: 1200,
  quality: 82,
});
