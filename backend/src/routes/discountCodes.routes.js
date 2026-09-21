import { Router } from "express";
import * as discountCodesController from "../controllers/discountCodes.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireVendorAccess, requireVendorWrite } from "../middleware/requireVendorAccess.js";

const router = Router();

// Público — preview del descuento desde el carrito, antes de pagar.
router.post("/validate", discountCodesController.validateDiscountCode);

// Panel de vendedor. Bloque 185: listar es "acceso"; crear/editar/borrar
// exige nivel "manage".
router.get("/me/list", authenticate, requireVendorAccess("codigos-descuento"), discountCodesController.listMyDiscountCodes);
router.post("/", authenticate, requireVendorWrite("codigos-descuento"), discountCodesController.createDiscountCode);
router.patch("/:id", authenticate, requireVendorWrite("codigos-descuento"), discountCodesController.updateDiscountCode);
router.delete("/:id", authenticate, requireVendorWrite("codigos-descuento"), discountCodesController.deleteDiscountCode);

export default router;
