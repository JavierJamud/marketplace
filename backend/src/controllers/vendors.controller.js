import { z } from "zod";
import { unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { slugify } from "../utils/slugify.js";
import { isVendorOpenNow } from "../services/schedule.service.js";
import { isAIAvailable } from "../lib/ai.js";

// E.164 laxo (+5355512345) — el frontend siempre arma el string completo con
// PhoneInput/toE164(), esto es solo una validación de forma del lado servidor.
const E164_REGEX = /^\+\d{7,15}$/;

const __dirname = dirname(fileURLToPath(import.meta.url));
export const VENDOR_AI_DOC_DIR = join(__dirname, "..", "..", "uploads", "vendor-ai-docs");

const createVendorSchema = z.object({
  companyName: z.string().min(2),
  // Persona física responsable (KYC/contacto legal) — nunca se expone
  // públicamente, distinto del nombre de tienda que sí se muestra en Store.jsx.
  ownerName: z.string().min(2, "Falta el nombre del responsable del negocio."),
  // Bloque 29: datos de facturación — opcionales a nivel de zod (así un
  // vendedor viejo puede seguir haciendo PATCH parciales, ej. cancelPlan,
  // sin que le exijan estos campos) pero el formulario de registro/settings
  // los pide como obligatorios, y el gate que de verdad importa es
  // invoices.controller.js: sin esto no se puede generar ningún PDF.
  ownerIdNumber: z.string().trim().min(1).optional(),
  companyAddress: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  whatsapp: z.string().regex(E164_REGEX, "El WhatsApp debe incluir código de país (ej. +5355512345)."),
  // Bloque 11: obligatorio — puede ser el mismo correo personal de la cuenta,
  // el frontend lo prellena pero permite editarlo.
  email: z.string().email("El correo de la tienda es obligatorio."),
  isRestaurant: z.boolean().default(false),
  tableCount: z.number().int().positive().optional(),
  // Bloque 18: obligatorio — el rubro/tipo de negocio se elige una sola vez
  // al registrar la tienda (se puede cambiar después desde VendorSettings.jsx).
  businessCategoryId: z.string().min(1, "Elegí el tipo de negocio de tu tienda."),
  locations: z
    .array(z.object({ provinceId: z.string(), municipalityId: z.string().optional() }))
    .min(1, "Selecciona al menos una provincia donde prestas servicio"),
});

// Registro de tienda (el usuario ya debe existir y estar autenticado).
// Empieza siempre en Plan Regular; el KYC/verificación se pide aparte.
export async function createVendor(req, res) {
  const data = createVendorSchema.parse(req.body);

  const existing = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (existing) throw new AppError("Este usuario ya tiene una tienda registrada.", 409);

  const businessCategory = await prisma.businessCategory.findUnique({ where: { id: data.businessCategoryId } });
  if (!businessCategory) throw new AppError("Ese tipo de negocio no existe.", 400);

  let slug = slugify(data.companyName);
  const slugTaken = await prisma.vendor.findUnique({ where: { slug } });
  if (slugTaken) slug = `${slug}-${Date.now().toString(36)}`;

  // Restaurantes arrancan con el Panel de vendedor como destino de pedidos
  // (no WhatsApp) — pueden cambiarlo después desde VendorSettings.jsx.
  const orderDestination = data.isRestaurant ? "PANEL" : "WHATSAPP";

  const vendor = await prisma.vendor.create({
    data: {
      userId: req.user.id,
      companyName: data.companyName,
      ownerName: data.ownerName,
      ownerIdNumber: data.ownerIdNumber,
      companyAddress: data.companyAddress,
      slug,
      description: data.description,
      whatsapp: data.whatsapp,
      email: data.email,
      isRestaurant: data.isRestaurant,
      tableCount: data.tableCount,
      businessCategoryId: data.businessCategoryId,
      planType: "REGULAR",
      orderDestination,
      locations: { create: data.locations.map((l) => ({ provinceId: l.provinceId, municipalityId: l.municipalityId })) },
      verification: { create: {} },
      // Un restaurante con N mesas declaradas en el registro arranca con N
      // QRs ya generados (mismo mecanismo de Table.qrToken que VendorTables.jsx)
      // — no hace falta pasar por "+ Agregar mesa" una por una después.
      tables:
        data.isRestaurant && data.tableCount
          ? { create: Array.from({ length: data.tableCount }, (_, i) => ({ tableNumber: i + 1 })) }
          : undefined,
    },
    include: { locations: true, tables: true },
  });

  await prisma.user.update({ where: { id: req.user.id }, data: { role: "VENDOR" } });

  res.status(201).json({ vendor });
}

export async function getVendorBySlug(req, res) {
  const { slug } = req.params;
  const vendor = await prisma.vendor.findUnique({
    where: { slug },
    include: {
      locations: { include: { province: { include: { country: true } }, municipality: true } },
      schedules: true,
      category: true,
      businessCategory: true,
      deliveryCountries: { include: { country: true } },
      // Bloque 23: Store.jsx separa esta lista en "disponibles" (stock > 0)
      // y "Próximamente disponibles" (stock = 0) — el take sube de 24 a 48
      // para que una tienda con varios productos agotados viejos no le tape
      // el cupo a productos disponibles nuevos (o viceversa) antes de que el
      // split ocurra del lado del cliente.
      products: { where: { isActive: true }, take: 48, orderBy: { createdAt: "desc" } },
      // Comentarios públicos de la tienda (sin producto asociado) — un
      // comentario oculto por el admin (isHidden) nunca llega acá.
      reviews: { where: { productId: null, isHidden: false }, orderBy: { createdAt: "desc" }, take: 20 },
      tables: { orderBy: { tableNumber: "asc" }, take: 1 },
    },
  });
  if (!vendor || vendor.isBlocked) throw new AppError("Tienda no encontrada.", 404);

  const { isOpen } = isVendorOpenNow(vendor.schedules, vendor.timezone);
  // ownerName/ownerIdNumber/companyAddress son privados (KYC/contacto
  // legal/facturación) — nunca se exponen en un endpoint público, a
  // diferencia de companyName que sí es la marca visible. (`omit` de Prisma
  // no está disponible en esta versión del cliente — se sacan los campos a
  // mano antes de responder.)
  const { ownerName, ownerIdNumber, companyAddress, ...publicVendor } = vendor;

  // Bloque 22: desglose de calificaciones (cuántas reseñas de 5/4/3/2/1
  // estrellas) para el widget de estadísticas de Store.jsx. Mismo universo
  // que recalculateVendorRating (reviews.controller.js): CUALQUIER reseña de
  // esta tienda con rating, tenga o no producto asociado — así el desglose
  // siempre suma exactamente al promedio ya mostrado en vendor.rating.
  const grouped = await prisma.review.groupBy({
    by: ["rating"],
    where: { vendorId: vendor.id, rating: { not: null }, isHidden: false },
    _count: true,
  });
  const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let total = 0;
  for (const g of grouped) {
    breakdown[g.rating] = g._count;
    total += g._count;
  }

  // Bloque 25: le dice al frontend si tiene sentido mostrar StoreChatWidget
  // — con Gemini y Groq desactivados/sin configurar, el botón llevaría a un
  // error 503 apenas el cliente escribiera algo. Solo se chequea para
  // tiendas verificadas (el widget nunca se monta si no lo está de todas
  // formas, ver Store.jsx/Product.jsx).
  const aiAvailable = vendor.isVerified ? await isAIAvailable() : false;

  res.json({ vendor: { ...publicVendor, isOpenNow: isOpen, reviewStats: { total, breakdown }, aiAvailable } });
}

export async function listVendors(req, res) {
  const { provinceId, municipalityId, isRestaurant, isVerified, q, businessCategoryId } = req.query;

  const vendors = await prisma.vendor.findMany({
    where: {
      isBlocked: false,
      isRestaurant: isRestaurant !== undefined ? isRestaurant === "true" : undefined,
      isVerified: isVerified !== undefined ? isVerified === "true" : undefined,
      companyName: q ? { contains: String(q), mode: "insensitive" } : undefined,
      businessCategoryId: businessCategoryId ? String(businessCategoryId) : undefined,
      locations: provinceId
        ? { some: { provinceId: String(provinceId), municipalityId: municipalityId ? String(municipalityId) : undefined } }
        : undefined,
    },
    orderBy: [{ isVerified: "desc" }, { createdAt: "desc" }],
    include: {
      locations: { include: { province: true, municipality: true } },
      category: true,
      businessCategory: true,
      // Bloque 23: cantidad de productos/servicios activos — se muestra en
      // StoreCard.jsx. Filtrado por isActive (no cuenta lo pausado/oculto,
      // que el cliente no puede ver de todas formas).
      _count: { select: { products: { where: { isActive: true } } } },
    },
    take: 50,
  });

  // ownerName es privado — ver nota en getVendorBySlug.
  res.json({ vendors: vendors.map(({ ownerName, ...v }) => v) });
}

export async function getMyVendor(req, res) {
  const vendor = await prisma.vendor.findUnique({
    where: { userId: req.user.id },
    include: {
      locations: { include: { province: { include: { country: true } }, municipality: true } },
      schedules: true,
      verification: true,
      tables: true,
      businessCategory: true,
      deliveryCountries: { include: { country: true } },
    },
  });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);
  res.json({ vendor });
}

