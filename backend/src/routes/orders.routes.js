import { Router } from "express";
import * as ordersController from "../controllers/orders.controller.js";
import * as invoicesController from "../controllers/invoices.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { ordersRateLimit } from "../middleware/rateLimit.js";

const router = Router();

router.post("/", ordersRateLimit, ordersController.createOrder);

// Panel de vendedor
router.get("/me", authenticate, requireRole("VENDOR", "ADMIN"), ordersController.listMyOrders);
router.get("/me/email-usage", authenticate, requireRole("VENDOR", "ADMIN"), ordersController.getEmailUsage);
router.patch("/:id/status", authenticate, requireRole("VENDOR", "ADMIN"), ordersController.updateOrderStatus);
router.post("/:id/email", authenticate, requireRole("VENDOR", "ADMIN"), ordersController.sendManualEmail);

// Bloque 29: gestión de pedidos Pendientes
router.post("/:id/confirm", authenticate, requireRole("VENDOR", "ADMIN"), ordersController.confirmOrderSale);
router.patch("/:id/items", authenticate, requireRole("VENDOR", "ADMIN"), ordersController.updateOrderItems);
router.delete("/:id", authenticate, requireRole("VENDOR", "ADMIN"), ordersController.deleteOrder);

// Bloque 29: factura/garantía en PDF, solo sobre pedidos ya confirmados.
router.post("/:id/invoice/download", authenticate, requireRole("VENDOR", "ADMIN"), invoicesController.downloadInvoice);
router.post("/:id/invoice/email", authenticate, requireRole("VENDOR", "ADMIN"), invoicesController.emailInvoice);
router.post("/:id/warranty/download", authenticate, requireRole("VENDOR", "ADMIN"), invoicesController.downloadWarranty);
router.post("/:id/warranty/email", authenticate, requireRole("VENDOR", "ADMIN"), invoicesController.emailWarranty);

export default router;
