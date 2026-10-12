import { Router } from "express";
import * as customersController from "../controllers/customers.controller.js";
import * as favoritesController from "../controllers/favorites.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.get("/me", authenticate, customersController.getMe);
router.patch("/me", authenticate, customersController.updateMe);
router.get("/me/orders", authenticate, customersController.getMyOrders);
router.post("/me/orders/:id/cancel", authenticate, customersController.cancelMyOrder);
router.put("/me/orders/:id/items", authenticate, customersController.editMyOrderItems);
router.get("/me/favorites", authenticate, favoritesController.listMyFavorites);
router.post("/me/favorites", authenticate, favoritesController.addFavorite);
router.delete("/me/favorites/:id", authenticate, favoritesController.removeFavorite);

export default router;
