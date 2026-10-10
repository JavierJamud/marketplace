import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { placeOrder } from "./orders.controller.js";
import { getSubscriptionPricing } from "./settings.controller.js";
import { getAllPlanConfigs } from "../lib/planConfig.js";
import { visibleVendorWhere, absUrl, siteUrl } from "../lib/partnerDto.js";
import { orderWhatsAppText, whatsappUrl, mixedTotalLabel } from "../lib/orderWhatsapp.js";
import { isVendorOpenNow } from "../services/schedule.service.js";

// Pedidos por la API de socios. Pasan por placeOrder (orders.controller.js), la misma función que
// usa el checkout de Baznova: mismas reglas (una sola tienda por pedido, stock, tallas, precios por
// cantidad, descuentos, cobertura de envío), mismo aviso en el panel del vendedor, mismo correo y
// el mismo mensaje de WhatsApp. Aquí solo se agrega lo que hace falta para un cliente externo:
// validación más estricta, Idempotency-Key obligatoria y límite de pedidos por credencial.

const E164 = /^\+\d{7,15}$/;
const idLike = z.string().min(1).max(60);

const orderBody = z
  .object({
    storeSlug: z.string().trim().min(1).max(120),
    channel: z.enum(["cod", "online", "cash"]),
    customerName: z.string().trim().min(2, "Falta el nombre del cliente.").max(120),
    customerPhone: z.string().regex(E164, "El teléfono debe llevar el código de país, por ejemplo +5355512345."),
    customerEmail: z.string().trim().email("Falta un correo válido.").max(160),
    shippingProvinceId: idLike,
    shippingMunicipalityId: idLike.optional(),
    // Solo para provincias de tipo "estado" (fuera de Cuba): ciudad escrita a mano.
    shippingCity: z.string().trim().min(2).max(120).optional(),
    shippingAddress: z.string().trim().min(5, "La dirección es muy corta.").max(300),
    items: z
      .array(z.object({ productId: idLike, quantity: z.number().int().min(1).max(10000), size: z.string().trim().min(1).max(20).optional() }).strict())
      .min(1, "El pedido necesita al menos un producto.")
      .max(50, "Un pedido admite hasta 50 líneas."),
    discountCode: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

const IDEMPOTENCY = /^[A-Za-z0-9_-]{8,64}$/;

// Tope de pedidos por credencial: 60 cada 5 minutos (el mismo que tiene el checkout web por IP).
const ORDER_WINDOW_MS = 5 * 60 * 1000;
const ORDER_MAX = 60;
const orderHits = new Map();
function consumeOrderSlot(keyId) {
  const now = Date.now();
  const hits = (orderHits.get(keyId) ?? []).filter((t) => now - t < ORDER_WINDOW_MS);
  if (hits.length >= ORDER_MAX) {
    orderHits.set(keyId, hits);
    return false;
  }
  hits.push(now);
  orderHits.set(keyId, hits);
  if (orderHits.size > 2000) orderHits.clear();
  return true;
}

async function visibleStore(partnerId, slug) {
  const store = await prisma.vendor.findFirst({
    where: { slug, ...visibleVendorWhere(partnerId) },
    include: { locations: { select: { provinceId: true, countryId: true } }, deliveryCountries: { select: { countryId: true } }, schedules: true },
  });
  if (!store) throw new AppError("Tienda no encontrada.", 404);
  return store;
}

// Provincias donde la tienda entrega: mismo criterio que valida placeOrder y que usa el checkout web.
async function deliveryProvinces(store) {
  const provinceIds = new Set(store.locations.map((l) => l.provinceId).filter(Boolean));
  const countryIds = new Set([...store.deliveryCountries.map((d) => d.countryId), ...store.locations.map((l) => l.countryId).filter(Boolean)]);
  const all = await prisma.province.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true, countryId: true } });
  return all.filter((p) => {
    if (p.type !== "STATE" && provinceIds.size > 0 && !provinceIds.has(p.id)) return false;
    if (countryIds.size > 0 && p.countryId && !countryIds.has(p.countryId)) return false;
    return true;
  });
}

