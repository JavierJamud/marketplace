import { runWithContext } from "../lib/requestContext.js";

// Acciones del admin que tocan una tienda (verificar, aprobar, cambiar el plan, bloquear, responder una solicitud...): la tienda
// recibe el aviso en el celular y en su panel solo si el admin marcó "Avisar a la tienda" (cabecera X-Notify-Vendor: 1). Sin la
// cabecera no se avisa. Solo se monta en las rutas del admin: un cliente o una tienda no pueden apagar avisos ajenos.
export function notifyVendorChoice(req, _res, next) {
  runWithContext({ notifyVendor: req.get("x-notify-vendor") === "1" }, next);
}
