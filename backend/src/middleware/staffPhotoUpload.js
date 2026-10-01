import { createImageUpload } from "../lib/imageOptimizer.js";
import { STAFF_PHOTO_UPLOAD_DIR } from "../controllers/vendorStaff.controller.js";

// Foto del personal de una tienda. Nunca se ve más grande que un avatar
// (lista de usuarios del vendedor, perfil propio), así que 500px alcanza de
// sobra incluso en retina — y con quality alto porque es una cara.
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export const staffPhotoUpload = createImageUpload({
  dir: STAFF_PHOTO_UPLOAD_DIR,
  allowedExt: ALLOWED_EXT,
  fileSize: 8 * 1024 * 1024,
  maxWidth: 500,
  quality: 85,
});