// Bloque 17 (auditoría de seguridad): este endpoint era el único de todo el
// backend que leía campos de req.body directo, sin z.object(...).parse() —
// inconsistente con el resto del código (createVendor, products, orders,
// verification, etc. siempre validan). No es un problema de permisos (el
// vendor ya se resuelve por userId, nunca por un id que mande el cliente),
// pero sin validar, un whatsapp/email con formato inválido rompía el deep
// link de WhatsApp en Store.jsx/Product.jsx más adelante sin ningún aviso.
const updateVendorSchema = z.object({
  companyName: z.string().min(2).optional(),
  ownerName: z.string().min(2).optional(),
  // Bloque 29: ver nota en createVendorSchema — opcional acá también, por
  // la misma razón (PATCH parciales existentes como cancelPlan no deben
  // romper por no mandar estos campos).
  ownerIdNumber: z.string().trim().min(1).optional(),
  companyAddress: z.string().trim().min(1).optional(),
  description: z.string().optional().nullable(),
  whatsapp: z.string().regex(E164_REGEX, "El WhatsApp debe incluir código de país (ej. +5355512345).").optional(),
  email: z.string().email().optional(),
  logoUrl: z.string().optional().nullable(),
  coverUrl: z.string().optional().nullable(),
  planType: z.enum(["REGULAR", "BUSINESS"]).optional(),
  orderDestination: z.enum(["WHATSAPP", "PANEL"]).optional(),
  acceptedPaymentMethods: z.array(z.string().trim().min(1)).optional(),
  provinceId: z.string().optional(),
  municipalityId: z.string().optional().nullable(),
  // Bloque 18: el vendedor puede cambiar su tipo de negocio después del
  // registro desde VendorSettings.jsx.
  businessCategoryId: z.string().optional(),
});

