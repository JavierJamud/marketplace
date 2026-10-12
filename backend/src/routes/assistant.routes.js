import { Router } from "express";
import { streamable } from "../lib/ndjsonStream.js";
import * as assistantController from "../controllers/assistant.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { assistantDocUpload } from "../middleware/assistantDocUpload.js";
import { chatRateLimit, orderStatusRateLimit } from "../middleware/rateLimit.js";

const router = Router();

// Bot general del marketplace (Home) — público, sin login; la autenticación
// (opcional) se resuelve adentro del controller solo para saber si hay
// sessionEmail propio con el que buscar pedidos (ver resolveOptionalUserId).
// Bloque 32: ya no recibe imagen (derogado) — la grabación de audio se
// transcribe aparte (POST /ai/transcribe) y llega acá como texto plano.
router.get("/chat", assistantController.getMarketplaceChatHistory);
router.get("/suggestions", assistantController.getChatSuggestions);
router.post("/order-status", orderStatusRateLimit, assistantController.postOrderStatus);
router.post("/chat", chatRateLimit, streamable(assistantController.postMarketplaceChatMessage));

// Admin: entrenar al bot general con documentación.
router.get("/documents", authenticate, requireRole("ADMIN"), assistantController.listAssistantDocuments);
router.post("/documents", authenticate, requireRole("ADMIN"), assistantDocUpload.single("document"), assistantController.uploadAssistantDocument);
router.delete("/documents/:id", authenticate, requireRole("ADMIN"), assistantController.deleteAssistantDocument);

// Admin: aprendizaje automático del bot general (preguntas sugeridas según lo que piden los clientes).
router.get("/learning", authenticate, requireRole("ADMIN"), assistantController.getLearning);
router.post("/learning/refresh", authenticate, requireRole("ADMIN"), assistantController.refreshLearning);
router.patch("/learning", authenticate, requireRole("ADMIN"), assistantController.updateLearning);

export default router;
