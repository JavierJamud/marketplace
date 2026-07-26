import multer from "multer";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { extname } from "node:path";
import { REVIEW_UPLOAD_DIR } from "../controllers/reviews.controller.js";

mkdirSync(REVIEW_UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

// Bloque 52: fotos reales del cliente en una reseña — solo archivos subidos
// (nunca un link, a diferencia de las imágenes de producto/oferta), hasta 4
// por reseña (ver createReview en reviews.controller.js).
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, REVIEW_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ALLOWED_EXT.has(ext) ? ext : ""}`);
  },
});

export const reviewImageUpload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXT.has(ext));
  },
});