export async function updateMyVendor(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const data = updateVendorSchema.parse(req.body);
  // "" llega seguido desde formularios que mandan el form entero con
  // spread (VendorSettings.jsx) — tratarlo como "no cambiar" en vez de
  // intentar guardar un id vacío (rompería la foreign key).
  if (data.businessCategoryId === "") data.businessCategoryId = undefined;

  if (data.businessCategoryId) {
    const businessCategory = await prisma.businessCategory.findUnique({ where: { id: data.businessCategoryId } });
    if (!businessCategory) throw new AppError("Ese tipo de negocio no existe.", 400);
  }

  // El upgrade a Business solo lo otorga una verificación KYC aprobada (ver
  // verification.controller.js) — acá solo se permite bajar a Regular.
  const planType = data.planType === "REGULAR" ? "REGULAR" : undefined;

  const updated = await prisma.vendor.update({
    where: { id: vendor.id },
    data: {
      companyName: data.companyName,
      ownerName: data.ownerName,
      ownerIdNumber: data.ownerIdNumber,
      companyAddress: data.companyAddress,
      description: data.description,
      whatsapp: data.whatsapp,
      email: data.email,
      logoUrl: data.logoUrl,
      coverUrl: data.coverUrl,
      planType,
      orderDestination: data.orderDestination,
      acceptedPaymentMethods: data.acceptedPaymentMethods,
      businessCategoryId: data.businessCategoryId,
    },
  });

  if (data.provinceId) {
    const location = await prisma.vendorLocation.findFirst({ where: { vendorId: vendor.id } });
    if (location) {
      await prisma.vendorLocation.update({
        where: { id: location.id },
        data: { provinceId: data.provinceId, municipalityId: data.municipalityId ?? null },
      });
    }
  }

  res.json({ vendor: updated });
}

