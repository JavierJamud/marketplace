import { createImageUpload } from "../lib/imageOptimizer.js";
import { REPORT_UPLOAD_DIR } from "../controllers/reports.controller.js";

// Capturas de pantalla adjuntas a un reporte de fraude (del denunciante) y
// la evidencia que sube el denunciado. Bloque 51: acá se optimiza con la
// mano MÁS suave de todo el proyecto (1800px, quality 90) a propósito — un
// admin tiene que poder leer texto chico dentro de una captura para decidir
// si confirma o descarta un fraude; ahorrar unos KB no vale arriesgar eso.
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export const reportUpload = createImageUpload({
  dir: REPORT_UPLOAD_DIR,
  allowedExt: ALLOWED_EXT,
  fileSize: 6 * 1024 * 1024,
  maxFiles: 4,
  maxWidth: 1800,
  quality: 90,
});
