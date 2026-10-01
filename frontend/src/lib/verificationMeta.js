import { Clock, CheckCircle2, XCircle, AlertTriangle, Ban } from "lucide-react";

// Bloque 52 (pedido explícito — "debe haber una concordancia con todo...
// una configuración correcta"): BENEFITS/PLANS vivían hardcodeados acá, sin
// ninguna relación con lo que el backend realmente aplicaba (podían decir
// cualquier cosa). Ahora todo viene de `settings.plans` (GET /settings,
// PlanConfig del backend) — ver planFromSettings() más abajo, usado por
// VendorVerification.jsx y PlanComparisonModal.jsx.

// Arma el objeto de UN plan a partir de la fila real de PlanConfig que
// devuelve /settings — único lugar que traduce esa forma a lo que las
// pantallas de vendedor/comprador necesitan mostrar, para que las dos nunca
// se desincronicen entre sí.
export function planFromSettings(plans, planType) {
  const p = plans?.find((p) => p.planType === planType);
  if (!p) return null;
  const isBusiness = planType === "BUSINESS";
  return {
    id: planType.toLowerCase(),
    planType,
    name: p.displayName,
    priceLabel: isBusiness ? null : "Gratis", // el precio real de Premium lo arma quien lo use (varía CUP/USD)
    features: p.features ?? [],
  };
}

// Bloque 64: verificationStatus (Vendor.verificationStatus, fuente única de
// verdad — ver vendorVerification.service.js) ES el ciclo completo, ya no
// hace falta traducirlo a un stage aparte: NOT_STARTED -> PENDING_DOCS ->
// IN_REVIEW -> PENDING_PAYMENT -> VERIFIED, o PAYMENT_FAILED/SUSPENDED/
// REJECTED en el medio.
export const STAGE_META = {
  NOT_STARTED: { label: "Sin verificar todavía", color: "#75777c", bg: "rgba(117,119,124,0.1)", Icon: Clock },
  PENDING_DOCS: { label: "Documentos enviados — esperando revisión", color: "#8A5100", bg: "rgba(138,81,0,0.1)", Icon: Clock },
  IN_REVIEW: { label: "Un admin está revisando tus documentos", color: "#8A5100", bg: "rgba(138,81,0,0.1)", Icon: Clock },
  PENDING_PAYMENT: { label: "Documentos aprobados — falta el pago", color: "#337475", bg: "rgba(51,116,117,0.1)", Icon: Clock },
  VERIFIED: { label: "Tienda verificada", color: "#0A8F42", bg: "rgba(12,174,83,0.1)", Icon: CheckCircle2 },
  PAYMENT_FAILED: { label: "El cobro de tu suscripción falló", color: "#ba1a1a", bg: "rgba(186,26,26,0.1)", Icon: AlertTriangle },
  SUSPENDED: { label: "Tu suscripción fue suspendida", color: "#ba1a1a", bg: "rgba(186,26,26,0.1)", Icon: Ban },
  REJECTED: { label: "Documentos rechazados", color: "#ba1a1a", bg: "rgba(186,26,26,0.1)", Icon: XCircle },
};
