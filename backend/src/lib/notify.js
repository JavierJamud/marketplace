import { prisma, setMutationHook } from "./prisma.js";
import { requestContext } from "./requestContext.js";
import { refreshUsers, sendToUser, connectedCount } from "./realtime.js";
import { pushToUsers } from "./push.js";
import { orderNoticeDetail } from "./orderSummary.js";

// Un solo lugar para avisar a las personas. Cada aviso llega por tres vías según lo que tengan abierto:
//  1. En vivo (canal SSE): las pantallas abiertas se actualizan y, si hay una abierta, muestra el aviso.
//  2. Push: llega al teléfono o al navegador aunque la página esté cerrada (solo si la persona lo activó).
//  3. Lo que ya existía (campanita, correo), que sigue igual.

// Categorías que cada persona puede silenciar (guarda User.pushMuted). `audience` dice a quién se le ofrece.
export const PUSH_CATEGORIES = {
  order_status: { audience: "CLIENT", label: "Estado de mis pedidos", hint: "Confirmado, en preparación, listo, entregado o cancelado." },
  orders: { audience: "VENDOR", label: "Pedidos", hint: "Pedidos nuevos, atrasados y cambios o cancelaciones del cliente." },
  customers: { audience: "VENDOR", label: "Clientes nuevos", hint: "Cuando alguien te compra por primera vez." },
  messages: { audience: "BOTH", label: "Mensajes", hint: "Mensajes nuevos en el chat de tu panel." },
  stock: { audience: "VENDOR", label: "Stock bajo", hint: "Productos que se están agotando." },
  reviews: { audience: "VENDOR", label: "Reseñas", hint: "Reseñas nuevas de tus productos y de tu tienda." },
  account: { audience: "VENDOR", label: "Avisos de la plataforma", hint: "Verificación, suscripción, autorizaciones y respuestas del equipo." },
  vendors: { audience: "ADMIN", label: "Tiendas y verificaciones", hint: "Tiendas nuevas, verificaciones y pagos por revisar." },
  approvals: { audience: "ADMIN", label: "Solicitudes y reportes", hint: "Solicitudes, sugerencias, casos de soporte y reportes." },
  errors: { audience: "ADMIN", label: "Errores", hint: "Errores de la plataforma y de la inteligencia artificial." },
};

const AUDIENCE_CACHE_MS = 60_000;
const caches = { admins: { at: 0, ids: [] }, vendor: new Map() };

export async function adminUserIds() {
  if (Date.now() - caches.admins.at > AUDIENCE_CACHE_MS) {
    const rows = await prisma.user.findMany({ where: { role: "ADMIN", deletedAt: null }, select: { id: true } });
    caches.admins = { at: Date.now(), ids: rows.map((r) => r.id) };
  }
  return caches.admins.ids;
}

// Dueño de la tienda y su personal con acceso al panel.
export async function vendorUserIds(vendorId) {
  const hit = caches.vendor.get(vendorId);
  if (hit && Date.now() - hit.at < AUDIENCE_CACHE_MS) return hit.ids;
  const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { userId: true, staff: { select: { userId: true } } } });
  const ids = v ? [...new Set([v.userId, ...(v.staff ?? []).map((s) => s.userId)])] : [];
  if (caches.vendor.size > 2000) caches.vendor.clear();
  caches.vendor.set(vendorId, { at: Date.now(), ids });
  return ids;
}

// Avisa a personas concretas: en vivo (si tienen la página abierta) y por push.
// `detail` (opcional): datos para la tarjeta del aviso en pantalla (p. ej. un pedido). `app` (CLIENT, VENDOR, ADMIN): a qué app
// instalada va el push si la persona tiene varias en el mismo dispositivo (si no, se elige por la categoría).
// `image`: foto para el aviso del teléfono (Android la muestra grande; iOS no muestra imágenes en avisos web).
// `type`: el tipo de aviso de la tienda (NEW_ORDER, ORDER_OVERDUE...), para que la página decida cómo mostrarlo.
export async function notifyUsers(userIds, { category, title, body, url = "/", tag, ttl, urgency, detail, app, image, type } = {}) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  for (const id of ids) sendToUser(id, "notify", { category, title, body, url, tag, detail, type, at: Date.now() });
  refreshUsers(ids);
  await pushToUsers(ids, { category, title, body, url, tag, ttl, urgency, app: app ?? APP_FOR_AUDIENCE[PUSH_CATEGORIES[category]?.audience], image });
}

