import { Router } from "express";
import * as sharedCartController from "../controllers/sharedCart.controller.js";
import { sharedCartRateLimit } from "../middleware/rateLimit.js";

const router = Router();

// Ambas públicas — compartir y recibir un carrito no requiere estar logueado.
router.post("/", sharedCartRateLimit, sharedCartController.createSharedCart);
router.get("/:id", sharedCartController.getSharedCart);

export default router;
