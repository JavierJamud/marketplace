import multer from "multer";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { extname } from "node:path";
import { OFFER_UPLOAD_DIR } from "../controllers/offers.controller.js";

mkdirSync(OFFER_UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

// Bloque 51: ofertas CUSTOM — imagen propia subida desde el dispositivo
// (a diferencia de las PRODUCT, que reusan una imagen ya cargada del
// producto). Carpeta plana, mismo criterio que siteUpload.js: son assets
// públicos de marketing, no hay necesidad de organizarlos por tienda.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, OFFER_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ALLOWED_EXT.has(ext) ? ext : ""}`);
  },
});

export const offerUpload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXT.has(ext));
  },
});
