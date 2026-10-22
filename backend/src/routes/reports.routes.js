import { Router } from "express";
import * as reportsController from "../controllers/reports.controller.js";
import { authenticate } from "../middleware/auth.js";
import { reportUpload } from "../middleware/reportUpload.js";
import { reportRateLimit } from "../middleware/rateLimit.js";

const router = Router();

// Cualquier usuario logueado (cliente, vendedor o admin) puede reportar —
// el botón vive en páginas públicas de producto/tienda/venta rápida, sin
// login redirige a /cuenta (mismo patrón que agregar a favoritos).
// Capturas opcionales: "images" (hasta 4); "screenshot" sigue aceptándose para la versión anterior de la web.
router.post("/", authenticate, reportRateLimit, reportUpload.fields([{ name: "images", maxCount: 4 }, { name: "screenshot", maxCount: 1 }]), reportsController.createReport);

// Reportes donde YO soy el reportado — antes de "/:id/evidence" por
// convención (aunque acá no hay colisión real de path, "/me/list" no
// matchea nunca "/:id/evidence").
router.get("/me/list", authenticate, reportsController.listMyReportsAgainstMe);
// Reportes que YO hice (de fraude y de comentarios), para ver en qué estado están.
router.get("/me/made", authenticate, reportsController.listMyReportsMade);

// Respuesta del reportado (vendedor o dueño de venta rápida) al pedido de
// evidencia — la evaluación en sí (resolveReportTarget) confirma que quien
// llama es realmente el dueño real detrás del objetivo reportado, sin
// depender de un rol fijo (puede ser CUSTOMER o VENDOR según el caso).
router.post("/:id/evidence", authenticate, reportUpload.array("evidence", 4), reportsController.submitEvidence);
// Apelación del dueño tras una suspensión (mensaje y capturas opcionales).
router.post("/:id/appeal", authenticate, reportRateLimit, reportUpload.array("images", 4), reportsController.submitAppeal);

export default router;
