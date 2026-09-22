import { z } from "zod";
import { unlink, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { KYC_UPLOAD_DIR } from "./verification.controller.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { slugify } from "../utils/slugify.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { isVendorOpenNow } from "../services/schedule.service.js";
import { isAIAvailable } from "../lib/ai.js";
import { getBrandSettings } from "./settings.controller.js";
import { expireStaleStoreOffers, storeOfferSummarySelect } from "./storeOffers.controller.js";
import { productPriceTiersInclude, expireNewBadges } from "./products.controller.js";
import { rawSalesSeries, fillSeriesGaps, salesSeriesSchema, resolveSeriesRange } from "../lib/salesSeries.js";
import { withComputedVendorFields, withComputedVendorFieldsList, transitionVendorVerification } from "../services/vendorVerification.service.js";
import { cancelStripeSubscription, scheduleStripeSubscriptionCancellation } from "../lib/stripe.js";
import { logActivity, actorRoleForVendorAction } from "../lib/activityLog.js";
import { assertVendorLocationComplete } from "../services/registrationLocation.service.js";
import { notifyAdminActionNeeded } from "../lib/adminNotify.js";
import { getOrGenerateVendorDailyTips } from "../services/vendorDailyTips.service.js";
import { LOW_STOCK_THRESHOLD } from "../constants/inventory.js";
import { completenessScore } from "../lib/productRanking.js";

// E.164 laxo (+5355512345) — el frontend siempre arma el string completo con
// PhoneInput/toE164(), esto es solo una validación de forma del lado servidor.
const E164_REGEX = /^\+\d{7,15}$/;

const __dirname = dirname(fileURLToPath(import.meta.url));
export const VENDOR_AI_DOC_DIR = join(__dirname, "..", "..", "uploads", "vendor-ai-docs");
// Bloque 133 (pedido explícito): logo/portada que el vendedor sube para SU
// PROPIA tienda (distinto de logoUrl de SiteSettings — esa es la marca de
// la plataforma entera, ver settings.controller.js). Mismo criterio de
// carpeta que VENDOR_AI_DOC_DIR de arriba.
export const VENDOR_BRANDING_DIR = join(__dirname, "..", "..", "uploads", "vendor-branding");

// Bloque 65: mismo criterio que assertPaymentMethodsAllowed (products.controller.js)
// — sin esto, una tienda podría quedar (o cambiarse) a una moneda que el
// admin ya desactivó desde "Marca de la plataforma".
async function assertCurrencyAllowed(currency) {
  if (!currency) return;
  const settings = await prisma.siteSettings.findFirst();
  const allowed = settings?.availableCurrencies ?? ["CUP", "USD", "EUR", "MXN"];
  if (!allowed.includes(currency)) {
    throw new AppError(`La moneda "${currency}" ya no está disponible en la plataforma.`, 400);
  }
}

// Bloque 171 (pedido explícito — "al crear una cuenta se debe ingresar los
// horarios de la tienda... si hay varios horarios un mismo día"): mismo
// schema que usa updateSchedule (Configuración) — un día puede traer varios
// tramos (ej. 9-12 y 2-6, con cierre de mediodía), o ninguno si isClosed.
// Se define acá arriba (no solo cerca de updateSchedule) porque
// createVendor también lo necesita, para pedir el horario YA en el
// registro, no como un paso aparte después.
const scheduleRangeSchema = z.object({
  opensAt: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida."),
  closesAt: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida."),
});
const scheduleDaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isClosed: z.boolean().default(false),
  ranges: z.array(scheduleRangeSchema).default([]),
});
const scheduleSchema = z.object({ days: z.array(scheduleDaySchema).length(7) });

// Aplana "un día con N tramos" a filas planas de VendorSchedule — un día
// cerrado (o sin ningún tramo real cargado) se guarda como UNA fila
// isClosed:true con horas de relleno (nunca se leen, isVendorOpenNow las
// ignora por completo en cuanto ve isClosed:true).
function flattenScheduleDays(days) {
  const rows = [];
  for (const d of days) {
    if (d.isClosed || d.ranges.length === 0) {
      rows.push({ dayOfWeek: d.dayOfWeek, opensAt: "00:00", closesAt: "00:00", isClosed: true });
    } else {
      for (const r of d.ranges) {
        rows.push({ dayOfWeek: d.dayOfWeek, opensAt: r.opensAt, closesAt: r.closesAt, isClosed: false });
      }
    }
  }
  return rows;
}

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
  businessCategoryId: z.string().min(1, "Elige el tipo de negocio de tu tienda."),
  // La moneda de la tienda ahora es opcional en el registro — cada producto
  // tiene su propia moneda. Se mantiene en el modelo para referencia y
  // reportes, pero ya no controla los precios. Por defecto USD.
  currency: z.enum(["CUP", "USD", "EUR", "MXN"]).optional().default("USD"),
  // Bloque 114 (pedido explícito): countryId siempre requerido (antes se
  // inferría de provinceId, pero fuera de Cuba ya no hay provincia real de
  // la que inferirlo) — provinceId/municipalityId solo aplican a Cuba,
  // stateOther (texto libre) solo a cualquier otro país.
  locations: z
    .array(
      z.object({
        countryId: z.string().min(1, "Selecciona el país donde va a operar tu tienda."),
        provinceId: z.string().optional(),
        municipalityId: z.string().optional(),
        stateOther: z.string().trim().optional(),
      })
    )
    .min(1, "Selecciona dónde va a operar tu tienda."),
  // Bloque 171 (pedido explícito — "al crear una cuenta se debe ingresar
  // los horarios de la tienda"): opcional a nivel de zod (un request directo
  // a la API sin este campo no debe romper), pero VendorOnboarding.jsx
  // SIEMPRE lo manda desde ahora — en la práctica, toda tienda nueva creada
  // por el formulario real termina con horario cargado desde el arranque.
  schedule: scheduleSchema.optional(),
});

// Bloque 222 (pedido explícito — el color de marca del banner ya no lo
// elige el vendedor, lo asigna el sistema al crear la tienda): paleta fija
// de tonos oscuros/medios (dan buen contraste con el texto e íconos blancos
// del banner, ver StoreHeaderBanner.jsx, cuyo degradado además siempre
// oscurece hacia #111827 al final). Se elige por hash del slug — no es al
// azar en cada request, la MISMA tienda siempre cae en el MISMO color si
// alguna vez hiciera falta recalcularlo.
const VENDOR_AUTO_COLORS = ["#232F3E", "#337475", "#7B4FA6", "#0E6BA8", "#8A5100", "#5C4033", "#2F4858", "#6B4226", "#3D5A80", "#4A5859"];
function pickVendorColor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return VENDOR_AUTO_COLORS[hash % VENDOR_AUTO_COLORS.length];
}