const scheduleSchema = z.object({
  days: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        opensAt: z.string(),
        closesAt: z.string(),
        isClosed: z.boolean().default(false),
      })
    )
    .length(7),
});

// Horario semanal — el mismo que usa isVendorOpenNow() en la tienda pública.
export async function updateSchedule(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const { days } = scheduleSchema.parse(req.body);

  await prisma.$transaction(
    days.map((d) =>
      prisma.vendorSchedule.upsert({
        where: { vendorId_dayOfWeek: { vendorId: vendor.id, dayOfWeek: d.dayOfWeek } },
        update: { opensAt: d.opensAt, closesAt: d.closesAt, isClosed: d.isClosed },
        create: { vendorId: vendor.id, dayOfWeek: d.dayOfWeek, opensAt: d.opensAt, closesAt: d.closesAt, isClosed: d.isClosed },
      })
    )
  );

  const schedules = await prisma.vendorSchedule.findMany({ where: { vendorId: vendor.id }, orderBy: { dayOfWeek: "asc" } });
  res.json({ schedules });
}

// Bloque 15: umbral de "por agotarse" y ventana de análisis reciente para
// productos de alta demanda / clientes potenciales — constantes simples,
// mismo patrón que REGULAR_PLAN_PRODUCT_LIMIT en products.controller.js.
const LOW_STOCK_THRESHOLD = 3;
const ANALYTICS_WINDOW_DAYS = 30;

