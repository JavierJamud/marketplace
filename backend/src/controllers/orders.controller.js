import { z } from "zod";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { sendOrderConfirmationEmail, sendNewOrderVendorEmail, sendOrderStatusEmail, sendManualOrderEmail, sendOrderCancelledVendorEmail } from "../lib/email.js";
import { resolveDiscountForOrder } from "./discountCodes.controller.js";
import { redeemForOrder, recordRedemption, awardOrderPoints, reverseOrderLoyalty } from "../services/loyalty.service.js";
import { resolveUnitPrice } from "../lib/pricing.js";
import { logActivity, actorRoleForVendorAction } from "../lib/activityLog.js";
import { recordOrderEvent } from "../lib/orderEvents.js";
import { upsertVendorCustomer } from "./vendorCustomers.controller.js";
import { getPlanLimit, assertPlanAllows } from "../lib/planConfig.js";

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
const PERSON_NAME_REGEX = /^[\p{L}\p{M} '’.-]+$/u;

// La tienda necesita poder contactar al cliente sí o sí — todos los campos
// de contacto/entrega son obligatorios, sin excepción (Bloque 6).
// Bloque 14: 3 opciones de checkout (antes whatsapp/cod/transfer) — ver
// CHANNEL_MAP y el comentario en schema.prisma sobre el enum OrderChannel.
export const createOrderSchema = z.object({
  vendorId: z.string(),
  channel: z.enum(["cod", "online", "cash", "table"]),
  // Nombre de persona: letras, espacios, apóstrofo, guion y punto (mismo filtro que el formulario).
  customerName: z.string().trim().min(2, "Falta el nombre del cliente.").max(80).regex(PERSON_NAME_REGEX, "El nombre solo puede llevar letras."),
  customerPhone: z.string().regex(E164_REGEX, "Falta un teléfono válido con código de país."),
  // Quien recibe, si no es quien compra. Si viene uno, tienen que venir los dos.
  recipientName: z.string().trim().min(2, "Falta el nombre de quien recibe.").max(80).regex(PERSON_NAME_REGEX, "El nombre de quien recibe solo puede llevar letras.").optional(),
  recipientPhone: z.string().regex(E164_REGEX, "Falta un teléfono válido de quien recibe.").optional(),
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
  // Bloque 52: código de descuento del vendedor aplicado en el carrito —
  // opcional, se revalida por completo acá (nunca se confía en el monto que
  // pudo haber mostrado el preview de /discount-codes/validate).
  discountCode: z.string().trim().optional(),
  // Puntos del programa de la tienda que el cliente quiere usar. Solo la cantidad: el valor y los topes los calcula el servidor.
  loyaltyPoints: z.number().int().min(1).max(10_000_000).optional(),
});

export const CHANNEL_MAP = { cod: "COD", online: "ONLINE", cash: "CASH", table: "TABLE" };

// Sin Stripe/PayPal ni ninguna pasarela: el pago se coordina siempre directo
// entre cliente y vendedor (contra entrega, en línea con la tienda, o
// efectivo). Esta ruta solo registra el pedido, nunca cobra nada.
export async function createOrder(req, res) {
  const data = createOrderSchema.parse(req.body);

  // Autenticación opcional: si viene un token válido, asocia el pedido al cliente.
  let customerId;
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null;
  if (token) {
    try {
      // Mismo criterio que middleware/auth.js (auditoría de seguridad): fija
      // el algoritmo esperado en vez de confiar en el "alg" del propio token.
      const payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
      customerId = payload.sub;
    } catch {
      // token inválido/expirado: seguimos como pedido de invitado
    }
  }

  const order = await placeOrder(data, { customerId });
  res.status(201).json({ order });
}

// Bloque 300: el registro del pedido vive aquí para que la web de Baznova y la API de socios
// (POST /partner/v1/orders) pasen por exactamente las mismas reglas, avisos y descuentos.
export async function placeOrder(data, { customerId, partnerId = null, idempotencyKey = null } = {}) {
  const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
  if (!vendor || vendor.isBlocked || vendor.status !== "ACTIVE") throw new AppError("Tienda no encontrada.", 404);

  // Bloque 206 (pedido explícito): Checkout.jsx ya filtra el desplegable de
  // provincias/países a la cobertura que el vendedor configuró, pero un
  // llamado directo a la API podía mandar cualquier provincia igual — acá
  // se hace cumplir de verdad. Cada eje (provincia cubana / país) solo
  // restringe si el vendedor configuró algo en ESE eje — sin nada
  // configurado, sin restricción (mismo criterio que ya usa el frontend).
  if (data.shippingProvinceId) {
    const province = await prisma.province.findUnique({ where: { id: data.shippingProvinceId } });
    if (!province) throw new AppError("La provincia/estado indicado no existe.", 400);

    const [vendorLocations, vendorDeliveryCountries] = await Promise.all([
      prisma.vendorLocation.findMany({ where: { vendorId: data.vendorId }, select: { provinceId: true, countryId: true, municipalityId: true } }),
      prisma.vendorDeliveryCountry.findMany({ where: { vendorId: data.vendorId }, select: { countryId: true } }),
    ]);

    const configuredProvinceIds = new Set(vendorLocations.map((l) => l.provinceId).filter(Boolean));
    // Un país queda "configurado" si aparece en cualquiera de las dos
    // fuentes — VendorLocation modela tanto zonas de Cuba (provinceId) como
    // locales fuera de Cuba (countryId + stateOther), VendorDeliveryCountry
    // es la lista aparte de países enteros a los que se hace envíos.
    const configuredCountryIds = new Set([
      ...vendorDeliveryCountries.map((d) => d.countryId),
      ...vendorLocations.map((l) => l.countryId).filter(Boolean),
    ]);

    // Mismo criterio que el checkout: si la tienda eligió provincias o estados en ese país, solo esos; si no eligió ninguno,
    // todo el país. Antes los estados no se comprobaban: una tienda que solo entrega en Texas aceptaba un pedido a California.
    const provincesInCountry = await prisma.province.findMany({
      where: { id: { in: [...configuredProvinceIds] }, countryId: province.countryId ?? undefined },
      select: { id: true },
    });
    if (provincesInCountry.length > 0 && !configuredProvinceIds.has(province.id)) {
      throw new AppError(province.type === "STATE" ? "Esta tienda no entrega en el estado seleccionado." : "Esta tienda no entrega en la provincia seleccionada.", 400);
    }
    if (configuredCountryIds.size > 0 && province.countryId && !configuredCountryIds.has(province.countryId)) {
      throw new AppError("Esta tienda no entrega en el país seleccionado.", 400);
    }
    // Si la tienda limitó esa provincia a ciertos municipios, el pedido solo puede ir a uno de ellos.
    const municipalityIds = vendorLocations.filter((l) => l.provinceId === province.id && l.municipalityId).map((l) => l.municipalityId);
    const unit = province.type === "STATE" ? "la ciudad" : "el municipio";
    if (municipalityIds.length > 0 && !data.shippingMunicipalityId) {
      throw new AppError(`Elige ${unit} de entrega: esta tienda solo entrega en algunos.`, 400);
    }
    if (municipalityIds.length > 0 && !municipalityIds.includes(data.shippingMunicipalityId)) {
      throw new AppError(province.type === "STATE" ? "Esta tienda no entrega en la ciudad seleccionada." : "Esta tienda no entrega en el municipio seleccionado.", 400);
    }
    // El municipio o la ciudad tiene que ser de esa provincia o estado.
    if (data.shippingMunicipalityId) {
      const m = await prisma.municipality.findUnique({ where: { id: data.shippingMunicipalityId }, select: { provinceId: true } });
      if (!m || m.provinceId !== province.id) throw new AppError(`${unit === "la ciudad" ? "La ciudad" : "El municipio"} no pertenece a ${province.name}.`, 400);
    }
  }

  // La forma de coordinar el pago la define la tienda: no se acepta una que la tienda no ofrece.
  if (data.channel !== "table" && !(vendor.checkoutPaymentOptions ?? ["cod", "online", "cash"]).includes(data.channel)) {
    throw new AppError("Esta tienda no ofrece esa forma de pago. Elige otra de las disponibles.", 400);
  }

  const productIds = data.items.map((i) => i.productId);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, include: { priceTiers: true } });

  if (products.length !== productIds.length) throw new AppError("Uno o más productos ya no están disponibles.", 400);
  // Un producto pausado, oculto de la tienda o fuera del cupo del plan no se puede pedir aunque
  // alguien conozca su id (antes solo se comprobaba que existiera).
  if (products.some((p) => !p.isActive || p.hiddenFromStore || p.overQuota)) {
    throw new AppError("Uno o más productos ya no están disponibles.", 400);
  }

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
      // Bloque 56: "disponible siempre" — nunca entra a este chequeo, sin
      // importar qué tenga guardado en `stock` (no se le lleva seguimiento).
      if (product.unlimitedStock) return null;
      const available = i.size ? Number(product.sizeStock?.[i.size] ?? 0) : product.stock;
      return { productId: i.productId, requested: i.quantity, available, name: product.name, size: i.size ?? null };
    })
    .filter((i) => i && i.requested > i.available);
  if (quickCheck.length > 0) {
    throw new AppError("Algunos productos ya no tienen suficiente stock.", 409, { insufficientStock: quickCheck });
  }

  // El precio se toma del producto en DB (no del cliente) para evitar
  // manipulación. Bloque 55: si el producto tiene precios por cantidad
  // (mayoreo), acá se resuelve el precio POR UNIDAD real según la cantidad
  // pedida — nunca el precio de 1 unidad a secas ni uno que mande el cliente.
  const orderItems = data.items.map((i) => {
    const product = productById[i.productId];
    return {
      productId: i.productId,
      name: product.name,
      price: resolveUnitPrice(product.price, product.priceTiers, i.quantity),
      currency: product.currency,
      quantity: i.quantity,
      selectedOptions: i.selectedOptions ?? null,
      size: i.size ?? null,
    };
  });
  const subtotal = orderItems.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);

  // Bloque 29: ya NO se descuenta stock acá — el pedido queda registrado
  // como NEW ("Pendiente") sin tocar Product.stock. El descuento real recién
  // pasa cuando el vendedor confirma la venta desde su panel
  // (confirmOrderSale, más abajo), que sí usa la misma transacción atómica
  // con updateMany+WHERE stock>=cantidad que antes vivía acá. Esto es
  // justamente lo que evita el bug original: dos clientes pidiendo el
  // último ítem casi a la vez ya no compiten por decrementar la misma fila
  // al crear el pedido — ambos pedidos se crean igual, y es el vendedor
  // quien decide cuál confirmar cuando efectivamente le queda stock.
  //
  // Bloque 52: si viene un código de descuento, se revalida acá adentro
  // (nunca se confía en el preview de /discount-codes/validate) y se
  // reclama un uso de forma atómica (updateMany con WHERE usesCount<maxUses)
  // dentro de la MISMA transacción que crea el pedido — si el reclamo falla
  // (otro cliente agotó el cupo justo antes), toda la transacción se aborta
  // y el pedido no llega a crearse, en vez de quedar "confirmado" sin
  // descuento aplicado de verdad.
  const order = await prisma.$transaction(async (tx) => {
    let discountCodeId = null;
    let discountAmount = null;
    let total = subtotal;

    if (data.discountCode) {
      const resolved = await resolveDiscountForOrder(tx, { vendorId: data.vendorId, code: data.discountCode, subtotal });
      const claim = await tx.discountCode.updateMany({
        where: {
          id: resolved.discountCode.id,
          active: true,
          ...(resolved.discountCode.maxUses != null ? { usesCount: { lt: resolved.discountCode.maxUses } } : {}),
        },
        data: { usesCount: { increment: 1 } },
      });
      if (claim.count === 0) throw new AppError("Este código de descuento ya alcanzó su límite de usos.", 409);

      discountCodeId = resolved.discountCode.id;
      discountAmount = resolved.discountAmount;
      total = subtotal - discountAmount;
    }

    // Puntos: se descuentan del saldo aquí mismo; si algo falla después, la transacción entera se deshace y el saldo vuelve.
    const redemption = await redeemForOrder(tx, { vendor, customerId, requestedPoints: data.loyaltyPoints, payable: total, items: orderItems });
    if (redemption) total = Math.max(0, total - redemption.discount);

    const created = await tx.order.create({
      data: {
        code: `Z-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`,
        vendorId: data.vendorId,
        customerId,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail,
        recipientName: data.recipientName && data.recipientPhone ? data.recipientName : null,
        recipientPhone: data.recipientName && data.recipientPhone ? data.recipientPhone : null,
        shippingAddress: data.shippingAddress,
        shippingProvinceId: data.shippingProvinceId,
        shippingMunicipalityId: data.shippingMunicipalityId,
        channel: CHANNEL_MAP[data.channel],
        // Se toma del vendedor server-side (nunca del body del cliente) para
        // que no se pueda falsear qué canal de aviso usó el pedido.
        notificationChannel: vendor.orderDestination,
        tableNumber: data.tableNumber,
        partnerId,
        idempotencyKey,
        total,
        discountCodeId,
        discountAmount,
        loyaltyPointsRedeemed: redemption?.points ?? null,
        loyaltyDiscount: redemption?.discount ?? null,
        items: { create: orderItems },
      },
      include: {
        // Bloque 231: product.images acá alimenta la foto de cada artículo
        // en orderConfirmationEmail (ver itemsTable, templates/_shared.js).
        items: { include: { product: { select: { images: true } } } },
        vendor: { select: { companyName: true, whatsapp: true, orderDestination: true, logoUrl: true } },
      },
    });
    await recordRedemption(tx, redemption, created);
    return created;
  });

  await recordOrderEvent(order.id, "CREATED");
  await upsertVendorCustomer(order.vendorId, { name: order.customerName, phone: order.customerPhone, email: order.customerEmail });

  // Confirmación al cliente — best-effort, nunca bloquea ni revierte el pedido.
  await sendOrderConfirmationEmail(order);

  // Bloque 231 (pedido explícito — "cuando un cliente envía un pedido se
  // debe llegar y notificar en tiempo real en el panel del vendedor, y de
  // no estar logeado se debe notificar vía email al admin del nuevo pedido
  // y de su estado"): antes un pedido normal (no de mesa) nunca generaba
  // ninguna VendorNotification — solo los pedidos de mesa tenían aviso
  // propio (NewOrderPopup.jsx). La campanita del vendedor (VendorNotificationBell.jsx)
  // ya poll-ea /vendors/me/notifications cada 20s, así que basta con crear
  // la fila acá para que aparezca sola; el popup+sonido en vivo los detecta
  // por separado desde NewRegularOrderPopup.jsx (poll de /orders/me).
  const totalLabel = `${Number(order.total).toLocaleString("es-CU")} CUP`;
  await prisma.vendorNotification.create({
    data: {
      vendorId: order.vendorId,
      type: "NEW_ORDER",
      refCode: order.code,
      title: "Pedido nuevo",
      body: `Pedido ${order.code} de ${order.customerName ?? "un cliente"} por ${totalLabel} — está en tu sección de Pedidos.`,
    },
  });
  // Aviso por correo a la TIENDA (no al administrador): llega al correo de la tienda si ella lo tiene activado
  // en su configuración. Best-effort, nunca bloquea ni revierte el pedido.
  const partner = partnerId ? await prisma.partner.findUnique({ where: { id: partnerId }, select: { name: true } }) : null;
  await sendNewOrderVendorEmail(order, { partnerName: partner?.name }).catch(() => {});

  // Solo se registra si el pedido se hizo logueado — un pedido de invitado no
  // tiene ningún User al que atarle la fila de ActivityLog.
  if (customerId) {
    logActivity({
      actorId: customerId,
      actorRole: "CUSTOMER",
      vendorId: order.vendorId,
      action: "order_placed",
      description: `Hizo un pedido en "${order.vendor.companyName}"`,
      meta: { orderId: order.id, code: order.code },
    });
  }

  return order;
}

