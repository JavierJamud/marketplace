import multer from "multer";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { PRODUCT_UPLOAD_DIR } from "../controllers/products.controller.js";

mkdirSync(PRODUCT_UPLOAD_DIR, { recursive: true });

// Bloque 52 (pedido explícito): solo JPG/WebP para fotos de producto — ya no
// se acepta PNG acá (sí sigue aceptándose en ofertas/sitio, esto es
// específico del catálogo, donde el admin pidió un formato único y
// predecible: 1200×900px, JPG o WebP).
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".webp"]);

// A diferencia de kycUpload/siteUpload (una sola carpeta fija conocida al
// cargar el módulo), acá la carpeta depende de la tienda de cada request —
// se crea al vuelo. req.uploadVendorSlug lo deja resolveProductForUpload,
// que corre ANTES de este middleware en la cadena de la ruta.
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = join(PRODUCT_UPLOAD_DIR, req.uploadVendorSlug);
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    // Nombre generado por el servidor (nunca el original del cliente) —
    // mismo criterio anti path-traversal que kycUpload.js.
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ALLOWED_EXT.has(ext) ? ext : ""}`);
  },
});

export const productUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXT.has(ext));
  },
});