// Registro de tienda (el usuario ya debe existir y estar autenticado).
// Empieza siempre en Plan Regular; el KYC/verificación se pide aparte.
export async function createVendor(req, res) {
  const data = createVendorSchema.parse(req.body);

  const existing = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (existing) throw new AppError("Este usuario ya tiene una tienda registrada.", 409);

  const businessCategory = await prisma.businessCategory.findUnique({ where: { id: data.businessCategoryId } });
  if (!businessCategory) throw new AppError("Ese tipo de negocio no existe.", 400);

  // Bloque 113/114 (pedido explícito — "antes de empezar a vender"): si el
  // país elegido es Cuba, provincia Y municipio pasan a ser obligatorios de
  // verdad (antes lo dejaba `.optional()` a nivel zod) contra el catálogo
  // real; si es cualquier otro país, no aplica provincia/municipio del
  // catálogo — hace falta un estado de texto libre (stateOther) y una
  // dirección real de la tienda (companyAddress, "el país, el estado y la
  // dirección" tal cual se pidió). resolvedLocations reemplaza data.locations
  // con el countryId ya confirmado real (nunca se confía en el que mandó el
  // cliente sin validar).
  let anyOutsideCuba = false;
  const resolvedLocations = [];
  for (const loc of data.locations) {
    const resolved = await assertVendorLocationComplete(loc);
    if (!resolved.isCuba) anyOutsideCuba = true;
    resolvedLocations.push({
      countryId: resolved.country.id,
      provinceId: resolved.province?.id,
      municipalityId: resolved.municipality?.id,
      stateOther: resolved.stateOther,
    });
  }
  if (anyOutsideCuba && !data.companyAddress?.trim()) {
    throw new AppError("Indica la dirección de tu tienda.", 400);
  }

  if (data.currency) await assertCurrencyAllowed(data.currency);
  data.currency = data.currency ?? "USD";

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
      color: pickVendorColor(slug),
      isRestaurant: data.isRestaurant,
      tableCount: data.tableCount,
      businessCategoryId: data.businessCategoryId,
      currency: data.currency,
      planType: "REGULAR",
      orderDestination,
      locations: { create: resolvedLocations },
      verification: { create: {} },
      // Un restaurante con N mesas declaradas en el registro arranca con N
      // QRs ya generados (mismo mecanismo de Table.qrToken que VendorTables.jsx)
      // — no hace falta pasar por "+ Agregar mesa" una por una después.
      tables:
        data.isRestaurant && data.tableCount
          ? { create: Array.from({ length: data.tableCount }, (_, i) => ({ tableNumber: i + 1 })) }
          : undefined,
      // Bloque 171: horario cargado desde el registro mismo, si el
      // formulario lo mandó — mismo aplanado que updateSchedule.
      schedules: data.schedule ? { create: flattenScheduleDays(data.schedule.days) } : undefined,
    },
    include: { locations: true, tables: true },
  });

  await prisma.user.update({ where: { id: req.user.id }, data: { role: "VENDOR" } });

  res.status(201).json({ vendor });
}

export async function getVendorBySlug(req, res) {
  const { slug } = req.params;
  // Bloque 52: chequeo perezoso ANTES de leer — mismo criterio que
  // expireStaleOffers en offers.controller.js, así la sección "Ofertas" de
  // Store.jsx nunca muestra una vencida que todavía no pasó por este check.
  await expireStaleStoreOffers();
  // Bloque 66: hay que vencer "Nuevo" ANTES de traer los productos de abajo
  // (a diferencia de expireStaleStoreOffers, que vence un modelo aparte) —
  // por eso esta consulta liviana primero, para no devolver un badge recién
  // vencido como si siguiera vigente en esta misma respuesta.
  const vendorIdLookup = await prisma.vendor.findUnique({ where: { slug }, select: { id: true } });
  if (vendorIdLookup) await expireNewBadges(vendorIdLookup.id);
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
      // Bloque 157: hiddenFromStore:true = "solo por pedido de mesa" — no
      // aparece en esta lista pública de la tienda.
      products: { where: { isActive: true, hiddenFromStore: false }, take: 48, orderBy: { createdAt: "desc" }, include: productPriceTiersInclude },
      // Comentarios públicos de la tienda (sin producto asociado) — un
      // comentario oculto por el admin (isHidden) nunca llega acá.
      reviews: { where: { productId: null, isHidden: false }, orderBy: { createdAt: "desc" }, take: 20 },
      // Bloque 66 (bug real reportado en vivo — fuga de seguridad): antes se
      // incluía `tables` (con su `qrToken` real) acá, y Store.jsx armaba un
      // link directo a `/mesa/:qrToken` — cualquier visitante llegaba al
      // pedido de mesa sin escanear ningún QR físico. El menú de mesa NUNCA
      // debe ser alcanzable desde la tienda pública — solo escaneando el QR
      // real (que apunta directo a esa URL) o desde el panel del vendedor
      // (VendorTables.jsx, que sí lista sus propios QRs).
      // Bloque 52: ofertas de ESTA tienda (distintas de Offer/Home) — Store.jsx
      // solo renderiza la sección si esta lista no viene vacía. Bloque 232
      // (pedido explícito — "se puede programar cuándo empieza una y cuándo
      // termina"): active:true por sí solo ya no basta — una oferta puede
      // estar "encendida" por el vendedor pero programada para arrancar más
      // adelante (startsAt futuro) o ya vencida (defensivo, sin depender de
      // que expireStaleStoreOffers haya corrido antes que esta consulta).
      storeOffers: {
        where: {
          active: true,
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] },
            { OR: [{ isLimitedTime: false }, { expiresAt: { gt: new Date() } }] },
          ],
        },
        orderBy: { createdAt: "desc" },
        select: storeOfferSummarySelect,
      },
    },
  });
  if (!vendor || vendor.isBlocked || vendor.status !== "ACTIVE") throw new AppError("Tienda no encontrada.", 404);

  // Bloque 208 (pedido explícito): si el vendedor eligió que su menú digital
  // sea oculto (solo visible escaneando el QR de la mesa), sus productos de
  // menú ni siquiera llegan a este endpoint público — no es solo un
  // ocultamiento visual en Store.jsx, el dato en sí no sale del servidor.
  // getTableByToken (el QR real) consulta los productos por su cuenta, sin
  // pasar por acá, así que nunca se ve afectado por este filtro.
  if (!vendor.menuPublic) {
    vendor.products = vendor.products.filter((p) => !p.availableForTableMenu);
  }

  // Bloque 64 (regla de visibilidad, independiente de verificationStatus):
  // una tienda sin ningún producto publicado no muestra su perfil completo
  // ni un catálogo vacío con apariencia normal — Store.jsx recibe esta forma
  // reducida y renderiza el estado "Tienda aún no disponible" en su lugar.
  if (vendor.products.length === 0) {
    // hasPublishedProducts va DENTRO de vendor (no como hermano) para que
    // Store.jsx pueda chequearlo sin cambiar la forma `data = res.vendor` que
    // ya usa en el resto del archivo.
    return res.json({
      vendor: { companyName: vendor.companyName, slug: vendor.slug, color: vendor.color, logoUrl: vendor.logoUrl, hasPublishedProducts: false },
    });
  }

  const { isOpen, nextOpenLabel } = isVendorOpenNow(vendor.schedules, vendor.timezone);
  // ownerName/ownerIdNumber/companyAddress son privados (KYC/contacto
  // legal/facturación) — nunca se exponen en un endpoint público, a
  // diferencia de companyName que sí es la marca visible. (`omit` de Prisma
  // no está disponible en esta versión del cliente — se sacan los campos a
  // mano antes de responder.) Bloque 108 (pedido explícito): salesCount se
  // suma a esta lista — es un dato interno de la tienda (visible en su
  // propio panel), no algo para mostrarle a un visitante anónimo por ahora.
  const { ownerName, ownerIdNumber, companyAddress, salesCount, ...publicVendor } = vendor;

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
  const aiAvailable = vendor.verificationStatus === "VERIFIED" ? await isAIAvailable() : false;

  res.json({
    vendor: withComputedVendorFields({ ...publicVendor, isOpenNow: isOpen, nextOpenLabel, reviewStats: { total, breakdown }, aiAvailable }),
  });
}

