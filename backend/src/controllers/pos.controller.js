import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { planAllows } from "../lib/planConfig.js";
import { logActivity, actorRoleForVendorAction } from "../lib/activityLog.js";
import { deleteUploadedImages } from "../lib/uploadFiles.js";
import { assertBarcodeFree } from "./products.controller.js";
import { recordOrderEvent } from "../lib/orderEvents.js";

// Caja con código de barras (ver PosSale en schema.prisma). Todo lo que cobra o descuenta stock se decide aquí: el panel
// solo manda qué se escaneó y cuánto efectivo entregó el cliente.

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin O/0 ni I/1, que se confunden al decirlos en voz alta
const CODE_WINDOW_MS = 24 * 60 * 60 * 1000;
const DISPLAY_ACTIVE_MS = 30 * 60 * 1000; // una venta abierta sin tocar en 30 min deja de mostrarse en la pantalla del cliente
const DISPLAY_THANKS_MS = 10 * 1000; // después de cobrar, la pantalla muestra el número y el vuelto unos segundos
const MAX_LINES = 100;

const money = (n) => Math.round(Number(n) * 100) / 100;
const token = () => crypto.randomBytes(18).toString("base64url");

async function newCode(vendorId) {
  const since = new Date(Date.now() - CODE_WINDOW_MS);
  for (let i = 0; i < 20; i++) {
    const code = Array.from(crypto.randomBytes(4), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    const taken = await prisma.posSale.findFirst({ where: { vendorId, code, createdAt: { gte: since } }, select: { id: true } });
    if (!taken) return code;
  }
  throw new AppError("No se pudo generar el número de la venta. Intenta de nuevo.", 503);
}

async function settingsFor(vendorId) {
  const existing = await prisma.posSettings.findUnique({ where: { vendorId } });
  if (existing) return existing;
  return prisma.posSettings.upsert({ where: { vendorId }, create: { vendorId, displayToken: token(), boardToken: token() }, update: {} });
}

function totalOf(items) {
  return money(items.reduce((s, i) => s + Number(i.price) * i.quantity, 0));
}

async function ownSale(vendorId, id, statuses) {
  const sale = await prisma.posSale.findUnique({ where: { id } });
  if (!sale || sale.vendorId !== vendorId) throw new AppError("Venta no encontrada.", 404);
  if (statuses && !statuses.includes(sale.status)) throw new AppError("Esta venta ya se cerró y no se puede cambiar.", 409);
  return sale;
}

// Un producto se puede vender en la caja si es de la tienda, está activo y no lleva tallas (cada talla tiene su propio stock
// y el escáner no sabe cuál es).
function assertSellable(product) {
  if (!product.isActive) throw new AppError(`"${product.name}" está pausado. Actívalo para venderlo.`, 409);
  if (product.sizes?.length) throw new AppError(`"${product.name}" tiene tallas: véndelo desde Pedidos o Ventas manuales.`, 409);
}

// Bloquea la fila de la venta hasta terminar la transacción: con un lector USB rápido llegan dos escaneos casi a la vez y,
// sin esto, el segundo podía pisar al primero y perderse un producto.
async function lockSale(tx, vendorId, id, statuses) {
  await tx.$queryRaw`SELECT id FROM "PosSale" WHERE id = ${id} FOR UPDATE`;
  const sale = await tx.posSale.findUnique({ where: { id } });
  if (!sale || sale.vendorId !== vendorId) throw new AppError("Venta no encontrada.", 404);
  if (statuses && !statuses.includes(sale.status)) throw new AppError("Esta venta ya se cerró y no se puede cambiar.", 409);
  return sale;
}

async function addProductToSale({ vendor, saleId, product, quantity, userId }) {
  assertSellable(product);
  const code = saleId ? null : await newCode(vendor.id);
  return prisma.$transaction(async (tx) => {
    const sale = saleId
      ? await lockSale(tx, vendor.id, saleId, ["OPEN"])
      : await tx.posSale.create({ data: { vendorId: vendor.id, code, currency: product.currency ?? vendor.currency ?? "CUP", createdById: userId } });
    return addToLockedSale(tx, sale, product, quantity);
  });
}

async function addToLockedSale(tx, sale, product, quantity) {
  if (sale.items.length > 0 && product.currency !== sale.currency) {
    throw new AppError(`"${product.name}" tiene precio en ${product.currency} y esta venta está en ${sale.currency}. Cóbralo en otra venta.`, 409);
  }
  const items = [...sale.items];
  const line = items.find((i) => i.productId === product.id);
  const nextQty = (line?.quantity ?? 0) + quantity;
  if (!product.unlimitedStock && nextQty > product.stock) {
    throw new AppError(`Solo quedan ${product.stock} de "${product.name}".`, 409);
  }
  if (line) {
    line.quantity = nextQty;
    line.addedAt = Date.now();
  } else {
    if (items.length >= MAX_LINES) throw new AppError("La venta ya tiene demasiados productos distintos.", 400);
    items.push({ productId: product.id, name: product.name, price: Number(product.price), currency: product.currency, quantity, barcode: product.barcode ?? null, addedAt: Date.now() });
  }
  return tx.posSale.update({ where: { id: sale.id }, data: { items, total: totalOf(items), currency: items.length ? sale.currency : product.currency } });
}

// --- Panel -----------------------------------------------------------------

function startOfToday(tz = "America/Havana") {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const offset = now.getTime() - local.getTime();
  local.setHours(0, 0, 0, 0);
  return new Date(local.getTime() + offset);
}

async function cashSummary(vendor) {
  const since = startOfToday(vendor.timezone);
  const [entries, paid] = await Promise.all([
    prisma.cashEntry.findMany({ where: { vendorId: vendor.id, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.posSale.groupBy({ by: ["paymentMethod", "currency"], where: { vendorId: vendor.id, status: "PAID", paidAt: { gte: since } }, _sum: { total: true }, _count: { _all: true } }),
  ]);
  const byCurrency = {};
  for (const e of entries) byCurrency[e.currency] = money((byCurrency[e.currency] ?? 0) + Number(e.amount));
  return {
    since,
    cashInDrawer: byCurrency,
    sales: paid.map((p) => ({ method: p.paymentMethod, currency: p.currency, total: money(p._sum.total ?? 0), count: p._count._all })),
    entries: entries.map((e) => ({ id: e.id, type: e.type, amount: Number(e.amount), currency: e.currency, note: e.note, posSaleId: e.posSaleId, createdAt: e.createdAt })),
  };
}

// Fotos de los productos de varias ventas (las líneas guardan solo id, nombre y precio).
async function imagesFor(sales) {
  const ids = [...new Set(sales.flatMap((s) => s.items.map((i) => i.productId)))];
  if (!ids.length) return new Map();
  const products = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, images: true } });
  return new Map(products.map((p) => [p.id, p.images?.[0] ?? null]));
}

const withImages = (sale, images) => ({ ...sale, items: sale.items.map((i) => ({ ...i, image: images.get(i.productId) ?? null })) });

// Pedidos "Listo para recoger" que nadie marcó como recogidos: pasado el tiempo que eligió la tienda se dan por recogidos, salen
// de la pantalla de pedidos y su pedido en Pedidos pasa a Entregado. Se hace al consultar el panel o la pantalla (sin tarea
// programada): cualquiera de las dos que esté abierta la mantiene al día.
async function autoPickupExpired(vendorId, minutes) {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);
  const expired = await prisma.posSale.findMany({ where: { vendorId, status: "PAID", fulfillment: "READY", readyAt: { lt: cutoff } }, select: { id: true, orderId: true } });
  if (!expired.length) return;
  const now = new Date();
  await prisma.posSale.updateMany({ where: { id: { in: expired.map((s) => s.id) }, fulfillment: "READY" }, data: { fulfillment: "PICKED_UP", pickedUpAt: now } });
  for (const s of expired) {
    if (!s.orderId) continue;
    const r = await prisma.order.updateMany({ where: { id: s.orderId, status: { in: ["PREPARING", "READY"] } }, data: { status: "DELIVERED" } });
    if (r.count) await recordOrderEvent(s.orderId, "DELIVERED", `Recogido (se dio por recogido a los ${minutes} min de estar listo)`).catch(() => {});
  }
}

