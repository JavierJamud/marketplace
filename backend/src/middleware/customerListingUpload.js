import { join } from "node:path";
import { createImageUpload } from "../lib/imageOptimizer.js";
import { CUSTOMER_LISTING_UPLOAD_DIR } from "../controllers/customerListings.controller.js";

// Fotos de una publicación de "venta rápida" (un cliente vendiendo algo
// puntual) — hasta 4. Carpeta propia por usuario, igual que las fotos de
// producto tienen una por tienda.
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".webp"]);

export const customerListingUpload = createImageUpload({
  dir: (req) => join(CUSTOMER_LISTING_UPLOAD_DIR, req.user.id),
  allowedExt: ALLOWED_EXT,
  fileSize: 5 * 1024 * 1024,
  // Mismas medidas que las fotos de producto: se muestran en el mismo tipo
  // de grilla y en una vista de detalle equivalente.
  maxWidth: 1400,
  thumbWidth: 500,
});
