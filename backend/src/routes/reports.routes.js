import { Router } from "express";
import * as reportsController from "../controllers/reports.controller.js";
import { authenticate } from "../middleware/auth.js";
import { reportUpload } from "../middleware/reportUpload.js";
import { reportRateLimit } from "../middleware/rateLimit.js";

const router = Router();

// Cualquier usuario logueado (cliente, vendedor o admin) puede reportar —
// el botón vive en páginas públicas de producto/tienda/venta rápida, sin
// login redirige a /cuenta (mismo patrón que agregar a favoritos).
router.post("/", authenticate, reportRateLimit, reportUpload.single("screenshot"), reportsController.createReport);

export default router;
