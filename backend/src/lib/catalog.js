import { prisma } from "./prisma.js";
import { connectedUserIds, sendToUser } from "./realtime.js";
import { AppError } from "../utils/AppError.js";

// Monedas y formas de pago que el admin edita (tabla CatalogOption). Productos, tiendas y pedidos guardan el código, que no
// cambia; el nombre visible sale de aquí. Se guarda en memoria y se recarga al editar: casi todas las pantallas y mensajes lo
// leen, y cambia muy pocas veces.

export const KINDS = ["CURRENCY", "PRODUCT_PAYMENT", "CHECKOUT_PAYMENT", "STORE_PAYMENT"];

// Formas que no son del catálogo: el menú QR de mesas marca sus productos con "table" y sus pedidos con TABLE.
const SYSTEM_PRODUCT_PAYMENTS = ["table"];
const SYSTEM_CHANNEL_LABEL = { TABLE: "Pedido de mesa" };

let cache = null;
let loading = null;

async function load() {
  const rows = await prisma.catalogOption.findMany({ orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] });
  cache = rows;
  return rows;
}

export async function getCatalog() {
  if (cache) return cache;
  loading ??= load().finally(() => {
    loading = null;
  });
  return loading;
}

// Para código que no puede esperar (textos de pedidos, PDF). Antes de la primera carga devuelve el código tal cual.
function cached() {
  return cache ?? [];
}

export function optionsOf(rows, kind, { activeOnly = false } = {}) {
  return rows.filter((r) => r.kind === kind && (!activeOnly || r.isActive));
}

export async function activeCodes(kind) {
  return optionsOf(await getCatalog(), kind, { activeOnly: true }).map((r) => r.code);
}

export async function allCodes(kind) {
  return optionsOf(await getCatalog(), kind).map((r) => r.code);
}

export async function universalProductPayment() {
  const rows = optionsOf(await getCatalog(), "PRODUCT_PAYMENT");
  return (rows.find((r) => r.isUniversal) ?? rows[0])?.code ?? "whatsapp";
}

export function currencyLabel(code) {
  if (!code) return "";
  return cached().find((r) => r.kind === "CURRENCY" && r.code === code)?.label ?? code;
}

export function productPaymentLabel(code) {
  return cached().find((r) => r.kind === "PRODUCT_PAYMENT" && r.code === code)?.label ?? code;
}

export function storePaymentLabel(code) {
  return cached().find((r) => r.kind === "STORE_PAYMENT" && r.code === code)?.label ?? code;
}

// Forma de cobro de un pedido (Order.channel guarda el código en mayúsculas).
export function channelLabel(channel) {
  if (!channel) return "";
  if (SYSTEM_CHANNEL_LABEL[channel]) return SYSTEM_CHANNEL_LABEL[channel];
  return cached().find((r) => r.kind === "CHECKOUT_PAYMENT" && r.code.toUpperCase() === channel)?.label ?? channel;
}

export function checkoutLabel(code) {
  return channelLabel(String(code ?? "").toUpperCase());
}

// Validaciones de lo que llega de una tienda o un cliente: solo lo que el admin tiene activo.
export async function assertActiveCurrency(code, what = "La moneda") {
  if (!code) return;
  if (!(await activeCodes("CURRENCY")).includes(code)) throw new AppError(`${what} "${currencyLabel(code)}" ya no está disponible en la plataforma.`, 400);
}

export async function assertActiveProductPayments(codes) {
  if (!codes) return;
  const allowed = new Set([...SYSTEM_PRODUCT_PAYMENTS, ...(await activeCodes("PRODUCT_PAYMENT"))]);
  const rejected = codes.find((c) => !allowed.has(c));
  if (rejected) throw new AppError(`La forma de pago "${productPaymentLabel(rejected)}" ya no está disponible en la plataforma.`, 400);
}

export async function assertActiveCheckoutPayments(codes) {
  if (!codes) return;
  const allowed = new Set(await activeCodes("CHECKOUT_PAYMENT"));
  const rejected = codes.find((c) => !allowed.has(c));
  if (rejected) throw new AppError(`La forma de cobro "${checkoutLabel(rejected)}" ya no está disponible en la plataforma.`, 400);
}

// La forma universal siempre va en cada producto; el plan Regular solo tiene esa.
export async function withUniversalPayment(codes, { onlyUniversal = false } = {}) {
  const universal = await universalProductPayment();
  if (onlyUniversal || !codes?.length) return [universal];
  return codes.includes(universal) ? codes : [universal, ...codes];
}

// Lo que necesita el sitio público para mostrar nombres (incluye las inactivas: hay productos viejos que las usan).
export async function publicCatalog() {
  const rows = await getCatalog();
  const pick = (kind) => optionsOf(rows, kind).map(({ code, label, description, icon, isActive, isUniversal }) => ({ code, label, description, icon, isActive, isUniversal }));
  return {
    currencies: pick("CURRENCY"),
    productPayments: pick("PRODUCT_PAYMENT"),
    checkoutPayments: pick("CHECKOUT_PAYMENT"),
    storePayments: pick("STORE_PAYMENT"),
  };
}

// Cuánto se usa cada opción. Una opción en uso no se puede eliminar: productos, tiendas o pedidos quedarían con un valor huérfano.
export async function usageOf(option) {
  const { kind, code } = option;
  if (kind === "CURRENCY") {
    const [products, stores, orders, listings, discountCodes, posSales, cashEntries] = await Promise.all([
      prisma.product.count({ where: { OR: [{ currency: code }, { shippingCurrency: code }] } }),
      prisma.vendor.count({ where: { OR: [{ currency: code }, { storeShippingCurrency: code }] } }),
      prisma.orderItem.count({ where: { OR: [{ currency: code }, { shippingCurrency: code }] } }),
      prisma.customerListing.count({ where: { currency: code } }),
      prisma.discountCode.count({ where: { currency: code } }),
      prisma.posSale.count({ where: { currency: code } }),
      prisma.cashEntry.count({ where: { currency: code } }),
    ]);
    return { products, stores, orders, listings, discountCodes, posSales: posSales + cashEntries };
  }
  if (kind === "PRODUCT_PAYMENT") {
    return { products: await prisma.product.count({ where: { paymentMethods: { has: code } } }) };
  }
  if (kind === "CHECKOUT_PAYMENT") {
    const [stores, orders] = await Promise.all([
      prisma.vendor.count({ where: { checkoutPaymentOptions: { has: code } } }),
      prisma.order.count({ where: { channel: code.toUpperCase() } }),
    ]);
    return { stores, orders };
  }
  return { stores: await prisma.vendor.count({ where: { acceptedPaymentMethods: { has: code } } }) };
}

export function usageTotal(usage) {
  return Object.values(usage).reduce((a, b) => a + b, 0);
}

// Recarga la memoria y avisa a quien tenga el sitio abierto con sesión: sus pantallas vuelven a pedir los nombres al instante.
export async function catalogChanged() {
  await load();
  const at = Date.now();
  for (const id of connectedUserIds()) sendToUser(id, "catalog", { at });
}

// Se carga al arrancar para que los textos de pedidos y PDF tengan los nombres desde el primer momento.
export async function warmCatalog() {
  try {
    await load();
  } catch (err) {
    console.error("[catálogo] no se pudo cargar:", err.message);
  }
}
