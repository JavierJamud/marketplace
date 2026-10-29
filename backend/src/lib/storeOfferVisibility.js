import { prisma } from "./prisma.js";
import { AppError } from "../utils/AppError.js";
import { getPlanConfig } from "./planConfig.js";

// Qué ofertas de tienda se publican y cuáles puede tener encendidas una tienda según su plan. Antes solo createStoreOffer
// miraba el plan: al reactivar una oferta, al bajar de plan o al cambiar el plan en Suscripciones nada lo volvía a mirar, y la
// tienda del Básico seguía mostrando una oferta cuyo código el checkout rechaza ("Esta tienda no acepta códigos de descuento").
// Todo lo que muestra ofertas a clientes (tienda pública, pantalla de la caja, API de socios, recordatorios por correo) pasa
// por aquí para que las reglas no se repitan a mano en cada consulta.

// Una oferta siempre lleva un código, así que el plan tiene que incluir las dos cosas: sin códigos la oferta anuncia un
// descuento que nadie puede usar.
function planHasStoreOffers(config) {
  return !!config?.allowStoreOffers && !!config?.allowDiscountCodes;
}

// Tope de ofertas encendidas a la vez para un plan (null = sin tope, 0 = ninguna).
function maxActiveFor(config) {
  if (!planHasStoreOffers(config)) return 0;
  return config.maxActiveStoreOffers ?? null;
}

// Mismo criterio que createStoreOffer: tienda verificada y un plan que incluya ofertas y códigos. Se usa al crear y al
// reactivar, así la puerta es la misma en los dos casos.
export async function assertCanPublishStoreOffers(vendor) {
  if (vendor.verificationStatus !== "VERIFIED") {
    throw new AppError("Disponible solo para tiendas verificadas.", 403);
  }
  const config = await getPlanConfig(vendor.planType);
  // Las ofertas exigen insignia (requiresBadge): en un plan que no la da no están, aunque la tienda conserve VERIFIED de un
  // plan anterior (misma regla que planAllows en lib/planConfig.js).
  if (!config?.allowStoreOffers || !config.grantsBadge) throw new AppError("Tu plan actual no incluye ofertas de tienda.", 403);
  if (!config?.allowDiscountCodes) throw new AppError("Tu plan actual no incluye códigos de descuento, que necesita cada oferta.", 403);
}

// Filtro de base para lo que ve un cliente: encendida, sin suspensión del admin, dentro de sus fechas y con un código que se
// pueda usar (activo y sin suspender). Un código apagado dejaba la oferta en la tienda con un código que el carrito rechaza.
export function publicStoreOfferWhere(now = new Date()) {
  return {
    active: true,
    suspendedAt: null,
    discountCode: { active: true, suspendedAt: null },
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ isLimitedTime: false }, { expiresAt: { gt: now } }] },
    ],
  };
}

// Recorta una lista de ofertas ya filtrada con publicStoreOfferWhere a lo que el plan de la tienda deja mostrar: nada si el
// plan no incluye ofertas o la tienda no está verificada, y como mucho las `maxActiveStoreOffers` más recientes. No toca la
// base: una tienda que pierde la verificación un rato (revisión de documentos) recupera sus ofertas al volver.
// `vendor` necesita planType y verificationStatus.
export async function filterVisibleStoreOffers(vendor, offers) {
  if (!vendor || vendor.verificationStatus !== "VERIFIED" || !offers?.length) return [];
  const config = await getPlanConfig(vendor.planType);
  // Sin insignia en el plan no se muestran (no se apagan: si vuelve a un plan con insignia, reaparecen).
  if (!config?.grantsBadge) return [];
  const max = maxActiveFor(config);
  const newestFirst = [...offers].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return max === null ? newestFirst : newestFirst.slice(0, max);
}

// Apaga las ofertas encendidas que el plan actual ya no permite: todas si el plan no incluye ofertas, o las más viejas que
// pasen del tope. Solo mira el plan (no la verificación) porque apagar es definitivo: la tienda las vuelve a encender a mano.
// Se llama al bajar de plan, al guardar un plan en Suscripciones y al abrir la lista del panel (cubre cualquier otro camino
// que cambie el plan de una tienda). Devuelve cuántas apagó.
export async function recalcVendorStoreOffers(vendorId) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { planType: true } });
  if (!vendor) return 0;
  const max = maxActiveFor(await getPlanConfig(vendor.planType));
  if (max === null) return 0;
  const active = await prisma.storeOffer.findMany({
    where: { vendorId, active: true },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const extra = active.slice(max).map((o) => o.id);
  if (extra.length === 0) return 0;
  await prisma.storeOffer.updateMany({ where: { id: { in: extra } }, data: { active: false } });
  return extra.length;
}

// Lo mismo para todas las tiendas de un plan, cuando el admin cambia sus interruptores o su tope de ofertas.
export async function recalcStoreOffersForPlan(planType) {
  const vendors = await prisma.vendor.findMany({ where: { planType, storeOffers: { some: { active: true } } }, select: { id: true } });
  let total = 0;
  for (const { id } of vendors) total += await recalcVendorStoreOffers(id);
  return total;
}
