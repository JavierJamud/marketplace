import multer from "multer";
import crypto from "node:crypto";
import { TEMP_VIDEO_DIR, TEMP_VIDEO_MAX_BYTES } from "../controllers/tempVideo.controller.js";

// Video que el admin sube para comprimir. El nombre lo pone el servidor (nunca el del archivo original) y la extensión
// .src marca que es el original pendiente: se borra apenas termina la compresión.
export const tempVideoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TEMP_VIDEO_DIR),
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.src`),
  }),
  limits: { fileSize: TEMP_VIDEO_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(file.originalname)),
}).single("video");
