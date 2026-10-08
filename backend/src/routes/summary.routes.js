import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import * as summaryController from "../controllers/summary.controller.js";

const router = Router();

// Bloque 290: resumen semanal para el mensaje de bienvenida de los tres paneles.
router.get("/weekly", authenticate, summaryController.getWeeklySummary);

export default router;