// --- Panel de vendedor -------------------------------------------------

// Lista unificada: pedidos "normales" (whatsapp/cod/transfer) + pedidos de
// mesa (si el vendedor es restaurante), ambos filtrados server-side por el
// vendorId del usuario autenticado.
export async function listMyOrders(req, res) {
  const vendor = await resolveMyVendor(req.user.id);

  const orders = await prisma.order.findMany({
    where: { vendorId: vendor.id },
    include: { items: true, events: { orderBy: { createdAt: "asc" } } },
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

  // Ventas de caja: cada una ya es un pedido; se le agregan los datos del mostrador (número, cómo se pagó, vuelto, quién cobró,
  // a qué hora estuvo lista y se recogió) para verlos en el mismo detalle.
  const posSales = await prisma.posSale.findMany({
    where: { vendorId: vendor.id, orderId: { in: orders.map((o) => o.id) } },
    select: { orderId: true, code: true, paymentMethod: true, cashReceived: true, changeGiven: true, fulfillment: true, paidAt: true, readyAt: true, pickedUpAt: true, createdById: true },
  });
  const cashierIds = [...new Set(posSales.map((s) => s.createdById))];
  const cashiers = cashierIds.length ? await prisma.user.findMany({ where: { id: { in: cashierIds } }, select: { id: true, fullName: true } }) : [];
  const cashierName = new Map(cashiers.map((u) => [u.id, u.fullName]));
  const posByOrder = new Map(
    posSales.map((s) => [
      s.orderId,
      {
        code: s.code,
        paymentMethod: s.paymentMethod,
        cashReceived: s.cashReceived != null ? Number(s.cashReceived) : null,
        change: s.changeGiven != null ? Number(s.changeGiven) : null,
        fulfillment: s.fulfillment,
        paidAt: s.paidAt,
        readyAt: s.readyAt,
        pickedUpAt: s.pickedUpAt,
        cashier: cashierName.get(s.createdById) ?? null,
      },
    ])
  );

  res.json({ orders: orders.map((o) => (posByOrder.has(o.id) ? { ...o, pos: posByOrder.get(o.id) } : o)), tableOrders });
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

const updateOrderStatusSchema = z.object({
  status: z.enum(["NEW", "PREPARING", "READY", "DELIVERED", "CANCELLED"]),
  // Bloque 197 (pedido explícito — "eliminar pedido... esto se puede hacer
  // para pedidos erróneos"): solo se exige (y solo se guarda) cuando el
  // destino es CANCELLED — ver el chequeo manual más abajo, igual que
  // cancelTableOrderSchema en tables.controller.js.
  reason: z.string().trim().optional(),
});

// El aviso de "pedido nuevo" deja de mostrarse en la campanita cuando el pedido ya se atendió (confirmado, anulado o eliminado).
async function resolveNewOrderNotices(vendorId, code) {
  await prisma.vendorNotification
    .updateMany({ where: { vendorId, type: "NEW_ORDER", refCode: code, resolvedAt: null }, data: { resolvedAt: new Date(), readAt: new Date() } })
    .catch(() => {});
}

// Un pedido que vino de la caja avanza también en la caja (y en la pantalla de pedidos del local). Si se anula, la venta de caja
// queda anulada y, si se cobró en efectivo, se registra la devolución como salida de caja.
async function syncPosSaleFromOrder(order, status, userId) {
  const sale = await prisma.posSale.findFirst({ where: { orderId: order.id, vendorId: order.vendorId } });
  if (!sale) return;
  const now = new Date();
  if (status === "CANCELLED") {
    await prisma.posSale.update({ where: { id: sale.id }, data: { status: "CANCELLED", fulfillment: null } });
    if (sale.paymentMethod === "CASH") {
      await prisma.cashEntry.create({ data: { vendorId: sale.vendorId, type: "WITHDRAWAL", amount: -Number(sale.total), currency: sale.currency, posSaleId: sale.id, createdById: userId, note: `Devolución venta ${sale.code} (pedido anulado)` } });
    }
    return;
  }
  const fulfillment = { PREPARING: "PREPARING", READY: "READY", DELIVERED: "PICKED_UP" }[status];
  if (!fulfillment || sale.fulfillment === fulfillment) return;
  await prisma.posSale.update({
    where: { id: sale.id },
    data: { fulfillment, ...(fulfillment === "READY" ? { readyAt: now } : {}), ...(fulfillment === "PICKED_UP" ? { pickedUpAt: now } : {}) },
  });
}

export async function updateOrderStatus(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;
  const { status, reason } = updateOrderStatusSchema.parse(req.body);

  const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!order || order.vendorId !== vendor.id) throw new AppError("Pedido no encontrado.", 404);
  // Bloque 231: precio total ya vive en `order`, se reusa tal cual para el
  // correo de abajo — nunca se recalcula desde los items.

  // Bloque 197 (pedido explícito — "quiero poder agregar una función para
  // eliminar pedido, eso [en realidad] no elimina el pedido, lo marca como
  // tachado... no se elimina y sigue quedando registrado pero no marcará
  // diferencia de ventas ni inventario... esto se puede hacer para pedidos
  // erróneos"): CANCELLED es una salida APARTE del flujo normal de
  // VALID_TRANSITIONS — antes solo se podía cancelar desde NEW o PREPARING
  // (READY/DELIVERED eran terminales), pero un pedido erróneo puede
  // notarse recién después de marcarlo Listo o Entregado. Se permite desde
  // cualquier estado que no sea ya CANCELLED, sin tocar el resto del mapa
  // (nunca se puede "revivir" un pedido cancelado, ni saltarse pasos para
  // cualquier otro destino).
  const isValidTransition = status === "CANCELLED" ? order.status !== "CANCELLED" : VALID_TRANSITIONS[order.status].includes(status);
  if (!isValidTransition) {
    throw new AppError(`No se puede pasar un pedido de "${order.status}" a "${status}".`, 400);
  }
  if (status === "CANCELLED" && (!reason || reason.length < 3)) {
    throw new AppError("Escribe el motivo de la cancelación.", 400);
  }

  // Bloque 29: si el pedido YA estaba confirmado (PREPARING/READY — el stock
  // real se descontó en confirmOrderSale) y ahora se cancela, hay que
  // devolver ese stock, si no el producto queda "perdido" para siempre pese
  // a que la venta nunca se concretó. Un pedido rechazado estando todavía
  // NEW nunca llegó a descontar nada, así que no hay nada que devolver ahí.
  const shouldRestock = status === "CANCELLED" && order.status !== "NEW";

  // Bloque 56: no tiene sentido "devolver" stock de un producto que nunca le
  // llevamos la cuenta — se resuelve antes de la transacción, igual que en
  // confirmOrderSale.
  let isUnlimited = new Map();
  if (shouldRestock) {
    const restockProductIds = [...new Set(order.items.map((i) => i.productId).filter(Boolean))];
    const restockProducts = await prisma.product.findMany({ where: { id: { in: restockProductIds } }, select: { id: true, unlimitedStock: true } });
    isUnlimited = new Map(restockProducts.map((p) => [p.id, p.unlimitedStock]));
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (shouldRestock) {
      for (const item of order.items) {
        if (!item.productId || isUnlimited.get(item.productId)) continue;
        if (item.size) await incrementSizeStock(tx, item.productId, item.size, item.quantity);
        else await tx.product.updateMany({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
      }
    }
    if (status === "CANCELLED") await reverseOrderLoyalty(id, tx);
    return tx.order.update({
      where: { id },
      data: { status, ...(status === "CANCELLED" ? { cancelReason: reason.trim() } : {}) },
      // Bloque 231: items+product.images acá alimentan la tabla de
      // artículos que ahora también lleva statusUpdateEmail (antes este
      // correo no mostraba ningún artículo).
      include: {
        vendor: { select: { companyName: true, logoUrl: true } },
        items: { include: { product: { select: { images: true } } } },
      },
    });
  });

  await recordOrderEvent(id, status, status === "CANCELLED" ? reason.trim() : null);
  await resolveNewOrderNotices(vendor.id, order.code);
  await syncPosSaleFromOrder(order, status, req.user.id).catch((err) => console.error("[pos] no se pudo sincronizar la venta de caja", order.code, err));
  // Los puntos del programa se ganan al entregar. Si falla, el pedido igual queda entregado; se registra el error.
  if (status === "DELIVERED") {
    const earned = await awardOrderPoints(id).catch((err) => {
      console.error("[loyalty] no se pudieron sumar los puntos del pedido", order.code, err);
      return 0;
    });
    if (earned) updated.loyaltyPointsEarned = earned;
  }

  if (status === "CANCELLED") {
    logActivity({
      actorId: req.user.id,
      actorRole: actorRoleForVendorAction(req),
      vendorId: vendor.id,
      action: "order_cancelled",
      description: `Anuló el pedido ${order.code} — ${reason.trim()}`,
      meta: { orderId: id, reason: reason.trim() },
    });
  }

  // "Tiempo real" = disparado en el momento del cambio, no un cron/batch.
  await sendOrderStatusEmail(updated);
  if (status === "CANCELLED") await sendOrderCancelledVendorEmail(updated, { by: "STORE", reason: reason.trim() }).catch(() => {});

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

  // Bloque 56: "disponible siempre" — se resuelve ANTES de la transacción
  // para saber a qué ítems no hay que hacerles ningún chequeo/descuento.
  const orderProductIds = [...new Set(order.items.map((i) => i.productId).filter(Boolean))];
  const orderProducts = await prisma.product.findMany({ where: { id: { in: orderProductIds } }, select: { id: true, unlimitedStock: true } });
  const isUnlimited = new Map(orderProducts.map((p) => [p.id, p.unlimitedStock]));

  const updated = await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      if (!item.productId) continue; // producto borrado después del pedido — nada que descontar

      // Bloque 98 (pedido explícito): señal real de "ventas" para el
      // algoritmo de "Destacados" — acá, no en createOrder, porque acá es
      // donde el vendedor confirma que la venta es real (mismo momento que
      // ya descuenta stock de verdad). Cuenta SIEMPRE, incluso con
      // unlimitedStock (esos productos igual se venden, solo no se les
      // sigue el stock) — si más abajo algo falla, toda la transacción
      // (este increment incluido) se revierte junto con el resto.
      // Bloque 230 (Fase 3): misma ancla de recencia que trackProductClick
      // (products.controller.js) — una venta confirmada también cuenta como
      // actividad real reciente para el decay del ranking.
      await tx.product.updateMany({
        where: { id: item.productId },
        data: { salesCount: { increment: item.quantity }, lastActivityAt: new Date() },
      });

      if (isUnlimited.get(item.productId)) continue; // sin seguimiento de stock — nunca bloquea la confirmación.

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
    return tx.order.update({
      where: { id },
      data: { status: "PREPARING" },
      include: {
        items: { include: { product: { select: { images: true } } } },
        vendor: { select: { companyName: true, logoUrl: true } },
      },
    });
  });

  // El stock de estos productos ya bajó de verdad — ver si algún OTRO
  // pedido Pendiente del mismo vendedor pidiendo alguno de ellos quedó sin
  // alcance. Es solo un aviso para que el vendedor decida (notificar al
  // cliente o dejarlo pendiente tal cual); nunca se toca ese otro pedido acá.
  await recordOrderEvent(id, "CONFIRMED");
  await resolveNewOrderNotices(vendor.id, order.code);

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

  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, stock: true, sizeStock: true, unlimitedStock: true } });
  const productById = new Map(products.map((p) => [p.id, p]));

  // Bloque 52: si el ítem lleva talla, lo que importa es el stock de ESA
  // talla, no el total del producto (puede sobrar en otras tallas). Bloque
  // 56: un producto "disponible siempre" nunca queda en riesgo.
  function availableFor(item) {
    const product = productById.get(item.productId);
    if (!product) return 0;
    if (product.unlimitedStock) return Infinity;
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

  await reverseOrderLoyalty(id); // si el cliente pagó parte con puntos, se le devuelven
  await prisma.order.delete({ where: { id } }); // OrderItem tiene onDelete: Cascade
  await resolveNewOrderNotices(vendor.id, order.code);
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
  const products = await prisma.product.findMany({
    where: { id: { in: uniqueProductIds }, vendorId: vendor.id },
    include: { priceTiers: true },
  });
  if (products.length !== uniqueProductIds.length) throw new AppError("Uno o más productos ya no están disponibles.", 400);
  const productById = Object.fromEntries(products.map((p) => [p.id, p]));

  const orderItems = items.map((i) => {
    const product = productById[i.productId];
    return {
      productId: i.productId,
      name: product.name,
      price: resolveUnitPrice(product.price, product.priceTiers, i.quantity),
      currency: product.currency,
      quantity: i.quantity,
      size: i.size ?? null,
    };
  });
  // El descuento del código y el de los puntos ya se aplicaron al crear el pedido: se mantienen al cambiar los productos.
  // Antes el total se recalculaba sin ellos y el cliente perdía el descuento si la tienda tocaba el pedido.
  const subtotal = orderItems.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
  const total = Math.max(0, subtotal - Number(order.discountAmount ?? 0) - Number(order.loyaltyDiscount ?? 0));

  const updated = await prisma.$transaction(async (tx) => {
    await tx.orderItem.deleteMany({ where: { orderId: id } });
    return tx.order.update({ where: { id }, data: { total, items: { create: orderItems } }, include: { items: true } });
  });

  res.json({ order: updated });
}