export async function listVendors(req, res) {
  const { provinceId, municipalityId, isRestaurant, isVerified, q, businessCategoryId } = req.query;

  const vendors = await prisma.vendor.findMany({
    where: {
      isBlocked: false,
      status: "ACTIVE",
      // Bloque 77 (pedido explícito): una tienda privada nunca aparece en
      // este catálogo público (Home.jsx/StoresPage) — sigue 100% accesible
      // por su link directo, ver getVendorBySlug, que NO chequea esto.
      isPrivate: false,
      // Bloque 64 (regla de visibilidad, INDEPENDIENTE de verificationStatus
      // de arriba): una tienda sin ningún producto publicado no aparece acá,
      // verificada o no, Plan Business o Regular.
      products: { some: { isActive: true, hiddenFromStore: false } },
      isRestaurant: isRestaurant !== undefined ? isRestaurant === "true" : undefined,
      verificationStatus: isVerified !== undefined ? (isVerified === "true" ? "VERIFIED" : { not: "VERIFIED" }) : undefined,
      companyName: q ? { contains: String(q), mode: "insensitive" } : undefined,
      businessCategoryId: businessCategoryId ? String(businessCategoryId) : undefined,
      locations: provinceId
        ? { some: { provinceId: String(provinceId), municipalityId: municipalityId ? String(municipalityId) : undefined } }
        : undefined,
    },
    orderBy: { createdAt: "desc" },
    include: {
      locations: { include: { province: true, municipality: true } },
      category: true,
      businessCategory: true,
      // Bloque 23: cantidad de productos/servicios activos — se muestra en
      // StoreCard.jsx. Filtrado por isActive (no cuenta lo pausado/oculto,
      // que el cliente no puede ver de todas formas).
      _count: { select: { products: { where: { isActive: true, hiddenFromStore: false } } } },
    },
    take: 50,
  });

  // Bloque 64: verificadas primero — ya no se puede ordenar por isVerified
  // en la propia query (es un enum de 8 valores, no un booleano), se
  // reordena acá con el mismo criterio de siempre.
  vendors.sort((a, b) => (b.verificationStatus === "VERIFIED" ? 1 : 0) - (a.verificationStatus === "VERIFIED" ? 1 : 0));

  // ownerName es privado — ver nota en getVendorBySlug.
  res.json({ vendors: withComputedVendorFieldsList(vendors.map(({ ownerName, ...v }) => v)) });
}

// Bloque 183: resolveMyVendor (no un findUnique directo por userId) — es lo
// que hace que esto también funcione para un usuario de sistema
// (VENDOR_STAFF), que nunca tiene su propia fila en Vendor. Esta es la
// primera consulta que hace el panel al cargar (VendorLayout.jsx), así que
// si esto no soporta staff, nada del panel arranca para ellos.
export async function getMyVendor(req, res) {
  const resolved = await resolveMyVendor(req.user.id);
  const vendor = await prisma.vendor.findUnique({
    where: { id: resolved.id },
    include: {
      locations: { include: { province: { include: { country: true } }, municipality: true } },
      schedules: true,
      verification: true,
      tables: true,
      businessCategory: true,
      deliveryCountries: { include: { country: true } },
    },
  });
  res.json({ vendor: withComputedVendorFields(stripOwnerPrivateFields(vendor, req.user.role)) });
}

// Bloque 184 (auditoría de seguridad): /vendors/me es la única ruta del
// panel abierta a CUALQUIER usuario de sistema activo (requireVendorAccess()
// sin secciones) — la necesita VendorLayout.jsx para arrancar. Pero la fila
// Vendor + la relación `verification` traen el KYC y los datos legales del
// DUEÑO: su número de carnet/pasaporte, el NIT de la empresa, su dirección
// legal, su número de cuenta bancaria y los ids de Stripe. Un camarero con
// la sección "pedidos" no tiene por qué leer nada de eso: el resto de las
// rutas de verificación ya usan requireRole("VENDOR","ADMIN") justamente
// para excluirlo, esta era la filtración que quedaba por esa puerta.
const OWNER_PRIVATE_VENDOR_FIELDS = [
  "ownerName",
  "ownerIdNumber",
  "companyTaxId",
  "companyAddress",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "blockReason",
];

export function stripOwnerPrivateFields(vendor, role) {
  if (!vendor || role !== "VENDOR_STAFF") return vendor;
  const safe = { ...vendor };
  for (const field of OWNER_PRIVATE_VENDOR_FIELDS) delete safe[field];
  // El sello de "tienda verificada" que muestra el panel NO sale de acá: se
  // calcula en withComputedVendorFields a partir de Vendor.verificationStatus
  // (ver Bloque 64), que sí se conserva. La relación `verification` es
  // únicamente el expediente (documentos + datos del pagador), así que se va
  // entera. KycDocumentsCard (VendorProfile.jsx) ya hace `if
  // (!vendor?.verification) return null`, y de todas formas un staff nunca
  // llega a esa pantalla — /vendedor/perfil le renderiza StaffProfile.jsx.
  safe.verification = null;
  return safe;
}

