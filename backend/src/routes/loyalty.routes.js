import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireVendorAccess, requireVendorWrite } from "../middleware/requireVendorAccess.js";
import * as loyalty from "../controllers/loyalty.controller.js";

const router = Router();

// Cliente
router.get("/vendors/:vendorId/program", loyalty.getPublicProgram);
router.get("/vendors/:vendorId/me", authenticate, loyalty.getMyBalanceAtVendor);
router.get("/me", authenticate, loyalty.listMyAccounts);
router.get("/me/:vendorId/history", authenticate, loyalty.getMyHistory);
router.post("/visits", authenticate, loyalty.recordStoreVisit);
router.get("/email-preferences", authenticate, loyalty.getEmailPreferences);
router.patch("/email-preferences", authenticate, loyalty.updateEmailPreferences);
router.post("/unsubscribe", loyalty.unsubscribe);

// Tienda: sección "Programa de fidelidad" del panel (el dueño siempre; el personal, si se la asignaron).
router.get("/store", authenticate, requireVendorAccess("puntos"), loyalty.getMyProgram);
router.put("/store", authenticate, requireVendorWrite("puntos"), loyalty.saveMyProgram);
router.get("/store/members", authenticate, requireVendorAccess("puntos"), loyalty.listMyMembers);
router.get("/store/eligible", authenticate, requireVendorAccess("puntos"), loyalty.listEligibleCustomers);
router.get("/store/members/:userId/history", authenticate, requireVendorAccess("puntos"), loyalty.getMemberHistory);
router.post("/store/adjust", authenticate, requireVendorWrite("puntos"), loyalty.adjustMemberPoints);

export default router;