// --- Emails manuales del vendedor ---------------------------------------

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
  const limit = await getPlanLimit(vendor, "maxMonthlyOrderEmails");
  if (limit === null) {
    return res.json({ unlimited: true, used: null, limit: null });
  }
  const used = await countManualEmailsThisMonth(vendor.id);
  res.json({ unlimited: false, used, limit });
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

  await assertPlanAllows(vendor, "allowCustomerEmails", "Enviar correos a tus clientes es del Plan Premium. Escríbele por WhatsApp o cambia de plan.");
  const monthlyEmailLimit = await getPlanLimit(vendor, "maxMonthlyOrderEmails");
  if (monthlyEmailLimit !== null) {
    const used = await countManualEmailsThisMonth(vendor.id);
    if (used >= monthlyEmailLimit) {
      throw new AppError(
        `Alcanzaste el límite de ${monthlyEmailLimit} emails manuales de tu plan este mes. Verificate para pasar a Premium y enviar sin límite.`,
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

// --- Acciones del cliente sobre su pedido --------------------------------
// Un cliente solo puede cancelar o cambiar su pedido mientras esté pendiente (recibido y SIN confirmar por la tienda). Cuando la tienda lo
// confirma y empieza a prepararlo o enviarlo, el cliente tiene que contactar a la tienda directamente: la plataforma no lo cancela.
// Cada acción queda en el historial del pedido y avisa al vendedor en su panel al momento.

export const CUSTOMER_CAN_CANCEL = ["NEW"];
export const CUSTOMER_CAN_EDIT = ["NEW"];

const ORDER_EMAIL_INCLUDE = {
  vendor: { select: { companyName: true, logoUrl: true } },
  items: { include: { product: { select: { images: true } } } },
};

// Datos de la tienda para que el cliente la contacte (los que la tienda ya publica en su página).
export async function storeContactFor(vendorId) {
  const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { companyName: true, slug: true, whatsapp: true, email: true, companyAddress: true } });
  return v ? { name: v.companyName, slug: v.slug, whatsapp: v.whatsapp ?? null, email: v.email ?? null, address: v.companyAddress ?? null } : null;
}

async function notifyVendorOfCustomerAction(order, { type, title, body }) {
  await prisma.vendorNotification.create({ data: { vendorId: order.vendorId, type, refCode: order.code, title, body } }).catch(() => {});
}

// Cancela el pedido a nombre del cliente. `via` dice desde dónde ("su cuenta" o "el asistente") para el historial.
export async function cancelOrderForCustomer(order, reason, via = "su cuenta") {
  const cleanReason = String(reason ?? "").trim();
  if (order.status === "CANCELLED") throw new AppError("Este pedido ya estaba cancelado.", 400);
  if (!CUSTOMER_CAN_CANCEL.includes(order.status)) {
    throw new AppError("La tienda ya empezó a atender este pedido, así que no se puede cancelar desde aquí. Contacta directamente a la tienda.", 409);
  }
  if (cleanReason.length < 3) throw new AppError("Escribe el motivo de la cancelación.", 400);

  const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
  // Si la tienda ya había confirmado la venta, el stock ya se descontó: se devuelve.
  const shouldRestock = order.status !== "NEW";
  let isUnlimited = new Map();
  if (shouldRestock) {
    const ids = [...new Set(items.map((i) => i.productId).filter(Boolean))];
    const products = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, unlimitedStock: true } });
    isUnlimited = new Map(products.map((p) => [p.id, p.unlimitedStock]));
  }

  const storedReason = `Cancelado por el cliente: ${cleanReason}`;
  const updated = await prisma.$transaction(async (tx) => {
    // Mismo estado de origen exigido en el UPDATE: si la tienda lo cambió justo ahora, no se pisa.
    const claimed = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status: "CANCELLED", cancelReason: storedReason } });
    if (claimed.count === 0) throw new AppError("El pedido cambió de estado hace un momento. Revísalo e inténtalo de nuevo.", 409);
    await reverseOrderLoyalty(order.id, tx);
    if (shouldRestock) {
      for (const item of items) {
        if (!item.productId || isUnlimited.get(item.productId)) continue;
        if (item.size) await incrementSizeStock(tx, item.productId, item.size, item.quantity);
        else await tx.product.updateMany({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
      }
    }
    return tx.order.findUnique({ where: { id: order.id }, include: ORDER_EMAIL_INCLUDE });
  });

  await recordOrderEvent(order.id, "CANCELLED", `Cliente (${via}): ${cleanReason}`);
  await resolveNewOrderNotices(order.vendorId, order.code);
  await notifyVendorOfCustomerAction(order, {
    type: "ORDER_CANCELLED_BY_CUSTOMER",
    title: "Pedido cancelado por el cliente",
    body: `${order.customerName ?? "El cliente"} canceló el pedido ${order.code}. Motivo: ${cleanReason}`,
  });
  await sendOrderStatusEmail(updated).catch(() => {});
  await sendOrderCancelledVendorEmail(updated, { by: "CUSTOMER", reason: cleanReason }).catch(() => {});
  return updated;
}