export async function getState(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const since = startOfToday(vendor.timezone);
  const posSettings = await settingsFor(vendor.id);
  await autoPickupExpired(vendor.id, posSettings.readyAutoClearMinutes);
  const [settings, open, pendingTable, todayRaw, cash] = await Promise.all([
    settingsFor(vendor.id),
    prisma.posSale.findMany({ where: { vendorId: vendor.id, status: "OPEN" }, orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.posSale.findMany({ where: { vendorId: vendor.id, status: "PENDING_TABLE" }, orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.posSale.findMany({ where: { vendorId: vendor.id, status: { in: ["PAID", "SENT_TO_TABLE"] }, OR: [{ paidAt: { gte: since } }, { updatedAt: { gte: since } }] }, orderBy: { paidAt: "desc" }, take: 80 }),
    cashSummary(vendor),
  ]);
  const images = await imagesFor([...open, ...pendingTable, ...todayRaw]);
  const staffIds = [...new Set(todayRaw.map((s) => s.createdById))];
  const staff = staffIds.length ? await prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, fullName: true } }) : [];
  const nameOf = new Map(staff.map((u) => [u.id, u.fullName]));
  res.json({
    currency: vendor.currency ?? "CUP",
    isRestaurant: !!vendor.isRestaurant,
    settings: { displayToken: settings.displayToken, boardToken: settings.boardToken, idleImageUrl: settings.idleImageUrl, readyAutoClearMinutes: settings.readyAutoClearMinutes, idleMode: settings.idleMode },
    open: open.map((s) => withImages(s, images)),
    pendingTable: pendingTable.map((s) => withImages(s, images)),
    today: todayRaw.map((s) => ({ ...withImages(s, images), createdByName: nameOf.get(s.createdById) ?? null })),
    cash,
  });
}

const scanSchema = z.object({ barcode: z.string().trim().min(1).max(60), saleId: z.string().max(40).optional() });

// Escaneo: busca el producto por su código; sin venta abierta, la crea. Escanear dos veces suma una unidad más.
export async function scan(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { barcode, saleId } = scanSchema.parse(req.body);
  const product = await prisma.product.findFirst({ where: { vendorId: vendor.id, barcode } });
  if (!product) return res.status(404).json({ error: `Ningún producto tiene el código ${barcode}.`, unknownBarcode: barcode });
  const sale = await addProductToSale({ vendor, saleId, product, quantity: 1, userId: req.user.id });
  res.json({ sale, added: { productId: product.id, name: product.name } });
}

export async function createSale(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { customerName } = z.object({ customerName: z.string().trim().max(40).optional() }).parse(req.body ?? {});
  const sale = await prisma.posSale.create({ data: { vendorId: vendor.id, code: await newCode(vendor.id), currency: vendor.currency ?? "CUP", customerName: customerName || null, createdById: req.user.id } });
  res.status(201).json({ sale });
}

export async function addItem(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { productId, quantity } = z.object({ productId: z.string().min(1).max(40), quantity: z.number().int().min(1).max(999).default(1) }).parse(req.body);
  const product = await prisma.product.findFirst({ where: { id: productId, vendorId: vendor.id } });
  if (!product) throw new AppError("Producto no encontrado.", 404);
  const sale = await addProductToSale({ vendor, saleId: req.params.id === "new" ? null : req.params.id, product, quantity, userId: req.user.id });
  res.json({ sale });
}

export async function setItemQuantity(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { quantity } = z.object({ quantity: z.number().int().min(0).max(999) }).parse(req.body);
  const updated = await prisma.$transaction(async (tx) => {
    const sale = await lockSale(tx, vendor.id, req.params.id, ["OPEN"]);
    let items = sale.items.map((i) => ({ ...i }));
    const line = items.find((i) => i.productId === req.params.productId);
    if (!line) throw new AppError("Ese producto no está en la venta.", 404);
    if (quantity > line.quantity) {
      const product = await tx.product.findUnique({ where: { id: line.productId }, select: { stock: true, unlimitedStock: true, name: true } });
      if (product && !product.unlimitedStock && quantity > product.stock) throw new AppError(`Solo quedan ${product.stock} de "${product.name}".`, 409);
    }
    if (quantity === 0) items = items.filter((i) => i.productId !== line.productId);
    else line.quantity = quantity;
    return tx.posSale.update({ where: { id: sale.id }, data: { items, total: totalOf(items) } });
  });
  res.json({ sale: updated });
}

export async function updateSale(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { customerName } = z.object({ customerName: z.string().trim().max(40).nullable() }).parse(req.body);
  const sale = await ownSale(vendor.id, req.params.id, ["OPEN", "PENDING_TABLE", "PAID"]);
  const updated = await prisma.posSale.update({ where: { id: sale.id }, data: { customerName: customerName || null } });
  if (updated.orderId) await prisma.order.update({ where: { id: updated.orderId }, data: { customerName: customerName || `Caja ${sale.code}` } }).catch(() => {});
  res.json({ sale: updated });
}

const paySchema = z.object({
  method: z.enum(["CASH", "CARD", "TRANSFER"]),
  cashReceived: z.number().nonnegative().max(1e9).optional(),
});

// Cobro en caja. En una sola transacción: descuenta el stock (si no alcanza, no se cobra nada), suma las ventas del producto,
// registra el pedido en Pedidos (cuenta en estadísticas desde ya) y, si fue en efectivo, los movimientos de caja. El pedido
// nace "Preparando" y avanza junto con la venta: Listo para recoger y Recogido (= Entregado) se marcan desde cualquiera de las
// dos pantallas.
export async function pay(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { method, cashReceived } = paySchema.parse(req.body);
  let sale;
  let total;
  let change;
  const updated = await prisma.$transaction(async (tx) => {
    // Se bloquea y se vuelve a leer aquí dentro: así se cobra exactamente lo que tiene la venta en este momento (un escaneo
    // que llegó justo antes cuenta) y nadie más la cobra a la vez (dos cajeros, doble toque).
    sale = await tx.posSale.findUnique({ where: { id: req.params.id }, select: { id: true } }).then(async (found) => {
      if (!found) throw new AppError("Venta no encontrada.", 404);
      return lockSale(tx, vendor.id, found.id, null);
    });
    if (sale.status === "PAID") throw new AppError("Esta venta ya se cobró.", 409);
    if (!["OPEN", "PENDING_TABLE"].includes(sale.status)) throw new AppError("Esta venta ya se cerró y no se puede cobrar.", 409);
    if (!sale.items.length) throw new AppError("La venta no tiene productos.", 400);
    total = money(sale.total);
    if (method === "CASH" && (cashReceived == null || cashReceived < total)) {
      throw new AppError(`El efectivo recibido no alcanza: faltan ${money(total - (cashReceived ?? 0))} ${sale.currency}.`, 400);
    }
    change = method === "CASH" ? money(cashReceived - total) : null;
    await tx.posSale.update({ where: { id: sale.id }, data: { status: "PAID" } });
    for (const item of sale.items) {
      const product = await tx.product.findUnique({ where: { id: item.productId }, select: { unlimitedStock: true, name: true, stock: true } });
      if (!product) continue; // borrado después de escanearlo: se cobra igual, sin stock que descontar
      if (!product.unlimitedStock) {
        const r = await tx.product.updateMany({ where: { id: item.productId, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity } } });
        if (r.count === 0) throw new AppError(`Ya no alcanza el stock de "${product.name}" (quedan ${product.stock}). Ajusta la cantidad.`, 409);
      }
      await tx.product.updateMany({ where: { id: item.productId }, data: { salesCount: { increment: item.quantity }, lastActivityAt: new Date() } });
    }
    const order = await tx.order.create({
      data: {
        code: `CJ-${sale.code}-${Date.now().toString(36).toUpperCase().slice(-4)}`,
        vendorId: vendor.id,
        customerName: sale.customerName ?? `Caja ${sale.code}`,
        channel: "CASH",
        notificationChannel: "PANEL",
        status: "PREPARING",
        total,
        items: { create: sale.items.map((i) => ({ productId: i.productId, name: i.name, price: i.price, currency: i.currency, quantity: i.quantity })) },
      },
    });
    if (method === "CASH") {
      await tx.cashEntry.create({ data: { vendorId: vendor.id, type: "SALE", amount: cashReceived, currency: sale.currency, posSaleId: sale.id, createdById: req.user.id, note: `Venta ${sale.code}` } });
      if (change > 0) await tx.cashEntry.create({ data: { vendorId: vendor.id, type: "CHANGE", amount: -change, currency: sale.currency, posSaleId: sale.id, createdById: req.user.id, note: `Vuelto venta ${sale.code}` } });
    }
    return tx.posSale.update({
      where: { id: sale.id },
      data: { paymentMethod: method, cashReceived: method === "CASH" ? cashReceived : null, changeGiven: change, paidAt: new Date(), fulfillment: "PREPARING", orderId: order.id },
    });
  });
  await recordOrderEvent(updated.orderId, "PREPARING", `Cobrado en caja (${method === "CASH" ? "efectivo" : method === "CARD" ? "tarjeta" : "transferencia"}), pedido ${sale.code}`).catch(() => {});
  logActivity({ actorId: req.user.id, actorRole: actorRoleForVendorAction(req), vendorId: vendor.id, action: "pos_sale_paid", description: `Cobró la venta de caja ${sale.code}`, meta: { posSaleId: sale.id, total } });
  res.json({ sale: updated, change });
}

