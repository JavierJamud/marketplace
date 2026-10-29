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
// Sirve para cualquier plan, también uno creado desde el admin: antes solo la clave "BUSINESS" se trataba como de pago.
export function planFromSettings(plans, planType) {
  const p = plans?.find((p) => p.planType === planType);
  if (!p) return null;
  return {
    id: planType.toLowerCase(),
    planType,
    // /settings trae displayName; /settings/plans lo trae como name.
    name: p.displayName ?? p.name,
    priceLabel: p.isFree ? "Gratis" : null, // el precio de un plan de pago lo arma quien lo use (varía CUP/USD y por meses)
    // Lo que incluye el plan, armado con sus límites, funciones y funciones personalizadas reales (backend:
    // buildPlanIncludes). No se cae en `features`: en /settings es el texto libre del admin y en /settings/plans es la lista
    // del catálogo (objetos), ninguna de las dos es "lo que incluye".
    features: p.includes ?? [],
  };
}

// Valor corto de una función en la tabla comparativa: true/false para un interruptor o una personalizada, y para un tope el
// número ("Hasta 50"), "Sin tope" si está vacío y false si es 0 o su interruptor está apagado (0 = nada, como en el servidor).
function comparisonValue(feature) {
  if (!feature?.enabled) return false;
  if (feature.kind !== "limit") return true;
  if (feature.limit == null) return "Sin tope";
  return feature.limit > 0 ? `Hasta ${feature.limit}` : false;
}

// Filas de una tabla que compara planes (PlanComparisonModal.jsx), armadas con `features` de GET /settings/plans: la lista
// del catálogo de funciones (planFeatureList del backend) con su valor en cada plan, más las funciones personalizadas que
// creó el admin. Así un plan nuevo, o una función nueva, aparece sola sin tocar esta pantalla. Reglas del contrato:
//  - Un interruptor con tope (pairedLimit) no tiene fila propia: la fila es la de su tope, con el nombre del interruptor
//    ("Usuarios del equipo", no "Tope de usuarios del equipo").
//  - La insignia de verificada no es una función del catálogo (es grantsBadge): va después de las del servidor y antes de
//    las personalizadas, igual que en "Tu plan incluye".
//  - Una fila que ningún plan de la tabla trae no se muestra (por ejemplo, una personalizada apagada en todos).
// Devuelve [{ key, label, values: [valor por plan, en el orden de `plans`] }].
export function planComparisonRows(plans) {
  const list = (plans ?? []).filter(Boolean);
  if (!list.length) return [];
  const catalog = new Map();
  for (const plan of list) for (const f of plan.features ?? []) if (f?.key && !catalog.has(f.key)) catalog.set(f.key, f);
  const rows = [];
  const badgeRow = { key: "__badge", label: "Insignia de tienda verificada", values: list.map((p) => !!p.grantsBadge) };
  let badgeAdded = false;
  for (const f of catalog.values()) {
    if (f.pairedLimit) continue;
    if (f.kind === "custom" && !badgeAdded) {
      rows.push(badgeRow);
      badgeAdded = true;
    }
    const label = (f.governedBy && catalog.get(f.governedBy)?.label) || f.label;
    rows.push({ key: f.key, label, values: list.map((p) => comparisonValue((p.features ?? []).find((x) => x.key === f.key))) });
  }
  if (!badgeAdded) rows.push(badgeRow);
  return rows.filter((r) => r.values.some((v) => v !== false));
}

// Bloque 64: verificationStatus (Vendor.verificationStatus, fuente única de
// verdad — ver vendorVerification.service.js) ES el ciclo completo, ya no
// hace falta traducirlo a un stage aparte: NOT_STARTED -> PENDING_DOCS ->
// IN_REVIEW -> PENDING_PAYMENT -> VERIFIED, o PAYMENT_FAILED/SUSPENDED/
// REJECTED en el medio.
export const STAGE_META = {
  NOT_STARTED: { label: "Sin verificar todavía", color: "#65676c", bg: "rgba(117,119,124,0.1)", Icon: Clock },
  PENDING_DOCS: { label: "Documentos enviados, esperando revisión", color: "#8A5100", bg: "rgba(138,81,0,0.1)", Icon: Clock },
  IN_REVIEW: { label: "Un admin está revisando tus documentos", color: "#8A5100", bg: "rgba(138,81,0,0.1)", Icon: Clock },
  PENDING_PAYMENT: { label: "Documentos aprobados: falta el pago", color: "#337475", bg: "rgba(51,116,117,0.1)", Icon: Clock },
  VERIFIED: { label: "Tienda verificada", color: "#087A38", bg: "rgba(12,174,83,0.1)", Icon: CheckCircle2 },
  PAYMENT_FAILED: { label: "El cobro de tu suscripción falló", color: "#ba1a1a", bg: "rgba(186,26,26,0.1)", Icon: AlertTriangle },
  SUSPENDED: { label: "Tu suscripción fue suspendida", color: "#ba1a1a", bg: "rgba(186,26,26,0.1)", Icon: Ban },
  REJECTED: { label: "Documentos rechazados", color: "#ba1a1a", bg: "rgba(186,26,26,0.1)", Icon: XCircle },
  // Tuvo un plan de pago (pagado o prueba gratis) y volvió al plan por defecto: no es un error ni un castigo, por eso no va
  // en rojo. El texto no nombra ningún plan: el nombre del plan por defecto lo pone el admin y sale en la etiqueta de al lado.
  PLAN_ENDED: { label: "Tu plan de pago terminó", color: "#65676c", bg: "rgba(117,119,124,0.1)", Icon: Clock },
};
