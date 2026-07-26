import multer from "multer";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { extname } from "node:path";
import { STORE_OFFER_UPLOAD_DIR } from "../controllers/storeOffers.controller.js";

mkdirSync(STORE_OFFER_UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

// Bloque 52: imagen de una oferta de tienda — mismo patrón que offerUpload.js
// (Bloque 51), carpeta propia.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, STORE_OFFER_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ALLOWED_EXT.has(ext) ? ext : ""}`);
  },
});

export const storeOfferUpload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXT.has(ext));
  },
});
