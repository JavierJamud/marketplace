import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { sendTableOrderStatusEmail } from "../lib/email.js";

// Estado de cocina: solo se puede avanzar un paso a la vez, nunca saltar
// (ej. de "received" directo a "ready") ni retroceder.
const KITCHEN_TRANSITIONS = {
  RECEIVED: ["PREPARING"],
  PREPARING: ["READY"],
  READY: [],
};

// --- Panel de vendedor (restaurantes) --------------------------------------

export async function listMyTables(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  if (!vendor.isRestaurant) throw new AppError("Esta función es solo para tiendas tipo restaurante.", 403);

  // "Ocupada" ya no es "todavía no llegó a Listo" — el cliente puede seguir
  // en la mesa después de que el pedido está Listo (comiendo, esperando la
  // cuenta). La mesa recién se libera cuando el vendedor marca a mano que
  // el cliente pagó y se fue (ver clearTableOrder).
  const tables = await prisma.table.findMany({
    where: { vendorId: vendor.id },
    include: { tableOrders: { where: { clearedAt: null }, orderBy: { createdAt: "desc" } } },
    orderBy: { tableNumber: "asc" },
  });
  res.json({ tables });
}

export async function createTable(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  if (!vendor.isRestaurant) throw new AppError("Esta función es solo para tiendas tipo restaurante.", 403);

  const last = await prisma.table.findFirst({ where: { vendorId: vendor.id }, orderBy: { tableNumber: "desc" } });
  const tableNumber = (last?.tableNumber ?? 0) + 1;

  // qrToken se autogenera (cuid único) — nunca un valor adivinable del cliente.
  const table = await prisma.table.create({ data: { vendorId: vendor.id, tableNumber } });
  res.status(201).json({ table });
}

export async function updateKitchenStatus(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { tableOrderId } = req.params;
  const { status } = z.object({ status: z.enum(["RECEIVED", "PREPARING", "READY"]) }).parse(req.body);

  const tableOrder = await prisma.tableOrder.findUnique({ where: { id: tableOrderId }, include: { table: true } });
  if (!tableOrder || tableOrder.table.vendorId !== vendor.id) throw new AppError("Pedido de mesa no encontrado.", 404);

  if (!KITCHEN_TRANSITIONS[tableOrder.kitchenStatus].includes(status)) {
    throw new AppError(`No se puede pasar de "${tableOrder.kitchenStatus}" a "${status}".`, 400);
  }

  // Bloque 29: RECEIVED -> PREPARING es el momento en que la cocina "acepta"
  // el pedido — recién ahí se descuenta el stock real de cada producto
  // (mismo criterio atómico que confirmOrderSale en orders.controller.js
  // para pedidos normales; antes de este bloque, un pedido de mesa nunca
  // tocaba Product.stock en ningún momento). tableOrder.items es JSON, no
  // una relación, pero Prisma ya lo devuelve como array de JS con el
  // productId real que guardó createTableOrder.
  const updated = await prisma.$transaction(async (tx) => {
    if (tableOrder.kitchenStatus === "RECEIVED" && status === "PREPARING") {
      for (const item of tableOrder.items) {
        if (!item.productId) continue;
        const result = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (result.count === 0) {
          const fresh = await tx.product.findUnique({ where: { id: item.productId } });
          throw new AppError(`Stock insuficiente para "${item.name}" — pedido ${item.quantity}, disponible ${fresh?.stock ?? 0}.`, 409, {
            insufficientStock: [{ productId: item.productId, name: item.name, requested: item.quantity, available: fresh?.stock ?? 0 }],
          });
        }
      }
    }
    return tx.tableOrder.update({ where: { id: tableOrderId }, data: { kitchenStatus: status } });
  });

  // "Tiempo real" = disparado en el momento del cambio, no un cron/batch —
  // mismo criterio que sendOrderStatusEmail en orders.controller.js. Los
  // pedidos de mesa viejos sin customerEmail simplemente no mandan nada
  // (sendTableOrderStatusEmail ya hace ese chequeo).
  await sendTableOrderStatusEmail({
    to: tableOrder.customerEmail,
    vendorId: vendor.id,
    vendorName: vendor.companyName,
    tableNumber: tableOrder.table.tableNumber,
    kitchenStatus: status,
  });

  res.json({ tableOrder: updated });
}

