import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { sendOrderOverdueVendorEmail } from "../lib/email.js";

// Pedidos atrasados: un pedido que sigue "Nuevo" (nadie lo confirmó) después de OVERDUE_MINUTES le llega a la tienda por tres
// vías: la campana del panel (con el aviso en pantalla si lo tiene abierto), la notificación del sistema en el celular o la
// computadora (push, ver lib/notify.js) y el correo de la tienda si tiene activado el aviso de pedidos. Una sola vez por
// pedido: el propio aviso (tipo ORDER_OVERDUE con el código del pedido) es la marca. Se revisa cada 5 minutos, así que el
// aviso llega entre los 30 y los 35 minutos.
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
    include: { items: { include: { product: { select: { images: true } } } }, vendor: { select: { companyName: true } } },
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
    // El correo nunca frena los demás avisos: si falla queda en el registro de correos.
    await sendOrderOverdueVendorEmail(o, { waited }).catch((err) => console.error("[orderOverdueJob] correo:", err?.message));
  }
  if (notified) console.log(`[orderOverdueJob] pedidos atrasados avisados=${notified}`);
  return { notified };
}

export function startOrderOverdueJob() {
  cron.schedule("*/5 * * * *", () => {
    runOrderOverdueJob().catch((err) => console.error("[orderOverdueJob] error:", err));
  });
}
