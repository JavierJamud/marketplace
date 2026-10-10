import { Router } from "express";
import * as apps from "../controllers/partnerApplications.controller.js";
import { registerRateLimit } from "../middleware/rateLimit.js";

// Público: cualquiera puede pedir usar la API de socios. La resuelve un administrador.
const router = Router();
router.post("/", registerRateLimit, apps.submitApplication);

export default router;
