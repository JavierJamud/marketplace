import { z } from "zod";
import { orderShippingText } from "../lib/orderSummary.js";
import { resolveVendorSlug } from "../lib/vendorSlug.js";
import { activeCodes, checkoutLabel } from "../lib/catalog.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { placeOrder } from "./orders.controller.js";
import { captureOrderRequest } from "../lib/orderRequestInfo.js";
import { getAllPlanConfigs, publicPlan } from "../lib/planConfig.js";
import { isBillingOverdue } from "../services/planBilling.service.js";
import { visibleVendorWhere, visibleProductWhere, absUrl, siteUrl } from "../lib/partnerDto.js";
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
    channel: z.string().trim().regex(/^[a-z0-9_]{1,40}$/, "Forma de pago inválida."),
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
  // Limpieza: solo se borran las credenciales sin pedidos dentro de la ventana. Antes se vaciaba todo el mapa y una
  // credencial que estaba en el tope recuperaba sus 60 pedidos de golpe.
  if (orderHits.size > 2000) {
    for (const [k, list] of orderHits) if (!list.length || now - list[list.length - 1] >= ORDER_WINDOW_MS) orderHits.delete(k);
  }
  return true;
}

async function visibleStore(partnerId, requestedSlug) {
  const slug = await resolveVendorSlug(requestedSlug);
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
  // La misma comprobación que hace placeOrder (assertVendorAcceptsOrders): con el cobro del plan atrasado la tienda se ve
  // pero no recibe pedidos. Así el socio lo sabe antes de armar el formulario y no al final, con un 409.
  const overdue = await isBillingOverdue(store);
  res.json({
    data: {
      store: { slug: store.slug, name: store.companyName, url: `${siteUrl()}/tienda/${store.slug}`, whatsapp: store.whatsapp, currency: store.currency },
      acceptsOrders: !overdue,
      // Por qué no acepta pedidos (null si los acepta). reasonCode es el mismo `code` que devolvería POST /orders (409).
      // El mismo texto del 409 de assertVendorAcceptsOrders (planBilling.service.js), para que el socio muestre una sola frase.
      reason: overdue ? "Esta tienda no está recibiendo pedidos en este momento. Prueba más tarde o escríbele directamente." : null,
      reasonCode: overdue ? "VENDOR_BILLING_OVERDUE" : null,
      orderDestination: store.orderDestination,
      isOpenNow: isOpen,
      nextOpenLabel: nextOpenLabel ?? null,
      rules: [
        "Todos los productos de un pedido deben ser de la misma tienda.",
        "El precio y el total los calcula la plataforma; nunca se toman del cliente.",
        "El stock se confirma cuando el vendedor acepta el pedido.",
        "Cada pedido necesita una cabecera Idempotency-Key única (8 a 64 caracteres) para que un reintento no duplique el pedido.",
      ],
      // Las formas de cobro activas que ofrece esta tienda, con el nombre que les dio el admin (lib/catalog.js).
      channels: (await activeCodes("CHECKOUT_PAYMENT"))
        .filter((code) => !store.checkoutPaymentOptions?.length || store.checkoutPaymentOptions.includes(code))
        .map((code) => ({ id: code, title: checkoutLabel(code) })),
      fields: [
        { name: "customerName", required: true, min: 2, max: 120, label: "Nombre del cliente" },
        { name: "customerPhone", required: true, format: "E.164 con código de país, ej. +5355512345", label: "Teléfono" },
        { name: "customerEmail", required: true, format: "correo válido", label: "Correo" },
        { name: "shippingProvinceId", required: true, label: "Provincia o estado (usa la lista delivery.provinces)" },
        { name: "shippingMunicipalityId", required: "en provincias (PROVINCE); en estados (STATE), esto o shippingCity", label: "Municipio o ciudad de esa provincia o estado (GET /locations/municipalities)" },
        { name: "shippingCity", required: "solo en estados (STATE) y si no envías shippingMunicipalityId", label: "Ciudad escrita, cuando no está en la lista" },
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
    totalLabel: mixedTotalLabel(items, discount?.amount ?? 0, order.shippingFees ?? []),
    shippingText: orderShippingText(order),
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
    // Envío aparte de `total` (que es solo productos): montos por moneda y si queda algo a coordinar con la tienda.
    shipping: { fees: (order.shippingFees ?? []).map((f) => ({ currency: f.currency, amount: Number(f.amount) })), toCoordinate: order.shippingCoordinate },
    items,
    customer: { name: order.customerName, phone: order.customerPhone, email: order.customerEmail, address: order.shippingAddress },
    store: { slug: store.slug, name: store.companyName },
    // Todo pedido entra al panel del vendedor (también los viejos marcados WHATSAPP).
    notifiedInPanel: true,
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
  const previous = await prisma.order.findFirst({ where: { partnerId, idempotencyKey: key }, include: orderInclude });
  if (previous) {
    const store = await prisma.vendor.findUnique({ where: { id: previous.vendorId } });
    // La misma clave con un pedido distinto es un error del cliente: se avisa en vez de devolverle otro pedido.
    // La talla también cuenta: la misma clave con la talla M en vez de la S es otro pedido. Una línea guardada sin talla es
    // de un producto sin tallas (placeOrder descarta la que se mande), así que ahí no se compara. Cada línea guardada se
    // empareja una sola vez: si no, dos líneas iguales del cuerpo coincidían con la misma línea del pedido anterior.
    const unmatched = [...previous.items];
    const sameItems =
      body.items.length === previous.items.length &&
      body.items.every((i) => {
        const k = unmatched.findIndex((p) => p.productId === i.productId && p.quantity === i.quantity && (p.size == null || p.size === i.size));
        if (k < 0) return false;
        unmatched.splice(k, 1);
        return true;
      });
    if (store.slug !== body.storeSlug || previous.customerEmail !== body.customerEmail || !sameItems) {
      throw new AppError("Esa Idempotency-Key ya se usó con un pedido distinto. Usa una clave nueva para cada pedido.", 409, { code: "idempotency_key_reused" });
    }
    return res.status(200).json({ data: orderDto(previous, store, { replayed: true }) });
  }

  if (!consumeOrderSlot(req.partnerKey.id)) {
    throw new AppError("Demasiados pedidos seguidos con esta credencial. Espera unos minutos.", 429, { code: "order_rate_limit" });
  }

  const store = await visibleStore(partnerId, body.storeSlug);

  // Un mismo producto puede ir en varias líneas si cada una lleva otra talla (la S y la M de una camisa); lo que se rechaza
  // es repetir producto y talla: ahí se manda una sola línea con la cantidad total.
  const lineKeys = body.items.map((i) => `${i.productId}|${i.size ?? ""}`);
  if (new Set(lineKeys).size !== lineKeys.length) {
    throw new AppError("Un producto aparece en más de una línea con la misma talla. Junta las cantidades en una sola línea.", 400);
  }
  const ids = [...new Set(body.items.map((i) => i.productId))];

  // Más estricto que el sitio: solo se puede pedir lo que esta credencial puede VER en el catálogo (nada de productos
  // de menú oculto ni de tiendas que no le corresponden), aunque alguien conozca el id.
  const visibleCount = await prisma.product.count({ where: { ...visibleProductWhere(partnerId, { includeOutOfStock: true }), id: { in: ids }, vendorId: store.id } });
  if (visibleCount !== ids.length) throw new AppError("Uno o más productos no están disponibles para pedir.", 400);

  // Cobertura geográfica: la provincia existe, y el municipio (o ciudad, en estados) es coherente con ella.
  const province = await prisma.province.findUnique({ where: { id: body.shippingProvinceId } });
  if (!province || !province.isActive) throw new AppError("La provincia o estado indicado no existe.", 400);
  // Provincias (Cuba): municipio del catálogo obligatorio. Estados: la ciudad del catálogo (shippingMunicipalityId) o, si no
  // está en la lista, escrita (shippingCity); la forma escrita sigue valiendo para los socios que ya la usan.
  let place;
  if (body.shippingMunicipalityId) {
    const municipality = await prisma.municipality.findUnique({ where: { id: body.shippingMunicipalityId } });
    if (!municipality || !municipality.isActive || municipality.provinceId !== province.id) {
      throw new AppError(`${province.type === "STATE" ? "La ciudad" : "El municipio"} no pertenece a la provincia o estado indicado.`, 400);
    }
    place = municipality.name;
  } else if (province.type === "STATE") {
    if (!body.shippingCity) throw new AppError("Falta la ciudad: envía shippingMunicipalityId (de GET /locations/municipalities) o shippingCity.", 400);
    place = body.shippingCity;
  } else {
    throw new AppError("Falta el municipio (shippingMunicipalityId).", 400);
  }

  const data = {
    vendorId: store.id,
    channel: body.channel,
    customerName: body.customerName,
    customerPhone: body.customerPhone,
    customerEmail: body.customerEmail,
    // Coma y no raya larga: es la misma forma que guarda el checkout del sitio y se muestra tal cual al vendedor.
    shippingAddress: [place, body.shippingAddress].filter(Boolean).join(", "),
    shippingProvinceId: province.id,
    shippingMunicipalityId: body.shippingMunicipalityId,
    items: body.items.map((i) => ({ productId: i.productId, quantity: i.quantity, size: i.size })),
    discountCode: body.discountCode,
  };

  let created;
  try {
    created = await placeOrder(data, { partnerId, idempotencyKey: key, requestInfo: captureOrderRequest(req, null, "PARTNER_API") });
  } catch (err) {
    // Dos peticiones simultáneas con la misma clave: gana una, la otra recibe ese mismo pedido.
    if (err?.code === "P2002") {
      const again = await prisma.order.findFirst({ where: { partnerId, idempotencyKey: key }, include: orderInclude });
      if (again) return res.status(200).json({ data: orderDto(again, store, { replayed: true }) });
    }
    throw err;
  }
  res.status(201).json({ data: orderDto(created, store, { discountCode: body.discountCode?.toUpperCase() }) });
}

// GET /orders/:code: estado de un pedido hecho con esta misma cuenta de socio.
export async function getPartnerOrder(req, res) {
  const code = z.string().trim().min(3).max(40).parse(req.params.code);
  const order = await prisma.order.findFirst({ where: { partnerId: req.partner.id, code }, include: orderInclude });
  if (!order) throw new AppError("Pedido no encontrado.", 404);
  const store = await prisma.vendor.findUnique({ where: { id: order.vendorId } });
  res.json({ data: orderDto(order, store) });
}

// Planes con el precio base de Baznova y el extra que este socio le suma. Se arma igual para la API y el panel.
// Lo descriptivo sale de publicPlan, lo mismo que ve /planes: lo que incluye cada plan armado con sus límites reales
// (buildPlanIncludes, que descarta el texto libre con números porque puede contradecir un límite) y los topes con su
// interruptor aplicado (un tope con la función apagada vale 0). Antes salían el texto libre y los topes crudos.
// Solo salen los planes que /settings le muestra completos a un visitante: públicos, el de registro y el de prueba. GET /plans
// es pública para sitios de terceros, y un plan oculto (por ejemplo uno pactado a mano con una tienda) no se puede elegir:
// ni sus precios ni sus topes deben salir, ni el socio debe poder anunciarlo. setPortalPlanPrice busca en esta misma lista,
// así que a un plan oculto le responde 404.
export async function plansForPartner(partnerId) {
  const [configs, extras, counts] = await Promise.all([
    getAllPlanConfigs(),
    prisma.partnerPlanPrice.findMany({ where: { partnerId } }),
    prisma.vendor.groupBy({ by: ["planType"], where: { partnerId }, _count: { _all: true } }),
  ]);
  const extraBy = new Map(extras.map((e) => [e.planType, e]));
  const countBy = new Map(counts.map((c) => [c.planType, c._count._all]));
  return configs.filter((c) => c.isPublic || c.isDefault || c.isTrialPlan).map((c) => {
    // Precio base de Baznova para ese plan (0 si es gratis por ahora o se contrata hablando con el equipo).
    const paid = !c.isFree && !c.contactOnly;
    const baseCup = paid ? Number(c.priceCup) : 0;
    const baseUsd = paid ? Number(c.priceUsd) : 0;
    const extra = extraBy.get(c.planType);
    const extraCup = Number(extra?.extraCup ?? 0);
    const extraUsd = Number(extra?.extraUsd ?? 0);
    const stores = countBy.get(c.planType) ?? 0;
    const pub = publicPlan(c);
    return {
      planType: pub.planType,
      name: pub.name,
      tagline: pub.tagline ?? null,
      // El papel del plan sale de sus banderas (PartnerPlans.jsx las lee: plan de inicio, gratis o a medida).
      isDefault: pub.isDefault,
      isTrialPlan: pub.isTrialPlan,
      isFree: !!pub.isFree,
      contactOnly: !!pub.contactOnly,
      grantsBadge: !!pub.grantsBadge,
      highlighted: !!pub.highlighted,
      includes: pub.includes,
      // `features` se conserva como lista de textos para los socios que ya la leen (y PartnerPlans.jsx), pero ahora trae
      // lo mismo que `includes`. publicPlan.features es otra cosa (objetos del catálogo) y no se expone aquí.
      features: pub.includes,
      limits: pub.limits,
      // Precio tachado y descuentos por pagar varios meses que configuró el admin (sobre el precio de Baznova).
      listPrice: { cup: pub.listPriceCup != null ? Number(pub.listPriceCup) : null, usd: pub.listPriceUsd != null ? Number(pub.listPriceUsd) : null },
      monthDiscounts: pub.monthDiscounts,
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
