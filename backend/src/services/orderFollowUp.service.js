import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { recordOrderEvent } from "../lib/orderEvents.js";
import { reverseOrderLoyalty } from "./loyalty.service.js";
import { getOrderFollowUpPolicy, getOrderDelayPolicy } from "../controllers/settings.controller.js";
import { notifyCustomerOfDelay } from "./orderDelay.service.js";
import { sendOrderFollowUpVendorEmail, sendOrderAutoCancelledCustomerEmail, sendOrderReactivatedCustomerEmail } from "../lib/email.js";
import { cubaDateTime } from "../templates/orderFollowUp.js";

// Pedido que la tienda no responde (sigue "Nuevo"). Tres pasos, con las horas que fija el admin (por defecto 24, 48 y 72):
//  1. Recordatorio a la tienda con todos los datos del pedido.
//  2. Aviso a la tienda de que el pedido se cerrará si no lo responde.
//  3. Cierre automático: el pedido pasa a cancelado, el cliente recibe un aviso amable con los datos de contacto de la tienda
//     y la tienda recibe el aviso de que se cerró y de que puede reactivarlo.
// Cada paso llega a la campana del panel (con push) y por correo, siempre, aunque la tienda tenga apagado el correo de pedidos.
// Las horas cuentan desde que se hizo el pedido, o desde que la tienda lo reactivó. Además, entre un paso y el siguiente
// siempre pasa el tiempo completo: un pedido viejo (por ejemplo, de antes de existir esto) recibe el recordatorio ahora y no
// se cierra hasta que la tienda tuvo los dos avisos con su tiempo para responder.

const HOUR = 3_600_000;
// Pedidos más viejos que esto no entran: ya no son "un cliente esperando", y avisar de todos de golpe sería ruido.
const MAX_AGE_MS = 30 * 24 * HOUR;
// Una tienda puede reactivar un pedido cerrado solo durante este tiempo.
export const REACTIVATE_WINDOW_MS = 30 * 24 * HOUR;
export const AUTO_CANCEL_REASON = "La tienda no alcanzó a confirmarlo a tiempo.";

const NOTICE_TYPES = ["NEW_ORDER", "ORDER_OVERDUE", "ORDER_REMINDER", "ORDER_CANCEL_WARNING"];

const clockStart = (o) => new Date(o.reactivatedAt ?? o.createdAt).getTime();

// Cuándo se cerraría el pedido si nadie lo responde, con las mismas reglas que el cron. Lo muestra el panel de la tienda.
export function projectedAutoCancelAt(order, policy, now = Date.now()) {
  if (!policy.enabled || order.status !== "NEW" || order.channel === "TABLE") return null;
  const start = clockStart(order);
  const { reminderHours: r, warningHours: w, cancelHours: c } = policy;
  const reminder = order.pendingReminderAt ? new Date(order.pendingReminderAt).getTime() : Math.max(start + r * HOUR, now);
  const warning = order.cancelWarningAt ? new Date(order.cancelWarningAt).getTime() : Math.max(start + w * HOUR, reminder + (w - r) * HOUR);
  return new Date(Math.max(start + c * HOUR, warning + (c - w) * HOUR));
}

// Los avisos de un pedido ya atendido dejan de mostrarse en la campana.
export async function resolveOrderNotices(vendorId, code) {
  await prisma.vendorNotification
    .updateMany({ where: { vendorId, refCode: code, type: { in: NOTICE_TYPES }, resolvedAt: null }, data: { resolvedAt: new Date(), readAt: new Date() } })
    .catch(() => {});
}

const ORDER_INCLUDE = {
  items: { include: { product: { select: { images: true } } } },
  vendor: { select: { companyName: true, logoUrl: true, slug: true, whatsapp: true, email: true, companyAddress: true } },
};

function hoursWaited(order, now) {
  return Math.max(1, Math.round((now - clockStart(order)) / HOUR));
}

