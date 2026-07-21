import multer from "multer";

// Bloque 32: audio corto que graba un cliente en cualquiera de los dos bots
// (reemplaza assistantChatImageUpload.js, derogado) — memoria, NUNCA disco:
// se transcribe con Whisper (ver lib/ai.js) y se descarta apenas termina el
// request. MediaRecorder produce mimetypes distintos según el navegador
// (Chrome/Firefox: audio/webm;codecs=opus, Safari: audio/mp4), así que se
// valida por prefijo en vez de una lista cerrada de strings exactos (a
// diferencia del filtro de imágenes, más estándar en solo 3 formatos).
export const chatAudioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("audio/")),
});