// Restaurantes: la venta queda pendiente hasta que se escanea el QR de la mesa (desde la caja) o el cliente escribe el número
// en la página de su mesa.
export async function sendToTable(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  if (!vendor.isRestaurant) throw new AppError("Solo los restaurantes tienen mesas.", 400);
  const sale = await ownSale(vendor.id, req.params.id, ["OPEN"]);
  if (!sale.items.length) throw new AppError("La venta no tiene productos.", 400);
  const updated = await prisma.posSale.update({ where: { id: sale.id }, data: { status: "PENDING_TABLE" } });
  res.json({ sale: updated });
}

// Pasa una venta pendiente a la cuenta de una mesa: si la mesa ya tiene cuenta abierta se suma a ella; si no, se abre una.
// El stock se descuenta aquí, igual que cuando el mesero abre una cuenta a mano.
export async function attachSaleToTable({ sale, table, actorName }) {
  if (sale.status !== "PENDING_TABLE") throw new AppError("Esta venta no está esperando una mesa.", 409);
  if (table.vendorId !== sale.vendorId) throw new AppError("Ese QR es de otra tienda.", 400);
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.posSale.updateMany({ where: { id: sale.id, status: "PENDING_TABLE" }, data: { status: "SENT_TO_TABLE", tableNumber: table.tableNumber } });
    if (claimed.count === 0) throw new AppError("Esta venta ya se pasó a una mesa.", 409);
    const newItems = [];
    for (const item of sale.items) {
      const product = await tx.product.findUnique({ where: { id: item.productId }, select: { unlimitedStock: true, name: true, stock: true } });
      if (product && !product.unlimitedStock) {
        const r = await tx.product.updateMany({ where: { id: item.productId, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity } } });
        if (r.count === 0) throw new AppError(`Ya no alcanza el stock de "${product.name}" (quedan ${product.stock}).`, 409);
      }
      newItems.push({ id: crypto.randomUUID(), productId: item.productId, name: item.name, price: item.price, quantity: item.quantity, source: "staff", addedByName: actorName ?? `Caja ${sale.code}`, status: "PREPARING" });
    }
    const open = await tx.tableOrder.findFirst({ where: { tableId: table.id, cancelledAt: null, clearedAt: null } });
    const tableOrder = open
      ? await tx.tableOrder.update({ where: { id: open.id }, data: { items: [...open.items, ...newItems], total: money(Number(open.total) + totalOf(newItems)) } })
      : await tx.tableOrder.create({ data: { tableId: table.id, items: newItems, total: totalOf(newItems), kitchenStatus: "PREPARING", customerName: sale.customerName || `Mesa #${table.tableNumber}` } });
    const updated = await tx.posSale.update({ where: { id: sale.id }, data: { tableOrderId: tableOrder.id } });
    return { sale: updated, tableOrder };
  });
}

