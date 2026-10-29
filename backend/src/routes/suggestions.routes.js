import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import * as suggestionsController from "../controllers/suggestions.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();

// Cada sugerencia queda en la bandeja del admin: 5 cada 10 minutos por cuenta alcanza para escribir a mano y frena a un
// script que la llene. Va por cuenta (la ruta ya exige sesión) para no cortar a quien comparte IP con otros.
const suggestionRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
  message: { error: "Ya enviaste varias sugerencias seguidas. Prueba de nuevo en unos minutos." },
});

// Tope de largo antes de guardar: el esquema del controlador solo pide un mínimo y un texto sin límite llenaba la base y la
// pantalla del admin. Mismo tope que la apelación de un reporte. Se mide sin recortar espacios porque el controlador guarda el
// texto tal cual; solo valida, el controlador sigue leyendo req.body. Va antes
// del tope de envíos para que un texto rechazado por largo no le gaste un intento a quien lo corrige.
const SUGGESTION_MAX = 2000;
const suggestionLengthSchema = z.object({
  message: z.string().max(SUGGESTION_MAX, `La sugerencia puede tener hasta ${SUGGESTION_MAX} caracteres.`),
});
function limitSuggestionLength(req, _res, next) {
  suggestionLengthSchema.parse(req.body ?? {});
  next();
}

router.post("/", authenticate, requireRole("VENDOR", "CUSTOMER"), limitSuggestionLength, suggestionRateLimit, suggestionsController.createSuggestion);

export default router;
