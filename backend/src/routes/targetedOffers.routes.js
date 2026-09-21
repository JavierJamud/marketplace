import { Router } from "express";
import * as targetedOffersController from "../controllers/targetedOffers.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// Bloque 194 (pedido explícito — "ofertas autodirigidas... mostrarse en el
// panel o en la cuenta cuando el cliente o vendedor se logeen como forma de
// popup"): cualquier usuario logueado (CUSTOMER/VENDOR/VENDOR_STAFF) puede
// pedir sus propias ofertas pendientes y descartarlas — sin restricción de
// rol acá (el controller ya resuelve la audiencia según req.user.role, y
// devuelve [] para ADMIN).
router.get("/me", authenticate, targetedOffersController.listMyTargetedOffers);
router.patch("/:id/dismiss", authenticate, targetedOffersController.dismissTargetedOffer);

export default router;