// Bloque 175 (pedido explícito — "vamos a agregar en el panel de vendedor
// una barra de búsqueda para buscar clientes o pedidos o todo lo que se
// registre, hasta secciones o configuraciones dentro del panel"): las
// secciones/configuraciones fijas del panel se buscan del lado del
// frontend (son una lista estática de rutas, VendorSearchBar.jsx) — esto
// solo cubre lo que vive en la base de datos: pedidos (código o número de
// mesa), el nombre/teléfono del cliente que hizo ese pedido, y productos
// por nombre. Buscar "un cliente" es, en la práctica, encontrar SUS
// pedidos (no hay una entidad Customer propia en este proyecto — ver
// Order.customerName/Phone/Email).
export async function searchMyVendor(req, res) {
  const vendor = await resolveMyVendor(req.user.id);

  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json({ orders: [], tableOrders: [], products: [] });

  const asNumber = Number(q);
  const isNumeric = !Number.isNaN(asNumber) && q !== "";

  const orders = await prisma.order.findMany({
    where: {
      vendorId: vendor.id,
      OR: [
        { code: { contains: q, mode: "insensitive" } },
        { customerName: { contains: q, mode: "insensitive" } },
        { customerPhone: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 6,
  });

  let tableOrders = [];
  if (vendor.isRestaurant) {
    tableOrders = await prisma.tableOrder.findMany({
      where: {
        table: { vendorId: vendor.id },
        OR: [
          ...(isNumeric ? [{ orderNumber: Math.trunc(asNumber) }] : []),
          { customerName: { contains: q, mode: "insensitive" } },
        ],
      },
      include: { table: true },
      orderBy: { createdAt: "desc" },
      take: 6,
    });
  }

  const products = await prisma.product.findMany({
    where: { vendorId: vendor.id, name: { contains: q, mode: "insensitive" } },
    select: { id: true, name: true, price: true, images: true },
    take: 6,
  });

  res.json({ orders, tableOrders, products });
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
  // Bloque 165 (bug real reportado en vivo — "Expected string, received
  // null"): faltaba .nullable() acá — VendorSettings.jsx manda `null`
  // (nunca "") a propósito para poder BORRAR el campo, mismo criterio que
  // warrantyTerms un poco más abajo, que sí lo tenía. Sin esto, cualquier
  // guardado con uno de estos 2 campos vacío fallaba con el mensaje crudo
  // de zod tal cual, en vez de guardar null como corresponde.
  ownerIdNumber: z.string().trim().min(1).optional().nullable(),
  companyAddress: z.string().trim().min(1).optional().nullable(),
  description: z.string().optional().nullable(),
  whatsapp: z.string().regex(E164_REGEX, "El WhatsApp debe incluir código de país (ej. +5355512345).").optional(),
  email: z.string().email().optional(),
  logoUrl: z.string().optional().nullable(),
  // Bloque 222 (pedido explícito — "elimina que los vendedores puedan
  // cambiar el color de su tienda... ese color lo define el sistema
  // automáticamente y solo el admin puede cambiar el color de una tienda"):
  // `color` se saca del self-service. El sistema lo asigna solo al crear la
  // tienda (ver pickVendorColor en createVendor, más abajo) y de ahí en
  // adelante solo un admin lo puede tocar (updateVendor, admin.controller.js).
  // Bloque 206 (pedido explícito): antes solo se elegía una vez al
  // registrar la tienda — ver createVendorSchema arriba, mismo criterio de
  // sembrado de mesas al prenderlo acá.
  isRestaurant: z.boolean().optional(),
  tableCount: z.number().int().positive().optional(),
  // Bloque 208 (pedido explícito): si el menú digital se ve en la tienda
  // pública o solo escaneando el QR de la mesa.
  menuPublic: z.boolean().optional(),
  planType: z.enum(["REGULAR", "BUSINESS"]).optional(),
  // Bloque 68: 3ra opción — BOTH (WhatsApp + panel). Ver el enum en
  // schema.prisma para lo que decide cada valor ahora (ya no gatea si se
  // crea el Order, eso siempre pasa; solo qué le ofrece la confirmación).
  orderDestination: z.enum(["WHATSAPP", "PANEL", "BOTH"]).optional(),
  acceptedPaymentMethods: z.array(z.string().trim().min(1)).optional(),
  // Bloque 65: cambiar la moneda operativa de la tienda DESPUÉS del registro
  // — a propósito nunca convierte los precios de los productos ya cargados
  // (VendorSettings.jsx avisa esto explícito), solo cambia la etiqueta de
  // los productos nuevos/editados en adelante (ver products.controller.js).
  currency: z.enum(["CUP", "USD", "EUR", "MXN"]).optional(),
  provinceId: z.string().optional(),
  municipalityId: z.string().optional().nullable(),
  // Bloque 18: el vendedor puede cambiar su tipo de negocio después del
  // registro desde VendorSettings.jsx.
  businessCategoryId: z.string().optional(),
  // Sección "Garantías" — ver nota en schema.prisma. Opcionales acá (mismo
  // criterio que ownerIdNumber/companyAddress) porque el gate real que
  // importa es invoices.controller.js justo antes de generar el PDF.
  warrantyTerms: z.string().trim().min(1).optional().nullable(),
  warrantyDefaultDays: z.number().int().positive().optional().nullable(),
  // Bloque 77 (pedido explícito): el vendedor la prende/apaga desde
  // VendorSettings.jsx — nunca afecta si la tienda funciona (sigue
  // aceptando pedidos, reseñas, etc.), solo si aparece en el catálogo
  // público/buscador/recomendaciones de IA (ver los ~9 puntos filtrados en
  // vendors/search/businessCategories/assistant.controller.js).
  isPrivate: z.boolean().optional(),
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

  if (data.currency) await assertCurrencyAllowed(data.currency);

  // Bloque 153 (pedido explícito — "todos los datos de la tienda no se
  // pueden modificar después de estar verificadas sin aprobación del
  // admin... para prevenir fraudes"): candado sobre los 4 datos de
  // IDENTIDAD (nunca los operativos — descripción, WhatsApp, logo, métodos
  // de pago, etc. siguen editables libremente) una vez que la tienda ya
  // tiene el badge. Solo bloquea si de verdad se intenta CAMBIAR el valor
  // — VendorSettings.jsx/VendorProfile.jsx mandan el formulario entero con
  // spread en cada guardado, así que estos campos siempre viajan en el
  // body aunque el vendedor solo haya tocado otro campo; comparar contra
  // el valor actual evita romper ese guardado normal. Corregirlos de
  // verdad requiere la nueva solicitud de cambio (ver
  // requestVendorChange más abajo).
  if (vendor.verificationStatus === "VERIFIED") {
    const locked = { companyName: vendor.companyName, ownerName: vendor.ownerName, ownerIdNumber: vendor.ownerIdNumber, companyAddress: vendor.companyAddress };
    // Bloque 165 (bug real reportado en vivo — con captura): `current &&`
    // es lo que faltaba acá. Sin esto, una tienda verificada CON un campo
    // de identidad vacío (nunca se lo pidieron al registrarse — bug
    // aparte, ya corregido en submitVerification/createVendorSchema, pero
    // esto sigue haciendo falta para las tiendas viejas que ya quedaron
    // así) quedaba en un callejón sin salida: no podía completarlo ella
    // misma (este candado lo rechazaba igual, tratándolo como "cambiar" un
    // valor que en realidad nunca existió) NI vía la solicitud de cambio
    // (pensada para CORREGIR un dato ya cargado, no para cargar uno por
    // primera vez). Ahora el candado solo aplica cuando hay algo real que
    // proteger — completar un campo vacío nunca cuenta como fraude.
    const attempted = Object.entries(locked).find(([key, current]) => current && data[key] !== undefined && data[key] !== current);
    if (attempted) {
      throw new AppError(
        "Tu tienda ya está verificada — el nombre, el responsable, su ID y la dirección no se pueden cambiar sin aprobación del admin. Envía una solicitud de cambio desde tu perfil.",
        409
      );
    }
  }

  // El upgrade a Business solo lo otorga una verificación KYC aprobada (ver
  // verification.controller.js) — acá solo se permite bajar a Regular.
  // Bloque 66 (pedido explícito): si la tienda está VERIFIED, bajar a
  // Regular queda DIFERIDO (ver más abajo) — planType se mantiene BUSINESS
  // acá, el cron/webhook lo cambia recién al llegar la fecha real de
  // vencimiento (Vendor.nextPaymentDueDate).
  const planType = data.planType === "REGULAR" && vendor.verificationStatus !== "VERIFIED" ? "REGULAR" : undefined;

  // Bloque 206: mismo sembrado de mesas que createVendor, para el caso de
  // "se hace restaurante recién ahora" — el chequeo de 0 mesas existentes
  // evita chocar con @@unique([vendorId, tableNumber]) si ya tuvo mesas
  // antes (se desactivó y se vuelve a activar).
  let seedTables;
  if (data.isRestaurant === true && !vendor.isRestaurant && data.tableCount) {
    const existingTableCount = await prisma.table.count({ where: { vendorId: vendor.id } });
    if (existingTableCount === 0) {
      seedTables = Array.from({ length: data.tableCount }, (_, i) => ({ tableNumber: i + 1 }));
    }
  }

  let updated = await prisma.vendor.update({
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
      isRestaurant: data.isRestaurant,
      tableCount: data.tableCount,
      menuPublic: data.menuPublic,
      tables: seedTables ? { create: seedTables } : undefined,
      planType,
      orderDestination: data.orderDestination,
      acceptedPaymentMethods: data.acceptedPaymentMethods,
      currency: data.currency,
      businessCategoryId: data.businessCategoryId,
      warrantyTerms: data.warrantyTerms,
      warrantyDefaultDays: data.warrantyDefaultDays,
      isPrivate: data.isPrivate,
    },
  });

  if (data.planType === "REGULAR" && vendor.verificationStatus === "VERIFIED") {
    // Bloque 66 (pedido explícito): "Cancelar suscripción" ya NO revoca el
    // acceso de inmediato — la tienda sigue VERIFIED/Business hasta
    // Vendor.nextPaymentDueDate. Se registra la intención (cancelAtPeriodEnd)
    // y, si paga con Stripe, se agenda su cancelación NATIVA
    // (cancel_at_period_end) — Stripe sigue facturando/vigente hasta el
    // final del ciclo ya pagado y recién ahí dispara
    // customer.subscription.deleted (handleSubscriptionDeleted), que revoca
    // el badge de verdad. El cron de verificationPayment.job.js cubre el
    // caso CUP (sin Stripe de por medio).
    if (!vendor.cancelAtPeriodEnd) {
      if (vendor.stripeSubscriptionId) await scheduleStripeSubscriptionCancellation(vendor.stripeSubscriptionId);
      updated = await prisma.vendor.update({ where: { id: vendor.id }, data: { cancelAtPeriodEnd: true } });
    }
  } else if (data.planType === "REGULAR" && !["NOT_STARTED", "REJECTED"].includes(vendor.verificationStatus)) {
    // Bloque 64 (mismo criterio que revoke-business del admin): todavía en
    // documentos/pago (nunca llegó a VERIFIED) — no hay ciclo pago vigente
    // que honrar, así que cancelar acá sigue siendo inmediato: vuelve a
    // NOT_STARTED de verdad y cancela cualquier suscripción de Stripe que
    // hubiera quedado a medias.
    if (vendor.stripeSubscriptionId) await cancelStripeSubscription(vendor.stripeSubscriptionId);
    updated = await transitionVendorVerification(vendor.id, "NOT_STARTED", {
      actorId: req.user.id,
      source: "VENDOR_ACTION",
      extraData: { stripeSubscriptionId: null },
    });
  }

  if (data.provinceId) {
    const location = await prisma.vendorLocation.findFirst({ where: { vendorId: vendor.id } });
    if (location) {
      await prisma.vendorLocation.update({
        where: { id: location.id },
        data: { provinceId: data.provinceId, municipalityId: data.municipalityId ?? null },
      });
    }
  }

  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "vendor_settings_updated",
    description: `Actualizó la configuración de "${vendor.companyName}"`,
  });

  res.json({ vendor: withComputedVendorFields(updated) });
}