const APP_FOR_AUDIENCE = { CLIENT: "CLIENT", VENDOR: "VENDOR", ADMIN: "ADMIN" };

export async function notifyAdmins(payload) {
  await notifyUsers(await adminUserIds(), { app: "ADMIN", ...payload });
}

export async function notifyVendor(vendorId, payload) {
  await notifyUsers(await vendorUserIds(vendorId), payload);
}

// --- Cambios en la base de datos: las pantallas abiertas se actualizan solas --------------------------------------------

// Entidades de negocio que, al cambiar, deben verse al instante en los paneles. Lo que no está aquí (visitas, clics, sesiones,
// registros de actividad, chats) cambia constantemente y no merece refrescar nada.
const WATCHED = new Set([
  "Product", "ProductOption", "ProductPriceTier", "Category", "BusinessCategory", "Vendor", "VendorLocation", "VendorDeliveryCountry",
  "VendorSchedule", "VendorStaff", "VendorStaffAllocation", "VendorStaffSale", "VendorStaffCashClose", "Order", "OrderItem", "OrderEvent",
  "Table", "TableOrder", "VerificationRequest", "VerificationArchive", "SubscriptionPayment", "VendorChangeRequest", "Announcement",
  "Campaign", "Suggestion", "VendorMessage", "VendorNotification", "Review", "Address", "Favorite", "CustomerListing", "Report",
  "ProductRequest", "Offer", "DiscountCode", "StoreOffer", "SupportCase", "VendorCustomer", "User", "PlanConfig", "SiteSettings",
  "Country", "Province", "Municipality", "LocationSuggestion", "ErrorLog", "SupportTicket", "SupportTicketMessage", "Integration", "Partner", "PartnerApplication", "TargetedOffer",
  "PosSale", "CashEntry", "PosSettings", "LoyaltyProgram", "LoyaltyAccount",
]);

// Si solo cambian estos campos (contadores y marcas de actividad) no se refresca nada: pasan con cada visita.
const NOISE_FIELDS = new Set([
  "viewCount", "clickCount", "searchClickCount", "totalDwellMs", "lastActivityAt", "lastLoginAt", "lastSeenAt", "lastLogin", "updatedAt",
  "lowStockNotifiedAt", "salesCount", "rating", "reviewCount",
]);

const WRITE = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany", "createManyAndReturn"]);

function idsFrom(model, args, result) {
  const first = Array.isArray(args?.data) ? args.data[0] : args?.data;
  const vendorId = model === "Vendor" ? result?.id ?? args?.where?.id : result?.vendorId ?? args?.where?.vendorId ?? first?.vendorId ?? null;
  const customerId = model === "Order" ? result?.customerId ?? first?.customerId ?? null : model === "User" ? result?.id ?? args?.where?.id : null;
  return { vendorId: typeof vendorId === "string" ? vendorId : null, customerId: typeof customerId === "string" ? customerId : null };
}

async function onMutation({ model, operation, args, result }) {
  if (!WRITE.has(operation) || !WATCHED.has(model) || connectedCount() === 0) return;
  // Un updateMany/deleteMany que no tocó ninguna fila no cambió nada. Sin esto, tareas que se repiten en cada lectura (como
  // vencer la etiqueta "Nuevo") avisaban "algo cambió" en cada consulta: el panel recargaba, volvía a consultar y la gráfica
  // de ventas del panel de la tienda parpadeaba sin parar.
  if (operation.endsWith("Many") && typeof result?.count === "number" && result.count === 0) return;
  if (operation.startsWith("update") && args?.data && typeof args.data === "object") {
    const keys = Object.keys(args.data);
    if (keys.length && keys.every((k) => NOISE_FIELDS.has(k))) return;
  }
  const { vendorId, customerId } = idsFrom(model, args, result);
  const targets = new Set(await adminUserIds());
  if (vendorId) for (const id of await vendorUserIds(vendorId)) targets.add(id);
  if (customerId) targets.add(customerId);
  refreshUsers([...targets]);
}

