// Plan en el que está una tienda, como lo ve el admin: Básico, Estándar, Premium o Empresarial. Un plan de pago está activo
// si la tienda está verificada en él o, en un plan sin insignia, mientras tenga tiempo pagado (mismo criterio que
// isPremiumActive del backend). La prueba gratis es Premium con todas sus funciones, pero se marca aparte.
const DAY_MS = 24 * 60 * 60 * 1000;

export function trialDaysLeft(trialEndsAt) {
  if (!trialEndsAt) return null;
  const left = Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / DAY_MS);
  return left > 0 ? left : null;
}

export function vendorPlanStatus(vendor, planNames) {
  const paidTime = !!vendor.nextPaymentDueDate && new Date(vendor.nextPaymentDueDate) > new Date();
  const premium = vendor.planType !== "REGULAR" && (vendor.verificationStatus === "VERIFIED" || paidTime);
  const name = planNames[vendor.planType] ?? vendor.planType;
  const daysLeft = premium ? trialDaysLeft(vendor.trialEndsAt) : null;
  return {
    premium,
    trial: daysLeft != null,
    daysLeft,
    label: premium ? (daysLeft != null ? `${name} · Prueba gratis` : name) : planNames.REGULAR,
    daysLabel: daysLeft == null ? null : daysLeft === 1 ? "Queda 1 día" : `Quedan ${daysLeft} días`,
  };
}
