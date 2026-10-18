import cron from "node-cron";
import { prisma } from "../lib/prisma.js";

// Pedidos atrasados: un pedido que sigue "Nuevo" (nadie lo confirmó) después de OVERDUE_MINUTES le llega a la tienda como aviso
// en la campana y en el celular. Una sola vez por pedido: el propio aviso (tipo ORDER_OVERDUE con el código del pedido) es la marca.
// Solo pedidos de los últimos 2 días (los más viejos ya no son "atrasados", son abandonados) y nunca los de mesa, que se
// atienden en el local.
const OVERDUE_MINUTES = 30;
const LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

export async function runOrderOverdueJob() {
  const now = Date.now();
  const orders = await prisma.order.findMany({
    where: {
      status: "NEW",
      channel: { not: "TABLE" },
      createdAt: { lte: new Date(now - OVERDUE_MINUTES * 60_000), gte: new Date(now - LOOKBACK_MS) },
      vendor: { isBlocked: false, status: "ACTIVE", deletedAt: null },
    },
    select: { id: true, code: true, vendorId: true, customerName: true, createdAt: true },
    take: 500,
  });
  if (!orders.length) return { notified: 0 };

  const already = await prisma.vendorNotification.findMany({
    where: { type: "ORDER_OVERDUE", refCode: { in: orders.map((o) => o.code) } },
    select: { refCode: true },
  });
  const done = new Set(already.map((n) => n.refCode));

  let notified = 0;
  for (const o of orders) {
    if (done.has(o.code)) continue;
    const minutes = Math.round((now - o.createdAt.getTime()) / 60_000);
    const waited = minutes >= 120 ? `${Math.floor(minutes / 60)} h` : `${minutes} min`;
    await prisma.vendorNotification.create({
      data: {
        vendorId: o.vendorId,
        type: "ORDER_OVERDUE",
        refCode: o.code,
        title: `Pedido sin confirmar · ${o.code}`,
        body: `${o.customerName ?? "Un cliente"} espera hace ${waited}. Confírmalo o avísale si no puedes atenderlo.`,
      },
    });
    notified++;
  }
  if (notified) console.log(`[orderOverdueJob] pedidos atrasados avisados=${notified}`);
  return { notified };
}

export function startOrderOverdueJob() {
  cron.schedule("*/10 * * * *", () => {
    runOrderOverdueJob().catch((err) => console.error("[orderOverdueJob] error:", err));
  });
}