// Métricas del panel de vendedor — todo calculado server-side.
export async function getDashboard(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const windowAgo = new Date(Date.now() - ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [
    salesAgg,
    tableSalesAgg,
    newOrdersCount,
    newTableOrdersCount,
    activeProducts,
    reviewAgg,
    lowStockProducts,
    outOfStockProducts,
    topItemsRaw,
    engagedRows,
    orderedRows,
  ] = await Promise.all([
    prisma.order.aggregate({ where: { vendorId: vendor.id, createdAt: { gte: weekAgo } }, _sum: { total: true } }),
    prisma.tableOrder.aggregate({ where: { table: { vendorId: vendor.id }, createdAt: { gte: weekAgo } }, _sum: { total: true } }),
    prisma.order.count({ where: { vendorId: vendor.id, status: "NEW" } }),
    prisma.tableOrder.count({ where: { table: { vendorId: vendor.id }, kitchenStatus: "RECEIVED" } }),
    prisma.product.count({ where: { vendorId: vendor.id, isActive: true } }),
    prisma.review.aggregate({ where: { vendorId: vendor.id, rating: { not: null } }, _count: { rating: true } }),
    prisma.product.findMany({
      where: { vendorId: vendor.id, isActive: true, stock: { gt: 0, lte: LOW_STOCK_THRESHOLD } },
      orderBy: { stock: "asc" },
      select: { id: true, name: true, stock: true, images: true },
      take: 10,
    }),
    prisma.product.findMany({
      where: { vendorId: vendor.id, isActive: true, stock: { lte: 0 } },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, stock: true, images: true },
      take: 10,
    }),
    // Alta demanda: agregado real de OrderItem (no Vendor.salesCount, que es
    // un total de tienda, no por producto) en la ventana reciente.
    prisma.orderItem.groupBy({
      by: ["productId"],
      where: { productId: { not: null }, order: { vendorId: vendor.id, createdAt: { gte: windowAgo } } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    }),
    // Clientes potenciales: clientes logueados que visitaron/agregaron al
    // carrito en la ventana reciente...
    prisma.vendorEngagement.findMany({
      where: { vendorId: vendor.id, createdAt: { gte: windowAgo } },
      distinct: ["customerId"],
      select: { customerId: true },
    }),
    // ...y que NO hicieron un pedido con esta tienda en esa misma ventana.
    prisma.order.findMany({
      where: { vendorId: vendor.id, customerId: { not: null }, createdAt: { gte: windowAgo } },
      distinct: ["customerId"],
      select: { customerId: true },
    }),
  ]);

  const topProductIds = topItemsRaw.map((t) => t.productId);
  const topProductsInfo = topProductIds.length
    ? await prisma.product.findMany({ where: { id: { in: topProductIds } }, select: { id: true, name: true, images: true } })
    : [];
  const topProductInfoById = Object.fromEntries(topProductsInfo.map((p) => [p.id, p]));
  const topProducts = topItemsRaw
    .map((t) => ({ ...topProductInfoById[t.productId], soldCount: t._sum.quantity ?? 0 }))
    .filter((p) => p.id);

  const orderedCustomerIds = new Set(orderedRows.map((o) => o.customerId));
  const potentialCustomerIds = engagedRows.map((e) => e.customerId).filter((id) => !orderedCustomerIds.has(id));
  const potentialCustomers = potentialCustomerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: potentialCustomerIds } },
        select: { id: true, fullName: true, email: true, phone: true },
        take: 20,
      })
    : [];

  const [recentOrders, recentTableOrders] = await Promise.all([
    prisma.order.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" }, take: 4 }),
    prisma.tableOrder.findMany({
      where: { table: { vendorId: vendor.id } },
      include: { table: true },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
  ]);

  const merged = [
    ...recentOrders.map((o) => ({
      id: o.code,
      customer: o.customerName ?? "Cliente",
      date: o.createdAt,
      channel: o.channel,
      total: o.total,
      status: o.status,
    })),
    ...recentTableOrders.map((t) => ({
      id: `Mesa ${t.table.tableNumber}`,
      customer: `Mesa ${t.table.tableNumber}`,
      date: t.createdAt,
      channel: "TABLE",
      total: t.total,
      status: t.kitchenStatus,
    })),
  ]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 4);

  res.json({
    salesThisWeek: Number(salesAgg._sum.total ?? 0) + Number(tableSalesAgg._sum.total ?? 0),
    newOrdersCount: newOrdersCount + newTableOrdersCount,
    activeProducts,
    maxProducts: vendor.planType === "REGULAR" ? 20 : null,
    rating: Number(vendor.rating),
    reviewCount: reviewAgg._count.rating,
    isVerified: vendor.isVerified,
    planType: vendor.planType,
    recentOrders: merged,
    lowStockProducts,
    outOfStockProducts,
    topProducts,
    potentialCustomers,
  });
}

const engagementSchema = z.object({ type: z.enum(["VISIT", "CART_ADD"]) });

// Tracking mínimo para "clientes potenciales" — ver nota en schema.prisma.
// Solo clientes logueados (requireRole CUSTOMER en la ruta); fire-and-forget
// desde el frontend, así que acá no hace falta devolver nada elaborado.
export async function trackEngagement(req, res) {
  const { id } = req.params;
  const { type } = engagementSchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);

  await prisma.vendorEngagement.create({ data: { vendorId: vendor.id, customerId: req.user.id, type } });
  res.status(201).end();
}

