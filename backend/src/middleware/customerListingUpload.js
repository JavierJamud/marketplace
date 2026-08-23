import multer from "multer";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { CUSTOMER_LISTING_UPLOAD_DIR } from "../controllers/customerListings.controller.js";

mkdirSync(CUSTOMER_LISTING_UPLOAD_DIR, { recursive: true });

// Mismo criterio que productUpload.js: solo JPG/WebP, nombre generado por el
// servidor (anti path-traversal), carpeta por dueño (req.user.id, resuelto
// por `authenticate` — no depende de resolveListingForUpload para esto).
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".webp"]);

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = join(CUSTOMER_LISTING_UPLOAD_DIR, req.user.id);
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ALLOWED_EXT.has(ext) ? ext : ""}`);
  },
});

export const customerListingUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXT.has(ext));
  },
});
