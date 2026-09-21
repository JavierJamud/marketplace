import { Router } from "express";
import * as productsController from "../controllers/products.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireVendorAccess, requireVendorWrite } from "../middleware/requireVendorAccess.js";
import { productUpload } from "../middleware/productUpload.js";

const router = Router();

// Panel de vendedor (siempre resuelve vendorId desde el usuario autenticado)
// Bloque 185 (bug real reportado en vivo, con captura — "cuando el usuario
// tiene acceso a la sección de mesas y va a crear una cuenta en una mesa,
// no se muestran los productos de esa tienda"): el desplegable de
// productos de CreateManualOrderModal/TableOrderDetailModal pide esta MISMA
// lista — antes exigía la sección "productos" a secas, así que un mesero
// con SOLO "mesas" (el caso de uso real, no gestiona el catálogo) recibía
// 403 acá y el desplegable quedaba vacío en silencio. Elegir un producto ya
// existente para armarle una cuenta a un cliente es lectura, no escritura
// del catálogo — por eso esta ruta acepta cualquiera de las 2 secciones,
// mientras que crear/editar/borrar productos de verdad (de acá para abajo)
// sigue exigiendo "productos" en modo escritura.
router.get("/me/list", authenticate, requireVendorAccess("productos", "mesas"), productsController.listMyProducts);
router.post("/", authenticate, requireVendorWrite("productos"), productsController.createProduct);
router.patch("/:id", authenticate, requireVendorWrite("productos"), productsController.updateProduct);
router.delete("/:id", authenticate, requireVendorWrite("productos"), productsController.deleteProduct);
router.post(
  "/:id/images",
  authenticate,
  requireVendorWrite("productos"),
  productsController.resolveProductForUpload,
  productUpload.array("images", 6),
  productsController.addProductImages
);
router.delete("/:id/images", authenticate, requireVendorWrite("productos"), productsController.removeProductImage);
router.post("/:id/images/link", authenticate, requireVendorWrite("productos"), productsController.addProductImageLink);
router.patch("/:id/images/reorder", authenticate, requireVendorWrite("productos"), productsController.reorderProductImages);

// Públicas
router.get("/barcode/:barcode", productsController.lookupByBarcode);
// Bloque 109 (pedido explícito): antes era pública para visitantes
// anónimos (guestId) — ahora exige sesión real, así el vendedor siempre
// recibe un cliente identificable al que puede contactar cuando reponga.
router.post("/:id/request", authenticate, productsController.requestProductRestock);
router.get("/:vendorSlug/:productSlug", productsController.getProductBySlug);
// Bloque 98: señales de "Destacados" (ver lib/productRanking.js) — públicas
// a propósito, cualquier visitante (sin sesión) las genera con solo mirar.
router.post("/:id/track-view", productsController.trackProductView);
router.post("/:id/track-click", productsController.trackProductClick);
router.post("/:id/track-dwell", productsController.trackProductDwell);

export default router;
