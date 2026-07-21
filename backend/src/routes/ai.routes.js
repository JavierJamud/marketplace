import { Router } from "express";
import * as aiController from "../controllers/ai.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { chatAudioUpload } from "../middleware/chatAudioUpload.js";
import { chatRateLimit } from "../middleware/rateLimit.js";

const router = Router();

router.post("/generate-description", authenticate, requireRole("VENDOR", "ADMIN"), aiController.generateProductOrStoreDescription);

// Bloque 32: transcripción de audio para ambos bots (tienda y general) — sin
// login, mismo rate limit que el chat en sí (evita abuso del endpoint pago
// de Groq sin necesitar cuenta).
router.post("/transcribe", chatRateLimit, chatAudioUpload.single("audio"), aiController.transcribeChatAudio);

export default router;
