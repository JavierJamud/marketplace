import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { channelLabel } from "../lib/catalog.js";
import { orderCurrency, money, orderShippingText, orderGrandTotal, deliveryPlace } from "../lib/orderSummary.js";

// Rastreo público de un pedido (/rastrear-pedido), sin cuenta: hace falta el correo con el que se hizo Y el número del pedido.
// Los dos tienen que coincidir en el mismo pedido; si no, la respuesta es la misma sea cual sea el dato que falló, para que
// la página no sirva para averiguar si un correo compró en la plataforma. El límite de intentos está en la ruta.
// Solo se muestra lo que el cliente ya conoce de su propio pedido: nunca el documento de identidad de quien recibe ni datos
// internos de la tienda.

const trackSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  code: z.string().trim().min(4).max(40),
});

const NOT_FOUND = "No encontramos un pedido con ese correo y ese número. Revisa que sean los mismos que usaste al comprar.";

// Movimientos que ve el cliente, en sus palabras. Los internos de la tienda (factura o garantía solo generadas) no se muestran.
const EVENT_TEXT = {
  CREATED: "La tienda recibió tu pedido",
  CONFIRMED: "La tienda confirmó tu pedido",
  PREPARING: "Tu pedido está en preparación",
  READY: "Tu pedido va en camino o está listo para recoger",
  DELIVERED: "Pedido entregado",
  CANCELLED: "Pedido cancelado",
  EDITED_BY_CUSTOMER: "Cambiaste los productos del pedido",
  INVOICE_SENT: "La tienda te envió la factura por correo",
  WARRANTY_SENT: "La tienda te envió la garantía por correo",
};

// "z-abc123", "Z-ABC123" o "abc123" llevan al mismo pedido.
function normalizeCode(raw) {
  const c = raw.toUpperCase().replace(/\s+/g, "");
  return c.startsWith("Z-") ? c : `Z-${c}`;
}

export async function trackOrder(req, res) {
  const parsed = trackSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError("Escribe el correo y el número del pedido.", 400);
  const { email, code } = parsed.data;

  const order = await prisma.order.findFirst({
    where: { code: normalizeCode(code), customerEmail: { equals: email, mode: "insensitive" } },
    include: {
      items: { include: { product: { select: { images: true } } } },
      events: { orderBy: { createdAt: "asc" }, select: { type: true, detail: true, createdAt: true } },
      vendor: { select: { companyName: true, slug: true, logoUrl: true, color: true, whatsapp: true, deletedAt: true } },
    },
  });
  if (!order) throw new AppError(NOT_FOUND, 404);

  const currency = orderCurrency(order);
  const events = order.events.filter((e) => EVENT_TEXT[e.type]);
  // Pedidos de antes del historial no tienen el movimiento de creación: se arma con la fecha del pedido.
  if (!events.some((e) => e.type === "CREATED")) events.unshift({ type: "CREATED", detail: null, createdAt: order.createdAt });

  const timeline = events.map((e) => {
    let detail = null;
    // Motivo de una cancelación: el que escribió la tienda o el propio cliente, sin el prefijo interno.
    if (e.type === "CANCELLED" && e.detail) detail = String(e.detail).replace(/^Cliente \([^)]*\):\s*/, "");
    if (e.type === "EDITED_BY_CUSTOMER" && e.detail) detail = String(e.detail).replace(/^Cliente \([^)]*\):\s*/, "");
    return { type: e.type, text: EVENT_TEXT[e.type], detail, at: e.createdAt };
  });
  const at = (type) => timeline.find((e) => e.type === type)?.at ?? null;

  const subtotal = order.items.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
  const deleted = !!order.vendor?.deletedAt;

  res.json({
    order: {
      code: order.code,
      status: order.status,
      createdAt: order.createdAt,
      // Fechas de cada paso del avance (null si todavía no pasó).
      steps: { received: order.createdAt, confirmed: at("CONFIRMED") ?? at("PREPARING"), onTheWay: at("READY"), delivered: at("DELIVERED"), cancelled: at("CANCELLED") },
      cancelReason: order.status === "CANCELLED" ? String(order.cancelReason ?? "").replace(/^Cancelado por el cliente:\s*/, "") || null : null,
      cancelledByCustomer: order.status === "CANCELLED" && String(order.cancelReason ?? "").startsWith("Cancelado por el cliente"),
      payment: channelLabel(order.channel),
      items: order.items.map((i) => ({
        name: i.name,
        size: i.size ?? null,
        quantity: i.quantity,
        unitPrice: money(i.price, i.currency ?? currency),
        lineTotal: money(Number(i.price) * i.quantity, i.currency ?? currency),
        image: i.product?.images?.[0] ?? null,
      })),
      totals: {
        subtotal: money(subtotal, currency),
        discount: Number(order.discountAmount) > 0 ? `-${money(order.discountAmount, currency)}` : null,
        loyalty: Number(order.loyaltyDiscount) > 0 ? `-${money(order.loyaltyDiscount, currency)}` : null,
        products: money(order.total, currency),
        shipping: orderShippingText(order),
        shippingCoordinate: !!order.shippingCoordinate,
        total: orderGrandTotal(order),
      },
      delivery: {
        // Los pedidos de antes unían municipio y dirección con una raya larga; se muestran con coma como los nuevos.
        address: order.shippingAddress ? order.shippingAddress.replace(/\s+—\s+/g, ", ") : null,
        place: await deliveryPlace(order),
        recipient: order.recipientName ?? null,
      },
      customerName: order.customerName ?? null,
      store: deleted
        ? { name: order.vendor.companyName, slug: null, logoUrl: null, color: null, whatsapp: null }
        : { name: order.vendor.companyName, slug: order.vendor.slug, logoUrl: order.vendor.logoUrl, color: order.vendor.color, whatsapp: order.vendor.whatsapp ?? null },
      timeline,
    },
  });
}