// --- Avisos automáticos por tipo de cambio ------------------------------------------------------------------------------

const VENDOR_NOTIF_CATEGORY = {
  NEW_ORDER: "orders", ORDER_CANCELLED_BY_CUSTOMER: "orders", ORDER_EDITED_BY_CUSTOMER: "orders", ORDER_OVERDUE: "orders", SUPPORT_CASE: "orders",
  NEW_CUSTOMER: "customers", NEW_MESSAGE: "messages", LOW_STOCK: "stock", VENDOR_STAFF_OUT_OF_STOCK: "stock",
};
const VENDOR_NOTIF_URL = {
  NEW_ORDER: "/vendedor/pedidos", ORDER_CANCELLED_BY_CUSTOMER: "/vendedor/pedidos", ORDER_EDITED_BY_CUSTOMER: "/vendedor/pedidos",
  ORDER_OVERDUE: "/vendedor/pedidos", NEW_CUSTOMER: "/vendedor/clientes", NEW_MESSAGE: "/vendedor/mensajes", LOW_STOCK: "/vendedor/productos",
  VENDOR_STAFF_OUT_OF_STOCK: "/vendedor/usuarios", SUPPORT_CASE: "/vendedor/pedidos",
};

async function onCreated({ model, args, result }) {
  if (!result) return;
  switch (model) {
    case "VendorNotification": {
      // Hecho por el admin sin marcar "Avisar a la tienda": queda en el historial de la campana, sin push ni aviso en vivo.
      if (requestContext()?.notifyVendor === false) return;
      const cat = VENDOR_NOTIF_CATEGORY[result.type] ?? "account";
      const url = VENDOR_NOTIF_URL[result.type] ?? (String(result.type).startsWith("VERIFICATION") || String(result.type).startsWith("TRIAL") ? "/vendedor/verificacion" : "/vendedor");
      // Los avisos de pedido nuevo ya tienen su propia ventana y sonido en el panel: aquí solo viaja el push y el refresco.
      // Al pedido nuevo se le suma el detalle (productos, quién recibe, dónde) para la tarjeta del aviso y la foto para Android.
      let detail;
      let image;
      if (result.type === "NEW_ORDER" && result.refCode) {
        const order = await prisma.order.findFirst({
          where: { vendorId: result.vendorId, code: result.refCode },
          include: { items: { include: { product: { select: { images: true } } } }, vendor: { select: { companyName: true } } },
        });
        if (order) {
          detail = { ...(await orderNoticeDetail(order)), audience: "vendor" };
          image = detail.image ?? undefined;
        }
      }
      // El de pedido atrasado lleva su propia etiqueta: si usara la del pedido nuevo, el sistema lo trataría como el mismo aviso.
      const tag = result.type === "ORDER_OVERDUE" ? `overdue-${result.refCode}` : `vn-${result.refCode ?? result.id}`;
      const link = result.type === "ORDER_OVERDUE" && result.refCode ? `/vendedor/pedidos?buscar=${encodeURIComponent(result.refCode)}` : url;
      return notifyVendor(result.vendorId, { category: cat, app: "VENDOR", title: result.title, body: result.body, url: link, tag, urgency: cat === "orders" ? "high" : "normal", detail, image, type: result.type });
    }
    case "Vendor": {
      return notifyAdmins({ category: "vendors", title: "Nueva tienda registrada", body: result.companyName ?? "Una tienda nueva se registró.", url: "/admin/tiendas", tag: `vendor-${result.id}` });
    }
    case "VendorMessage": {
      if (result.senderRole === "ADMIN") return notifyVendor(result.vendorId, { category: "messages", title: "Mensaje de la plataforma", body: result.body ?? "Tienes un mensaje nuevo.", url: "/vendedor/mensajes", tag: `msg-${result.vendorId}` });
      const v = await prisma.vendor.findUnique({ where: { id: result.vendorId }, select: { companyName: true } });
      return notifyAdmins({ category: "messages", title: `Mensaje de ${v?.companyName ?? "una tienda"}`, body: result.body ?? "", url: `/admin/mensajes/${result.vendorId}`, tag: `msg-${result.vendorId}` });
    }
    case "Suggestion":
      return notifyAdmins({ category: "approvals", title: "Nueva sugerencia", body: String(result.message ?? result.body ?? result.title ?? "Alguien envió una sugerencia.").slice(0, 140), url: "/admin/sugerencias", tag: `sug-${result.id}` });
    case "SupportCase":
      if (result.vendorId) return notifyVendor(result.vendorId, { category: "orders", title: result.kind === "ORDER" ? "Problema con un pedido" : "Caso de soporte", body: `${result.name ?? "Un cliente"} reportó un problema.`, url: "/vendedor/pedidos", tag: `case-${result.id}` });
      return notifyAdmins({ category: "approvals", title: result.kind === "ORDER" ? "Problema con un pedido" : "Problema con la web", body: result.name ?? "", url: "/admin/casos-soporte", tag: `case-${result.id}` });
    case "Report":
      return notifyAdmins({ category: "approvals", title: "Nuevo reporte", body: "Alguien reportó un producto, una tienda o un anuncio.", url: "/admin/reportes-fraude", tag: `rep-${result.id}` });
    case "Review":
      return notifyVendor(result.vendorId, { category: "reviews", title: "Reseña nueva", body: String(result.comment ?? "").slice(0, 140) || "Recibiste una reseña.", url: "/vendedor/resenas", tag: `rev-${result.id}` });
    case "VendorCustomer": {
      const v = args?.data;
      await prisma.vendorNotification.create({ data: { vendorId: result.vendorId, type: "NEW_CUSTOMER", title: "Cliente nuevo", body: `${result.name ?? v?.name ?? "Un cliente"} te compró por primera vez.` } });
      return;
    }
    // ErrorLog no avisa desde aquí: logError (lib/errorLog.js) ya avisa al admin de cada error nuevo, y los dos juntos
    // mandaban dos alertas por el mismo fallo.
    default:
  }
}

