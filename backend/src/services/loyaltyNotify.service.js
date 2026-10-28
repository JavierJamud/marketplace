import { prisma } from "../lib/prisma.js";
import { notifyUsers } from "../lib/notify.js";
import { sendLoyaltyPointsEmail } from "../lib/email.js";
import { activeProgramFor, serializeProgram, pointsWorth } from "./loyalty.service.js";

// Avisos al cliente de cada movimiento de sus puntos en una tienda: en el celular (push, si tiene la app o el aviso activado)
// y por correo. Siempre después de que el movimiento quedó guardado, y sin frenar nada si un aviso falla.

const fmtPts = (n) => `${Number(n).toLocaleString("es-CU")} ${Math.abs(n) === 1 ? "punto" : "puntos"}`;

async function context(vendorId, userId) {
  const [vendor, user, account] = await Promise.all([
    prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, companyName: true, slug: true, logoUrl: true, email: true, currency: true, planType: true, loyaltyProgram: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true, deletedAt: true } }),
    prisma.loyaltyAccount.findUnique({ where: { vendorId_userId: { vendorId, userId } }, select: { balance: true } }),
  ]);
  if (!vendor || !user || user.deletedAt) return null;
  const active = await activeProgramFor(vendor);
  const program = active ?? serializeProgram(vendor.loyaltyProgram);
  const balance = account?.balance ?? 0;
  return {
    vendor,
    user,
    account: {
      balance,
      value: pointsWorth(program, balance),
      currency: vendor.currency ?? "CUP",
      minRedeemPoints: program.minRedeemPoints,
      maxRedeemPercent: program.maxRedeemPercent,
      programActive: !!active,
    },
  };
}

async function send(ctx, { title, body, email }) {
  void notifyUsers([ctx.user.id], { category: "order_status", app: "CLIENT", title, body, url: "/cuenta/panel?tab=points", tag: `points-${ctx.vendor.id}` }).catch(() => {});
  await sendLoyaltyPointsEmail({ to: ctx.user.email, vendor: ctx.vendor, customerName: ctx.user.fullName, account: ctx.account, ...email }).catch((err) =>
    console.error("[loyalty] correo de puntos:", err?.message)
  );
}

// Pedido entregado: puntos ganados (y cuántos fueron de bono).
export async function notifyPointsEarned({ vendorId, userId, orderId, orderCode, points, bonus }) {
  const ctx = await context(vendorId, userId);
  if (!ctx) return;
  await send(ctx, {
    title: `Ganaste ${fmtPts(points)} · ${ctx.vendor.companyName}`,
    body: `Por tu pedido ${orderCode}${bonus > 0 ? `, con un bono de ${fmtPts(bonus)}` : ""}. Tu saldo: ${fmtPts(ctx.account.balance)}.`,
    email: { kind: "earned", orderId, orderCode, points, bonus },
  });
}

// Ajuste a mano de la tienda: regalo (positivo) o corrección (negativo), siempre con su motivo.
export async function notifyPointsAdjusted({ vendorId, userId, points, note }) {
  const ctx = await context(vendorId, userId);
  if (!ctx) return;
  const gift = points > 0;
  await send(ctx, {
    title: gift ? `${ctx.vendor.companyName} te regaló ${fmtPts(points)}` : `${ctx.vendor.companyName} ajustó tus puntos`,
    body: `${gift ? "+" : "-"}${fmtPts(Math.abs(points))}. Motivo: ${note}. Tu saldo: ${fmtPts(ctx.account.balance)}.`,
    email: { kind: gift ? "gift" : "removed", points, note },
  });
}

// Pedido anulado: puntos usados devueltos y puntos ganados quitados.
export async function notifyOrderPointsReversed({ vendorId, userId, orderId, orderCode, refunded, removed }) {
  if (!(refunded > 0) && !(removed > 0)) return;
  const ctx = await context(vendorId, userId);
  if (!ctx) return;
  const parts = [refunded > 0 ? `te devolvimos ${fmtPts(refunded)}` : null, removed > 0 ? `se quitaron ${fmtPts(removed)} ganados` : null].filter(Boolean);
  await send(ctx, {
    title: `Tus puntos del pedido ${orderCode}`,
    body: `El pedido se anuló: ${parts.join(" y ")}. Tu saldo: ${fmtPts(ctx.account.balance)}.`,
    email: { kind: "reversed", orderId, orderCode, refunded, removed },
  });
}
