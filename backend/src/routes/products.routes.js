import { Router } from "express";
import * as productsController from "../controllers/products.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { productUpload } from "../middleware/productUpload.js";

const router = Router();

// Panel de vendedor (siempre resuelve vendorId desde el usuario autenticado)
router.get("/me/list", authenticate, requireRole("VENDOR", "ADMIN"), productsController.listMyProducts);
router.post("/", authenticate, requireRole("VENDOR", "ADMIN"), productsController.createProduct);
router.patch("/:id", authenticate, requireRole("VENDOR", "ADMIN"), productsController.updateProduct);
router.delete("/:id", authenticate, requireRole("VENDOR", "ADMIN"), productsController.deleteProduct);
router.post(
  "/:id/images",
  authenticate,
  requireRole("VENDOR", "ADMIN"),
  productsController.resolveProductForUpload,
  productUpload.array("images", 6),
  productsController.addProductImages
);
router.delete("/:id/images", authenticate, requireRole("VENDOR", "ADMIN"), productsController.removeProductImage);

// Públicas
router.get("/barcode/:barcode", productsController.lookupByBarcode);
// Bloque 23: sin `authenticate` — un visitante anónimo también puede
// solicitar reposición (ver optionalUser en el controller).
router.post("/:id/request", productsController.requestProductRestock);
router.get("/:vendorSlug/:productSlug", productsController.getProductBySlug);

export default router;
