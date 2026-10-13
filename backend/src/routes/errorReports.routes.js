import { Router } from "express";
import { optionalAuth } from "../middleware/auth.js";
import { errorReportRateLimit } from "../middleware/rateLimit.js";
import * as reports from "../controllers/errorReports.controller.js";

// Público: cualquiera (con o sin sesión) puede reportar que algo no le funcionó.
const router = Router();
router.post("/", errorReportRateLimit, optionalAuth, reports.createErrorReport);
// Aviso automático de un fallo de pantalla (sin sesión; con tope por IP).
router.post("/client", errorReportRateLimit, reports.reportClientCrash);

export default router;
