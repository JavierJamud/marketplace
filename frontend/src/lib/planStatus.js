// Plan en el que está una tienda, con el nombre que le puso el admin. Un plan de pago está activo si la tienda está verificada
// en él o, en un plan sin insignia, mientras tenga tiempo pagado (mismo criterio que isPremiumActive del backend: el plan por
// defecto nunca cuenta como de pago). La prueba gratis es el plan de prueba con todas sus funciones, pero se marca aparte.
const DAY_MS = 24 * 60 * 60 * 1000;

// Formato de la clave de un plan: copia de PLAN_KEY_PATTERN de backend/src/lib/planConfig.js (CHECK de PlanConfig.planType).
// Vive en un solo sitio del frontend para que las pantallas que leen ?plan= del enlace filtren con la misma regla; si el
// backend la cambia, se cambia solo aquí.
export const PLAN_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,29}$/;

export function trialDaysLeft(trialEndsAt) {
  if (!trialEndsAt) return null;
  const left = Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / DAY_MS);
  return left > 0 ? left : null;
}

// `planNames` es { clave: nombre } y `defaultPlanKey` la clave del plan con isDefault (los dos de usePlatformSettings).
// Antes el plan por defecto era la clave "REGULAR" escrita acá; si el admin elige otro plan por defecto, esto lo sigue.
// Sin `defaultPlanKey` (todavía no llegó /settings, o un llamador viejo que no lo pasa) no se puede saber cuál es el plan por
// defecto: la tienda se muestra en su propio plan, que es lo que guarda la base.
export function vendorPlanStatus(vendor, planNames, defaultPlanKey = null) {
  const paidTime = !!vendor.nextPaymentDueDate && new Date(vendor.nextPaymentDueDate) > new Date();
  const onDefault = defaultPlanKey != null && vendor.planType === defaultPlanKey;
  const premium = !onDefault && (vendor.verificationStatus === "VERIFIED" || paidTime);
  const nameOf = (key) => planNames?.[key] ?? key;
  const name = nameOf(vendor.planType);
  const daysLeft = premium ? trialDaysLeft(vendor.trialEndsAt) : null;
  return {
    premium,
    trial: daysLeft != null,
    daysLeft,
    // En un plan de pago sin pagar (o sin la insignia que ese plan pide), lo que de verdad tiene es el plan por defecto.
    label: premium ? (daysLeft != null ? `${name} · Prueba gratis` : name) : defaultPlanKey ? nameOf(defaultPlanKey) : name,
    daysLabel: daysLeft == null ? null : daysLeft === 1 ? "Queda 1 día" : `Quedan ${daysLeft} días`,
  };
}

// ¿El plan de la tienda trae una sección del panel? `planFlag` es un interruptor de PlanConfig (o una lista: alcanza con
// cualquiera) y `planFeatures` sale de GET /vendors/me (planFeaturesOf del backend, los mismos interruptores que aplica el
// servidor). Depende solo de las banderas, nunca del nombre ni de la clave del plan, así que vale igual para un plan nuevo.
// La comparten el menú y el bloqueo por enlace directo (VendorLayout.jsx) y el buscador del panel (VendorSearchBar.jsx),
// para que nunca ofrezcan secciones distintas. Si planFeatures todavía no llegó no se oculta nada: es solo un instante hasta
// que /vendors/me responde, y el servidor rechaza igual lo que el plan no permite.
export function planIncludesFlag(planFlag, planFeatures) {
  if (!planFlag || !planFeatures) return true;
  const flags = Array.isArray(planFlag) ? planFlag : [planFlag];
  return flags.some((f) => !!planFeatures[f]);
}
