import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import * as portal from "../controllers/partnerPortal.controller.js";

// Bloque 299: panel del socio. Solo cuentas con rol PARTNER.
const router = Router();
router.use(authenticate, requireRole("PARTNER"));
router.get("/me", portal.getPortalMe);
router.get("/overview", portal.getPortalOverview);
router.get("/movements", portal.getPortalMovements);
router.get("/plans", portal.getPortalPlans);
router.put("/plans/:planType", portal.setPortalPlanPrice);

export default router;
