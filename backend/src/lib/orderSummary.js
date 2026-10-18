import { prisma } from "./prisma.js";

// Resumen de un pedido para avisos (push, en vivo) y correos: total en la moneda real del pedido (no siempre CUP), productos,
// quién recibe y dónde. Un solo lugar para que el aviso del teléfono, la tarjeta en pantalla y los correos digan lo mismo.

export const ID_TYPE_LABEL = { CU_ID: "Carné de identidad", OTHER: "Documento" };

// Moneda del pedido: la de sus productos (una tienda vende en una sola moneda; si no hay dato, CUP).
export function orderCurrency(order) {
  return order.items?.find((i) => i.currency)?.currency ?? order.currency ?? "CUP";
}

export function money(n, currency) {
  return `${Number(n ?? 0).toLocaleString("es-CU", { maximumFractionDigits: 2 })} ${currency}`;
}

// "2× Panel solar 625 W, 1× Moto GN125 y 2 más"
export function itemsLine(items, max = 2) {
  const list = (items ?? []).map((i) => `${i.quantity}× ${i.name}`);
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} y ${list.length - max} más`;
}

// Carné de identidad cubano: 11 dígitos; los 6 primeros son la fecha de nacimiento (AAMMDD) y tiene que existir.
export function isValidCubanId(value) {
  const v = String(value ?? "").replace(/\s+/g, "");
  if (!/^\d{11}$/.test(v)) return false;
  const yy = Number(v.slice(0, 2));
  const mm = Number(v.slice(2, 4));
  const dd = Number(v.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1) return false;
  // El séptimo dígito dice el siglo (9 = 1800, 0-5 = 1900, 6-8 = 2000); para validar el día alcanza con un año bisiesto o no.
  const centuryDigit = Number(v[6]);
  const year = (centuryDigit === 9 ? 1800 : centuryDigit <= 5 ? 1900 : 2000) + yy;
  return dd <= new Date(Date.UTC(year, mm, 0)).getUTCDate();
}

// Pasaporte u otro documento: 6 a 20 letras o números (sin espacios ni signos).
export function isValidOtherId(value) {
  return /^[A-Za-z0-9]{6,20}$/.test(String(value ?? "").replace(/\s+/g, ""));
}

export function isValidIdNumber(type, value) {
  return type === "CU_ID" ? isValidCubanId(value) : type === "OTHER" ? isValidOtherId(value) : false;
}

// Lugar de entrega legible: municipio/ciudad (ya va al inicio de shippingAddress), provincia y país.
export async function deliveryPlace(order) {
  if (!order.shippingProvinceId) return null;
  const province = await prisma.province.findUnique({ where: { id: order.shippingProvinceId }, select: { name: true, country: { select: { name: true } } } }).catch(() => null);
  // Algunos países del catálogo están guardados en mayúsculas ("CUBA"): se muestran como nombre propio.
  const titleCase = (s) => (s && s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase()) : s);
  return province ? [titleCase(province.name), titleCase(province.country?.name)].filter(Boolean).join(", ") : null;
}

// Datos para la tarjeta del aviso en pantalla (LiveNotices) y para el texto del push.
export async function orderNoticeDetail(order) {
  const currency = orderCurrency(order);
  const place = await deliveryPlace(order);
  const firstImage = order.items?.find((i) => i.product?.images?.[0])?.product.images[0] ?? null;
  return {
    kind: "order",
    code: order.code,
    store: order.vendor?.companyName ?? null,
    total: money(order.total, currency),
    units: (order.items ?? []).reduce((n, i) => n + i.quantity, 0),
    items: (order.items ?? []).slice(0, 4).map((i) => ({ name: i.name, quantity: i.quantity, size: i.size ?? null })),
    more: Math.max(0, (order.items?.length ?? 0) - 4),
    buyer: order.customerName ?? null,
    recipient: order.recipientName ? { name: order.recipientName, phone: order.recipientPhone ?? null } : null,
    place,
    image: firstImage,
  };
}
