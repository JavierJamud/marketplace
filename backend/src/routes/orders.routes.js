import { Router } from "express";
import * as ordersController from "../controllers/orders.controller.js";
import * as invoicesController from "../controllers/invoices.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireVendorAccess, requireVendorWrite } from "../middleware/requireVendorAccess.js";
import { ordersRateLimit, trackOrderRateLimit } from "../middleware/rateLimit.js";
import { trackOrder } from "../controllers/orderTracking.controller.js";

const router = Router();

router.post("/", ordersRateLimit, ordersController.createOrder);
// Rastreo público: correo + número del pedido (página /rastrear-pedido).
router.post("/track", trackOrderRateLimit, trackOrder);
// Envío que se cobraría por un carrito (carrito y checkout). Público, igual que crear el pedido.
router.post("/shipping-quote", ordersController.quoteShipping);

// Panel de vendedor — Bloque 183: sección "pedidos" (ver tables.routes.js,
// mismo criterio). Bloque 185: listar/ver es solo acceso a la sección; el
// resto (cambiar estado, editar, borrar, mandar factura) exige "manage".
router.get("/me", authenticate, requireVendorAccess("pedidos"), ordersController.listMyOrders);
router.get("/me/email-usage", authenticate, requireVendorAccess("pedidos"), ordersController.getEmailUsage);
router.patch("/:id/status", authenticate, requireVendorWrite("pedidos"), ordersController.updateOrderStatus);
router.post("/:id/email", authenticate, requireVendorWrite("pedidos"), ordersController.sendManualEmail);

// Bloque 29: gestión de pedidos Pendientes
router.post("/:id/confirm", authenticate, requireVendorWrite("pedidos"), ordersController.confirmOrderSale);
router.post("/:id/reactivate", authenticate, requireVendorWrite("pedidos"), ordersController.reactivateOrder);
router.patch("/:id/items", authenticate, requireVendorWrite("pedidos"), ordersController.updateOrderItems);
router.delete("/:id", authenticate, requireVendorWrite("pedidos"), ordersController.deleteOrder);

// Bloque 29: factura/garantía en PDF, solo sobre pedidos ya confirmados.
router.post("/:id/invoice/download", authenticate, requireVendorAccess("pedidos"), invoicesController.downloadInvoice);
router.post("/:id/invoice/email", authenticate, requireVendorWrite("pedidos"), invoicesController.emailInvoice);
router.post("/:id/warranty/download", authenticate, requireVendorAccess("pedidos"), invoicesController.downloadWarranty);
router.post("/:id/warranty/email", authenticate, requireVendorWrite("pedidos"), invoicesController.emailWarranty);

export default router;
