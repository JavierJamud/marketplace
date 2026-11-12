import { Router } from "express";
import * as whatsappController from "../controllers/whatsapp.controller.js";
import { authenticate } from "../middleware/auth.js";
import { whatsappVerifyRateLimit } from "../middleware/rateLimit.js";

const router = Router();

// Confirmar por código que un número tiene WhatsApp (cuenta o tienda). El envío de códigos pide sesión iniciada:
// nadie de fuera puede hacer que la plataforma le escriba a un número cualquiera.
router.get("/availability", whatsappController.getAvailability);
router.get("/status", authenticate, whatsappController.getStatus);
router.post("/verify/start", authenticate, whatsappVerifyRateLimit, whatsappController.startVerification);
router.post("/verify/confirm", authenticate, whatsappVerifyRateLimit, whatsappController.confirmVerification);
router.post("/disable", authenticate, whatsappController.disableWhatsapp);

export default router;
