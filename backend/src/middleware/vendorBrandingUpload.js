import multer from "multer";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { extname } from "node:path";
import { VENDOR_BRANDING_DIR } from "../controllers/vendors.controller.js";

// Bloque 133: logo/portada que un vendedor sube para SU propia tienda —
// mismo criterio EXACTO que siteUpload.js (logo de la plataforma, subido
// por el admin): misma lista de extensiones, mismo límite de tamaño, mismo
// nombre de archivo aleatorio (nunca el nombre original del visitante).
mkdirSync(VENDOR_BRANDING_DIR, { recursive: true });

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, VENDOR_BRANDING_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ALLOWED_EXT.has(ext) ? ext : ""}`);
  },
});

export const vendorBrandingUpload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXT.has(ext));
  },
});
