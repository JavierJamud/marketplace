import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireVendorAccess, requireVendorWrite } from "../middleware/requireVendorAccess.js";
import * as loyalty from "../controllers/loyalty.controller.js";

const router = Router();
// Cliente y vendedor son cuentas separadas (lib/accountRealm.js): esto es solo de cuentas de cliente.
const customer = [authenticate, requireRole("CUSTOMER")];

// Cliente
router.get("/vendors/:vendorId/program", loyalty.getPublicProgram);
router.get("/vendors/:vendorId/me", ...customer, loyalty.getMyBalanceAtVendor);
router.get("/me", ...customer, loyalty.listMyAccounts);
router.get("/me/:vendorId/history", ...customer, loyalty.getMyHistory);
router.post("/visits", ...customer, loyalty.recordStoreVisit);
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
