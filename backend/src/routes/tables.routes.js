import { Router } from "express";
import * as tablesController from "../controllers/tables.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();

// Vendedor (restaurante)
router.get("/me", authenticate, requireRole("VENDOR", "ADMIN"), tablesController.listMyTables);
router.post("/me", authenticate, requireRole("VENDOR", "ADMIN"), tablesController.createTable);
router.patch("/orders/:tableOrderId/status", authenticate, requireRole("VENDOR", "ADMIN"), tablesController.updateKitchenStatus);
router.patch("/orders/:tableOrderId/clear", authenticate, requireRole("VENDOR", "ADMIN"), tablesController.clearTableOrder);

// Público (cliente escaneando el QR)
router.get("/qr/:qrToken", tablesController.getTableByToken);
router.post("/qr/:qrToken/order", tablesController.createTableOrder);

export default router;
