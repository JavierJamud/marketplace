import express, { Router } from "express";
import * as c from "../controllers/partnerApi.controller.js";
import { partnerCors, partnerAuth, requireScope } from "../middleware/partnerAuth.js";

// API pública de socios: /partner/v1. Se monta ANTES del CORS general de app.js porque tiene su
// propio control (llave + dominio/IP), no el allowlist de orígenes del sitio.
const router = Router();
router.use(partnerCors, partnerAuth, express.json({ limit: "100kb" }));

router.get("/me", c.getMe);

router.get("/products", requireScope("products:read"), c.listProducts);
router.get("/products/featured", requireScope("ranking:read"), c.listFeatured);
router.get("/products/:id", requireScope("products:read"), c.getProduct);
router.get("/products/:id/reviews", requireScope("reviews:read"), c.listProductReviews);

router.get("/stores", requireScope("stores:read"), c.listStores);
router.get("/stores/:slug", requireScope("stores:read"), c.getStore);
router.get("/stores/:slug/products", requireScope("stores:read"), requireScope("products:read"), c.listStoreProducts);
router.get("/stores/:slug/reviews", requireScope("reviews:read"), c.listStoreReviews);
router.get("/stores/:slug/offers", requireScope("store-offers:read"), c.listStoreOffers);

router.get("/offers", requireScope("offers:read"), c.listSiteOffers);

router.get("/categories", requireScope("catalog:read"), c.listCategories);
router.get("/business-categories", requireScope("catalog:read"), c.listBusinessCategories);
router.get("/locations/provinces", requireScope("catalog:read"), c.listProvinces);
router.get("/locations/municipalities", requireScope("catalog:read"), c.listMunicipalities);

router.post("/cart/validate", requireScope("cart:validate"), c.validateCart);

router.use((req, res) => res.status(404).json({ error: `Recurso no encontrado: ${req.method} ${req.path}`, code: "not_found" }));

export default router;
