import { Router } from "express";
import * as cartController from "../controllers/cart.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();
// Cliente y vendedor son cuentas separadas (lib/accountRealm.js): esto es solo de cuentas de cliente.
const customer = [authenticate, requireRole("CUSTOMER")];

router.get("/me", ...customer, cartController.getMyCart);
router.put("/me", ...customer, cartController.saveMyCart);
router.delete("/me", ...customer, cartController.deleteMyCart);

export default router;