export function installNotifyHooks() {
  setMutationHook((info) => {
    void onMutation(info).catch(() => {});
    if (info.operation === "create") void onCreated(info).catch(() => {});
  });
}

// Aviso al cliente por el movimiento de su pedido (lo llama recordOrderEvent). Los cambios que hizo el propio cliente no se le avisan.
const CUSTOMER_ORDER_COPY = {
  CONFIRMED: ["Pedido confirmado", "La tienda confirmó tu pedido."],
  PREPARING: ["Preparando tu pedido", "La tienda está preparando tu pedido."],
  READY: ["Tu pedido está listo", "Ya puedes recogerlo o va camino a ti."],
  DELIVERED: ["Pedido entregado", "Tu pedido fue entregado. ¡Gracias por comprar!"],
  CANCELLED: ["Pedido cancelado", "La tienda canceló tu pedido."],
  INVOICE_SENT: ["Factura de tu pedido", "La tienda te envió la factura."],
  WARRANTY_SENT: ["Garantía de tu pedido", "La tienda te envió la garantía."],
};

export async function notifyCustomerOrderEvent(orderId, type, detail) {
  const copy = CUSTOMER_ORDER_COPY[type];
  if (!copy || String(detail ?? "").startsWith("Cliente")) return;
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { code: true, customerId: true, vendor: { select: { companyName: true } } } });
  if (!order?.customerId) return;
  const reason = type === "CANCELLED" && detail ? ` Motivo: ${String(detail).slice(0, 100)}` : "";
  await notifyUsers([order.customerId], {
    category: "order_status",
    title: `${copy[0]} · ${order.code}`,
    body: `${order.vendor?.companyName ?? "La tienda"}: ${copy[1]}${reason}`,
    url: "/cuenta/panel?tab=orders",
    tag: `order-${order.code}`,
  });
}

// Aviso del admin a una tienda por un cambio que hoy no tiene aviso propio (bloqueo, desbloqueo, cambio de plan, reactivación).
// Solo si el admin marcó "Avisar a la tienda" en esa acción; queda en la campana del panel y llega como push.
export async function adminNoticeToVendor(vendorId, title, body) {
  if (requestContext()?.notifyVendor !== true) return;
  await prisma.vendorNotification.create({ data: { vendorId, type: "ADMIN_NOTICE", title, body: String(body).slice(0, 500) } }).catch(() => {});
}
