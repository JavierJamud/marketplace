import { Router } from "express";
import * as contactController from "../controllers/contact.controller.js";
import { contactRateLimit } from "../middleware/rateLimit.js";

const router = Router();

// Público — formulario de /contacto, sin login.
router.post("/", contactRateLimit, contactController.sendContactMessage);

export default router;
