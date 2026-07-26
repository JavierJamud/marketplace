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
    .array(
      z.object({
        productId: z.string(),
        quantity: z.number().int().positive(),
        selectedOptions: z.record(z.any()).optional(),
        // Bloque 52: talla elegida, solo si el producto tiene Product.sizes
        // cargadas — validado contra esa lista más abajo (nunca se confía en
        // que el string que manda el cliente sea una talla real del producto).
        size: z.string().optional(),
      })
    )
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

  // Bloque 52: si el producto tiene tallas cargadas, el cliente TIENE que
  // elegir una de las reales (nunca se confía en el string que manda el
  // body) — si no tiene tallas, cualquier `size` que haya mandado se ignora.
  for (const i of data.items) {
    const product = productById[i.productId];
    if (product.sizes.length > 0 && !product.sizes.includes(i.size)) {
      throw new AppError(`Elige una talla válida para "${product.name}".`, 400);
    }
    if (product.sizes.length === 0) i.size = undefined;
  }

  // Bloque 29: chequeo puramente informativo — NUNCA reserva ni descuenta
  // nada (el stock del producto no se toca hasta que el vendedor confirme
  // la venta, ver confirmOrderSale). Solo evita que un pedido obviamente
  // imposible (pide más de lo que hay en este instante) se registre igual;
  // como no reserva nada, dos clientes pidiendo el último ítem casi al
  // mismo tiempo pueden AMBOS pasar este chequeo y quedar como pedidos
  // Pendiente — es intencional, el vendedor decide cuál confirmar. Bloque
  // 52: si el ítem lleva talla, el disponible es el de ESA talla, no el
  // total del producto.
  const quickCheck = data.items
    .map((i) => {
      const product = productById[i.productId];
      const available = i.size ? Number(product.sizeStock?.[i.size] ?? 0) : product.stock;
      return { productId: i.productId, requested: i.quantity, available, name: product.name, size: i.size ?? null };
    })
    .filter((i) => i.requested > i.available);
  if (quickCheck.length > 0) {
    throw new AppError("Algunos productos ya no tienen suficiente stock.", 409, { insufficientStock: quickCheck });
  }

  // El precio se toma del producto en DB (no del cliente) para evitar manipulación.
  const orderItems = data.items.map((i) => ({
    productId: i.productId,
    name: productById[i.productId].name,
    price: productById[i.productId].price,
    currency: productById[i.productId].currency,
    quantity: i.quantity,
    selectedOptions: i.selectedOptions ?? null,
    size: i.size ?? null,
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

// Bloque 52: decremento/incremento atómico de stock POR TALLA. `sizeStock`
// es JSON, y Prisma no da un `updateMany({ where: { stock: { gte } } })`
// para un valor DENTRO de un JSON — en vez de armar SQL crudo con
// jsonb_set/to_jsonb a mano (frágil, fácil de romper con un paréntesis de
// más), se usa `SELECT ... FOR UPDATE` dentro de la misma transacción: eso
// bloquea la fila hasta que la transacción termina, así que dos
// confirmaciones concurrentes sobre el mismo producto quedan serializadas
// (la segunda espera a que la primera termine y lee el valor YA actualizado)
// — misma garantía atómica que el updateMany+WHERE que protege el stock
// general, solo que con lock explícito en vez de un WHERE condicional.
async function decrementSizeStock(tx, productId, size, quantity) {
  const rows = await tx.$queryRaw`SELECT "sizeStock" FROM "Product" WHERE id = ${productId} FOR UPDATE`;
  const current = Number(rows[0]?.sizeStock?.[size] ?? 0);
  if (current < quantity) return false;
  const nextSizeStock = { ...rows[0].sizeStock, [size]: current - quantity };
  const nextTotal = Object.values(nextSizeStock).reduce((sum, n) => sum + Number(n), 0);
  await tx.product.update({ where: { id: productId }, data: { sizeStock: nextSizeStock, stock: nextTotal } });
  return true;
}

async function incrementSizeStock(tx, productId, size, quantity) {
  const rows = await tx.$queryRaw`SELECT "sizeStock" FROM "Product" WHERE id = ${productId} FOR UPDATE`;
  const current = Number(rows[0]?.sizeStock?.[size] ?? 0);
  const nextSizeStock = { ...(rows[0]?.sizeStock ?? {}), [size]: current + quantity };
  const nextTotal = Object.values(nextSizeStock).reduce((sum, n) => sum + Number(n), 0);
  await tx.product.update({ where: { id: productId }, data: { sizeStock: nextSizeStock, stock: nextTotal } });
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
        if (item.size) await incrementSizeStock(tx, item.productId, item.size, item.quantity);
        else await tx.product.updateMany({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
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

      // Bloque 52: si el ítem lleva talla, decrementar ESA talla (con lock de
      // fila, ver decrementSizeStock) en vez del stock general del producto.
      const ok = item.size
        ? await decrementSizeStock(tx, item.productId, item.size, item.quantity)
        : (await tx.product.updateMany({ where: { id: item.productId, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity } } })).count > 0;

      if (!ok) {
        const fresh = await tx.product.findUnique({ where: { id: item.productId } });
        const available = item.size ? Number(fresh?.sizeStock?.[item.size] ?? 0) : fresh?.stock ?? 0;
        throw new AppError(
          `Stock insuficiente para confirmar "${item.name}"${item.size ? ` (talla ${item.size})` : ""} — pedido ${item.quantity}, disponible ${available}.`,
          409,
          { insufficientStock: [{ productId: item.productId, name: item.name, size: item.size ?? null, requested: item.quantity, available }] }
        );
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

  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, stock: true, sizeStock: true } });
  const productById = new Map(products.map((p) => [p.id, p]));

  // Bloque 52: si el ítem lleva talla, lo que importa es el stock de ESA
  // talla, no el total del producto (puede sobrar en otras tallas).
  function availableFor(item) {
    const product = productById.get(item.productId);
    if (!product) return 0;
    return item.size ? Number(product.sizeStock?.[item.size] ?? 0) : product.stock;
  }

  const atRisk = [];
  for (const o of siblingOrders) {
    const shortItems = o.items
      .filter((i) => i.productId && i.quantity > availableFor(i))
      .map((i) => ({ name: i.name, requested: i.quantity, available: availableFor(i) }));
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
  items: z
    .array(z.object({ productId: z.string(), quantity: z.number().int().positive(), size: z.string().optional() }))
    .min(1, "El pedido necesita al menos un producto"),
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
    currency: productById[i.productId].currency,
    quantity: i.quantity,
    size: i.size ?? null,
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
