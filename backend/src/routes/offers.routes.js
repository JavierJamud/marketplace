import { Router } from "express";
import * as offersController from "../controllers/offers.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireVendorAccess, requireVendorWrite } from "../middleware/requireVendorAccess.js";
import { offerUpload } from "../middleware/offerUpload.js";

const router = Router();

// Pública — Home.jsx.
router.get("/active", offersController.listActiveOffers);

// Panel de vendedor. .single("image") va siempre (aunque el body no traiga
// archivo): las ofertas PRODUCT no lo usan, las CUSTOM sí — un solo form.
// Bloque 185: listar/ver sigue siendo "acceso a la sección" a secas; crear/
// editar/quitar exige nivel "manage" en ella.
router.get("/me/list", authenticate, requireVendorAccess("ofertas"), offersController.listMyOffers);
router.post("/", authenticate, requireVendorWrite("ofertas"), offerUpload.single("image"), offersController.createOffer);
router.patch("/:id", authenticate, requireVendorWrite("ofertas"), offerUpload.single("image"), offersController.updateOffer);
router.patch("/:id/remove", authenticate, requireVendorWrite("ofertas"), offersController.removeOffer);

export default router;
