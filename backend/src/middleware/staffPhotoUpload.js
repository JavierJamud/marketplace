import multer from "multer";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { extname } from "node:path";
import { STAFF_PHOTO_UPLOAD_DIR } from "../controllers/vendorStaff.controller.js";

// Bloque 183 (pedido explícito — "al registrar ese nuevo usuario... el
// vendedor o administrador deberá tomar una foto de ese usuario
// registrado"): mismo criterio EXACTO que vendorBrandingUpload.js (logo de
// la tienda) — nombre de archivo aleatorio, nunca el original.
mkdirSync(STAFF_PHOTO_UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, STAFF_PHOTO_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ALLOWED_EXT.has(ext) ? ext : ""}`);
  },
});

export const staffPhotoUpload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXT.has(ext));
  },
});
