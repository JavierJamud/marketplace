import { Router } from "express";
import * as storeOffersController from "../controllers/storeOffers.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireVendorAccess, requireVendorWrite } from "../middleware/requireVendorAccess.js";

const router = Router();

// Panel de vendedor.
router.get("/me/list", authenticate, requireVendorAccess("ofertas-tienda"), storeOffersController.listMyStoreOffers);
router.post("/", authenticate, requireVendorWrite("ofertas-tienda"), storeOffersController.createStoreOffer);
router.patch("/:id", authenticate, requireVendorWrite("ofertas-tienda"), storeOffersController.updateStoreOffer);

export default router;