async function sendReminder(order, policy, now) {
  // La marca va primero y condicionada: si dos procesos corren a la vez, solo uno avisa.
  const claimed = await prisma.order.updateMany({ where: { id: order.id, status: "NEW", pendingReminderAt: null }, data: { pendingReminderAt: new Date(now) } });
  if (!claimed.count) return false;
  const hours = hoursWaited(order, now);
  const closesAt = projectedAutoCancelAt({ ...order, pendingReminderAt: new Date(now) }, policy, now);
  await prisma.vendorNotification.create({
    data: {
      vendorId: order.vendorId,
      type: "ORDER_REMINDER",
      refCode: order.code,
      title: `Pedido sin respuesta · ${order.code}`,
      body: `${order.customerName ?? "Un cliente"} espera hace ${hours} h. Si no lo respondes, se cerrará el ${cubaDateTime(closesAt)}.`,
    },
  });
  await recordOrderEvent(order.id, "REMINDER_SENT", `${hours} h sin respuesta`);
  await sendOrderFollowUpVendorEmail(order, { stage: "reminder", hours, closesAt }).catch((err) => console.error("[orderFollowUp] correo recordatorio:", err?.message));
  // El cliente también se entera de que su pedido va con retraso (si el aviso de retraso está encendido).
  if ((await getOrderDelayPolicy()).delayEnabled) await notifyCustomerOfDelay(order, hours);
  return true;
}

async function sendWarning(order, policy, now) {
  const claimed = await prisma.order.updateMany({ where: { id: order.id, status: "NEW", cancelWarningAt: null }, data: { cancelWarningAt: new Date(now) } });
  if (!claimed.count) return false;
  const hours = hoursWaited(order, now);
  const closesAt = projectedAutoCancelAt({ ...order, cancelWarningAt: new Date(now) }, policy, now);
  await prisma.vendorNotification.create({
    data: {
      vendorId: order.vendorId,
      type: "ORDER_CANCEL_WARNING",
      refCode: order.code,
      title: `Se cerrará pronto · ${order.code}`,
      body: `Lleva ${hours} h sin respuesta. Confírmalo o recházalo antes del ${cubaDateTime(closesAt)}, o se cerrará solo.`,
    },
  });
  await recordOrderEvent(order.id, "CANCEL_WARNING_SENT", `Se cerrará el ${cubaDateTime(closesAt)}`);
  await sendOrderFollowUpVendorEmail(order, { stage: "warning", hours, closesAt }).catch((err) => console.error("[orderFollowUp] correo aviso:", err?.message));
  return true;
}

async function autoCancel(order, now) {
  const hours = hoursWaited(order, now);
  const done = await prisma.$transaction(async (tx) => {
    // Solo si sigue "Nuevo": si la tienda lo confirmó o lo rechazó justo ahora, no se toca.
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: "NEW" },
      data: { status: "CANCELLED", cancelReason: AUTO_CANCEL_REASON, autoCancelledAt: new Date(now) },
    });
    if (!claimed.count) return false;
    // Un pedido "Nuevo" nunca descontó stock ni sumó ventas; solo se devuelven los puntos que el cliente usó.
    await reverseOrderLoyalty(order.id, tx);
    return true;
  });
  if (!done) return false;

  await recordOrderEvent(order.id, "AUTO_CANCELLED", `${hours} h sin respuesta de la tienda`);
  await resolveOrderNotices(order.vendorId, order.code);
  await prisma.vendorNotification.create({
    data: {
      vendorId: order.vendorId,
      type: "ORDER_AUTO_CANCELLED",
      refCode: order.code,
      title: `Pedido cerrado sin respuesta · ${order.code}`,
      body: `Pasó ${hours} h sin confirmar y se le avisó al cliente. Si te escribe y puedes atenderlo, ábrelo y toca "Reactivar pedido".`,
    },
  });
  const fresh = await prisma.order.findUnique({ where: { id: order.id }, include: ORDER_INCLUDE });
  await sendOrderFollowUpVendorEmail(fresh, { stage: "cancelled", hours }).catch((err) => console.error("[orderFollowUp] correo cierre tienda:", err?.message));
  await sendOrderAutoCancelledCustomerEmail(fresh, { hours }).catch((err) => console.error("[orderFollowUp] correo cierre cliente:", err?.message));
  return true;
}

