import { publicCache } from "../middleware/publicCache.js";
import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import * as categoriesController from "../controllers/categories.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireVendorWrite } from "../middleware/requireVendorAccess.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

// Las categorías son globales (las ve toda la plataforma), así que crearlas tiene tope: 20 por tienda al día alcanza para
// cargar un catálogo real y frena a un script que llene el árbol. Va por tienda y no por cuenta: con la clave por cuenta,
// el dueño y cada usuario del equipo tenían su propio cupo y una tienda con N usuarios creaba 20*(N+1). Tampoco va por IP,
// porque varias tiendas pueden compartir IP (datos móviles, wifi pública). El admin no tiene tope.
// requireVendorWrite corre antes y deja req.vendorStaff para el equipo; al dueño se le busca su tienda.
async function categoryQuotaKey(req) {
  if (req.vendorStaff?.vendorId) return `vendor:${req.vendorStaff.vendorId}`;
  if (req.user?.id) {
    const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, select: { id: true } });
    return vendor ? `vendor:${vendor.id}` : `user:${req.user.id}`;
  }
  return ipKeyGenerator(req.ip);
}

const createCategoryRateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user?.role === "ADMIN",
  keyGenerator: categoryQuotaKey,
  // Si el nombre ya existe, el controlador devuelve esa categoría con 200 y no crea nada: eso no gasta cupo. Las
  // creaciones (201) cuentan, y los errores también, para que un script no pueda probar nombres sin límite.
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode === 200,
  message: { error: "Tu tienda ya creó muchas categorías hoy. Elige una de la lista o prueba de nuevo mañana." },
});

router.get("/", publicCache(60_000), categoriesController.listCategories);
// Un vendedor (o el admin) puede crear una categoría nueva al cargar un producto cuando no existe la suya. Por eso pide lo
// mismo que crear el producto: la sección Productos con nivel "Modificar" y la tienda sin bloquear (el admin pasa siempre).
// requireRole va primero para que un cliente reciba "no tienes permiso" y no el aviso de solo lectura del panel.
router.post(
  "/",
  authenticate,
  requireRole("VENDOR", "VENDOR_STAFF", "ADMIN"),
  requireVendorWrite("productos"),
  createCategoryRateLimit,
  categoriesController.createCategory
);

export default router;
