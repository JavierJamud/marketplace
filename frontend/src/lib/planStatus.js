// Plan en el que está una tienda, como lo ve el admin. Solo hay dos: Regular o Premium. La prueba gratis es Premium con
// todas sus funciones, pero se marca aparte para saber cuánto le queda.
const DAY_MS = 24 * 60 * 60 * 1000;

export function trialDaysLeft(trialEndsAt) {
  if (!trialEndsAt) return null;
  const left = Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / DAY_MS);
  return left > 0 ? left : null;
}

export function vendorPlanStatus(vendor, planNames) {
  const premium = vendor.planType === "BUSINESS" && vendor.verificationStatus === "VERIFIED";
  const daysLeft = premium ? trialDaysLeft(vendor.trialEndsAt) : null;
  return {
    premium,
    trial: daysLeft != null,
    daysLeft,
    label: premium ? (daysLeft != null ? `${planNames.BUSINESS} · Prueba gratis` : planNames.BUSINESS) : planNames.REGULAR,
    daysLabel: daysLeft == null ? null : daysLeft === 1 ? "Queda 1 día" : `Quedan ${daysLeft} días`,
  };
}