// El QR de la mesa guarda la dirección /mesa/<token>; se acepta la dirección completa o solo el token.
const qrTokenFrom = (value) => {
  const m = String(value).match(/mesa\/([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : String(value).trim();
};

export async function attachToTable(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { qr } = z.object({ qr: z.string().trim().min(5).max(300) }).parse(req.body);
  const sale = await ownSale(vendor.id, req.params.id, ["PENDING_TABLE"]);
  const table = await prisma.table.findUnique({ where: { qrToken: qrTokenFrom(qr) } });
  if (!table || table.vendorId !== vendor.id) throw new AppError("Ese código no es el QR de una de tus mesas.", 400);
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { fullName: true } });
  const result = await attachSaleToTable({ sale, table, actorName: user?.fullName });
  res.json(result);
}

export async function cancelSale(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const sale = await ownSale(vendor.id, req.params.id, ["OPEN", "PENDING_TABLE"]);
  const updated = await prisma.posSale.update({ where: { id: sale.id }, data: { status: "CANCELLED" } });
  res.json({ sale: updated });
}

// Estado de un pedido de caja ↔ estado del pedido en Pedidos.
export const ORDER_STATUS_FOR_FULFILLMENT = { PREPARING: "PREPARING", READY: "READY", PICKED_UP: "DELIVERED" };
export const FULFILLMENT_FOR_ORDER_STATUS = { PREPARING: "PREPARING", READY: "READY", DELIVERED: "PICKED_UP" };
const FULFILLMENT_EVENT = { READY: "Listo para recoger", PICKED_UP: "Recogido por el cliente" };

export async function setFulfillment(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { fulfillment } = z.object({ fulfillment: z.enum(["PREPARING", "READY", "PICKED_UP"]) }).parse(req.body);
  const sale = await ownSale(vendor.id, req.params.id, ["PAID"]);
  const now = new Date();
  const updated = await prisma.posSale.update({
    where: { id: sale.id },
    data: { fulfillment, ...(fulfillment === "READY" ? { readyAt: now } : {}), ...(fulfillment === "PICKED_UP" ? { pickedUpAt: now } : {}) },
  });
  if (sale.orderId) {
    const status = ORDER_STATUS_FOR_FULFILLMENT[fulfillment];
    const r = await prisma.order.updateMany({ where: { id: sale.orderId, status: { notIn: ["CANCELLED", status] } }, data: { status } });
    if (r.count && FULFILLMENT_EVENT[fulfillment]) await recordOrderEvent(sale.orderId, status, FULFILLMENT_EVENT[fulfillment]).catch(() => {});
  }
  res.json({ sale: updated });
}

// Ajustes de las pantallas: cuánto tiempo se queda un pedido listo en la pantalla de pedidos.
export async function updatePosSettings(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const data = z
    .object({
      readyAutoClearMinutes: z.number().int().min(2, "Mínimo 2 minutos.").max(240, "Máximo 4 horas.").optional(),
      idleMode: z.enum(["SHOWCASE", "IMAGE"]).optional(),
    })
    .parse(req.body);
  const current = await settingsFor(vendor.id);
  if (data.idleMode === "IMAGE" && !current.idleImageUrl) throw new AppError("Sube primero la imagen que quieres mostrar.", 400);
  const settings = await prisma.posSettings.update({ where: { vendorId: vendor.id }, data });
  res.json({ settings: { displayToken: settings.displayToken, boardToken: settings.boardToken, idleImageUrl: settings.idleImageUrl, readyAutoClearMinutes: settings.readyAutoClearMinutes, idleMode: settings.idleMode } });
}

export async function addCashEntry(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { type, amount, note, currency } = z
    .object({
      type: z.enum(["DEPOSIT", "WITHDRAWAL"]),
      amount: z.number().positive("Escribe un monto mayor que 0.").max(1e9),
      note: z.string().trim().min(3, "Escribe el motivo.").max(200),
      currency: z.enum(["CUP", "USD", "EUR", "MXN"]).optional(),
    })
    .parse(req.body);
  const entry = await prisma.cashEntry.create({
    data: { vendorId: vendor.id, type, amount: type === "WITHDRAWAL" ? -amount : amount, currency: currency ?? vendor.currency ?? "CUP", note, createdById: req.user.id },
  });
  res.status(201).json({ entry, cash: await cashSummary(vendor) });
}

export async function searchProducts(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const q = String(req.query.q ?? "").trim().slice(0, 60);
  if (q.length < 2) return res.json({ products: [] });
  const products = await prisma.product.findMany({
    where: { vendorId: vendor.id, OR: [{ name: { contains: q, mode: "insensitive" } }, { barcode: q }] },
    select: { id: true, name: true, price: true, currency: true, stock: true, unlimitedStock: true, barcode: true, isActive: true, images: true, sizes: true },
    orderBy: [{ isActive: "desc" }, { salesCount: "desc" }],
    take: 12,
  });
  res.json({ products: products.map((p) => ({ ...p, price: Number(p.price), hasSizes: p.sizes.length > 0, sizes: undefined, image: p.images[0] ?? null, images: undefined })) });
}

// Escaneó un código que ningún producto tiene: se lo asigna a un producto desde la misma caja.
export async function assignBarcode(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { productId, barcode } = z.object({ productId: z.string().min(1).max(40), barcode: z.string().trim().regex(/^[A-Za-z0-9.-]{3,40}$/, "El código admite de 3 a 40 letras o números.") }).parse(req.body);
  const product = await prisma.product.findFirst({ where: { id: productId, vendorId: vendor.id } });
  if (!product) throw new AppError("Producto no encontrado.", 404);
  await assertBarcodeFree(vendor.id, barcode, product.id);
  await prisma.product.update({ where: { id: product.id }, data: { barcode } });
  res.json({ product: { id: product.id, name: product.name, barcode } });
}

export async function regenerateLink(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { which } = z.object({ which: z.enum(["display", "board"]) }).parse(req.body);
  await settingsFor(vendor.id);
  const settings = await prisma.posSettings.update({ where: { vendorId: vendor.id }, data: which === "display" ? { displayToken: token() } : { boardToken: token() } });
  res.json({ settings: { displayToken: settings.displayToken, boardToken: settings.boardToken, idleImageUrl: settings.idleImageUrl } });
}

export async function uploadIdleImage(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  if (!req.file) throw new AppError("Sube una imagen.", 400);
  const before = await settingsFor(vendor.id);
  const settings = await prisma.posSettings.update({ where: { vendorId: vendor.id }, data: { idleImageUrl: `/uploads/vendor-branding/${req.file.filename}`, idleMode: "IMAGE" } });
  if (before.idleImageUrl) void deleteUploadedImages([before.idleImageUrl]);
  res.json({ settings: { displayToken: settings.displayToken, boardToken: settings.boardToken, idleImageUrl: settings.idleImageUrl } });
}

export async function removeIdleImage(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const before = await settingsFor(vendor.id);
  const settings = await prisma.posSettings.update({ where: { vendorId: vendor.id }, data: { idleImageUrl: null, idleMode: "SHOWCASE" } });
  if (before.idleImageUrl) void deleteUploadedImages([before.idleImageUrl]);
  res.json({ settings: { displayToken: settings.displayToken, boardToken: settings.boardToken, idleImageUrl: settings.idleImageUrl } });
}

// --- Pantallas públicas (enlace secreto) --------------------------------------

const publicVendor = (v) => ({ name: v.companyName, logoUrl: v.logoUrl, color: v.color, timezone: v.timezone ?? "America/Havana" });
const publicItems = (items, images = new Map()) => items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price, image: images.get(i.productId) ?? null, addedAt: i.addedAt ?? null }));

