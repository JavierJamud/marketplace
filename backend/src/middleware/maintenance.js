import { getMaintenanceState } from "../controllers/settings.controller.js";
import { optionalAuth } from "./auth.js";

// Modo mantenimiento "FULL": el sitio público deja de responder y solo el admin sigue funcionando. Se aplica antes de las rutas de la API
// (ver app.js). Quedan siempre disponibles: el inicio de sesión (el admin tiene que poder entrar), todo /admin, los ajustes públicos (de
// ahí sale el propio aviso de mantenimiento), el envío de errores de pantalla y lo que se sirve antes de este punto (archivos subidos,
// salud del servicio, webhook de Stripe). Un administrador con sesión válida puede usar el resto de la API, para ver el sitio como siempre.
const ALWAYS_ALLOWED = ["/auth", "/admin", "/settings", "/error-reports"];

export async function maintenanceGate(req, res, next) {
  if (req.method === "OPTIONS") return next();
  const { mode, message } = await getMaintenanceState();
  if (mode !== "FULL") return next();
  if (ALWAYS_ALLOWED.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return next();
  if (req.headers.authorization) {
    await optionalAuth(req, res, () => {});
    if (req.user?.role === "ADMIN") return next();
  }
  res.set({ "Retry-After": "600", "Cache-Control": "no-store" });
  return res.status(503).json({ error: message, code: "MAINTENANCE" });
}
