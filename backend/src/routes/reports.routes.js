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

// Respuesta del reportado (vendedor o dueño de venta rápida) al pedido de
// evidencia — la evaluación en sí (resolveReportTarget) confirma que quien
// llama es realmente el dueño real detrás del objetivo reportado, sin
// depender de un rol fijo (puede ser CUSTOMER o VENDOR según el caso).
router.post("/:id/evidence", authenticate, reportUpload.array("evidence", 4), reportsController.submitEvidence);

export default router;