// GET /stores/:slug/checkout: todo lo que el sitio del socio necesita para armar el formulario de pedido.
export async function getCheckoutRequirements(req, res) {
  const store = await visibleStore(req.partner.id, req.params.slug);
  const provinces = await deliveryProvinces(store);
  const { isOpen, nextOpenLabel } = isVendorOpenNow(store.schedules, store.timezone);
  res.json({
    data: {
      store: { slug: store.slug, name: store.companyName, url: `${siteUrl()}/tienda/${store.slug}`, whatsapp: store.whatsapp, currency: store.currency },
      acceptsOrders: true,
      orderDestination: store.orderDestination,
      isOpenNow: isOpen,
      nextOpenLabel: nextOpenLabel ?? null,
      rules: [
        "Todos los productos de un pedido deben ser de la misma tienda.",
        "El precio y el total los calcula Baznova; nunca se toman del cliente.",
        "El stock se confirma cuando el vendedor acepta el pedido.",
        "Cada pedido necesita una cabecera Idempotency-Key única (8 a 64 caracteres) para que un reintento no duplique el pedido.",
      ],
      channels: [
        { id: "cod", title: "Pago contra entrega" },
        { id: "online", title: "Pago en línea con el vendedor" },
        { id: "cash", title: "Efectivo" },
      ],
      fields: [
        { name: "customerName", required: true, min: 2, max: 120, label: "Nombre del cliente" },
        { name: "customerPhone", required: true, format: "E.164 con código de país, ej. +5355512345", label: "Teléfono" },
        { name: "customerEmail", required: true, format: "correo válido", label: "Correo" },
        { name: "shippingProvinceId", required: true, label: "Provincia o estado (usa la lista delivery.provinces)" },
        { name: "shippingMunicipalityId", required: "si la provincia no es de tipo STATE", label: "Municipio de esa provincia (GET /locations/municipalities)" },
        { name: "shippingCity", required: "solo si la provincia es de tipo STATE", label: "Ciudad" },
        { name: "shippingAddress", required: true, min: 5, max: 300, label: "Dirección" },
        { name: "items", required: true, max: 50, label: "Productos: { productId, quantity, size? } (size solo si el producto tiene tallas)" },
        { name: "discountCode", required: false, label: "Código de descuento de la tienda" },
      ],
      delivery: { restricted: provinces.length > 0, provinces },
    },
  });
}

function orderDto(order, store, extra = {}) {
  const items = order.items.map((i) => ({
    productId: i.productId,
    name: i.name,
    size: i.size ?? null,
    quantity: i.quantity,
    unitPrice: Number(i.price),
    currency: i.currency,
    lineTotal: Math.round(Number(i.price) * i.quantity * 100) / 100,
    image: absUrl(i.product?.images?.[0]),
  }));
  const discount = order.discountAmount != null ? { amount: Number(order.discountAmount) } : null;
  const channel = { COD: "cod", ONLINE: "online", CASH: "cash" }[order.channel] ?? order.channel.toLowerCase();
  const text = orderWhatsAppText({
    code: order.code,
    vendorName: store.companyName,
    items,
    discount: discount ? { code: extra.discountCode ?? "descuento", amount: discount.amount } : null,
    totalLabel: mixedTotalLabel(items, discount?.amount ?? 0),
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    address: order.shippingAddress,
    channel,
  });
  const usesWhatsapp = order.notificationChannel !== "PANEL";
  return {
    id: order.id,
    code: order.code,
    status: order.status,
    createdAt: order.createdAt,
    channel,
    total: Number(order.total),
    discount,
    items,
    customer: { name: order.customerName, phone: order.customerPhone, email: order.customerEmail, address: order.shippingAddress },
    store: { slug: store.slug, name: store.companyName },
    // El pedido ya está en el panel del vendedor cuando el destino es PANEL o BOTH.
    notifiedInPanel: order.notificationChannel !== "WHATSAPP",
    // Cuando el destino incluye WhatsApp, el cliente abre este enlace para mandar el pedido al vendedor.
    whatsapp: usesWhatsapp ? { url: whatsappUrl(store.whatsapp, text), message: text } : null,
    ...(extra.replayed ? { replayed: true } : {}),
  };
}

const orderInclude = { items: { include: { product: { select: { images: true } } } } };

