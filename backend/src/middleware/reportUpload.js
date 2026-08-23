import multer from "multer";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { extname } from "node:path";
import { REPORT_UPLOAD_DIR } from "../controllers/reports.controller.js";

mkdirSync(REPORT_UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

// Feature B (pedido explícito): la captura de pantalla del fraude es
// OBLIGATORIA para poder crear un reporte — mismo criterio anti path-
// traversal que reviewImageUpload.js (nombre generado server-side, nunca el
// del cliente). Se reusa esta misma instancia para la evidencia que manda
// el reportado (createReport usa .single("screenshot"), submitEvidence usa
// .array("evidence", 4)) — de ahí el límite de 4 archivos acá, aunque
// .single() en la práctica solo deja pasar uno para ese campo.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, REPORT_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ALLOWED_EXT.has(ext) ? ext : ""}`);
  },
});

export const reportUpload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXT.has(ext));
  },
});
