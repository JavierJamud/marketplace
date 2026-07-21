import { z } from "zod";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { sendOrderConfirmationEmail, sendOrderStatusEmail, sendManualOrderEmail } from "../lib/email.js";

// Transiciones válidas de estado de pedido — no se puede saltar pasos
// (ej. de NEW directo a DELIVERED) ni revivir un pedido terminal.
// Bloque 29: NEW -> PREPARING quedó AFUERA de este mapa a propósito — esa
// transición puntual es la que descuenta stock real (ver confirmOrderSale),
// así que solo puede pasar por esa acción dedicada, nunca por este endpoint
// genérico. Si se dejara acá, un vendedor podría "confirmar" un pedido sin
// que el stock se mueva nunca, dejando el sistema inconsistente.
const VALID_TRANSITIONS = {
  NEW: ["CANCELLED"],
  PREPARING: ["READY", "DELIVERED", "CANCELLED"],
  READY: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

// E.164 laxo (+5355512345) — el frontend arma el string completo con
// PhoneInput/toE164(), esto solo valida la forma del lado servidor.
const E164_REGEX = /^\+\d{7,15}$/;

// La tienda necesita poder contactar al cliente sí o sí — todos los campos
// de contacto/entrega son obligatorios, sin excepción (Bloque 6).
// Bloque 14: 3 opciones de checkout (antes whatsapp/cod/transfer) — ver
// CHANNEL_MAP y el comentario en schema.prisma sobre el enum OrderChannel.
const createOrderSchema = z.object({
  vendorId: z.string(),
  channel: z.enum(["cod", "online", "cash", "table"]),
  customerName: z.string().min(2, "Falta el nombre del cliente."),
  customerPhone: z.string().regex(E164_REGEX, "Falta un teléfono válido con código de país."),
  customerEmail: z.string().email("Falta un correo válido."),
  shippingAddress: z.string().min(1, "Falta la dirección."),
  shippingProvinceId: z.string().min(1, "Falta la provincia."),
  shippingMunicipalityId: z.string().optional(),
  tableNumber: z.number().int().positive().optional(),
  items: z
    .array(z.object({ productId: z.string(), quantity: z.number().int().positive(), selectedOptions: z.record(z.any()).optional() }))
    .min(1, "El pedido necesita al menos un producto"),
});

const CHANNEL_MAP = { cod: "COD", online: "ONLINE", cash: "CASH", table: "TABLE" };

// Sin Stripe/PayPal ni ninguna pasarela: el pago se coordina siempre directo
// entre cliente y vendedor (contra entrega, en línea con la tienda, o
// efectivo). Esta ruta solo registra el pedido, nunca cobra nada.
export async function createOrder(req, res) {
  const data = createOrderSchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
  if (!vendor || vendor.isBlocked) throw new AppError("Tienda no encontrada.", 404);

  const productIds = data.items.map((i) => i.productId);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });

  if (products.length !== productIds.length) throw new AppError("Uno o más productos ya no están disponibles.", 400);

  // Regla de negocio no negociable: un solo vendedor por pedido.
  const otherVendorProduct = products.find((p) => p.vendorId !== data.vendorId);
  if (otherVendorProduct) {
    throw new AppError("Todos los productos de un pedido deben ser de la misma tienda.", 400);
  }

  const productById = Object.fromEntries(products.map((p) => [p.id, p]));

  // Bloque 29: chequeo puramente informativo — NUNCA reserva ni descuenta
  // nada (el stock del producto no se toca hasta que el vendedor confirme
  // la venta, ver confirmOrderSale). Solo evita que un pedido obviamente
  // imposible (pide más de lo que hay en este instante) se registre igual;
  // como no reserva nada, dos clientes pidiendo el último ítem casi al
  // mismo tiempo pueden AMBOS pasar este chequeo y quedar como pedidos
  // Pendiente — es intencional, el vendedor decide cuál confirmar.
  const quickCheck = data.items
    .map((i) => ({ productId: i.productId, requested: i.quantity, available: productById[i.productId].stock, name: productById[i.productId].name }))
    .filter((i) => i.requested > i.available);
  if (quickCheck.length > 0) {
    throw new AppError("Algunos productos ya no tienen suficiente stock.", 409, { insufficientStock: quickCheck });
  }

  // El precio se toma del producto en DB (no del cliente) para evitar manipulación.
  const orderItems = data.items.map((i) => ({
    productId: i.productId,
    name: productById[i.productId].name,
    price: productById[i.productId].price,
    quantity: i.quantity,
    selectedOptions: i.selectedOptions ?? null,
  }));
  const total = orderItems.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);

  // Autenticación opcional: si viene un token válido, asocia el pedido al cliente.
  let customerId;
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, env.jwtSecret);
      customerId = payload.sub;
    } catch {
      // token inválido/expirado: seguimos como pedido de invitado
    }
  }

  // Bloque 29: ya NO se descuenta stock acá — el pedido queda registrado
  // como NEW ("Pendiente") sin tocar Product.stock. El descuento real recién
  // pasa cuando el vendedor confirma la venta desde su panel
  // (confirmOrderSale, más abajo), que sí usa la misma transacción atómica
  // con updateMany+WHERE stock>=cantidad que antes vivía acá. Esto es
  // justamente lo que evita el bug original: dos clientes pidiendo el
  // último ítem casi a la vez ya no compiten por decrementar la misma fila
  // al crear el pedido — ambos pedidos se crean igual, y es el vendedor
  // quien decide cuál confirmar cuando efectivamente le queda stock.
  const order = await prisma.order.create({
    data: {
      code: `Z-${Date.now().toString(36).toUpperCase()}`,
      vendorId: data.vendorId,
      customerId,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerEmail: data.customerEmail,
      shippingAddress: data.shippingAddress,
      shippingProvinceId: data.shippingProvinceId,
      shippingMunicipalityId: data.shippingMunicipalityId,
      channel: CHANNEL_MAP[data.channel],
      // Se toma del vendedor server-side (nunca del body del cliente) para
      // que no se pueda falsear qué canal de aviso usó el pedido.
      notificationChannel: vendor.orderDestination,
      tableNumber: data.tableNumber,
      total,
      items: { create: orderItems },
    },
    include: { items: true, vendor: { select: { companyName: true, whatsapp: true, orderDestination: true } } },
  });

  // Confirmación al cliente — best-effort, nunca bloquea ni revierte el pedido.
  await sendOrderConfirmationEmail(order);

  res.status(201).json({ order });
}