// Una pasada del cron: cada pedido avanza como mucho un paso por pasada.
export async function runOrderFollowUp(now = Date.now()) {
  const result = { reminders: 0, warnings: 0, cancelled: 0 };
  const policy = await getOrderFollowUpPolicy();
  if (!policy.enabled) return result;
  const { reminderHours: r, warningHours: w, cancelHours: c } = policy;
  const due = new Date(now - r * HOUR);

  const orders = await prisma.order.findMany({
    where: {
      status: "NEW",
      channel: { not: "TABLE" },
      createdAt: { gte: new Date(now - MAX_AGE_MS) },
      OR: [{ reactivatedAt: null, createdAt: { lte: due } }, { reactivatedAt: { lte: due } }],
    },
    include: ORDER_INCLUDE,
    orderBy: { createdAt: "asc" },
    take: 300,
  });

  for (const order of orders) {
    try {
      const start = clockStart(order);
      if (!order.pendingReminderAt) {
        if (await sendReminder(order, policy, now)) result.reminders++;
        continue;
      }
      const reminderAt = new Date(order.pendingReminderAt).getTime();
      if (!order.cancelWarningAt) {
        if (now >= start + w * HOUR && now >= reminderAt + (w - r) * HOUR && (await sendWarning(order, policy, now))) result.warnings++;
        continue;
      }
      const warningAt = new Date(order.cancelWarningAt).getTime();
      if (now >= start + c * HOUR && now >= warningAt + (c - w) * HOUR && (await autoCancel(order, now))) result.cancelled++;
    } catch (err) {
      console.error("[orderFollowUp] pedido", order.code, err?.message);
    }
  }
  if (result.reminders || result.warnings || result.cancelled) console.log(`[orderFollowUp] recordatorios=${result.reminders} avisos=${result.warnings} cerrados=${result.cancelled}`);
  return result;
}

// Por qué no se puede reactivar un pedido, o null si se puede. Lo usan el panel (para mostrar u ocultar el botón) y el servidor.
export function reactivateBlocker(order, now = Date.now()) {
  if (order.status !== "CANCELLED" || !order.autoCancelledAt) return "Solo se pueden reactivar los pedidos que el sistema cerró por falta de respuesta.";
  if (now - new Date(order.autoCancelledAt).getTime() > REACTIVATE_WINDOW_MS) return "Este pedido se cerró hace más de 30 días. Pídele al cliente que haga un pedido nuevo.";
  // Los puntos que usó ya se le devolvieron al cerrarse: volver a cobrárselos sin preguntarle no corresponde.
  if (order.loyaltyPointsRedeemed > 0) return "Este pedido usó puntos del cliente, que ya se le devolvieron. Pídele que haga el pedido de nuevo.";
  return null;
}

// La tienda retoma un pedido que el sistema cerró: vuelve a "Nuevo", el plazo empieza de cero y el cliente recibe un aviso.
export async function reactivateAutoCancelledOrder(order) {
  const blocker = reactivateBlocker(order);
  if (blocker) throw new AppError(blocker, 400);
  const now = new Date();
  const claimed = await prisma.order.updateMany({
    where: { id: order.id, status: "CANCELLED", autoCancelledAt: { not: null } },
    data: { status: "NEW", cancelReason: null, autoCancelledAt: null, pendingReminderAt: null, cancelWarningAt: null, reactivatedAt: now },
  });
  if (!claimed.count) throw new AppError("El pedido cambió hace un momento. Recarga la lista e inténtalo de nuevo.", 409);

  await recordOrderEvent(order.id, "REACTIVATED", null);
  await prisma.vendorNotification
    .updateMany({ where: { vendorId: order.vendorId, refCode: order.code, type: "ORDER_AUTO_CANCELLED", resolvedAt: null }, data: { resolvedAt: now, readAt: now } })
    .catch(() => {});
  const fresh = await prisma.order.findUnique({ where: { id: order.id }, include: ORDER_INCLUDE });
  await sendOrderReactivatedCustomerEmail(fresh).catch((err) => console.error("[orderFollowUp] correo reactivado:", err?.message));
  return fresh;
}
