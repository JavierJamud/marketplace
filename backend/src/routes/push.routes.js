import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import * as push from "../controllers/push.controller.js";
import { optionalAuth } from "../middleware/auth.js";
import { appInstallRateLimit } from "../middleware/rateLimit.js";
import * as installs from "../controllers/appInstalls.controller.js";

const router = Router();

router.get("/public-key", push.publicKey);
router.get("/stream", authenticate, push.realtimeStream);
router.post("/subscribe", authenticate, push.subscribe);
router.post("/unsubscribe", authenticate, push.unsubscribe);
router.post("/rotate", appInstallRateLimit, push.rotate);
router.get("/preferences", authenticate, push.getPreferences);
router.patch("/preferences", authenticate, push.updatePreferences);

// Aplicaciones instaladas: la app instalada avisa al abrirse; el navegador pregunta si esta persona ya la tiene.
router.post("/installs", appInstallRateLimit, optionalAuth, installs.pingInstall);
router.get("/installs/status", authenticate, installs.installStatus);

export default router;
