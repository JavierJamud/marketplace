import { prisma } from "../lib/prisma.js";
import { recordOrderEvent } from "../lib/orderEvents.js";
import { notifyUsers } from "../lib/notify.js";
import { getOrderDelayPolicy } from "../controllers/settings.controller.js";
import { sendOrderDelayVendorEmail, sendOrderDelayCustomerEmail } from "../lib/email.js";
import { DELAY_STAGE } from "../templates/orderDelay.js";

// Pedido detenido: si un pedido "Vendido" o "En camino" pasa las horas que fija el admin sin cambiar de estado, se avisa a la
// tienda (campana, push y correo) y al cliente (correo y, si tiene cuenta, push), una vez por estado: si la tienda lo mueve, el
// plazo vuelve a contar desde el cambio. Los pedidos "Nuevo" ya tienen su propio seguimiento (orderFollowUp.service.js); ahí
// el cliente recibe este mismo aviso cuando la tienda recibe el recordatorio.
// Quedan fuera los pedidos de mesa y las ventas de caja, que se atienden en el local.

const HOUR = 3_600_000;
const MAX_AGE_MS = 30 * 24 * HOUR;
// Eventos que marcan un cambio de estado (lib/orderEvents.js). El último decide desde cuándo cuenta el plazo.
const STATUS_EVENTS = ["CREATED", "CONFIRMED", "PREPARING", "READY", "REACTIVATED"];

const ORDER_INCLUDE = {
  items: { include: { product: { select: { images: true } } } },
  vendor: { select: { companyName: true, logoUrl: true, slug: true, whatsapp: true, email: true } },
};

// Aviso al cliente (lo usa también el recordatorio de un pedido "Nuevo"). `order` trae ORDER_INCLUDE.
export async function notifyCustomerOfDelay(order, hours) {
  const stage = DELAY_STAGE[order.status]?.customer ?? "en curso";
  if (order.customerId) {
    void notifyUsers([order.customerId], {
      category: "order_status",
      app: "CLIENT",
      title: `Tu pedido va con retraso · ${order.code}`,
      body: `${order.vendor?.companyName ?? "La tienda"}: tu pedido sigue ${stage}. Te avisamos cuando cambie.`,
      url: "/cuenta/panel?tab=orders",
      tag: `order-delay-${order.code}`,
    }).catch(() => {});
  }
  await sendOrderDelayCustomerEmail(order, { hours }).catch((err) => console.error("[orderDelay] correo cliente:", err?.message));
}

async function notifyDelay(order, hours) {
  const stage = DELAY_STAGE[order.status]?.vendor ?? order.status;
  // La marca va primero: si el envío de un correo falla, el aviso no se repite en la próxima pasada.
  await recordOrderEvent(order.id, "DELAY_NOTICE", `${hours} h en "${stage}"`);
  await prisma.vendorNotification.create({
    data: {
      vendorId: order.vendorId,
      type: "ORDER_DELAYED",
      refCode: order.code,
      title: `Pedido detenido · ${order.code}`,
      body: `Lleva ${hours} h en "${stage}". Le avisamos a ${order.customerName ?? "tu cliente"} del retraso: actualízalo o escríbele.`,
    },
  });
  await sendOrderDelayVendorEmail(order, { hours }).catch((err) => console.error("[orderDelay] correo tienda:", err?.message));
  await notifyCustomerOfDelay(order, hours);
}

// Una pasada del cron (jobs/orderOverdue.job.js).
export async function runOrderDelayNotices(now = Date.now()) {
  const { delayEnabled, delayHours } = await getOrderDelayPolicy();
  if (!delayEnabled) return { notified: 0 };
  const limit = delayHours * HOUR;

  const orders = await prisma.order.findMany({
    where: {
      status: { in: ["PREPARING", "READY"] },
      channel: { not: "TABLE" },
      createdAt: { gte: new Date(now - MAX_AGE_MS), lte: new Date(now - limit) },
      vendor: { isBlocked: false, status: "ACTIVE", deletedAt: null },
    },
    include: { ...ORDER_INCLUDE, events: { where: { type: { in: [...STATUS_EVENTS, "DELAY_NOTICE"] } }, orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "asc" },
    take: 300,
  });
  if (!orders.length) return { notified: 0 };
  const posOrders = new Set((await prisma.posSale.findMany({ where: { orderId: { in: orders.map((o) => o.id) } }, select: { orderId: true } })).map((p) => p.orderId));

  let notified = 0;
  for (const order of orders) {
    try {
      const last = order.events[0];
      // Ya se avisó en este estado, o es una venta de caja.
      if (last?.type === "DELAY_NOTICE" || posOrders.has(order.id)) continue;
      const since = new Date(last?.createdAt ?? order.createdAt).getTime();
      if (now - since < limit) continue;
      await notifyDelay(order, Math.round((now - since) / HOUR));
      notified++;
    } catch (err) {
      console.error("[orderDelay] pedido", order.code, err?.message);
    }
  }
  if (notified) console.log(`[orderDelay] pedidos detenidos avisados=${notified}`);
  return { notified };
}