// --- Solicitudes de cambio de identidad (Bloque 153, pedido explícito) ----
// "todos los datos de la tienda no se pueden modificar después de estar
// verificadas sin aprobación del admin... si se desea cambiar el nombre o
// algo o responsable se debe enviar la solicitud al admin para prevenir
// fraudes y en caso dado subir fotos del nuevo responsable y foto del ID."
// Solo los 4 campos que updateMyVendor bloquea una vez VERIFIED — cada uno
// opcional en el patch (null/undefined = "no quiero cambiar este"). Las
// fotos del NUEVO responsable son opcionales acá también (compact acá
// mismo, no hace falta cambiar de responsable para corregir, por ejemplo,
// solo la dirección).
const changeRequestSchema = z.object({
  companyName: z.string().trim().min(2).optional(),
  ownerName: z.string().trim().min(2).optional(),
  ownerIdNumber: z.string().trim().min(1).optional(),
  companyAddress: z.string().trim().min(1).optional(),
  reason: z.string().trim().max(500).optional(),
});

// Solo una solicitud PENDING a la vez — evita que el vendedor mande varias
// sueltas mientras el admin todavía no revisó la primera (confundiría cuál
// es la vigente).
export async function requestVendorChange(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);
  if (vendor.verificationStatus !== "VERIFIED") {
    throw new AppError("Esto es solo para tiendas ya verificadas — mientras no lo estés, edita tus datos directamente desde tu perfil.", 409);
  }

  const existing = await prisma.vendorChangeRequest.findFirst({ where: { vendorId: vendor.id, status: "PENDING" } });
  if (existing) throw new AppError("Ya tienes una solicitud de cambio esperando revisión — espera a que el equipo la resuelva.", 409);

  const data = changeRequestSchema.parse(req.body);
  const hasAnyField = data.companyName || data.ownerName || data.ownerIdNumber || data.companyAddress;
  if (!hasAnyField) throw new AppError("Indica al menos un dato que quieras cambiar.", 400);

  const selfieFile = req.files?.newOwnerSelfie?.[0];
  const idFile = req.files?.newOwnerIdPhoto?.[0];
  // Cambiar quién es el responsable es más sensible que corregir un dato
  // de texto (dirección mal tipeada, por ejemplo) — ahí sí hacen falta las
  // 2 fotos del nuevo responsable para que el admin pueda confirmar que es
  // una persona real y no solo un nombre distinto en un campo de texto.
  if (data.ownerName && data.ownerName !== vendor.ownerName && (!selfieFile || !idFile)) {
    throw new AppError("Para cambiar el responsable del negocio, sube una foto de esa persona y una foto de su identificación.", 400);
  }

  const request = await prisma.vendorChangeRequest.create({
    data: {
      vendorId: vendor.id,
      companyName: data.companyName ?? null,
      ownerName: data.ownerName ?? null,
      ownerIdNumber: data.ownerIdNumber ?? null,
      companyAddress: data.companyAddress ?? null,
      reason: data.reason ?? null,
      newOwnerSelfieUrl: selfieFile?.filename ?? null,
      newOwnerIdPhotoUrl: idFile?.filename ?? null,
    },
  });

  await notifyAdminActionNeeded(
    "Solicitud de cambio de datos — tienda verificada",
    `${vendor.companyName} pidió cambiar datos de identidad (verificada) — revísalo en el panel de administración.`,
    vendor.id
  );
  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "vendor_change_requested",
    description: `Solicitó cambiar: ${Object.keys(data).filter((k) => k !== "reason" && data[k]).join(", ")}`,
  });

  res.status(201).json({ changeRequest: request });
}