// Vitrina animada de la pantalla del cliente (sin venta en curso). Devuelve:
//  - products: hasta 24 productos activos, con stock y foto, para la cuadrícula que se desplaza;
//  - spotlight: los que se "abren" en grande, en este orden de prioridad: los más vendidos de los últimos 14 días (demanda real),
//    los que están en oferta (precio anterior mayor) y los más vistos o con más clics; cada uno dice por qué se destaca;
//  - offers: las ofertas de tienda activas, con su código de descuento, que se abren intercaladas.
// Se guarda 5 minutos por tienda: la pantalla consulta cada segundo y medio.
const SHOWCASE_MS = 5 * 60 * 1000;
const showcaseCache = new Map();
const shortText = (t, max) => (!t ? null : t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, "")}…` : t);

async function showcaseFor(vendorId) {
  const hit = showcaseCache.get(vendorId);
  if (hit && Date.now() - hit.at < SHOWCASE_MS) return hit.data;
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const [products, recent, offers] = await Promise.all([
    prisma.product.findMany({
      where: { vendorId, isActive: true, hiddenFromStore: false, overQuota: false, images: { isEmpty: false }, OR: [{ unlimitedStock: true }, { stock: { gt: 0 } }] },
      select: { id: true, name: true, price: true, oldPrice: true, currency: true, images: true, description: true, salesCount: true, clickCount: true, viewCount: true, activatedAt: true },
      take: 300,
    }),
    prisma.orderItem.groupBy({
      by: ["productId"],
      where: { productId: { not: null }, order: { vendorId, status: { not: "CANCELLED" }, createdAt: { gte: since } } },
      _sum: { quantity: true },
    }),
    prisma.storeOffer.findMany({
      where: { vendorId, active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] }] },
      include: { discountCode: { select: { code: true, type: true, value: true, currency: true, active: true } } },
      take: 5,
    }),
  ]);
  const sold14 = new Map(recent.map((r) => [r.productId, r._sum.quantity ?? 0]));
  const score = (p) => (sold14.get(p.id) ?? 0) * 10 + p.salesCount * 3 + p.clickCount * 2 + p.viewCount / 5;
  const ranked = [...products].sort((x, y) => score(y) - score(x));
  const isNew = (p) => p.activatedAt && Date.now() - new Date(p.activatedAt).getTime() < 14 * 24 * 60 * 60 * 1000;
  const reasonOf = (p) => {
    const recentSold = sold14.get(p.id) ?? 0;
    if (recentSold > 0) return { kind: "demand", label: recentSold === 1 ? "Se está vendiendo" : `${recentSold} vendidos estas dos semanas` };
    if (p.oldPrice != null && Number(p.oldPrice) > Number(p.price)) return { kind: "offer", label: `Oferta: -${Math.round((1 - Number(p.price) / Number(p.oldPrice)) * 100)} %` };
    if (isNew(p)) return { kind: "new", label: "Nuevo en la tienda" };
    if (p.salesCount > 0) return { kind: "demand", label: "De lo más pedido aquí" };
    return { kind: "popular", label: "Te puede gustar" };
  };
  const shape = (p) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    oldPrice: p.oldPrice != null ? Number(p.oldPrice) : null,
    currency: p.currency,
    image: p.images[0],
    images: p.images.slice(0, 4),
    description: shortText(p.description, 170),
    reason: reasonOf(p),
  });
  const grid = ranked.slice(0, 24).map(shape);
  // Lo que se abre: primero demanda real, luego ofertas, luego el resto por interés (sin repetir), hasta 8.
  const demand = ranked.filter((p) => (sold14.get(p.id) ?? 0) > 0);
  const onSale = ranked.filter((p) => p.oldPrice != null && Number(p.oldPrice) > Number(p.price));
  const spotlightIds = [...new Set([...demand, ...onSale, ...ranked].map((p) => p.id))].slice(0, 8);
  const data = {
    products: grid,
    spotlight: spotlightIds.filter((id) => grid.some((g) => g.id === id)),
    offers: offers
      .filter((o) => o.discountCode?.active)
      .map((o) => ({
        id: o.id,
        title: o.title,
        description: shortText(o.description, 170),
        code: o.discountCode.code,
        discount: o.discountCode.type === "PERCENTAGE" ? `${Number(o.discountCode.value)} %` : `${Number(o.discountCode.value).toLocaleString("es-CU")} ${o.discountCode.currency}`,
        expiresAt: o.expiresAt,
      })),
  };
  showcaseCache.set(vendorId, { at: Date.now(), data });
  return data;
}

// Pantalla que mira el cliente en el mostrador: la venta en curso (lo que se va escaneando), el número al cobrar y, sin
// venta, la imagen que eligió la tienda.
// Middleware de las rutas del panel: la tienda (del dueño o del personal) tiene que tener la caja en su plan.
export async function requirePosPlan(req, _res, next) {
  const vendor = await resolveMyVendor(req.user.id);
  if (!(await planAllows(vendor.planType, "allowPos"))) throw new AppError("La caja con código de barras es del Plan Premium. Cambia de plan para usarla.", 403, { planRequired: "allowPos" });
  next();
}

export async function getDisplay(req, res) {
  const settings = await prisma.posSettings.findUnique({ where: { displayToken: req.params.token }, include: { vendor: true } });
  if (!settings || settings.vendor.isBlocked || settings.vendor.deletedAt || !(await planAllows(settings.vendor.planType, "allowPos"))) throw new AppError("Este enlace ya no es válido. Pide el nuevo en el panel de la tienda.", 404);
  const now = Date.now();
  const [current, justPaid] = await Promise.all([
    prisma.posSale.findFirst({ where: { vendorId: settings.vendorId, status: "OPEN", updatedAt: { gte: new Date(now - DISPLAY_ACTIVE_MS) } }, orderBy: { updatedAt: "desc" } }),
    prisma.posSale.findFirst({ where: { vendorId: settings.vendorId, status: { in: ["PAID", "PENDING_TABLE"] }, updatedAt: { gte: new Date(now - DISPLAY_THANKS_MS) } }, orderBy: { updatedAt: "desc" } }),
  ]);
  const recent = justPaid && (!current || justPaid.updatedAt > current.updatedAt) ? justPaid : null;
  const sale = recent ?? current;
  const state = recent ? (recent.status === "PAID" ? "paid" : "table") : current?.items.length ? "active" : "idle";
  const images = sale ? await imagesFor([sale]) : new Map();
  res.set("Cache-Control", "no-store");
  res.json({
    vendor: publicVendor(settings.vendor),
    idleImageUrl: settings.idleImageUrl,
    state,
    idleMode: settings.idleMode,
    showcase: state === "idle" && settings.idleMode !== "IMAGE" ? await showcaseFor(settings.vendorId) : null,
    sale: sale
      ? {
          code: sale.code,
          customerName: sale.customerName,
          items: publicItems(sale.items, images),
          units: sale.items.reduce((n, i) => n + i.quantity, 0),
          total: Number(sale.total),
          currency: sale.currency,
          paymentMethod: sale.paymentMethod,
          cashReceived: sale.cashReceived != null ? Number(sale.cashReceived) : null,
          change: sale.changeGiven != null ? Number(sale.changeGiven) : null,
        }
      : null,
  });
}

// Tablero de pedidos de hoy: en preparación y listos, por número (y nombre, si se lo pusieron).
export async function getBoard(req, res) {
  const settings = await prisma.posSettings.findUnique({ where: { boardToken: req.params.token }, include: { vendor: true } });
  if (!settings || settings.vendor.isBlocked || settings.vendor.deletedAt || !(await planAllows(settings.vendor.planType, "allowPos"))) throw new AppError("Este enlace ya no es válido. Pide el nuevo en el panel de la tienda.", 404);
  await autoPickupExpired(settings.vendorId, settings.readyAutoClearMinutes);
  const sales = await prisma.posSale.findMany({
    where: { vendorId: settings.vendorId, status: "PAID", fulfillment: { in: ["PREPARING", "READY"] }, paidAt: { gte: startOfToday(settings.vendor.timezone) } },
    orderBy: { paidAt: "asc" },
    select: { code: true, customerName: true, fulfillment: true, readyAt: true, paidAt: true, items: true },
    take: 60,
  });
  const card = (s) => ({
    code: s.code,
    name: s.customerName,
    units: s.items.reduce((n, i) => n + i.quantity, 0),
    summary: s.items.slice(0, 3).map((i) => `${i.quantity}× ${i.name}`),
    more: Math.max(0, s.items.length - 3),
    paidAt: s.paidAt,
    readyAt: s.readyAt,
  });
  res.set("Cache-Control", "no-store");
  res.json({
    vendor: publicVendor(settings.vendor),
    readyAutoClearMinutes: settings.readyAutoClearMinutes,
    preparing: sales.filter((s) => s.fulfillment === "PREPARING").map(card),
    ready: sales.filter((s) => s.fulfillment === "READY").sort((a, b) => b.readyAt - a.readyAt).map(card),
  });
}

// El cliente, en la página de su mesa, escribe el número que le dieron en caja.
export async function claimForTable(req, res) {
  const { code } = z.object({ code: z.string().trim().toUpperCase().length(4, "El número tiene 4 caracteres.") }).parse(req.body);
  const table = await prisma.table.findUnique({ where: { qrToken: req.params.qrToken }, include: { vendor: { select: { planType: true } } } });
  if (!table || !(await planAllows(table.vendor.planType, "allowQrTables"))) throw new AppError("Mesa no encontrada.", 404);
  const sale = await prisma.posSale.findFirst({ where: { vendorId: table.vendorId, code, status: "PENDING_TABLE", updatedAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) } } });
  if (!sale) throw new AppError("No hay ningún pedido de caja con ese número esperando mesa.", 404);
  const { tableOrder } = await attachSaleToTable({ sale, table, actorName: null });
  res.json({ ok: true, tableOrderId: tableOrder.id });
}
