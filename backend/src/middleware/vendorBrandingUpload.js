import { createImageUpload } from "../lib/imageOptimizer.js";
import { VENDOR_BRANDING_DIR } from "../controllers/vendors.controller.js";

// Bloque 133: logo que un vendedor sube para SU propia tienda (distinto del
// logo de la plataforma, que desde el Bloque 46 ya no se sube: es un archivo
// fijo en assets). Se ve en el círculo del banner de la tienda y en las
// tarjetas de tienda — nunca grande, por eso 600px basta.
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export const vendorBrandingUpload = createImageUpload({
  dir: VENDOR_BRANDING_DIR,
  allowedExt: ALLOWED_EXT,
  fileSize: 8 * 1024 * 1024,
  maxWidth: 600,
  quality: 85,
});
