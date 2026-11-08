import { Router } from "express";
import rateLimit from "express-rate-limit";
import { bumpSiteTraffic } from "../lib/siteTraffic.js";
import { isBotRequest } from "../lib/vendorDailyStats.js";

const router = Router();

// Una persona navegando cambia de pantalla unas pocas veces por minuto; esto deja de contar a quien manda cientos.
const trafficRateLimit = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Demasiadas solicitudes." } });

// POST /traffic/view { area, newSession } — la página pública avisa que se abrió una pantalla. Siempre responde 204: el
// contador nunca debe frenar ni romper la página.
router.post("/view", trafficRateLimit, (req, res) => {
  if (!isBotRequest(req)) void bumpSiteTraffic(String(req.body?.area ?? ""), req.body?.newSession === true);
  res.status(204).end();
});

export default router;