// --- Panel de vendedor -------------------------------------------------

// Lista unificada: pedidos "normales" (whatsapp/cod/transfer) + pedidos de
// mesa (si el vendedor es restaurante), ambos filtrados server-side por el
// vendorId del usuario autenticado.
export async function listMyOrders(req, res) {
  const vendor = await resolveMyVendor(req.user.id);

  const orders = await prisma.order.findMany({
    where: { vendorId: vendor.id },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  let tableOrders = [];
  if (vendor.isRestaurant) {
    tableOrders = await prisma.tableOrder.findMany({
      where: { table: { vendorId: vendor.id } },
      include: { table: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  res.json({ orders, tableOrders });
}

export async function updateOrderStatus(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;
  const { status } = z.object({ status: z.enum(["NEW", "PREPARING", "READY", "DELIVERED", "CANCELLED"]) }).parse(req.body);

  const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!order || order.vendorId !== vendor.id) throw new AppError("Pedido no encontrado.", 404);

  if (!VALID_TRANSITIONS[order.status].includes(status)) {
    throw new AppError(`No se puede pasar un pedido de "${order.status}" a "${status}".`, 400);
  }

  // Bloque 29: si el pedido YA estaba confirmado (PREPARING/READY — el stock
  // real se descontó en confirmOrderSale) y ahora se cancela, hay que
  // devolver ese stock, si no el producto queda "perdido" para siempre pese
  // a que la venta nunca se concretó. Un pedido rechazado estando todavía
  // NEW nunca llegó a descontar nada, así que no hay nada que devolver ahí.
  const shouldRestock = status === "CANCELLED" && order.status !== "NEW";

  const updated = await prisma.$transaction(async (tx) => {
    if (shouldRestock) {
      for (const item of order.items) {
        if (!item.productId) continue;
        await tx.product.updateMany({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
      }
    }
    return tx.order.update({ where: { id }, data: { status }, include: { vendor: { select: { companyName: true } } } });
  });

  // "Tiempo real" = disparado en el momento del cambio, no un cron/batch.
  await sendOrderStatusEmail(updated);

  res.json({ order: updated });
}

// Bloque 29: acción dedicada de "Confirmar venta" — la ÚNICA forma de pasar
// un pedido de NEW a PREPARING (ver la nota en VALID_TRANSITIONS). Acá vive
// ahora la misma transacción atómica updateMany+WHERE stock>=cantidad que
// antes corría en createOrder: si algún ítem no alcanza, se aborta TODO (el
// pedido se queda en NEW, nada de stock negativo ni confirmación parcial).
export async function confirmOrderSale(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;

  const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!order || order.vendorId !== vendor.id) throw new AppError("Pedido no encontrado.", 404);
  if (order.status !== "NEW") throw new AppError(`Este pedido ya no está pendiente (está "${order.status}").`, 400);

  const updated = await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      if (!item.productId) continue; // producto borrado después del pedido — nada que descontar
      const result = await tx.product.updateMany({
        where: { id: item.productId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (result.count === 0) {
        const fresh = await tx.product.findUnique({ where: { id: item.productId } });
        throw new AppError(`Stock insuficiente para confirmar "${item.name}" — pedido ${item.quantity}, disponible ${fresh?.stock ?? 0}.`, 409, {
          insufficientStock: [{ productId: item.productId, name: item.name, requested: item.quantity, available: fresh?.stock ?? 0 }],
        });
      }
    }
    return tx.order.update({ where: { id }, data: { status: "PREPARING" }, include: { items: true, vendor: { select: { companyName: true } } } });
  });

  // El stock de estos productos ya bajó de verdad — ver si algún OTRO
  // pedido Pendiente del mismo vendedor pidiendo alguno de ellos quedó sin
  // alcance. Es solo un aviso para que el vendedor decida (notificar al
  // cliente o dejarlo pendiente tal cual); nunca se toca ese otro pedido acá.
  const productIds = [...new Set(order.items.map((i) => i.productId).filter(Boolean))];
  const atRiskOrders = await findAtRiskSiblingOrders({ vendorId: vendor.id, excludeOrderId: id, productIds });

  await sendOrderStatusEmail(updated);

  res.json({ order: updated, atRiskOrders });
}

async function findAtRiskSiblingOrders({ vendorId, excludeOrderId, productIds }) {
  if (productIds.length === 0) return [];

  const siblingOrders = await prisma.order.findMany({
    where: { vendorId, status: "NEW", id: { not: excludeOrderId }, items: { some: { productId: { in: productIds } } } },
    include: { items: { where: { productId: { in: productIds } } } },
  });
  if (siblingOrders.length === 0) return [];

  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, stock: true } });
  const stockById = new Map(products.map((p) => [p.id, p.stock]));

  const atRisk = [];
  for (const o of siblingOrders) {
    const shortItems = o.items
      .filter((i) => i.productId && i.quantity > (stockById.get(i.productId) ?? 0))
      .map((i) => ({ name: i.name, requested: i.quantity, available: stockById.get(i.productId) ?? 0 }));
    if (shortItems.length > 0) {
      atRisk.push({ orderId: o.id, code: o.code, customerName: o.customerName, customerEmail: o.customerEmail, items: shortItems });
    }
  }
  return atRisk;
}

// Bloque 29: eliminar/modificar solo tienen sentido mientras el pedido sigue
// Pendiente (NEW) — una vez confirmado, ya movió stock real y tiene sentido
// de venta; para deshacer eso está "Rechazar/Cancelar" (que sí restituye
// stock, ver updateOrderStatus), nunca un borrado silencioso.
export async function deleteOrder(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order || order.vendorId !== vendor.id) throw new AppError("Pedido no encontrado.", 404);
  if (order.status !== "NEW") throw new AppError("Solo se pueden eliminar pedidos pendientes, todavía sin confirmar.", 400);

  await prisma.order.delete({ where: { id } }); // OrderItem tiene onDelete: Cascade
  res.status(204).send();
}

const updateOrderItemsSchema = z.object({
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })).min(1, "El pedido necesita al menos un producto"),
});

