import { Router } from "express";
import * as cartController from "../controllers/cart.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.get("/me", authenticate, cartController.getMyCart);
router.put("/me", authenticate, cartController.saveMyCart);
router.delete("/me", authenticate, cartController.deleteMyCart);

export default router;
