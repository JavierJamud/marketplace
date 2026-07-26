import { Router } from "express";
import * as storeOffersController from "../controllers/storeOffers.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { storeOfferUpload } from "../middleware/storeOfferUpload.js";

const router = Router();

// Panel de vendedor. .single("image") va siempre (aunque no traiga archivo,
// si el vendedor pegó un link) — mismo criterio que offers.routes.js.
router.get("/me/list", authenticate, requireRole("VENDOR", "ADMIN"), storeOffersController.listMyStoreOffers);
router.post("/", authenticate, requireRole("VENDOR", "ADMIN"), storeOfferUpload.single("image"), storeOffersController.createStoreOffer);
router.patch("/:id", authenticate, requireRole("VENDOR", "ADMIN"), storeOfferUpload.single("image"), storeOffersController.updateStoreOffer);

export default router;
