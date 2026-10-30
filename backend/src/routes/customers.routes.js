import { Router } from "express";
import * as customersController from "../controllers/customers.controller.js";
import * as favoritesController from "../controllers/favorites.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();
// Cliente y vendedor son cuentas separadas (lib/accountRealm.js): esto es solo de cuentas de cliente.
const customer = [authenticate, requireRole("CUSTOMER")];

router.get("/me", ...customer, customersController.getMe);
router.patch("/me", ...customer, customersController.updateMe);
router.get("/me/orders", ...customer, customersController.getMyOrders);
router.post("/me/orders/:id/cancel", ...customer, customersController.cancelMyOrder);
router.put("/me/orders/:id/items", ...customer, customersController.editMyOrderItems);
router.get("/me/favorites", ...customer, favoritesController.listMyFavorites);
router.post("/me/favorites", ...customer, favoritesController.addFavorite);
router.delete("/me/favorites/:id", ...customer, favoritesController.removeFavorite);

export default router;