// El cliente ya pagó y se retiró de la mesa — recién acá se libera de
// verdad (ver listMyTables). Solo se puede marcar sobre un pedido que ya
// llegó a Listo (no tiene sentido "liberar" una mesa con comida sin
// terminar de preparar).
export async function clearTableOrder(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { tableOrderId } = req.params;

  const tableOrder = await prisma.tableOrder.findUnique({ where: { id: tableOrderId }, include: { table: true } });
  if (!tableOrder || tableOrder.table.vendorId !== vendor.id) throw new AppError("Pedido de mesa no encontrado.", 404);
  if (tableOrder.kitchenStatus !== "READY") {
    throw new AppError("Solo se puede liberar una mesa con el pedido en estado Listo.", 400);
  }
  if (tableOrder.clearedAt) throw new AppError("Esta mesa ya fue liberada.", 409);

  const updated = await prisma.tableOrder.update({ where: { id: tableOrderId }, data: { clearedAt: new Date() } });
  res.json({ tableOrder: updated });
}

// --- Público (cliente escaneando el QR de su mesa) -------------------------

export async function getTableByToken(req, res) {
  const { qrToken } = req.params;
  const table = await prisma.table.findUnique({
    where: { qrToken },
    include: {
      vendor: {
        select: {
          companyName: true,
          description: true,
          logoUrl: true,
          slug: true,
          whatsapp: true,
          color: true,
          // Bloque 16: solo los productos que el vendedor marcó para el menú
          // QR (VendorProducts.jsx) — antes se mostraban TODOS los activos,
          // sin distinguir de la tienda normal.
          products: { where: { isActive: true, availableForTableMenu: true }, include: { options: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!table) throw new AppError("Mesa no encontrada.", 404);
  res.json({ table });
}

const createTableOrderSchema = z.object({
  items: z
    .array(z.object({ productId: z.string(), name: z.string(), quantity: z.number().int().positive(), price: z.number().positive() }))
    .min(1, "El pedido necesita al menos un producto"),
  customerEmail: z.string().email("Ingresá un correo válido para avisarte del estado del pedido."),
});

export async function createTableOrder(req, res) {
  const { qrToken } = req.params;
  const table = await prisma.table.findUnique({ where: { qrToken }, include: { vendor: { select: { id: true, companyName: true } } } });
  if (!table) throw new AppError("Mesa no encontrada.", 404);

  const { items, customerEmail } = createTableOrderSchema.parse(req.body);

  // El precio se toma del producto en DB (no del cliente).
  const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) }, vendorId: table.vendorId } });
  if (products.length !== items.length) throw new AppError("Uno o más productos ya no están disponibles en este menú.", 400);

  const productById = Object.fromEntries(products.map((p) => [p.id, p]));

  // Bloque 29: chequeo informativo — igual que createOrder, NO reserva ni
  // descuenta nada (eso pasa recién cuando la cocina acepta el pedido, ver
  // updateKitchenStatus). Solo evita registrar un pedido de mesa obviamente
  // imposible con el stock de este instante.
  const insufficientStock = items
    .map((i) => ({ productId: i.productId, requested: i.quantity, available: productById[i.productId].stock, name: productById[i.productId].name }))
    .filter((i) => i.requested > i.available);
  if (insufficientStock.length > 0) {
    throw new AppError("Algunos productos ya no tienen suficiente stock.", 409, { insufficientStock });
  }

  const orderItems = items.map((i) => ({ productId: i.productId, name: productById[i.productId].name, price: Number(productById[i.productId].price), quantity: i.quantity }));
  const total = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const tableOrder = await prisma.tableOrder.create({
    data: { tableId: table.id, items: orderItems, total, kitchenStatus: "RECEIVED", customerEmail },
  });

  // Confirmación al cliente — best-effort, nunca bloquea ni revierte el
  // pedido si el email falla (mismo criterio que sendOrderConfirmationEmail).
  await sendTableOrderStatusEmail({
    to: customerEmail,
    vendorId: table.vendor.id,
    vendorName: table.vendor.companyName,
    tableNumber: table.tableNumber,
    kitchenStatus: "RECEIVED",
  });

  res.status(201).json({ tableOrder });
}
