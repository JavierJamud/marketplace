import multer from "multer";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { extname } from "node:path";
import { VENDOR_AI_DOC_DIR } from "../controllers/vendors.controller.js";

mkdirSync(VENDOR_AI_DOC_DIR, { recursive: true });

const ALLOWED_EXT = new Set([".pdf", ".txt"]);

// Documento privado del negocio (Bloque 21) — mismo criterio que
// kycUpload.js: nunca se sirve como archivo estático público (no hay
// app.use("/uploads/vendor-ai-docs", ...) en app.js), solo el backend lo lee
// del disco para armar el contexto del chatbot.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, VENDOR_AI_DOC_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ALLOWED_EXT.has(ext) ? ext : ""}`);
  },
});

export const vendorAiDocUpload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXT.has(ext));
  },
});
