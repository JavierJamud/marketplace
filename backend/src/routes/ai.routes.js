import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as aiController from "../controllers/ai.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireVendorWrite } from "../middleware/requireVendorAccess.js";
import { chatAudioUpload } from "../middleware/chatAudioUpload.js";
import { chatRateLimit } from "../middleware/rateLimit.js";

const router = Router();

// "Mejorar con IA" llama a un proveedor de pago con la clave del admin. Antes era la única ruta de IA sin tope. El tope va
// por usuario (la ruta exige sesión) y no comparte contador con el chat público: varias personas de una misma tienda
// detrás de la misma IP no se frenan entre sí. Alcanza para mejorar decenas de descripciones seguidas a mano, no para un
// script.
const aiDescriptionRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ai-description:${req.user.id}`,
  message: { error: "Usaste muchas veces la mejora con IA. Espera unos minutos y vuelve a intentarlo." },
});

// Quién puede pedir cada tipo de texto: el mismo permiso que hace falta para guardarlo.
// - campaign y admin-offer: textos de la plataforma (AdminCampaigns.jsx, AdminOffers.jsx), solo el admin. Antes cualquier
//   vendedor podía pedirlos y saltarse la tienda.
// - product y offer: el personal con permiso de escribir en Productos u Ofertas de tienda también (Bloque 183). Antes la
//   ruta tenía requireRole("VENDOR","ADMIN") de antes del personal y el botón le daba 403.
// - store y warranty: datos del negocio (Mi perfil y Configuración, PATCH /vendors/me), solo el dueño o el admin, con la
//   misma comprobación de tienda usable que ownerWrite de vendors.routes.js: antes bastaba el rol, y el dueño de una tienda
//   bloqueada o eliminada gastaba el cupo de IA en textos que después no podía guardar.
// Un tipo desconocido sigue al controlador, que lo rechaza con 400 al validar.
const vendorOrAdmin = requireRole("VENDOR", "ADMIN");
const vendorUsable = requireVendorWrite();
// requireRole lanza si el rol no vale y, si vale, llama a su next: ahí no hay nada que seguir todavía, así que se le pasa
// uno vacío. Para el admin requireVendorWrite deja pasar; para el dueño revisa que la tienda no esté bloqueada ni eliminada.
async function ownerOrAdminWrite(req, res, next) {
  vendorOrAdmin(req, res, () => {});
  return vendorUsable(req, res, next);
}
const DESCRIPTION_ACCESS = {
  campaign: requireRole("ADMIN"),
  "admin-offer": requireRole("ADMIN"),
  product: requireVendorWrite("productos"),
  offer: requireVendorWrite("ofertas-tienda"),
  store: ownerOrAdminWrite,
  warranty: ownerOrAdminWrite,
};

async function requireDescriptionAccess(req, res, next) {
  // Solo claves propias del objeto: con kind "constructor", "toString" o "__proto__" la búsqueda llegaba a Object.prototype
  // y la "guardia" era una función que nunca llamaba a next (la petición quedaba colgada y se saltaba el tope) o lanzaba un
  // 500. Cualquier otro valor cae en vendorOrAdmin y el controlador lo rechaza con 400.
  const kind = typeof req.body?.kind === "string" ? req.body.kind : "";
  const guard = Object.hasOwn(DESCRIPTION_ACCESS, kind) ? DESCRIPTION_ACCESS[kind] : vendorOrAdmin;
  return guard(req, res, next);
}

router.post("/generate-listing-description", authenticate, requireRole("CUSTOMER", "VENDOR", "ADMIN"), chatRateLimit, aiController.generateListingDescription);
router.post("/generate-description", authenticate, requireDescriptionAccess, aiDescriptionRateLimit, aiController.generateProductOrStoreDescription);

// Bloque 32: transcripción de audio para ambos bots (tienda y general) — sin
// login, mismo rate limit que el chat en sí (evita abuso del endpoint pago
// de Groq sin necesitar cuenta).
router.post("/transcribe", chatRateLimit, chatAudioUpload.single("audio"), aiController.transcribeChatAudio);

export default router;