// Reemplaza la lista completa de ítems de un pedido pendiente (el vendedor
// puede sumar/quitar/cambiar cantidades antes de confirmar la venta). El
// precio se vuelve a tomar del producto en DB en este mismo momento — nunca
// del cliente — mismo criterio anti-manipulación que createOrder.
export async function updateOrderItems(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;
  const { items } = updateOrderItemsSchema.parse(req.body);

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order || order.vendorId !== vendor.id) throw new AppError("Pedido no encontrado.", 404);
  if (order.status !== "NEW") throw new AppError("Solo se pueden modificar pedidos pendientes, todavía sin confirmar.", 400);

  const uniqueProductIds = [...new Set(items.map((i) => i.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: uniqueProductIds }, vendorId: vendor.id } });
  if (products.length !== uniqueProductIds.length) throw new AppError("Uno o más productos ya no están disponibles.", 400);
  const productById = Object.fromEntries(products.map((p) => [p.id, p]));

  const orderItems = items.map((i) => ({
    productId: i.productId,
    name: productById[i.productId].name,
    price: productById[i.productId].price,
    quantity: i.quantity,
  }));
  const total = orderItems.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.orderItem.deleteMany({ where: { orderId: id } });
    return tx.order.update({ where: { id }, data: { total, items: { create: orderItems } }, include: { items: true } });
  });

  res.json({ order: updated });
}

