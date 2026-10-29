import { publicCache } from "../middleware/publicCache.js";
import { Router } from "express";
import * as customerListingsController from "../controllers/customerListings.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { customerListingUpload } from "../middleware/customerListingUpload.js";

const router = Router();

// Panel de cliente (siempre resuelve ownerId desde el usuario autenticado). El dueño de una tienda (VENDOR) es la misma
// persona que se registró como cliente: abrir su tienda no le quita sus anuncios de venta rápida.
router.get("/me/list", authenticate, requireRole("CUSTOMER", "VENDOR", "ADMIN"), customerListingsController.listMyListings);
router.post("/", authenticate, requireRole("CUSTOMER", "VENDOR", "ADMIN"), customerListingsController.createListing);
router.patch("/:id", authenticate, requireRole("CUSTOMER", "VENDOR", "ADMIN"), customerListingsController.updateListing);
router.patch("/:id/sold", authenticate, requireRole("CUSTOMER", "VENDOR", "ADMIN"), customerListingsController.toggleSold);
router.delete("/:id", authenticate, requireRole("CUSTOMER", "VENDOR", "ADMIN"), customerListingsController.deleteListing);
router.post(
  "/:id/images",
  authenticate,
  requireRole("CUSTOMER", "VENDOR", "ADMIN"),
  customerListingsController.resolveListingForUpload,
  customerListingUpload.array("images", 10),
  customerListingsController.addListingImages
);
router.delete("/:id/images", authenticate, requireRole("CUSTOMER", "VENDOR", "ADMIN"), customerListingsController.removeListingImage);

// Públicas
router.get("/", publicCache(20_000), customerListingsController.listPublicListings);
router.get("/:id", customerListingsController.getPublicListing);
router.post("/:id/contact-click", customerListingsController.trackListingContact);

export default router;
