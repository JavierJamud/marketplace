import { Router } from "express";
import * as sharedCartController from "../controllers/sharedCart.controller.js";

const router = Router();

// Ambas públicas — compartir y recibir un carrito no requiere estar logueado.
router.post("/", sharedCartController.createSharedCart);
router.get("/:id", sharedCartController.getSharedCart);

export default router;