// --- Chat vendedor <-> admin (Bloque 15) ------------------------------------
// Habilitado solo para vendedores con KYC APPROVED — se valida server-side
// acá, no solo en el frontend (VendorChat.jsx también oculta la UI).
async function requireApprovedVendor(userId) {
  const vendor = await prisma.vendor.findUnique({ where: { userId }, include: { verification: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);
  if (vendor.verification?.status !== "APPROVED") {
    throw new AppError("El chat con el equipo de ZeuDin se habilita al verificar tu tienda.", 403);
  }
  return vendor;
}

export async function getMyMessages(req, res) {
  const vendor = await requireApprovedVendor(req.user.id);
  const messages = await prisma.vendorMessage.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "asc" } });
  res.json({ messages });
}

const sendMessageSchema = z.object({ body: z.string().trim().min(1).max(2000) });

export async function sendMyMessage(req, res) {
  const vendor = await requireApprovedVendor(req.user.id);
  const { body } = sendMessageSchema.parse(req.body);
  const message = await prisma.vendorMessage.create({
    data: { vendorId: vendor.id, senderRole: "VENDOR", senderId: req.user.id, body },
  });
  res.status(201).json({ message });
}

// Se llama cuando el vendedor efectivamente ve el hilo (no al recibir en el
// backend) — marca como leídos los mensajes que mandó el lado ADMIN.
export async function markMyMessagesRead(req, res) {
  const vendor = await requireApprovedVendor(req.user.id);
  await prisma.vendorMessage.updateMany({
    where: { vendorId: vendor.id, senderRole: "ADMIN", readAt: null },
    data: { readAt: new Date() },
  });
  res.status(204).end();
}

// --- Campanita de notificaciones (Bloque 16) --------------------------------
// A diferencia del chat, esto no exige KYC APPROVED — son avisos sobre el
// propio ciclo de verificación, así que tienen que verse desde REGULAR.

