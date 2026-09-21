import { Router } from "express";
import * as controller from "../controllers/vendorStaffSales.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireVendorAccess, requireVendorWrite } from "../middleware/requireVendorAccess.js";

const router = Router();

// Bloque 198: todas las rutas exigen acceso a la sección "ventas-manuales"
// (VENDOR/ADMIN siempre pasan, igual que en cualquier otra sección) — lo
// que decide "usuario de sistema para sí mismo" vs. "dueño/admin
// supervisando a todos" es cada handler del controller (requireStaffActor
// vs. assertOwnerOrAdmin), no la ruta.

// Catálogo / reclamo — lectura vs. escritura.
router.get("/products", authenticate, requireVendorAccess("ventas-manuales"), controller.listClaimableProducts);
router.post("/allocations/claim", authenticate, requireVendorWrite("ventas-manuales"), controller.claimAllocation);
router.post("/allocations/release", authenticate, requireVendorWrite("ventas-manuales"), controller.releaseAllocation);
router.post("/allocations/reassign", authenticate, requireVendorWrite("ventas-manuales"), controller.reassignAllocation);
router.get("/me/allocations", authenticate, requireVendorAccess("ventas-manuales"), controller.listMyAllocations);

// Ventas manuales — propias (usuario de sistema) y globales (dueño/admin).
router.post("/sales", authenticate, requireVendorWrite("ventas-manuales"), controller.registerManualSale);
// Bloque 199: varias líneas de una sola vez, atómico.
router.post("/sales/batch", authenticate, requireVendorWrite("ventas-manuales"), controller.registerManualSalesBatch);
router.get("/me/sales", authenticate, requireVendorAccess("ventas-manuales"), controller.listMySales);
// Bloque 199: devolución PROPIA (achica una venta ya cargada) — distinto de
// updateManualSale/deleteManualSale, que son correcciones del dueño.
router.post("/sales/:id/return", authenticate, requireVendorWrite("ventas-manuales"), controller.returnManualSale);
router.get("/sales", authenticate, requireVendorAccess("ventas-manuales"), controller.listAllSales);
router.patch("/sales/:id", authenticate, requireVendorWrite("ventas-manuales"), controller.updateManualSale);
router.delete("/sales/:id", authenticate, requireVendorWrite("ventas-manuales"), controller.deleteManualSale);
// Bloque 199: tabla de seguimiento — más y menos vendidos, toda la tienda.
router.get("/products-tracking", authenticate, requireVendorAccess("ventas-manuales"), controller.getProductsTracking);

// Cuadre de caja.
router.get("/me/cash-close", authenticate, requireVendorAccess("ventas-manuales"), controller.getMyCashCloseStatus);
router.post("/me/cash-close", authenticate, requireVendorWrite("ventas-manuales"), controller.markMyCashClose);
router.get("/cash-close-status", authenticate, requireVendorAccess("ventas-manuales"), controller.getCashCloseStatus);
router.get("/settings", authenticate, requireVendorAccess("ventas-manuales"), controller.getCashCloseSettings);
router.patch("/settings", authenticate, requireVendorWrite("ventas-manuales"), controller.updateCashCloseSettings);

// Supervisión (dueño/admin) — el controller también exige assertOwnerOrAdmin,
// esto es solo la primera capa (acceso a la sección).
router.get("/staff", authenticate, requireVendorAccess("ventas-manuales"), controller.listStaffRoster);
router.get("/staff/:staffId/analytics", authenticate, requireVendorAccess("ventas-manuales"), controller.getStaffAnalytics);
// Bloque 204: desglose de stock por producto de un usuario puntual, y
// modificar/eliminar cada asignación — usado por el detalle de usuario en
// VendorUsers.jsx.
router.get("/staff/:staffId/allocations", authenticate, requireVendorAccess("ventas-manuales"), controller.getStaffAllocations);
router.patch("/staff/:staffId/allocations/:id", authenticate, requireVendorWrite("ventas-manuales"), controller.setStaffAllocationQuantity);
router.delete("/staff/:staffId/allocations/:id", authenticate, requireVendorWrite("ventas-manuales"), controller.deleteStaffAllocation);

export default router;
