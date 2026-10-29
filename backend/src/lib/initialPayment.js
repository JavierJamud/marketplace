import { prisma } from "./prisma.js";

// El primer pago de una suscripción (la verificación: CUP confirmado por el admin, tarjeta confirmada por Stripe o plan
// activado a mano) se guardaba solo en VerificationRequest, y las renovaciones en SubscriptionPayment. El historial de pagos
// de una tienda quedaba partido en dos tablas y las estadísticas tenían que emparejar "gemelos" para no contar dos veces.
// Ahora cada primer pago confirmado también queda en SubscriptionPayment (fromVerification = true), así el historial y los
// ingresos salen de una sola tabla. La migración 20261130110000 copió los pagos anteriores.
//
// Mismo criterio de "gemelo" que las estadísticas (admin.controller.js SAME_PAYMENT_WINDOW_MS): si ya hay un pago de la
// tienda confirmado a menos de 2 minutos (por ejemplo, la renovación manual que escribe en las dos tablas), no se duplica.
const SAME_PAYMENT_WINDOW_MS = 2 * 60 * 1000;

export async function mirrorInitialPayment(vendorId, db = prisma) {
  const v = await db.verificationRequest.findUnique({
    where: { vendorId },
    select: {
      paymentMethod: true,
      paymentMonths: true,
      paymentPlanType: true,
      paymentDiscountPercent: true,
      paymentAmount: true,
      paymentCurrency: true,
      paymentClaimedAt: true,
      paymentConfirmedAt: true,
      paymentConfirmedById: true,
      paymentNote: true,
      paymentProofUrl: true,
      stripePaidAt: true,
    },
  });
  if (!v?.paymentConfirmedAt || !v.paymentMethod) return null;
  const at = v.paymentConfirmedAt;
  const twin = await db.subscriptionPayment.findFirst({
    where: {
      vendorId,
      confirmedAt: { gte: new Date(at.getTime() - SAME_PAYMENT_WINDOW_MS), lte: new Date(at.getTime() + SAME_PAYMENT_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (twin) return null;
  const months = v.paymentMonths ?? 1;
  return db.subscriptionPayment.create({
    data: {
      vendorId,
      fromVerification: true,
      paymentMethod: v.paymentMethod,
      months,
      planType: v.paymentPlanType ?? null,
      discountPercent: v.paymentDiscountPercent ?? null,
      amount: v.paymentAmount ?? null,
      // La columna no admite null: sin moneda (pago sin monto) queda en USD y no suma a ingresos porque no tiene monto.
      currency: v.paymentCurrency ?? "USD",
      proofUrl: v.paymentProofUrl ?? null,
      stripePaidAt: v.stripePaidAt ?? null,
      claimedAt: v.paymentClaimedAt ?? at,
      confirmedAt: at,
      confirmedById: v.paymentConfirmedById ?? null,
      note: v.paymentNote ?? null,
    },
  });
}
