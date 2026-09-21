import multer from "multer";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { extname } from "node:path";
import { KYC_UPLOAD_DIR } from "../controllers/verification.controller.js";

mkdirSync(KYC_UPLOAD_DIR, { recursive: true });

// Bloque 146: .webm/.mp4 sumados para el video corto de liveness (selfie
// girando la cabeza) — mismo middleware que ya sirve fotos/comprobantes,
// nunca hace falta uno aparte para esto.
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".pdf", ".webp", ".webm", ".mp4"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, KYC_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Nombre generado por el servidor (nunca el original del cliente) para
    // evitar path traversal y colisiones/adivinanza de rutas.
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ALLOWED_EXT.has(ext) ? ext : ""}`);
  },
});

export const kycUpload = multer({
  storage,
  // Bloque 146: subido de 8MB a 20MB — el video de liveness (unos segundos,
  // baja resolución) puede pesar más que una foto sola, aunque siga siendo
  // chico. Las fotos nunca se acercan a este límite de todas formas.
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXT.has(ext));
  },
});
