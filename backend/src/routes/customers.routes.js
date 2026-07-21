import { Router } from "express";
import * as customersController from "../controllers/customers.controller.js";
import * as favoritesController from "../controllers/favorites.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.get("/me", authenticate, customersController.getMe);
router.patch("/me", authenticate, customersController.updateMe);
router.get("/me/orders", authenticate, customersController.getMyOrders);
router.get("/me/favorites", authenticate, favoritesController.listMyFavorites);
router.post("/me/favorites", authenticate, favoritesController.addFavorite);
router.delete("/me/favorites/:id", authenticate, favoritesController.removeFavorite);

export default router;
