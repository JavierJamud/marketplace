import { Router } from "express";
import * as reviewsController from "../controllers/reviews.controller.js";
import { authenticate } from "../middleware/auth.js";
import { publicCache } from "../middleware/publicCache.js";
import { reviewImageUpload } from "../middleware/reviewImageUpload.js";

const router = Router();

// Público (portada): las reseñas más recientes de todas las tiendas. Se guarda unos segundos en memoria como las demás consultas
// públicas, y se vacía cuando alguien publica o modifica algo.
router.get("/featured", publicCache(60_000), reviewsController.listFeaturedReviews);

// Bloque 52: .array("images", 4) va siempre (aunque no traiga archivos) —
// tiendas no verificadas simplemente no mandan ninguno, mismo endpoint sirve
// a las dos situaciones.
router.post("/", authenticate, reviewImageUpload.array("images", 4), reviewsController.createReview);

// Bloque 69 (pedido explícito): cualquier usuario logueado puede reportar un
// comentario que ve (Store.jsx/Product.jsx) — el mismo endpoint también lo
// usa el vendedor desde su panel (VendorReviews.jsx) sobre reseñas de su
// propia tienda, ver reportReview en el controller para el gate real.
router.post("/:id/report", authenticate, reviewsController.reportReview);

export default router;

