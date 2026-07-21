import multer from "multer";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { extname } from "node:path";
import { ASSISTANT_DOC_DIR } from "../controllers/assistant.controller.js";

mkdirSync(ASSISTANT_DOC_DIR, { recursive: true });

const ALLOWED_EXT = new Set([".pdf", ".txt"]);

// Bloque 30: documentos de entrenamiento del bot general — mismo criterio
// que vendorAiDocUpload.js (Bloque 21): nunca se sirve como archivo
// estático público, solo el backend los lee del disco para armar el
// contexto del asistente.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ASSISTANT_DOC_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ALLOWED_EXT.has(ext) ? ext : ""}`);
  },
});

export const assistantDocUpload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXT.has(ext));
  },
});