// --- Emails manuales del vendedor ---------------------------------------

const REGULAR_MONTHLY_EMAIL_LIMIT = 10;

function monthStart() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function countManualEmailsThisMonth(vendorId) {
  return prisma.emailLog.count({
    where: { vendorId, type: "MANUAL", status: "SENT", createdAt: { gte: monthStart() } },
  });
}

export async function getEmailUsage(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  if (vendor.planType === "BUSINESS") {
    return res.json({ unlimited: true, used: null, limit: null });
  }
  const used = await countManualEmailsThisMonth(vendor.id);
  res.json({ unlimited: false, used, limit: REGULAR_MONTHLY_EMAIL_LIMIT });
}

const manualEmailSchema = z.object({
  subject: z.string().min(2),
  message: z.string().min(2),
});

export async function sendManualEmail(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;
  const { subject, message } = manualEmailSchema.parse(req.body);

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order || order.vendorId !== vendor.id) throw new AppError("Pedido no encontrado.", 404);
  if (!order.customerEmail) throw new AppError("Este pedido no tiene un correo de cliente registrado.", 400);

  if (vendor.planType === "REGULAR") {
    const used = await countManualEmailsThisMonth(vendor.id);
    if (used >= REGULAR_MONTHLY_EMAIL_LIMIT) {
      throw new AppError(
        `Alcanzaste el límite de ${REGULAR_MONTHLY_EMAIL_LIMIT} emails manuales del Plan Regular este mes. Verificate para pasar a Business y enviar sin límite.`,
        403
      );
    }
  }

  // La plantilla necesita companyName/color de la tienda — resolveMyVendor ya
  // trae el vendor completo, se lo adjuntamos al pedido para no hacer otra query.
  const result = await sendManualOrderEmail({ order: { ...order, vendor }, vendorName: vendor.companyName, subject, message });
  if (!result.ok) throw new AppError(`No se pudo enviar el correo: ${result.error}`, 502);

  res.status(201).json({ ok: true });
}