// El vendedor consulta el estado de su solicitud más reciente (para poder
// mostrar "en revisión" en su perfil en vez de dejarlo adivinar).
export async function getMyChangeRequest(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);
  const request = await prisma.vendorChangeRequest.findFirst({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" } });
  res.json({ changeRequest: request });
}

// Mismo criterio que getVerificationFile — privado, dueño de la tienda o
// admin, nunca URL pública.
export async function getVendorChangeRequestFile(req, res) {
  const { id, type } = req.params;
  const request = await prisma.vendorChangeRequest.findUnique({ where: { id }, include: { vendor: true } });
  if (!request) throw new AppError("No encontrado.", 404);

  const isOwner = request.vendor.userId === req.user.id;
  const isAdmin = req.user.role === "ADMIN";
  if (!isOwner && !isAdmin) throw new AppError("No tienes permiso para ver este documento.", 403);

  const filename = type === "selfie" ? request.newOwnerSelfieUrl : request.newOwnerIdPhotoUrl;
  if (!filename) throw new AppError("Documento no encontrado.", 404);

  let buffer;
  try {
    buffer = await readFile(join(KYC_UPLOAD_DIR, filename));
  } catch {
    throw new AppError("Documento no encontrado.", 404);
  }
  const ext = filename.split(".").pop()?.toLowerCase();
  const contentType = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[ext] ?? "application/octet-stream";
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
}

// Bloque 133: mismo patrón EXACTO que ya usa el admin para el logo de la
// plataforma (updateBrandingLogo, settings.controller.js) — subir archivo
// es la alternativa a pegar un link (PATCH /vendor/me con logoUrl como
// string plano, ver updateVendorSchema arriba). Se guarda la ruta relativa
// completa (no solo el nombre del archivo) porque es el mismo criterio que
// ya usan las imágenes de producto (addProductImages) — el frontend
// resuelve absoluta vs. relativa con imgUrl() de todas formas, así que no
// hace falta un formatter aparte acá.
export async function uploadVendorLogo(req, res) {
  if (!req.file) throw new AppError("Sube un archivo de logo.", 400);
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const updated = await prisma.vendor.update({
    where: { id: vendor.id },
    data: { logoUrl: `/uploads/vendor-branding/${req.file.filename}` },
  });
  res.json({ vendor: withComputedVendorFields(updated) });
}

// Bloque 171: reemplaza el upsert por-día de antes (que asumía un solo
// tramo por día, la clave compuesta vendorId_dayOfWeek ya no existe) por un
// reemplazo completo — mismo criterio que replacePriceTiers
// (products.controller.js): se borran todas las filas de este vendedor y se
// recrean desde cero con lo que mandó el formulario, dentro de una
// transacción.
export async function updateSchedule(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const { days } = scheduleSchema.parse(req.body);
  const rows = flattenScheduleDays(days);

  await prisma.$transaction([
    prisma.vendorSchedule.deleteMany({ where: { vendorId: vendor.id } }),
    prisma.vendorSchedule.createMany({ data: rows.map((r) => ({ ...r, vendorId: vendor.id })) }),
  ]);

  const schedules = await prisma.vendorSchedule.findMany({ where: { vendorId: vendor.id }, orderBy: { dayOfWeek: "asc" } });
  res.json({ schedules });
}

// Bloque 15: ventana de análisis reciente para productos de alta demanda /
// clientes potenciales — mismo patrón que REGULAR_PLAN_PRODUCT_LIMIT en
// products.controller.js. Bloque 228: LOW_STOCK_THRESHOLD se centralizó en
// constants/inventory.js (antes vivía duplicado acá y en otros 2 archivos).
const ANALYTICS_WINDOW_DAYS = 30;

// Bloque 230 (Fase 3, pedido explícito — "score de salud de tienda para el
// vendedor (semáforo) — reutiliza completitud, cancelaciones, stock que ya
// calculas"): 3 señales que YA existían por separado en este archivo
// (completenessScore de productRanking.js — antes solo para "Destacados",
// LOW_STOCK_THRESHOLD, y el filtro status!=CANCELLED que ya usa cada
// agregado de ventas de arriba), combinadas en un solo número 0-100 con
// semáforo. Nunca decide nada por sí solo — es un indicador para que el
// vendedor mismo priorice qué atender.
const HEALTH_WEIGHTS = { completeness: 0.4, cancellations: 0.3, stock: 0.3 };

export async function computeVendorHealthScore(vendorId, windowAgo) {
  const [
    products,
    stockTrackedCount,
    lowStockCount,
    outOfStockCount,
    totalOrders,
    cancelledOrders,
    totalTableOrders,
    cancelledTableOrders,
  ] = await Promise.all([
    // Mismo campo que completenessScore ya usa en productRanking.js —
    // priceTiers solo hasta 1 fila, alcanza para saber si tiene al menos
    // una (`.length > 0`), sin traer el tramo completo de precios.
    prisma.product.findMany({
      where: { vendorId, isActive: true },
      select: { images: true, description: true, tags: true, categoryId: true, badge: true, priceTiers: { select: { id: true }, take: 1 } },
      take: 200,
    }),
    prisma.product.count({ where: { vendorId, isActive: true, unlimitedStock: false } }),
    prisma.product.count({ where: { vendorId, isActive: true, unlimitedStock: false, stock: { gt: 0, lte: LOW_STOCK_THRESHOLD } } }),
    prisma.product.count({ where: { vendorId, isActive: true, unlimitedStock: false, stock: { lte: 0 } } }),
    prisma.order.count({ where: { vendorId, createdAt: { gte: windowAgo } } }),
    prisma.order.count({ where: { vendorId, createdAt: { gte: windowAgo }, status: "CANCELLED" } }),
    prisma.tableOrder.count({ where: { table: { vendorId }, createdAt: { gte: windowAgo } } }),
    prisma.tableOrder.count({ where: { table: { vendorId }, createdAt: { gte: windowAgo }, cancelledAt: { not: null } } }),
  ]);

  // Sin productos activos todavía = 0 real ("todavía no armaste tu
  // catálogo"), no se disfraza de neutro.
  const completeness = products.length > 0 ? products.reduce((sum, p) => sum + completenessScore(p), 0) / products.length : 0;

  const ordersInWindow = totalOrders + totalTableOrders;
  const cancelledInWindow = cancelledOrders + cancelledTableOrders;
  // Sin pedidos en la ventana = sin evidencia de mal servicio, no se
  // penaliza (sería castigar a una tienda recién empezando igual que a una
  // con cancelaciones reales).
  const cancellationRate = ordersInWindow > 0 ? cancelledInWindow / ordersInWindow : 0;

  const stockIssues = lowStockCount + outOfStockCount;
  // Sin ningún producto con seguimiento de stock (todo unlimitedStock) =
  // nada que preocupe acá, mismo criterio de "disponible siempre" del resto
  // del proyecto.
  const stockHealth = stockTrackedCount > 0 ? 100 * (1 - stockIssues / stockTrackedCount) : 100;

  const score = Math.round(
    HEALTH_WEIGHTS.completeness * completeness +
      HEALTH_WEIGHTS.cancellations * (100 * (1 - cancellationRate)) +
      HEALTH_WEIGHTS.stock * stockHealth
  );
  const level = score >= 75 ? "green" : score >= 50 ? "yellow" : "red";

  return {
    score,
    level,
    completeness: Math.round(completeness),
    cancellationRate: Math.round(cancellationRate * 100),
    stockHealth: Math.round(stockHealth),
  };
}

// Métricas del panel de vendedor — todo calculado server-side.
export async function getDashboard(req, res) {
  const vendor = await resolveMyVendor(req.user.id);

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
    // Bloque 197 (bug real encontrado al auditar — voidear/anular un pedido
    // ya confirmado ahora es posible desde cualquier estado, así que un
    // pedido cancelado que antes casi nunca pesaba acá empezó a importar de
    // verdad): "status != CANCELLED" / "cancelledAt IS NULL" en TODOS los
    // agregados de ventas de este archivo — nunca solo en los nuevos.
    prisma.order.aggregate({ where: { vendorId: vendor.id, createdAt: { gte: weekAgo }, status: { not: "CANCELLED" } }, _sum: { total: true } }),
    prisma.tableOrder.aggregate({ where: { table: { vendorId: vendor.id }, createdAt: { gte: weekAgo }, cancelledAt: null }, _sum: { total: true } }),
    prisma.order.count({ where: { vendorId: vendor.id, status: "NEW" } }),
    prisma.tableOrder.count({ where: { table: { vendorId: vendor.id }, kitchenStatus: "RECEIVED" } }),
    prisma.product.count({ where: { vendorId: vendor.id, isActive: true } }),
    prisma.review.aggregate({ where: { vendorId: vendor.id, rating: { not: null } }, _count: { rating: true } }),
    // Bloque 56: un producto "disponible siempre" nunca aparece acá — es
    // justamente lo que significa no llevarle seguimiento de stock.
    prisma.product.findMany({
      where: { vendorId: vendor.id, isActive: true, unlimitedStock: false, stock: { gt: 0, lte: LOW_STOCK_THRESHOLD } },
      orderBy: { stock: "asc" },
      select: { id: true, name: true, stock: true, images: true },
      take: 10,
    }),
    prisma.product.findMany({
      where: { vendorId: vendor.id, isActive: true, unlimitedStock: false, stock: { lte: 0 } },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, stock: true, images: true },
      take: 10,
    }),
    // Alta demanda: agregado real de OrderItem (no Vendor.salesCount, que es
    // un total de tienda, no por producto) en la ventana reciente.
    prisma.orderItem.groupBy({
      by: ["productId"],
      where: { productId: { not: null }, order: { vendorId: vendor.id, createdAt: { gte: windowAgo }, status: { not: "CANCELLED" } } },
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

  const [recentOrders, recentTableOrders, healthScore] = await Promise.all([
    prisma.order.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" }, take: 4 }),
    prisma.tableOrder.findMany({
      where: { table: { vendorId: vendor.id } },
      include: { table: true },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
    computeVendorHealthScore(vendor.id, windowAgo),
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
    // Bloque 181 (bug real visto en consola — "Encountered two children
    // with the same key, Mesa 2"): `id` es la key de React en
    // VendorDashboard.jsx — varios pedidos de la misma mesa colisionaban,
    // y el cliente se mostraba como "Mesa 2 · Mesa 2". Mismo formato que
    // ya usa la lista de Pedidos: la mesa + su número de pedido único, y el
    // nombre real del cliente si lo dejó.
    ...recentTableOrders.map((t) => ({
      id: `${t.table.label || `Mesa ${t.table.tableNumber}`} · Pedido #${t.orderNumber}`,
      customer: t.customerName ?? "Cliente de mesa",
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
    isVerified: vendor.verificationStatus === "VERIFIED",
    planType: vendor.planType,
    recentOrders: merged,
    lowStockProducts,
    outOfStockProducts,
    topProducts,
    potentialCustomers,
    healthScore,
  });
}

// ---------------------------------------------------------------------------
// Bloque 194 (pedido explícito — "quiero que en la sección de resumen los
// vendedores puedan ver más resúmenes en su panel, basado en el algoritmo
// que utiliza la plataforma para calcular dónde los clientes hacen más
// clic en su tienda, dónde permanecen más, la gráfica colorida para ver
// las ventas del día de la semana y del mes, para ver también las ventas
// de todos los meses, los productos más vendidos por día, por semana y
// por mes, el inventario en tiempo real... resumen de sus meseros que más
// venden"): getDashboard (arriba) se queda tal cual para las tarjetas
// resumen de siempre — esto es un endpoint NUEVO y aparte
// (GET /vendors/me/dashboard/analytics) con todo lo demás, para no
// sobrecargar ni arriesgar el que ya funcionaba. "El algoritmo que usa la
// plataforma" = las mismas señales de productRanking.js (clickCount,
// searchClickCount, totalDwellMs, viewCount, salesCount en Product) que ya
// deciden "Destacados" en el Home — acá simplemente se le muestran al
// propio vendedor, ordenadas, en vez de solo usarse internamente.
// ---------------------------------------------------------------------------

// Bloque 48: el motor de series (bucketKey/bucketLabel/rawSalesSeries/etc.,
// originalmente Bloque 225) se movió a lib/salesSeries.js para poder
// reusarlo desde el dashboard de admin (agregado, toda la plataforma) sin
// duplicar estas ~90 líneas — acá solo queda el endpoint propio del
// vendedor, que le pasa su vendorId.
export async function getVendorSalesSeries(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { granularity, from, to } = salesSeriesSchema.parse(req.query);

  const range = resolveSeriesRange(granularity, from, to);
  if (!range) throw new AppError("Rango de fechas inválido.", 400);
  const { fromDate, toDate } = range;

  const rawRows = await rawSalesSeries(vendor.id, granularity, fromDate, toDate);
  const series = fillSeriesGaps(granularity, fromDate, toDate, rawRows);
  const total = series.reduce((sum, s) => sum + s.total, 0);
  const orders = series.reduce((sum, s) => sum + s.orders, 0);

  res.json({ granularity, from: fromDate.toISOString(), to: toDate.toISOString(), series, total, orders });
}

// Bloque 225: mismo query de agrupado por día de la semana que antes vivía
// como salesByWeekday (endpoint público) — se queda, pero solo como señal
// INTERNA para los consejos de IA (getOrGenerateVendorDailyTips más abajo),
// ya no se expone en el dashboard: ese lugar ahora lo cubre la gráfica única
// de arriba con su selector de día/semana/mes/año.
const WEEKDAY_LABEL = { 1: "lunes", 2: "martes", 3: "miércoles", 4: "jueves", 5: "viernes", 6: "sábado", 7: "domingo" };
export async function bestSellingWeekday(vendorId, since) {
  const rows = await prisma.$queryRaw`
    SELECT EXTRACT(ISODOW FROM t."createdAt")::int AS weekday, COALESCE(SUM(t.total), 0)::numeric AS total
    FROM (
      SELECT "createdAt", total FROM "Order" WHERE "vendorId" = ${vendorId} AND "createdAt" >= ${since} AND status != 'CANCELLED'
      UNION ALL
      SELECT o."createdAt", o.total FROM "TableOrder" o JOIN "Table" tb ON tb.id = o."tableId"
      WHERE tb."vendorId" = ${vendorId} AND o."createdAt" >= ${since} AND o."cancelledAt" IS NULL
    ) t
    GROUP BY weekday
    ORDER BY total DESC
    LIMIT 1
  `;
  if (!rows.length || Number(rows[0].total) <= 0) return null;
  return { label: WEEKDAY_LABEL[Number(rows[0].weekday)], total: Number(rows[0].total) };
}

// Bloque 194: reusable para "hoy"/"esta semana"/"este mes" — combina
// OrderItem (pedidos normales) con los items JSON de TableOrder (nunca una
// relación real, ver Bloque 158/185), sumando por productId. Los items sin
// productId (cargas manuales sueltas, "Cerveza Cristal" tipeada a mano) se
// ignoran — no hay ningún Product real al que atribuirles la venta.
export async function topSellingProducts(vendorId, since, limit = 5) {
  const [orderItems, tableOrders] = await Promise.all([
    prisma.orderItem.groupBy({
      by: ["productId"],
      where: { productId: { not: null }, order: { vendorId, createdAt: { gte: since }, status: { not: "CANCELLED" } } },
      _sum: { quantity: true },
    }),
    prisma.tableOrder.findMany({
      where: { table: { vendorId }, createdAt: { gte: since }, cancelledAt: null },
      select: { items: true },
    }),
  ]);

  const qtyByProduct = new Map();
  for (const row of orderItems) qtyByProduct.set(row.productId, (qtyByProduct.get(row.productId) ?? 0) + (row._sum.quantity ?? 0));
  for (const order of tableOrders) {
    for (const item of order.items) {
      if (!item.productId) continue;
      qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) ?? 0) + item.quantity);
    }
  }

  const sorted = [...qtyByProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (sorted.length === 0) return [];
  const products = await prisma.product.findMany({ where: { id: { in: sorted.map(([id]) => id) } }, select: { id: true, name: true, images: true } });
  const productById = Object.fromEntries(products.map((p) => [p.id, p]));
  return sorted.map(([id, soldCount]) => ({ ...productById[id], soldCount })).filter((p) => p.id);
}

// Bloque 194 ("dónde los clientes hacen más clic en su tienda, dónde
// permanecen más"): mismas señales EXACTAS que productRanking.js usa para
// "Destacados" del Home (Product.clickCount/searchClickCount/totalDwellMs/
// viewCount) — acá no se recalcula ningún score nuevo, solo se ordena y se
// le muestra al vendedor su propio top de cada señal por separado.
export async function engagementSignals(vendorId) {
  const products = await prisma.product.findMany({
    where: { vendorId, isActive: true },
    select: { id: true, name: true, images: true, clickCount: true, searchClickCount: true, viewCount: true, totalDwellMs: true },
  });

  const topClicks = [...products]
    .filter((p) => p.clickCount > 0)
    .sort((a, b) => b.clickCount - a.clickCount)
    .slice(0, 5)
    .map((p) => ({ id: p.id, name: p.name, images: p.images, clickCount: p.clickCount, searchClickCount: p.searchClickCount }));

  const topDwell = products
    .filter((p) => p.viewCount > 0)
    .map((p) => ({ id: p.id, name: p.name, images: p.images, avgDwellSeconds: Math.round(p.totalDwellMs / p.viewCount / 1000), viewCount: p.viewCount }))
    .sort((a, b) => b.avgDwellSeconds - a.avgDwellSeconds)
    .slice(0, 5);

  return { topClicks, topDwell };
}

// Bloque 194 ("resumen de sus meseros que más venden"): quién ACEPTÓ cada
// pedido de mesa (RECEIVED->PREPARING) o creó una cuenta manual queda en
// ActivityLog.actorId desde que existen los usuarios de sistema (Bloque
// 183) — el dueño también puede aparecer acá si él mismo acepta pedidos,
// a propósito (no hay motivo para excluirlo de su propio ranking). JOIN a
// TableOrder vía meta->>'tableOrderId' (JSON, no una FK real) para sumar
// el monto de cada cuenta que esa persona manejó.
async function staffLeaderboard(vendorId, since) {
  const rows = await prisma.$queryRaw`
    SELECT al."actorId" AS "userId", u."fullName" AS "fullName", COUNT(*)::int AS "ordersHandled", COALESCE(SUM(t.total), 0)::numeric AS "totalSales"
    FROM "ActivityLog" al
    JOIN "User" u ON u.id = al."actorId"
    LEFT JOIN "TableOrder" t ON t.id = (al.meta->>'tableOrderId')
    WHERE al."vendorId" = ${vendorId}
      AND al."createdAt" >= ${since}
      AND (
        al.action = 'table_order_created_manually'
        OR (al.action = 'table_order_status_changed' AND al.meta->>'status' = 'PREPARING')
      )
      -- Bloque 197: una cuenta anulada después (pedido erróneo) no debe
      -- seguir contando a favor del mesero que la aceptó — t.id IS NULL
      -- deja pasar filas viejas de actividad que no llegan a matchear
      -- ningún TableOrder real.
      AND (t.id IS NULL OR t."cancelledAt" IS NULL)
    GROUP BY al."actorId", u."fullName"
    ORDER BY "totalSales" DESC
    LIMIT 10
  `;
  return rows.map((r) => ({ userId: r.userId, fullName: r.fullName, ordersHandled: Number(r.ordersHandled), totalSales: Number(r.totalSales) }));
}

export async function getDashboardAnalytics(req, res) {
  const vendor = await resolveMyVendor(req.user.id);

  const now = new Date();
  const eightWeeksAgo = new Date(now.getTime() - 56 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // lunes de esta semana

  // Bloque 225: las 3 gráficas de ventas (día de la semana / del mes /
  // últimos 12 meses) se sacaron de acá — ahora viven en una sola gráfica
  // con selector propio, ver GET /vendors/me/dashboard/sales-series.
  const [bestToday, bestThisWeek, bestThisMonth, engagement, staff, inventoryProducts] = await Promise.all([
    topSellingProducts(vendor.id, todayStart),
    topSellingProducts(vendor.id, weekStart),
    topSellingProducts(vendor.id, monthStart),
    engagementSignals(vendor.id),
    staffLeaderboard(vendor.id, eightWeeksAgo),
    // Bloque 194 ("el inventario en tiempo real"): mismo criterio que Bloque
    // 56 en todo el resto del proyecto — "disponible siempre" (unlimitedStock)
    // nunca entra a los conteos de stock, se muestra aparte.
    prisma.product.findMany({
      where: { vendorId: vendor.id, isActive: true },
      select: { id: true, name: true, slug: true, images: true, stock: true, unlimitedStock: true },
      orderBy: { name: "asc" },
      take: 300,
    }),
  ]);

  // Bloque 230 (pedido explícito, con captura — "quiero que cada uno tenga
  // un botón de ver y al hacer clic... se levante la ventana con los datos
  // que está mostrando y detalles"): antes estos 5 números salían de 4
  // consultas de conteo/suma aparte — se reemplazan por UNA sola lista
  // (arriba) y el resto se deriva en JS, así el mismo dato que arma cada
  // número también alimenta el detalle del modal, sin volver a consultar.
  const tracked = inventoryProducts.filter((p) => !p.unlimitedStock);
  const lowStock = tracked.filter((p) => p.stock > 0 && p.stock <= LOW_STOCK_THRESHOLD);
  const outOfStock = tracked.filter((p) => p.stock <= 0);
  const unlimited = inventoryProducts.filter((p) => p.unlimitedStock);
  const totalUnits = tracked.reduce((sum, p) => sum + p.stock, 0);

  res.json({
    bestSellers: { today: bestToday, thisWeek: bestThisWeek, thisMonth: bestThisMonth },
    engagement,
    staffLeaderboard: staff,
    inventory: {
      trackedProducts: tracked.length,
      totalUnits,
      lowStockCount: lowStock.length,
      outOfStockCount: outOfStock.length,
      unlimitedStockProducts: unlimited.length,
      products: { tracked, lowStock, outOfStock, unlimited },
    },
  });
}

// Bloque 194 (pedido explícito — "puedes agregar una sección dentro del
// dashboard para que, basado en cómo funciona el negocio, la IA vaya
// reconociendo el modo de uso del negocio y le recomiende consejos...
// consejos diarios"): endpoint chico y aparte de los otros 2 de arriba —
// toda la lógica real vive en services/vendorDailyTips.service.js
// (generación + caché de un día).
export async function getVendorDailyTips(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { tips, generatedAt } = await getOrGenerateVendorDailyTips(vendor.id);
  res.json({ tips, generatedAt });
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
  const vendor = await resolveMyVendor(userId);
  if (vendor.verificationStatus !== "VERIFIED") {
    const { siteName } = await getBrandSettings();
    throw new AppError(`El chat con el equipo de ${siteName} se habilita al verificar tu tienda.`, 403);
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
  const vendor = await resolveMyVendor(req.user.id);

  const [notifications, unreadCount] = await Promise.all([
    prisma.vendorNotification.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" } }),
    prisma.vendorNotification.count({ where: { vendorId: vendor.id, readAt: null } }),
  ]);
  res.json({ notifications, unreadCount });
}

// Se llama cuando el vendedor efectivamente abre el dropdown de la
// campanita — no cuando se crea la notificación en el backend.
export async function markMyNotificationsRead(req, res) {
  const vendor = await resolveMyVendor(req.user.id);

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
      `Tu Plan ${vendor.planType === "BUSINESS" ? "Business" : "Regular"} permite hasta ${max} país(es) de entrega. Quita uno o verifica tu tienda para ampliar el límite.`,
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
        `Tu Plan ${vendor.planType === "BUSINESS" ? "Business" : "Regular"} permite vender en hasta ${max} provincia(s). Verifica tu tienda para ampliar el límite.`,
        403
      );
    }
  }

  const duplicate = existingLocations.some((l) => l.provinceId === provinceId && l.municipalityId === (municipalityId ?? null));
  if (duplicate) throw new AppError("Ya tienes esa provincia/municipio agregado.", 409);

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
        `Tu Plan ${vendor.planType === "BUSINESS" ? "Business" : "Regular"} permite vender en hasta ${max} provincia(s). Verifica tu tienda para ampliar el límite.`,
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
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);
  if (!req.file) throw new AppError("Sube un archivo .pdf o .txt.", 400);

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
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  if (vendor.aiDocument) {
    await unlink(join(VENDOR_AI_DOC_DIR, vendor.aiDocument)).catch(() => {});
  }

  await prisma.vendor.update({
    where: { id: vendor.id },
    data: { aiDocument: null, aiDocumentName: null },
  });

  res.status(204).end();
}
