import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";

// Clientes de una tienda. Cada pedido crea o actualiza su registro (por correo; si no dejó correo, por teléfono). Las cifras salen
// de los pedidos reales, nunca se guardan aparte: pedidos, total gastado por moneda, primera y última compra.

export function customerKey({ email, phone }) {
  const mail = String(email ?? "").trim().toLowerCase();
  if (mail) return `e:${mail}`;
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits ? `p:${digits}` : null;
}

// Se llama al registrarse un pedido. Nunca rompe el pedido si falla.
export async function upsertVendorCustomer(vendorId, { name, phone, email }) {
  const key = customerKey({ email, phone });
  if (!key) return;
  try {
    await prisma.vendorCustomer.upsert({
      where: { vendorId_key: { vendorId, key } },
      create: { vendorId, key, name: name ?? null, phone: phone ?? null, email: email?.trim().toLowerCase() || null },
      update: { ...(name ? { name } : {}), ...(phone ? { phone } : {}), ...(email ? { email: email.trim().toLowerCase() } : {}) },
    });
  } catch {
    /* el registro de clientes es auxiliar */
  }
}

const ORDER_SELECT = {
  id: true,
  code: true,
  status: true,
  channel: true,
  total: true,
  createdAt: true,
  customerName: true,
  customerPhone: true,
  customerEmail: true,
  shippingAddress: true,
  items: { select: { name: true, quantity: true, price: true, currency: true, size: true } },
};

function sumByCurrency(orders) {
  const totals = new Map();
  for (const o of orders) {
    if (o.status === "CANCELLED") continue;
    for (const it of o.items) totals.set(it.currency, (totals.get(it.currency) ?? 0) + Number(it.price) * it.quantity);
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount }));
}

function statsFor(orders) {
  const sorted = [...orders].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const valid = orders.filter((o) => o.status !== "CANCELLED");
  return {
    ordersCount: orders.length,
    validOrdersCount: valid.length,
    deliveredCount: orders.filter((o) => o.status === "DELIVERED").length,
    cancelledCount: orders.filter((o) => o.status === "CANCELLED").length,
    pendingCount: orders.filter((o) => o.status === "NEW").length,
    totals: sumByCurrency(orders),
    firstOrderAt: sorted[0]?.createdAt ?? null,
    lastOrderAt: sorted[sorted.length - 1]?.createdAt ?? null,
  };
}

// Pedidos de la tienda agrupados por cliente. Crea el registro de los clientes que ya compraron antes de que existiera esta sección.
async function loadGrouped(vendorId) {
  const orders = await prisma.order.findMany({ where: { vendorId }, select: ORDER_SELECT, orderBy: { createdAt: "desc" }, take: 5000 });
  const groups = new Map();
  for (const o of orders) {
    const key = customerKey({ email: o.customerEmail, phone: o.customerPhone });
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  const existing = await prisma.vendorCustomer.findMany({ where: { vendorId } });
  const byKey = new Map(existing.map((c) => [c.key, c]));
  const missing = [...groups.keys()].filter((k) => !byKey.has(k));
  for (const key of missing) {
    const latest = groups.get(key)[0];
    const created = await prisma.vendorCustomer
      .create({ data: { vendorId, key, name: latest.customerName ?? null, phone: latest.customerPhone ?? null, email: latest.customerEmail?.trim().toLowerCase() || null } })
      .catch(() => null);
    if (created) byKey.set(key, created);
  }
  return { groups, byKey };
}

export async function listMyCustomers(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { groups, byKey } = await loadGrouped(vendor.id);
  const customers = [...groups.entries()]
    .map(([key, orders]) => {
      const c = byKey.get(key);
      if (!c) return null;
      return { id: c.id, name: c.name, phone: c.phone, email: c.email, notes: c.notes, ...statsFor(orders) };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.lastOrderAt) - new Date(a.lastOrderAt));
  res.json({ customers });
}

export async function getMyCustomer(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const customer = await prisma.vendorCustomer.findUnique({ where: { id: req.params.id } });
  if (!customer || customer.vendorId !== vendor.id) throw new AppError("Cliente no encontrado.", 404);
  const [kind, value] = [customer.key.slice(0, 1), customer.key.slice(2)];
  // Por correo: coincidencia exacta. Por teléfono (clientes que no dejaron correo): se acota por los últimos dígitos y se confirma exacto.
  const or = kind === "e" ? [{ customerEmail: { equals: value, mode: "insensitive" } }] : [{ customerPhone: { contains: value.slice(-6) } }];
  const found = await prisma.order.findMany({
    where: { vendorId: vendor.id, OR: or },
    select: { ...ORDER_SELECT, events: { select: { id: true, type: true, detail: true, createdAt: true }, orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  const orders = kind === "e" ? found : found.filter((o) => !String(o.customerEmail ?? "").trim() && String(o.customerPhone ?? "").replace(/\D/g, "") === value);
  res.json({ customer: { ...customer, ...statsFor(orders) }, orders });
}

const updateSchema = z.object({
  notes: z.string().trim().max(2000).nullable().optional(),
  name: z.string().trim().min(1).max(120).optional(),
});

export async function updateMyCustomer(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const data = updateSchema.parse(req.body);
  const customer = await prisma.vendorCustomer.findUnique({ where: { id: req.params.id } });
  if (!customer || customer.vendorId !== vendor.id) throw new AppError("Cliente no encontrado.", 404);
  const updated = await prisma.vendorCustomer.update({
    where: { id: customer.id },
    data: { ...(data.notes !== undefined ? { notes: data.notes || null } : {}), ...(data.name ? { name: data.name } : {}) },
  });
  res.json({ customer: updated });
}