// POST /orders
export async function createPartnerOrder(req, res) {
  const key = req.get("idempotency-key");
  if (!key || !IDEMPOTENCY.test(key)) {
    throw new AppError("Falta la cabecera Idempotency-Key (8 a 64 caracteres: letras, números, guion o guion bajo). Evita que un reintento duplique el pedido.", 400, { code: "idempotency_key_required" });
  }
  const body = orderBody.parse(req.body);
  const partnerId = req.partner.id;

  // Reintento con la misma clave: se devuelve el pedido ya creado, no uno nuevo.
  const previous = await prisma.order.findFirst({ where: { partnerId, idempotencyKey: key }, include: { ...orderInclude } });
  if (previous) {
    const store = await prisma.vendor.findUnique({ where: { id: previous.vendorId } });
    return res.status(200).json({ data: orderDto(previous, store, { replayed: true }) });
  }

  if (!consumeOrderSlot(req.partnerKey.id)) {
    throw new AppError("Demasiados pedidos seguidos con esta credencial. Espera unos minutos.", 429, { code: "order_rate_limit" });
  }

  const store = await visibleStore(partnerId, body.storeSlug);

  // Un producto repetido en dos líneas se rechaza: se manda una sola línea con la cantidad total.
  const ids = body.items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) throw new AppError("Un producto aparece en más de una línea. Junta las cantidades en una sola línea.", 400);

  // Cobertura geográfica: la provincia existe, y el municipio (o ciudad, en estados) es coherente con ella.
  const province = await prisma.province.findUnique({ where: { id: body.shippingProvinceId } });
  if (!province || !province.isActive) throw new AppError("La provincia o estado indicado no existe.", 400);
  let place;
  if (province.type === "STATE") {
    if (!body.shippingCity) throw new AppError("Falta la ciudad (shippingCity) para esta provincia o estado.", 400);
    if (body.shippingMunicipalityId) throw new AppError("Esta provincia o estado no usa municipios; envía shippingCity.", 400);
    place = body.shippingCity;
  } else {
    if (!body.shippingMunicipalityId) throw new AppError("Falta el municipio (shippingMunicipalityId).", 400);
    const municipality = await prisma.municipality.findUnique({ where: { id: body.shippingMunicipalityId } });
    if (!municipality || !municipality.isActive || municipality.provinceId !== province.id) {
      throw new AppError("El municipio no pertenece a la provincia indicada.", 400);
    }
    if (body.shippingCity) throw new AppError("Esta provincia usa municipios; no envíes shippingCity.", 400);
    place = municipality.name;
  }

  const data = {
    vendorId: store.id,
    channel: body.channel,
    customerName: body.customerName,
    customerPhone: body.customerPhone,
    customerEmail: body.customerEmail,
    shippingAddress: `${place} — ${body.shippingAddress}`,
    shippingProvinceId: province.id,
    shippingMunicipalityId: body.shippingMunicipalityId,
    items: body.items.map((i) => ({ productId: i.productId, quantity: i.quantity, size: i.size })),
    discountCode: body.discountCode,
  };

  let created;
  try {
    created = await placeOrder(data, { partnerId, idempotencyKey: key });
  } catch (err) {
    // Dos peticiones simultáneas con la misma clave: gana una, la otra recibe ese mismo pedido.
    if (err?.code === "P2002") {
      const again = await prisma.order.findFirst({ where: { partnerId, idempotencyKey: key }, include: { ...orderInclude } });
      if (again) return res.status(200).json({ data: orderDto(again, store, { replayed: true }) });
    }
    throw err;
  }
  res.status(201).json({ data: orderDto(created, store, { discountCode: body.discountCode?.toUpperCase() }) });
}

// GET /orders/:code: estado de un pedido hecho con esta misma cuenta de socio.
export async function getPartnerOrder(req, res) {
  const code = z.string().trim().min(3).max(40).parse(req.params.code);
  const order = await prisma.order.findFirst({ where: { partnerId: req.partner.id, code }, include: { ...orderInclude } });
  if (!order) throw new AppError("Pedido no encontrado.", 404);
  const store = await prisma.vendor.findUnique({ where: { id: order.vendorId } });
  res.json({ data: orderDto(order, store) });
}

// Planes con el precio base de Baznova y el extra que este socio le suma. Se arma igual para la API y el panel.
export async function plansForPartner(partnerId) {
  const [configs, pricing, extras, counts] = await Promise.all([
    getAllPlanConfigs(),
    getSubscriptionPricing(),
    prisma.partnerPlanPrice.findMany({ where: { partnerId } }),
    prisma.vendor.groupBy({ by: ["planType"], where: { partnerId }, _count: { _all: true } }),
  ]);
  const extraBy = new Map(extras.map((e) => [e.planType, e]));
  const countBy = new Map(counts.map((c) => [c.planType, c._count._all]));
  return configs.map((c) => {
    const paid = c.planType !== "REGULAR";
    const baseCup = paid ? Number(pricing.cupPricePerMonth) : 0;
    const baseUsd = paid ? Number(pricing.cardPricePerMonthUsd) : 0;
    const extra = extraBy.get(c.planType);
    const extraCup = Number(extra?.extraCup ?? 0);
    const extraUsd = Number(extra?.extraUsd ?? 0);
    const stores = countBy.get(c.planType) ?? 0;
    return {
      planType: c.planType,
      name: c.displayName,
      features: c.features,
      limits: { maxProducts: c.maxProducts, maxTables: c.maxTables, maxStaffUsers: c.maxStaffUsers, maxDiscountCodes: c.maxDiscountCodes, maxProvinces: c.maxProvinces },
      baseMonthly: { cup: baseCup, usd: baseUsd },
      extraMonthly: { cup: extraCup, usd: extraUsd },
      finalMonthly: { cup: baseCup + extraCup, usd: baseUsd + extraUsd },
      stores,
      // Ganancia mensual estimada: tiendas de este socio hoy en el plan por el extra de cada una.
      estimatedMonthlyEarnings: { cup: Math.round(stores * extraCup * 100) / 100, usd: Math.round(stores * extraUsd * 100) / 100 },
    };
  });
}

export async function listPlans(req, res) {
  res.json({ data: await plansForPartner(req.partner.id) });
}
