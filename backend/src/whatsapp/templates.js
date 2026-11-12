import { env } from "../config/env.js";

// Textos de los mensajes de WhatsApp. Todo sale de datos del sistema: aquí no interviene ninguna IA.
// Forma de todos: un ícono y el título en negrita, dos o tres líneas con lo que importa, el enlace y el pie con la
// referencia. Cortos a propósito: se leen en la notificación sin abrir el chat.
// WhatsApp marca *negrita* y _cursiva_ con símbolos; por eso se quitan de los datos que escribe la gente.

const FOOTER = "Baznova · Responde BAJA para dejar de recibir estos avisos";

export function clean(text, max = 300) {
  const flat = String(text ?? "").replace(/[*_~`]/g, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

// Texto que escribió el admin (mensaje masivo): conserva los saltos de línea y el formato de WhatsApp que puso a propósito.
function cleanMultiline(text, max) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim());
  const joined = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return joined.length > max ? `${joined.slice(0, max - 1).trimEnd()}…` : joined;
}

function link(url) {
  if (!url || url === "/") return env.frontendUrl;
  if (/^https?:\/\//.test(url)) return url;
  return `${env.frontendUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

function withFooter(lines, ref) {
  const footer = ref ? `${FOOTER} · Ref. ${ref}` : FOOTER;
  return [...lines, "", `_${footer}_`].join("\n");
}

// Quita líneas vacías repetidas y las del principio o el final (pasa cuando un dato no viene).
function tidy(lines) {
  const out = [];
  for (const line of lines) {
    if (line === null || line === undefined || line === false) continue;
    if (line === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(line);
  }
  while (out[out.length - 1] === "") out.pop();
  return out;
}

function heading(icon, title) {
  return `${icon} *${clean(title, 90)}*`;
}

function orderLines(detail) {
  const lines = [];
  for (const item of (detail.items ?? []).slice(0, 5)) {
    lines.push(`• ${item.quantity} × ${clean(item.name, 60)}${item.size ? ` (${clean(item.size, 20)})` : ""}`);
  }
  const more = (detail.more ?? 0) + Math.max(0, (detail.items?.length ?? 0) - 5);
  if (more > 0) lines.push(more === 1 ? "y 1 producto más" : `y ${more} productos más`);
  return lines;
}

// ── Tiendas ───────────────────────────────────────────────────────────────────────────────────────────────

const VENDOR_ICON = {
  NEW_ORDER: "🛒",
  ORDER_OVERDUE: "⏰",
  ORDER_REMINDER: "⏰",
  ORDER_CANCEL_WARNING: "⚠️",
  ORDER_AUTO_CANCELLED: "⛔",
  ORDER_DELAYED: "⏳",
  ORDER_CANCELLED_BY_CUSTOMER: "❌",
  ORDER_EDITED_BY_CUSTOMER: "✏️",
  SUPPORT_CASE: "🆘",
  NEW_CUSTOMER: "🙌",
  NEW_MESSAGE: "💬",
  LOW_STOCK: "📦",
  VENDOR_STAFF_OUT_OF_STOCK: "📦",
};
const VENDOR_CATEGORY_ICON = { orders: "🛒", customers: "🙌", messages: "💬", stock: "📦", reviews: "⭐", account: "🔔" };

const VENDOR_LINK_LABEL = {
  orders: "Ábrelo aquí",
  customers: "Ver tus clientes",
  messages: "Leer el mensaje",
  stock: "Revisar tus productos",
  reviews: "Ver la reseña",
  account: "Abrir tu panel",
};

// Pedido nuevo para la tienda: lo necesario para decidir sin abrir el panel.
function storeNewOrder({ detail, url }) {
  return tidy([
    heading("🛒", `Pedido nuevo · ${detail.code}`),
    "",
    ...orderLines(detail),
    "",
    detail.total ? `Total: *${clean(detail.total, 60)}*` : null,
    detail.shipping ? `Envío: ${clean(detail.shipping, 60)}` : null,
    detail.buyer ? `Cliente: ${clean(detail.buyer, 60)}` : null,
    detail.recipient?.name ? `Recibe: ${clean(detail.recipient.name, 60)}${detail.recipient.phone ? ` (${clean(detail.recipient.phone, 20)})` : ""}` : null,
    detail.place ? `Entrega: ${clean(detail.place, 100)}` : null,
    "",
    `Confírmalo aquí: ${link(url)}`,
  ]);
}

function generic({ title, body, url }, icon, label) {
  return tidy([heading(icon, title), clean(body, 280) || null, "", `${label}: ${link(url)}`]);
}

function isOrderDetail(payload) {
  return payload.detail?.kind === "order" && Boolean(payload.detail.code);
}

// Aviso para la tienda. `payload` es el mismo que recibe notifyVendor (lib/notify.js).
export function vendorNoticeText(payload, ref) {
  const lines = payload.type === "NEW_ORDER" && isOrderDetail(payload)
    ? storeNewOrder(payload)
    : generic(
      payload,
      VENDOR_ICON[payload.type] ?? VENDOR_CATEGORY_ICON[payload.category] ?? "🔔",
      VENDOR_LINK_LABEL[payload.category] ?? "Abrir tu panel",
    );
  return withFooter(lines, ref);
}

// ── Clientes ──────────────────────────────────────────────────────────────────────────────────────────────

// Los avisos de cliente no traen tipo: el ícono sale de cómo empieza el título (lib/notify.js, orders.controller.js...).
const CUSTOMER_ICONS = [
  [/^pedido recibido/i, "🧾"],
  [/^pedido confirmado/i, "✅"],
  [/^preparando/i, "👨‍🍳"],
  [/^tu pedido está listo/i, "📦"],
  [/^pedido entregado/i, "🎉"],
  [/^pedido cancelado/i, "❌"],
  [/no se confirmó/i, "⚠️"],
  [/retraso/i, "⏳"],
  [/activo otra vez/i, "🔄"],
  [/^(factura|garantía)/i, "📄"],
  [/punto/i, "⭐"],
];
function customerIcon(title) {
  return CUSTOMER_ICONS.find(([re]) => re.test(String(title ?? "")))?.[1] ?? "🔔";
}

// Pedido recién hecho, para quien lo compró.
function customerOrder({ title, detail, url }) {
  return tidy([
    heading(customerIcon(title), title),
    `Pedido ${clean(detail.code, 30)}${detail.store ? ` en ${clean(detail.store, 60)}` : ""}`,
    "",
    ...orderLines(detail),
    "",
    detail.total ? `Total: *${clean(detail.total, 60)}*` : null,
    detail.shipping ? `Envío: ${clean(detail.shipping, 60)}` : null,
    detail.place ? `Entrega: ${clean(detail.place, 100)}` : null,
    "",
    "Te avisamos aquí cuando la tienda lo confirme.",
    `Síguelo aquí: ${link(url)}`,
  ]);
}

// Aviso para el cliente. `payload` es el mismo que recibe notifyUsers.
export function customerNoticeText(payload, ref) {
  const lines = isOrderDetail(payload)
    ? customerOrder(payload)
    : generic(payload, customerIcon(payload.title), "Míralo aquí");
  return withFooter(lines, ref);
}

// ── Admin ─────────────────────────────────────────────────────────────────────────────────────────────────

const ADMIN_ICON = { vendors: "🏪", approvals: "📋", errors: "🚨", messages: "💬" };

// Avisos del panel de admin (lo mismo que llega a la campanita y al correo del admin, en corto).
export function adminNoticeText(payload, ref) {
  const lines = generic(payload, ADMIN_ICON[payload.category] ?? "🔔", "Revísalo aquí");
  return withFooter(lines, ref);
}

// Tienda nueva: los datos clave del correo de "tienda nueva" (services/adminReports.service.js).
export function adminNewVendorText(summary, ref) {
  const lines = tidy([
    heading("🏪", "Tienda nueva registrada"),
    `*${clean(summary.companyName, 80)}*`,
    summary.category ? `Rubro: ${clean(summary.category, 60)}` : null,
    summary.place ? `Lugar: ${clean(summary.place, 100)}` : null,
    summary.ownerName ? `Dueño: ${clean(summary.ownerName, 60)}` : null,
    summary.whatsapp ? `WhatsApp: ${clean(summary.whatsapp, 20)}` : null,
    summary.planName ? `Plan: ${clean(summary.planName, 40)}` : null,
    "",
    `Ver la tienda: ${link(`/admin/tiendas/${summary.id}`)}`,
  ]);
  return withFooter(lines, ref);
}

const signedPct = (now, before) => {
  if (!before) return "";
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? " (igual que la semana pasada)" : ` (${pct > 0 ? "+" : ""}${pct} % frente a la semana pasada)`;
};

// Resumen semanal de la plataforma (sábados). Los números del correo, en corto; el análisis completo queda en el correo.
export function adminWeeklyText(report, ref) {
  const s = report.stats ?? {};
  const t = report.traffic ?? {};
  const lines = tidy([
    heading("📊", "Tu semana en Baznova"),
    `Del ${clean(report.rangeLabel, 60)}`,
    "",
    `• Pedidos: ${count(s.orders)}${signedPct(s.orders, s.ordersPrev)}`,
    `• Tiendas nuevas: ${count(report.newVendors?.length ?? 0)}`,
    `• Clientes nuevos: ${count(s.newCustomers)}${signedPct(s.newCustomers, s.newCustomersPrev)}`,
    t.sessions != null ? `• Visitas al sitio: ${count(t.sessions)}${signedPct(t.sessions, t.sessionsPrev)}` : null,
    s.activeStores != null ? `• Tiendas activas: ${count(s.activeStores)}` : null,
    report.scan?.length ? "" : null,
    report.scan?.length ? "*Para revisar*" : null,
    ...(report.scan ?? []).slice(0, 3).map((line) => `• ${clean(line, 140)}`),
    report.insight?.resumen ? "" : null,
    report.insight?.resumen ? clean(report.insight.resumen, 400) : null,
    "",
    "El análisis completo te llegó al correo.",
    `Abrir el panel: ${link("/admin")}`,
  ]);
  return withFooter(lines, ref);
}

// ── Resumen semanal de la tienda ──────────────────────────────────────────────────────────────────────────

// Los números salen de la base; el consejo es el mismo texto del correo y, si la IA no respondió esa semana, el mensaje
// sale igual, sin esa parte (jobs/weeklyVendorSummary.job.js).
const HAVANA = "America/Havana";
const shortDate = (d) => new Intl.DateTimeFormat("es", { day: "numeric", month: "long", timeZone: HAVANA }).format(d);
const count = (n) => new Intl.NumberFormat("es").format(Number(n) || 0);
const plural = (n, one, many) => `${count(n)} ${Number(n) === 1 ? one : many}`;

export function weeklySummaryText({ vendor, stats, pending, insight }, ref) {
  const end = new Date();
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  const lines = [
    heading("📊", "Tu semana en Baznova"),
    `${clean(vendor?.companyName, 80)} · del ${shortDate(start)} al ${shortDate(end)}`,
    "",
    "*Tu vitrina*",
    `• Visitas a tu tienda: ${count(stats.storeViews)}`,
    `• Vistas de tus productos: ${count(stats.productViews)}`,
    `• Clics en tus productos: ${count(stats.clicks)}${stats.visitors ? ` (${plural(stats.visitors, "persona", "personas")})` : ""}`,
  ];
  if (stats.newFavorites) lines.push(`• Favoritos nuevos: ${count(stats.newFavorites)}`);
  if (stats.productRequests) lines.push(`• Pidieron productos agotados: ${count(stats.productRequests)}`);

  lines.push("", "*Tus ventas*", `• Pedidos: ${count(stats.orders)}${stats.cancelled ? ` (${plural(stats.cancelled, "cancelado", "cancelados")})` : ""}`);
  if (stats.sales) lines.push(`• Vendiste: ${count(stats.sales)} ${clean(stats.currency, 8)}`);
  if (stats.avgResponseMinutes != null) lines.push(`• Respondiste en ${plural(stats.avgResponseMinutes, "minuto", "minutos")} de promedio`);
  if (stats.autoCancelled) lines.push(`• Se cerraron solos por no responder: ${count(stats.autoCancelled)}`);

  const top = (stats.topProducts ?? []).slice(0, 3);
  if (top.length) {
    lines.push("", "*Lo más visto*");
    top.forEach((p, i) => lines.push(`${i + 1}. ${clean(p.name, 50)} (${plural(p.clicks, "clic", "clics")})`));
  }
  if (pending?.length) {
    lines.push("", "*Pendiente ahora*");
    for (const p of pending.slice(0, 3)) lines.push(`• ${clean(p.label, 120)}`);
  }
  const advice = clean(insight?.resumen, 450);
  if (advice) lines.push("", "*Consejo de la semana*", advice);
  lines.push("", `Abre tu panel: ${link("/vendedor")}`);
  return withFooter(lines, ref);
}

// ── Mensaje masivo del admin a las tiendas ────────────────────────────────────────────────────────────────

// Cada mensaje empieza con el nombre de la tienda: así no salen cientos de textos idénticos, que es lo que WhatsApp
// marca como envío masivo no deseado.
export const BROADCAST_MAX = 700;
export function broadcastText({ companyName, message, url }, ref) {
  return withFooter(tidy([
    `Hola, *${clean(companyName, 60)}* 👋`,
    "",
    cleanMultiline(message, BROADCAST_MAX),
    url ? "" : null,
    url ? link(url) : null,
  ]), ref);
}

// ── Mensajes sueltos ──────────────────────────────────────────────────────────────────────────────────────

export const CODE_MINUTES = 10;

export function verificationText(code) {
  return `🔐 Tu código de Baznova es *${code}*\n\nEscríbelo en la web para confirmar este WhatsApp. Vence en ${CODE_MINUTES} minutos. Si no lo pediste, ignora este mensaje.`;
}

export function testText() {
  return [heading("✅", "Mensaje de prueba de Baznova"), "Si lo estás leyendo, el WhatsApp de la plataforma está enviando bien."].join("\n");
}

export const OPT_OUT_REPLY = "Listo, no recibirás más avisos de Baznova por WhatsApp. Si cambias de idea, actívalos otra vez desde tu perfil.";
