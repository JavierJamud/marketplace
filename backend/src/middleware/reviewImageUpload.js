import { createImageUpload } from "../lib/imageOptimizer.js";
import { REVIEW_UPLOAD_DIR } from "../controllers/reviews.controller.js";

// Fotos que un cliente adjunta a su reseña — hasta 4 por reseña.
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export const reviewImageUpload = createImageUpload({
  dir: REVIEW_UPLOAD_DIR,
  allowedExt: ALLOWED_EXT,
  fileSize: 6 * 1024 * 1024,
  maxFiles: 4,
  maxWidth: 1200,
});
