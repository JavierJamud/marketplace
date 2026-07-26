import { Router } from "express";
import * as discountCodesController from "../controllers/discountCodes.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();

// Público — preview del descuento desde el carrito, antes de pagar.
router.post("/validate", discountCodesController.validateDiscountCode);

// Panel de vendedor.
router.get("/me/list", authenticate, requireRole("VENDOR", "ADMIN"), discountCodesController.listMyDiscountCodes);
router.post("/", authenticate, requireRole("VENDOR", "ADMIN"), discountCodesController.createDiscountCode);
router.patch("/:id", authenticate, requireRole("VENDOR", "ADMIN"), discountCodesController.updateDiscountCode);
router.delete("/:id", authenticate, requireRole("VENDOR", "ADMIN"), discountCodesController.deleteDiscountCode);

export default router;
