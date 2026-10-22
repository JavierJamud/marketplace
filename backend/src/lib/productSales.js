import { prisma } from "./prisma.js";
import { ORDER_EVENT_LABEL } from "./orderEvents.js";
import { channelLabel } from "./catalog.js";

// Historial de ventas de UN producto, para el vendedor (su producto) y el admin (cualquiera): cada pedido donde aparece
// (normales, de caja y de mesa), con su estado y sus movimientos, y un resumen (unidades vendidas, cuándo se vendió por
// última vez, pendientes y cancelados). "Vendido" = la tienda lo confirmó (preparación, listo o entregado; en mesa, aceptado),
// el mismo momento en que se descuenta el stock. Un pedido nuevo todavía no es una venta y uno cancelado ya no lo es.

const SOLD_STATUSES = new Set(["PREPARING", "READY", "DELIVERED"]);
const MAX_ROWS = 60;

const STATUS_LABEL = {
  NEW: "Pendiente",
  PREPARING: "En preparación",
  READY: "Listo",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
};

function tableStatus(t) {
  if (t.cancelledAt) return "CANCELLED";
  if (t.kitchenStatus === "RECEIVED") return "NEW";
  if (t.clearedAt) return "DELIVERED";
  return t.kitchenStatus;
}

export async function productSalesHistory(productId) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, vendorId: true, currency: true, stock: true, unlimitedStock: true, salesCount: true },
  });
  if (!product) return null;

  const [orderItems, orderTotal, tableOrders] = await Promise.all([
    prisma.orderItem.findMany({
      where: { productId },
      orderBy: { order: { createdAt: "desc" } },
      take: MAX_ROWS,
      select: {
        quantity: true,
        price: true,
        currency: true,
        size: true,
        order: {
          select: {
            id: true,
            code: true,
            status: true,
            channel: true,
            createdAt: true,
            customerName: true,
            cancelReason: true,
            events: { orderBy: { createdAt: "asc" }, select: { type: true, detail: true, createdAt: true } },
          },
        },
      },
    }),
    prisma.orderItem.count({ where: { productId } }),
    // Las líneas de un pedido de mesa viven en un JSON; jsonb @> encuentra las que llevan este producto.
    prisma.tableOrder.findMany({
      where: { table: { vendorId: product.vendorId }, items: { array_contains: [{ productId }] } },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      select: { id: true, orderNumber: true, items: true, kitchenStatus: true, cancelledAt: true, cancelReason: true, clearedAt: true, createdAt: true, customerName: true, table: { select: { tableNumber: true, label: true } } },
    }),
  ]);

  const rows = [];
  for (const it of orderItems) {
    const o = it.order;
    // Momento de la venta: cuando la tienda la confirmó (si hay registro de ese paso), si no, cuando entró el pedido.
    const confirmed = o.events.find((e) => e.type === "CONFIRMED");
    rows.push({
      kind: "ORDER",
      id: o.id,
      code: o.code,
      status: o.status,
      statusLabel: STATUS_LABEL[o.status] ?? o.status,
      channel: channelLabel(o.channel),
      createdAt: o.createdAt,
      soldAt: SOLD_STATUSES.has(o.status) ? confirmed?.createdAt ?? o.createdAt : null,
      customerName: o.customerName,
      quantity: it.quantity,
      size: it.size,
      unitPrice: Number(it.price),
      currency: it.currency ?? product.currency,
      cancelReason: o.cancelReason,
      events: o.events.map((e) => ({ label: ORDER_EVENT_LABEL[e.type] ?? e.type, detail: e.detail, at: e.createdAt })),
    });
  }
  for (const t of tableOrders) {
    const lines = (Array.isArray(t.items) ? t.items : []).filter((i) => i?.productId === productId);
    const quantity = lines.reduce((sum, i) => sum + Number(i.quantity ?? 0), 0);
    if (!quantity) continue;
    const status = tableStatus(t);
    const events = [{ label: "Pedido recibido en la mesa", detail: null, at: t.createdAt }];
    if (t.cancelledAt) events.push({ label: "Pedido cancelado", detail: t.cancelReason, at: t.cancelledAt });
    if (t.clearedAt) events.push({ label: "Cuenta cobrada y mesa libre", detail: null, at: t.clearedAt });
    rows.push({
      kind: "TABLE",
      id: t.id,
      code: `#${t.orderNumber}`,
      status,
      statusLabel: STATUS_LABEL[status] ?? status,
      channel: t.table.label || `Mesa ${t.table.tableNumber}`,
      createdAt: t.createdAt,
      soldAt: SOLD_STATUSES.has(status) ? t.createdAt : null,
      customerName: t.customerName,
      quantity,
      size: null,
      unitPrice: Number(lines[0]?.price ?? 0),
      currency: lines[0]?.currency ?? product.currency,
      cancelReason: t.cancelReason,
      events,
    });
  }
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Resumen sobre lo que se muestra (los últimos pedidos); el total histórico confirmado es salesCount.
  const sold = rows.filter((r) => r.soldAt);
  const last = sold.reduce((acc, r) => (!acc || new Date(r.soldAt) > new Date(acc.soldAt) ? r : acc), null);
  const revenue = {};
  for (const r of sold) revenue[r.currency] = (revenue[r.currency] ?? 0) + r.unitPrice * r.quantity;

  return {
    product: { id: product.id, name: product.name, stock: product.unlimitedStock ? null : product.stock, salesCount: product.salesCount },
    summary: {
      unitsSold: sold.reduce((sum, r) => sum + r.quantity, 0),
      ordersSold: sold.length,
      revenue: Object.entries(revenue).map(([currency, amount]) => ({ currency, amount })),
      lastSoldAt: last?.soldAt ?? null,
      lastSoldCode: last?.code ?? null,
      pendingUnits: rows.filter((r) => r.status === "NEW").reduce((sum, r) => sum + r.quantity, 0),
      cancelledOrders: rows.filter((r) => r.status === "CANCELLED").length,
    },
    rows: rows.slice(0, MAX_ROWS),
    truncated: orderTotal + tableOrders.length > MAX_ROWS,
  };
}
