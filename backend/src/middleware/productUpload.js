import { join } from "node:path";
import { createImageUpload } from "../lib/imageOptimizer.js";
import { PRODUCT_UPLOAD_DIR } from "../controllers/products.controller.js";

// Bloque 52 (pedido explícito): solo JPG/WebP para fotos de producto — ya no
// se acepta PNG acá (sí sigue aceptándose en ofertas/sitio, esto es
// específico del catálogo, donde el admin pidió un formato único y
// predecible). Bloque 51: lo que entra se valida igual, pero lo que se GUARDA
// siempre termina siendo WebP optimizado, sin importar con qué formato haya
// llegado — ver lib/imageOptimizer.js.
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".webp"]);

// A diferencia del resto (una sola carpeta fija conocida al cargar el
// módulo), acá la carpeta depende de la tienda de cada request — se crea al
// vuelo. req.uploadVendorSlug lo deja resolveProductForUpload, que corre
// ANTES de este middleware en la cadena de la ruta.
export const productUpload = createImageUpload({
  dir: (req) => join(PRODUCT_UPLOAD_DIR, req.uploadVendorSlug),
  allowedExt: ALLOWED_EXT,
  fileSize: 5 * 1024 * 1024,
  // 1400px: la foto más grande se ve en la galería de Product.jsx, que en
  // escritorio ocupa ~700px — el doble para que se vea nítida en pantallas
  // retina, sin pasarse.
  maxWidth: 1400,
  // Miniatura para la grilla del catálogo (ProductCard, ~300px de ancho
  // real): 500px cubre retina ahí también, y pesa una fracción de la grande.
  thumbWidth: 500,
});
