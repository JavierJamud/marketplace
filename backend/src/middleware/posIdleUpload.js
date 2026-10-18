import { createImageUpload } from "../lib/imageOptimizer.js";
import { VENDOR_BRANDING_DIR } from "../controllers/vendors.controller.js";

// Imagen de reposo de la pantalla del cliente en la caja (se ve a pantalla completa en una tablet o monitor): más grande que
// un logo, por eso 1600 px.
export const posIdleUpload = createImageUpload({
  dir: VENDOR_BRANDING_DIR,
  allowedExt: new Set([".jpg", ".jpeg", ".png", ".webp"]),
  fileSize: 8 * 1024 * 1024,
  maxWidth: 1600,
  quality: 82,
});
