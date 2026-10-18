import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireVendorAccess, requireVendorWrite } from "../middleware/requireVendorAccess.js";
import { posDisplayRateLimit } from "../middleware/rateLimit.js";
import { posIdleUpload } from "../middleware/posIdleUpload.js";
import * as pos from "../controllers/pos.controller.js";
import { requirePosPlan } from "../controllers/pos.controller.js";

const router = Router();

// Pantallas públicas: solo con el enlace secreto que da el panel.
router.get("/display/:token", posDisplayRateLimit, pos.getDisplay);
router.get("/board/:token", posDisplayRateLimit, pos.getBoard);

// Panel de la tienda: sección "Caja".
// La caja es del plan de pago: sin ella el panel responde 403 con el motivo (las pantallas públicas lo comprueban por su cuenta).
router.use(["/state", "/products", "/scan", "/sales", "/cash", "/barcode", "/links", "/idle-image", "/settings"], authenticate, requirePosPlan);
router.get("/state", authenticate, requireVendorAccess("caja"), pos.getState);
router.get("/products", authenticate, requireVendorAccess("caja"), pos.searchProducts);
router.post("/scan", authenticate, requireVendorWrite("caja"), pos.scan);
router.post("/sales", authenticate, requireVendorWrite("caja"), pos.createSale);
router.post("/sales/:id/items", authenticate, requireVendorWrite("caja"), pos.addItem);
router.patch("/sales/:id/items/:productId", authenticate, requireVendorWrite("caja"), pos.setItemQuantity);
router.patch("/sales/:id", authenticate, requireVendorWrite("caja"), pos.updateSale);
router.post("/sales/:id/pay", authenticate, requireVendorWrite("caja"), pos.pay);
router.post("/sales/:id/table", authenticate, requireVendorWrite("caja"), pos.sendToTable);
router.post("/sales/:id/attach-table", authenticate, requireVendorWrite("caja"), pos.attachToTable);
router.post("/sales/:id/cancel", authenticate, requireVendorWrite("caja"), pos.cancelSale);
router.patch("/sales/:id/fulfillment", authenticate, requireVendorWrite("caja"), pos.setFulfillment);
router.post("/cash", authenticate, requireVendorWrite("caja"), pos.addCashEntry);
router.post("/barcode", authenticate, requireVendorWrite("caja", "productos"), pos.assignBarcode);
router.post("/links", authenticate, requireVendorWrite("caja"), pos.regenerateLink);
router.patch("/settings", authenticate, requireVendorWrite("caja"), pos.updatePosSettings);
router.post("/idle-image", authenticate, requireVendorWrite("caja"), posIdleUpload.single("image"), pos.uploadIdleImage);
router.delete("/idle-image", authenticate, requireVendorWrite("caja"), pos.removeIdleImage);

export default router;
