import { Router } from "express";
import * as offersController from "../controllers/offers.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { offerUpload } from "../middleware/offerUpload.js";

const router = Router();

// Pública — Home.jsx.
router.get("/active", offersController.listActiveOffers);

// Panel de vendedor. .single("image") va siempre (aunque el body no traiga
// archivo): las ofertas PRODUCT no lo usan, las CUSTOM sí — un solo form.
router.get("/me/list", authenticate, requireRole("VENDOR", "ADMIN"), offersController.listMyOffers);
router.post("/", authenticate, requireRole("VENDOR", "ADMIN"), offerUpload.single("image"), offersController.createOffer);
router.patch("/:id", authenticate, requireRole("VENDOR", "ADMIN"), offerUpload.single("image"), offersController.updateOffer);
router.patch("/:id/remove", authenticate, requireRole("VENDOR", "ADMIN"), offersController.removeOffer);

export default router;