export const customerItemsSchema = z
  .array(z.object({ productId: z.string(), quantity: z.number().int().min(1).max(999), size: z.string().nullish() }))
  .min(1, "El pedido necesita al menos un producto. Si ya no lo quieres, cancélalo.")
  .max(50);

// Cambia los productos de un pedido pendiente: quitar, cambiar cantidades o agregar otros de la misma tienda.
export async function editOrderItemsForCustomer(order, rawItems, via = "su cuenta") {
  if (!CUSTOMER_CAN_EDIT.includes(order.status)) {
    throw new AppError("Este pedido ya fue confirmado por la tienda, así que no se puede modificar. Puedes cancelarlo o escribirle a la tienda.", 400);
  }
  if (order.discountCodeId || order.loyaltyPointsRedeemed) {
    throw new AppError(`Este pedido usó ${order.discountCodeId ? "un código de descuento" : "puntos de la tienda"} y no se puede modificar. Cancélalo y haz uno nuevo.`, 400);
  }
  const items = customerItemsSchema.parse(rawItems);

  // Una misma línea (producto y talla) no puede repetirse: se suman.
  const merged = new Map();
  for (const i of items) {
    const key = `${i.productId}|${i.size ?? ""}`;
    merged.set(key, { productId: i.productId, size: i.size ?? undefined, quantity: (merged.get(key)?.quantity ?? 0) + i.quantity });
  }
  const lines = [...merged.values()];

  const previous = await prisma.orderItem.findMany({ where: { orderId: order.id } });
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, include: { priceTiers: true } });
  if (products.length !== productIds.length) throw new AppError("Uno o más productos ya no están disponibles.", 400);
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));

  const unavailable = [];
  for (const l of lines) {
    const p = byId[l.productId];
    if (p.vendorId !== order.vendorId) throw new AppError("Todos los productos deben ser de la misma tienda.", 400);
    const wasInOrder = previous.some((x) => x.productId === l.productId);
    // Un producto que ya estaba en el pedido se puede conservar aunque se haya pausado; uno nuevo tiene que estar a la venta.
    if (!wasInOrder && (!p.isActive || p.hiddenFromStore || p.overQuota)) throw new AppError(`"${p.name}" ya no está disponible.`, 400);
    if (p.sizes.length > 0 && !p.sizes.includes(l.size)) throw new AppError(`Elige una talla válida para "${p.name}".`, 400);
    if (p.sizes.length === 0) l.size = undefined;
    if (!p.unlimitedStock) {
      const available = l.size ? Number(p.sizeStock?.[l.size] ?? 0) : p.stock;
      if (l.quantity > available) unavailable.push({ productId: p.id, name: p.name, requested: l.quantity, available, size: l.size ?? null });
    }
  }
  if (unavailable.length) throw new AppError("Algunos productos no tienen suficiente stock.", 409, { insufficientStock: unavailable });

  const newItems = lines.map((l) => {
    const p = byId[l.productId];
    const before = previous.find((x) => x.productId === l.productId && (x.size ?? null) === (l.size ?? null));
    return {
      productId: p.id,
      name: p.name,
      price: resolveUnitPrice(p.price, p.priceTiers, l.quantity),
      currency: p.currency,
      quantity: l.quantity,
      size: l.size ?? null,
      selectedOptions: before?.selectedOptions ?? undefined,
    };
  });
  const total = newItems.reduce((s, i) => s + Number(i.price) * i.quantity, 0);

  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({ where: { id: order.id, status: "NEW" }, data: { total } });
    if (claimed.count === 0) throw new AppError("La tienda acaba de atender este pedido y ya no se puede modificar.", 409);
    await tx.orderItem.deleteMany({ where: { orderId: order.id } });
    await tx.orderItem.createMany({ data: newItems.map((i) => ({ ...i, orderId: order.id })) });
    return tx.order.findUnique({ where: { id: order.id }, include: { items: true, vendor: { select: { companyName: true, slug: true, color: true } } } });
  });

  const units = newItems.reduce((s, i) => s + i.quantity, 0);
  const summary = `${newItems.length} ${newItems.length === 1 ? "producto" : "productos"}, ${units} ${units === 1 ? "unidad" : "unidades"}`;
  await recordOrderEvent(order.id, "EDITED_BY_CUSTOMER", `Cliente (${via}): ${summary}`);
  await notifyVendorOfCustomerAction(order, {
    type: "ORDER_EDITED_BY_CUSTOMER",
    title: "Pedido modificado por el cliente",
    body: `${order.customerName ?? "El cliente"} cambió los productos del pedido ${order.code}: ahora son ${summary}, total ${Number(total).toLocaleString("es-CU")} ${newItems[0].currency}. Revísalo antes de confirmarlo.`,
  });
  return updated;
}