export async function listMyNotifications(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, select: { id: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const [notifications, unreadCount] = await Promise.all([
    prisma.vendorNotification.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" } }),
    prisma.vendorNotification.count({ where: { vendorId: vendor.id, readAt: null } }),
  ]);
  res.json({ notifications, unreadCount });
}

// Se llama cuando el vendedor efectivamente abre el dropdown de la
// campanita — no cuando se crea la notificación en el backend.
export async function markMyNotificationsRead(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, select: { id: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  await prisma.vendorNotification.updateMany({ where: { vendorId: vendor.id, readAt: null }, data: { readAt: new Date() } });
  res.status(204).end();
}

// --- Países de entrega (Bloque 19) ------------------------------------------
// Además de las provincias de Cuba donde vende (VendorLocation), un
// vendedor puede declarar a qué OTROS países entrega. Tope según el plan,
// configurable por el admin en SiteSettings — nunca una constante fija acá.

async function getPlanLimits() {
  const settings = (await prisma.siteSettings.findFirst()) ?? (await prisma.siteSettings.create({ data: {} }));
  return settings;
}

const deliveryCountrySchema = z.object({ countryId: z.string().min(1) });

export async function addMyDeliveryCountry(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const { countryId } = deliveryCountrySchema.parse(req.body);

  const country = await prisma.country.findUnique({ where: { id: countryId } });
  if (!country || !country.isActive) throw new AppError("Ese país no está disponible.", 400);

  const existing = await prisma.vendorDeliveryCountry.findUnique({ where: { vendorId_countryId: { vendorId: vendor.id, countryId } } });
  if (existing) throw new AppError("Ya agregaste ese país de entrega.", 409);

  const limits = await getPlanLimits();
  const max = vendor.planType === "BUSINESS" ? limits.maxDeliveryCountriesBusiness : limits.maxDeliveryCountriesRegular;
  const currentCount = await prisma.vendorDeliveryCountry.count({ where: { vendorId: vendor.id } });
  if (currentCount >= max) {
    throw new AppError(
      `Tu Plan ${vendor.planType === "BUSINESS" ? "Business" : "Regular"} permite hasta ${max} país(es) de entrega. Quitá uno o verificá tu tienda para ampliar el límite.`,
      403
    );
  }

  const created = await prisma.vendorDeliveryCountry.create({ data: { vendorId: vendor.id, countryId }, include: { country: true } });
  res.status(201).json({ deliveryCountry: created });
}

export async function removeMyDeliveryCountry(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const { countryId } = req.params;

  // 1. Quitar el país de entrega
  await prisma.vendorDeliveryCountry.deleteMany({ where: { vendorId: vendor.id, countryId } });

  // 2. Quitar también todas las ubicaciones (provincias/estados) de ese país para este vendedor
  const countryProvinces = await prisma.province.findMany({ where: { countryId }, select: { id: true } });
  const provinceIds = countryProvinces.map((p) => p.id);
  if (provinceIds.length > 0) {
    await prisma.vendorLocation.deleteMany({ where: { vendorId: vendor.id, provinceId: { in: provinceIds } } });
  }

  res.status(204).end();
}

// --- Provincias de venta en Cuba (multi, Bloque 19) -------------------------
const addLocationSchema = z.object({ provinceId: z.string().min(1), municipalityId: z.string().optional().nullable() });

export async function addMyLocation(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const { provinceId, municipalityId } = addLocationSchema.parse(req.body);

  const province = await prisma.province.findUnique({ where: { id: provinceId } });
  if (!province || !province.isActive) throw new AppError("Provincia/Estado no disponible.", 404);

  const existingLocations = await prisma.vendorLocation.findMany({ where: { vendorId: vendor.id } });
  const distinctProvinceCount = new Set(existingLocations.map((l) => l.provinceId)).size;
  const isNewProvince = !existingLocations.some((l) => l.provinceId === provinceId);

  if (isNewProvince) {
    const limits = await getPlanLimits();
    const max = vendor.planType === "BUSINESS" ? limits.maxProvincesBusiness : limits.maxProvincesRegular;
    if (max !== null && distinctProvinceCount >= max) {
      throw new AppError(
        `Tu Plan ${vendor.planType === "BUSINESS" ? "Business" : "Regular"} permite vender en hasta ${max} provincia(s). Verificá tu tienda para ampliar el límite.`,
        403
      );
    }
  }

  const duplicate = existingLocations.some((l) => l.provinceId === provinceId && l.municipalityId === (municipalityId ?? null));
  if (duplicate) throw new AppError("Ya tenés esa provincia/municipio agregado.", 409);

  const created = await prisma.vendorLocation.create({
    data: { vendorId: vendor.id, provinceId, municipalityId: municipalityId || null },
    include: { province: { include: { country: true } }, municipality: true },
  });
  res.status(201).json({ location: created });
}

const syncProvinceSchema = z.object({
  provinceId: z.string().min(1),
  municipalityIds: z.array(z.string()).nullable(),
});

export async function syncProvinceLocations(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const { provinceId, municipalityIds } = syncProvinceSchema.parse(req.body);

  const province = await prisma.province.findUnique({ where: { id: provinceId } });
  
  const isDeletingAll = municipalityIds !== null && municipalityIds.length === 0;
  if (!isDeletingAll) {
    if (!province || !province.isActive) throw new AppError("Provincia/Estado no disponible.", 404);
  }

  const existingLocations = await prisma.vendorLocation.findMany({ where: { vendorId: vendor.id } });
  const distinctProvinceCount = new Set(existingLocations.map((l) => l.provinceId)).size;
  const isNewProvince = !existingLocations.some((l) => l.provinceId === provinceId);

  if (isNewProvince && (municipalityIds === null || municipalityIds.length > 0)) {
    const limits = await getPlanLimits();
    const max = vendor.planType === "BUSINESS" ? limits.maxProvincesBusiness : limits.maxProvincesRegular;
    if (max !== null && distinctProvinceCount >= max) {
      throw new AppError(
        `Tu Plan ${vendor.planType === "BUSINESS" ? "Business" : "Regular"} permite vender en hasta ${max} provincia(s). Verificá tu tienda para ampliar el límite.`,
        403
      );
    }
  }

  // Handle syncing
  if (municipalityIds === null) {
    // "Todos los municipios"
    await prisma.vendorLocation.deleteMany({ where: { vendorId: vendor.id, provinceId } });
    await prisma.vendorLocation.create({
      data: { vendorId: vendor.id, provinceId, municipalityId: null },
    });
  } else {
    // Especificar municipios
    if (municipalityIds.length === 0) {
      await prisma.vendorLocation.deleteMany({ where: { vendorId: vendor.id, provinceId } });
      if (province?.countryId) {
        const remainingInCountry = await prisma.vendorLocation.count({
          where: { vendorId: vendor.id, province: { countryId: province.countryId } },
        });
        if (remainingInCountry === 0) {
          await prisma.vendorDeliveryCountry.deleteMany({ where: { vendorId: vendor.id, countryId: province.countryId } });
        }
      }
    } else {
      const validMunicipalities = await prisma.municipality.findMany({
        where: { id: { in: municipalityIds }, provinceId, isActive: true },
      });
      const validIds = new Set(validMunicipalities.map((m) => m.id));

      await prisma.vendorLocation.deleteMany({
        where: { vendorId: vendor.id, provinceId, OR: [{ municipalityId: null }, { municipalityId: { notIn: [...validIds] } }] },
      });

      const currentLocs = await prisma.vendorLocation.findMany({ where: { vendorId: vendor.id, provinceId } });
      const currentMunIds = new Set(currentLocs.map((l) => l.municipalityId));

      for (const mId of validIds) {
        if (!currentMunIds.has(mId)) {
          await prisma.vendorLocation.create({ data: { vendorId: vendor.id, provinceId, municipalityId: mId } });
        }
      }
    }
  }

  const updatedLocations = await prisma.vendorLocation.findMany({
    where: { vendorId: vendor.id },
    include: { province: { include: { country: true } }, municipality: true },
  });

  res.json({ locations: updatedLocations });
}

export async function removeMyLocation(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const { id } = req.params;
  const location = await prisma.vendorLocation.findUnique({ where: { id }, include: { province: true } });
  if (!location || location.vendorId !== vendor.id) throw new AppError("Ubicación no encontrada.", 404);

  await prisma.vendorLocation.delete({ where: { id } });

  // Cleanup country if no more locations exist in that country
  if (location.province?.countryId) {
    const countryId = location.province.countryId;
    const remainingInCountry = await prisma.vendorLocation.count({
      where: { vendorId: vendor.id, province: { countryId } },
    });
    if (remainingInCountry === 0) {
      await prisma.vendorDeliveryCountry.deleteMany({ where: { vendorId: vendor.id, countryId } });
    }
  }

  res.status(204).end();
}

// Bloque 21: reemplaza el guardado falso de antes (updateMyVendor solo
// recibía aiFile.name como texto plano, nunca el archivo real — ver
// VendorSettings.jsx). Esta es la única forma real de cargar el documento
// que después lee chat.controller.js para armar el contexto del chatbot.
export async function uploadAiDocument(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tenés una tienda registrada.", 404);
  if (!req.file) throw new AppError("Subí un archivo .pdf o .txt.", 400);

  // Reemplazo, no acumulación — un solo documento por tienda a la vez. Si
  // falla el borrado del anterior (ya no existe, permisos, etc.) no bloquea
  // el guardado del nuevo, solo queda un archivo huérfano sin referencia.
  if (vendor.aiDocument) {
    await unlink(join(VENDOR_AI_DOC_DIR, vendor.aiDocument)).catch(() => {});
  }

  const updated = await prisma.vendor.update({
    where: { id: vendor.id },
    data: { aiDocument: req.file.filename, aiDocumentName: req.file.originalname },
  });
  res.status(201).json({ aiDocument: updated.aiDocument, aiDocumentName: updated.aiDocumentName });
}

export async function removeAiDocument(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tenés una tienda registrada.", 404);

  if (vendor.aiDocument) {
    await unlink(join(VENDOR_AI_DOC_DIR, vendor.aiDocument)).catch(() => {});
  }

  await prisma.vendor.update({
    where: { id: vendor.id },
    data: { aiDocument: null, aiDocumentName: null },
  });

  res.status(204).end();
}
