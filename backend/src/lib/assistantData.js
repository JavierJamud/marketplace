import { prisma } from "./prisma.js";
import { getPlanConfig, isPremiumActive } from "./planConfig.js";
import { RANKING_RULES, rankFeaturedProducts, explainProductRanking, completenessScore } from "./productRanking.js";
import { LOW_STOCK_THRESHOLD } from "../constants/inventory.js";

// Bloque 260 (pedido explícito — el asistente de negocio debe tener acceso
// completo a todo lo que pasa en el negocio, también lo que el vendedor no ve en
// pantalla, como el algoritmo con el que aparece su tienda pública, sus inicios
// de sesión y toda su actividad registrada): consultas de SOLO LECTURA por
// tienda. Cada función recibe el vendorId que ya validó el servidor (en el
// ámbito del vendedor sale de su sesión; en el del admin, del nombre que busca)
// y devuelve datos ya recortados: nunca contraseñas, tokens, claves, documentos
// de verificación, ni correos o teléfonos de clientes.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const clip = (text, max) => {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
};
export const money = (n) => Math.round(Number(n ?? 0) * 100) / 100;
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const iso = (d) => (d ? new Date(d).toISOString() : null);

function deviceLabel(userAgent) {
  const ua = String(userAgent ?? "");
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows" : /Mac OS|Macintosh/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "dispositivo desconocido";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "navegador desconocido";
  return `${browser} en ${os}`;
}

// ---------------------------------------------------------------------------
// Plan, suscripción y vencimientos
// ---------------------------------------------------------------------------
export async function planAndSubscription(vendorId) {
  const v = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: {
      companyName: true,
      planType: true,
      verificationStatus: true,
      nextPaymentDueDate: true,
      cancelAtPeriodEnd: true,
      trialStartedAt: true,
      trialEndsAt: true,
      stripeSubscriptionId: true,
      createdAt: true,
    },
  });
  if (!v) return { error: "No se encontró la tienda." };
  const [config, activeProducts, staff, tables, storeOffers, codes, payments, logs] = await Promise.all([
    getPlanConfig(v.planType),
    prisma.product.count({ where: { vendorId, isActive: true, overQuota: false } }),
    prisma.vendorStaff.count({ where: { vendorId, isActive: true } }),
    prisma.table.count({ where: { vendorId } }),
    prisma.storeOffer.count({ where: { vendorId, active: true } }),
    prisma.discountCode.count({ where: { vendorId, active: true } }),
    prisma.subscriptionPayment.findMany({
      where: { vendorId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { paymentMethod: true, months: true, amount: true, currency: true, claimedAt: true, confirmedAt: true, periodStart: true, periodEnd: true, createdAt: true },
    }),
    prisma.verificationStatusLog.findMany({ where: { vendorId }, orderBy: { at: "desc" }, take: 6, select: { fromStatus: true, toStatus: true, reason: true, source: true, at: true } }),
  ]);
  const premium = isPremiumActive(v);
  const now = Date.now();
  const daysLeft = v.nextPaymentDueDate ? Math.ceil((new Date(v.nextPaymentDueDate).getTime() - now) / DAY_MS) : null;
  const limit = (used, max) => ({ usados: used, maximo: max ?? "sin límite" });
  return {
    tienda: v.companyName,
    plan: v.planType,
    planDePagoActivo: premium,
    verificacion: v.verificationStatus,
    registradaEl: day(v.createdAt),
    vencimiento: premium
      ? {
          proximoVencimiento: day(v.nextPaymentDueDate),
          diasRestantes: daysLeft,
          nota: v.nextPaymentDueDate ? undefined : "El plan de pago está activo pero no tiene fecha de vencimiento registrada (suele pasar cuando el admin lo activó a mano, sin un cobro programado). No hay una fecha que consultar.",
          seCancelaAlFinalDelPeriodo: v.cancelAtPeriodEnd,
          formaDeCobro: v.stripeSubscriptionId ? "tarjeta (Stripe, renovación automática)" : "transferencia (hay que pagar cada renovación)",
        }
      : { nota: "No tiene una suscripción de pago activa, por eso no hay fecha de vencimiento." },
    pruebaGratuita: { iniciada: day(v.trialStartedAt), termina: day(v.trialEndsAt), activaAhora: !!v.trialEndsAt && new Date(v.trialEndsAt).getTime() > now },
    limitesDelPlan: {
      productosPublicos: limit(activeProducts, config?.maxProducts),
      usuariosDeSistema: limit(staff, config?.maxStaffUsers),
      mesas: limit(tables, config?.maxTables),
      ofertasDeTiendaActivas: limit(storeOffers, config?.maxActiveStoreOffers),
      codigosDeDescuentoActivos: limit(codes, config?.maxDiscountCodes),
    },
    ultimosPagosDeRenovacion: payments.map((p) => ({
      metodo: p.paymentMethod === "CARD" ? "tarjeta" : "transferencia CUP",
      meses: p.months,
      monto: p.amount != null ? money(p.amount) : null,
      moneda: p.currency,
      confirmado: !!p.confirmedAt,
      periodo: p.periodStart && p.periodEnd ? `${day(p.periodStart)} a ${day(p.periodEnd)}` : null,
      creadoEl: day(p.createdAt),
    })),
    historialDeVerificacion: logs.map((l) => ({ de: l.fromStatus, a: l.toStatus, motivo: clip(l.reason, 100), origen: l.source, fecha: day(l.at) })),
  };
}

// ---------------------------------------------------------------------------
// Inicios de sesión y toda la actividad registrada
// ---------------------------------------------------------------------------
export async function accountActivity(vendorId, limit = 15) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { userId: true, user: { select: { lastLoginAt: true, createdAt: true } } } });
  if (!vendor) return { error: "No se encontró la tienda." };
  const since14 = new Date(Date.now() - 14 * DAY_MS);
  const since30 = new Date(Date.now() - 30 * DAY_MS);
  const [sessions, activeSessions, staff, logs, byAction] = await Promise.all([
    prisma.session.findMany({ where: { userId: vendor.userId, createdAt: { gte: since14 } }, orderBy: { createdAt: "desc" }, take: 60, select: { createdAt: true, lastUsedAt: true, userAgent: true, revokedAt: true } }),
    prisma.session.count({ where: { userId: vendor.userId, revokedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.vendorStaff.findMany({ where: { vendorId }, take: 15, select: { isActive: true, staffType: true, user: { select: { fullName: true, lastLoginAt: true } } } }),
    prisma.activityLog.findMany({ where: { vendorId }, orderBy: { createdAt: "desc" }, take: limit, select: { action: true, description: true, actorRole: true, createdAt: true } }),
    prisma.activityLog.groupBy({ by: ["action"], where: { vendorId, createdAt: { gte: since30 } }, _count: { _all: true }, orderBy: { _count: { action: "desc" } }, take: 10 }),
  ]);
  const perDay = {};
  for (const s of sessions) {
    const k = day(s.createdAt);
    perDay[k] = (perDay[k] ?? 0) + 1;
  }
  return {
    ultimoInicioDeSesionDelDueno: iso(vendor.user?.lastLoginAt),
    cuentaCreadaEl: day(vendor.user?.createdAt),
    sesionesAbiertasAhora: activeSessions,
    iniciosDeSesionPorDiaUltimos14dias: perDay,
    ultimasSesiones: sessions.slice(0, Math.min(limit, 20)).map((s) => ({ inicio: iso(s.createdAt), ultimoUso: iso(s.lastUsedAt), dispositivo: deviceLabel(s.userAgent), cerrada: !!s.revokedAt })),
    personalDeSistema: staff.map((s) => ({ nombre: clip(s.user?.fullName ?? "Sin nombre", 40), tipo: s.staffType ?? "sin tipo", activo: s.isActive, ultimoAcceso: iso(s.user?.lastLoginAt) })),
    actividadRegistradaUltimos30diasPorTipo: byAction.map((a) => ({ accion: a.action, veces: a._count._all })),
    ultimosMovimientosRegistrados: logs.map((l) => ({ fecha: iso(l.createdAt), quien: l.actorRole, accion: l.action, detalle: clip(l.description, 140) })),
  };
}

// ---------------------------------------------------------------------------
// Algoritmo: cómo aparece la tienda pública y dónde queda cada producto
// ---------------------------------------------------------------------------
export function algorithmRules() {
  return {
    destacadosYBusqueda: {
      queEs: "El orden de 'Destacados' del Home y de la búsqueda/catálogo cuando no se elige otro orden. Cada producto recibe un puntaje de 0 a 1 que mezcla seis señales reales, cada una comparada contra el máximo del catálogo.",
      pesosDeLasSenales: RANKING_RULES.pesos,
      pisoDeCalidad: `Un producto NUNCA se destaca si su ficha está por debajo del ${RANKING_RULES.pisoDeCompletitudTiendaVerificada}% de completitud (tienda verificada) o del ${RANKING_RULES.pisoDeCompletitudTiendaSinVerificar}% (tienda sin verificar), ni si tiene reseñas con promedio menor a ${RANKING_RULES.calificacionMinimaSiTieneResenas}. No se oculta del catálogo: solo cae al final.`,
      empujonProductoNuevo: `Un producto recién activado suma +${RANKING_RULES.empujonProductoNuevo} al puntaje durante sus primeros ${RANKING_RULES.diasDeEmpujonProductoNuevo} días.`,
      actividadReciente: `El peso de ventas y clics baja a la mitad cada ${RANKING_RULES.mitadDeVidaDeLaActividadEnDias} días sin actividad (nunca por debajo de ${RANKING_RULES.pesoMinimoDeLaActividadAntigua}). La completitud y las reseñas no caducan.`,
      destacadoAMano: "Un producto marcado como destacado a mano por el admin siempre queda por encima de los demás.",
      completitudDeLaFicha: "Suma hasta 100: hasta 30 por 3 fotos, 25 por una descripción de más de 60 caracteres (12 si es más corta), 15 por etiquetas, 10 por categoría, 10 por precios por cantidad, 10 por una insignia.",
      reseñas: "Se usa un promedio que desconfía de pocas reseñas: con 2 reseñas de 5 estrellas todavía pesa poco.",
    },
    visibilidadDeLaTienda: [
      "La tienda solo aparece en el catálogo, el Home y el buscador si está activa, no bloqueada, no es privada y tiene al menos un producto activo, visible y dentro del cupo de su plan.",
      "Un producto agotado (sin stock y sin 'siempre disponible') no sale en el Home ni en el catálogo, solo dentro de su propia tienda.",
      "En el listado de tiendas las verificadas salen primero.",
      "Las tiendas verificadas con plan de pago salen en la publicidad de la plataforma durante toda la semana en los grupos de compra y venta de Cuba.",
    ],
    insigniaMasVendido: "El producto más vendido de cada tienda en los últimos 30 días recibe la insignia 'Más vendido'.",
    ofertas: "Una tienda solo puede tener una oferta del Home activa a la vez, con un tiempo de espera entre ofertas que define el admin.",
  };
}

export async function algorithmPosition(vendorId) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { companyName: true, verificationStatus: true, planType: true, isBlocked: true, status: true, isPrivate: true, deletedAt: true, suspensionReason: true, blockReason: true },
  });
  if (!vendor) return { error: "No se encontró la tienda." };

  const mine = await prisma.product.findMany({
    where: { vendorId },
    select: { id: true, isActive: true, hiddenFromStore: true, overQuota: true, stock: true, unlimitedStock: true },
  });
  const inStock = (p) => p.unlimitedStock || p.stock > 0;
  const publicProducts = mine.filter((p) => p.isActive && !p.hiddenFromStore && !p.overQuota);
  const visibilityProblems = [];
  if (vendor.deletedAt) visibilityProblems.push("la tienda fue eliminada");
  if (vendor.isBlocked) visibilityProblems.push(`la tienda está bloqueada${vendor.blockReason ? ` (${clip(vendor.blockReason, 80)})` : ""}`);
  if (vendor.status !== "ACTIVE") visibilityProblems.push(`la tienda está suspendida${vendor.suspensionReason ? ` (${clip(vendor.suspensionReason, 80)})` : ""}`);
  if (vendor.isPrivate) visibilityProblems.push("la tienda está marcada como privada: solo se entra por su enlace directo");
  if (publicProducts.length === 0) visibilityProblems.push("no tiene ningún producto activo, visible y dentro del cupo del plan");

  const base = {
    tienda: vendor.companyName,
    aparecenEnElCatalogoPublico: visibilityProblems.length === 0,
    problemasDeVisibilidad: visibilityProblems,
    productosPublicos: publicProducts.length,
    productosPublicosAgotados: publicProducts.filter((p) => !inStock(p)).length,
    productosPausados: mine.filter((p) => !p.isActive).length,
    productosOcultosSoloMesa: mine.filter((p) => p.hiddenFromStore).length,
    productosFueraDelCupoDelPlan: mine.filter((p) => p.overQuota).length,
    esVerificada: vendor.verificationStatus === "VERIFIED",
  };
  if (visibilityProblems.length > 0) return { ...base, nota: "Mientras haya problemas de visibilidad, sus productos no compiten en el algoritmo." };

  // Mismo universo y mismo orden que el buscador/Home (search.controller.js):
  // hasta 300 candidatos y rankFeaturedProducts sobre ellos.
  const POOL = 300;
  const catalog = await prisma.product.findMany({
    where: {
      isActive: true,
      hiddenFromStore: false,
      overQuota: false,
      OR: [{ unlimitedStock: true }, { stock: { gt: 0 } }],
      vendor: { isBlocked: false, status: "ACTIVE", isPrivate: false },
    },
    include: { vendor: { select: { verificationStatus: true } }, priceTiers: { select: { id: true } } },
    take: POOL,
    orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
  });
  const reviewAgg = await prisma.review.groupBy({
    by: ["productId"],
    where: { productId: { in: catalog.map((p) => p.id) }, rating: { not: null } },
    _avg: { rating: true },
    _count: { rating: true },
  });
  const stats = new Map(reviewAgg.map((a) => [a.productId, { avgRating: a._avg.rating ?? 0, reviewCount: a._count.rating }]));
  const ranked = rankFeaturedProducts(catalog, stats);
  const positions = new Map(ranked.map((p, i) => [p.id, i + 1]));
  const mineRanked = ranked.filter((p) => p.vendorId === vendorId);
  const total = ranked.length;
  const now = Date.now();

  return {
    ...base,
    productosComparadosEnElCatalogo: total,
    nota: total >= POOL ? `El catálogo tiene más de ${POOL} productos candidatos: el buscador evalúa solo los ${POOL} primeros, así que un producto fuera de ese grupo ni siquiera compite.` : undefined,
    susProductosEnElRanking: {
      cuantosCompiten: mineRanked.length,
      enElTop10: mineRanked.filter((p) => positions.get(p.id) <= 10).length,
      enElTop30: mineRanked.filter((p) => positions.get(p.id) <= 30).length,
      penalizadosPorElPisoDeCalidad: mineRanked.filter((p) => !explainProductRanking(p, stats.get(p.id), now).seMuestraComoDestacado).length,
    },
    mejoresPosiciones: mineRanked.slice(0, 6).map((p) => ({ id: p.id, nombre: clip(p.name, 60), posicion: positions.get(p.id), de: total, ...explainProductRanking(p, stats.get(p.id), now) })),
    peoresPosiciones: mineRanked.length > 6 ? mineRanked.slice(-4).map((p) => ({ id: p.id, nombre: clip(p.name, 60), posicion: positions.get(p.id), de: total, ...explainProductRanking(p, stats.get(p.id), now) })) : [],
    comoMejorar: "Subir la completitud de la ficha (fotos, descripción, etiquetas), conseguir reseñas buenas y mantener actividad reciente (clics y ventas) son las palancas reales; el algoritmo no se puede comprar ni forzar.",
  };
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------
const PRODUCT_ORDER = {
  ventas: [{ salesCount: "desc" }],
  vistas: [{ viewCount: "desc" }],
  clics: [{ clickCount: "desc" }],
  calificacion: [{ rating: "desc" }, { reviewCount: "desc" }],
  stock: [{ stock: "asc" }],
  recientes: [{ createdAt: "desc" }],
};

function productRow(p) {
  return {
    id: p.id,
    nombre: clip(p.name, 70),
    precio: `${money(p.price)} ${p.currency}`,
    stock: p.unlimitedStock ? "siempre disponible" : p.stock,
    estado: !p.isActive ? "pausado" : p.overQuota ? "fuera del cupo del plan" : p.hiddenFromStore ? "solo para mesas" : "público",
    ventas: p.salesCount,
    vistas: p.viewCount,
    clics: p.clickCount,
    clicsDesdeBusqueda: p.searchClickCount,
    segundosPromedioEnLaFicha: p.viewCount > 0 ? Math.round(Number(p.totalDwellMs) / p.viewCount / 1000) : 0,
    calificacion: p.reviewCount > 0 ? `${Number(p.rating)} (${p.reviewCount} reseñas)` : "sin reseñas",
    fotos: p.images?.length ?? 0,
    completitudDeLaFicha: completenessScore(p),
    ultimaActividad: day(p.lastActivityAt),
  };
}
const PRODUCT_SELECT = {
  id: true,
  name: true, price: true, currency: true, stock: true, unlimitedStock: true, isActive: true, hiddenFromStore: true, overQuota: true, isFeatured: true,
  salesCount: true, viewCount: true, clickCount: true, searchClickCount: true, totalDwellMs: true, rating: true, reviewCount: true,
  images: true, description: true, tags: true, categoryId: true, badge: true, lastActivityAt: true, createdAt: true, activatedAt: true,
  priceTiers: { select: { id: true } },
};

export async function productsList(vendorId, { busqueda, orden, limite }) {
  const where = { vendorId, ...(busqueda ? { name: { contains: busqueda, mode: "insensitive" } } : {}) };
  const [rows, total, active, paused, hidden, over] = await Promise.all([
    prisma.product.findMany({ where, orderBy: PRODUCT_ORDER[orden] ?? PRODUCT_ORDER.ventas, take: limite, select: PRODUCT_SELECT }),
    prisma.product.count({ where: { vendorId } }),
    prisma.product.count({ where: { vendorId, isActive: true } }),
    prisma.product.count({ where: { vendorId, isActive: false } }),
    prisma.product.count({ where: { vendorId, hiddenFromStore: true } }),
    prisma.product.count({ where: { vendorId, overQuota: true } }),
  ]);
  return { totalDeProductos: total, activos: active, pausados: paused, ocultosSoloMesa: hidden, fueraDelCupoDelPlan: over, ordenadosPor: orden, productos: rows.map(productRow) };
}

export async function productDetail(vendorId, { busqueda }) {
  const matches = await prisma.product.findMany({ where: { vendorId, name: { contains: busqueda, mode: "insensitive" } }, take: 3, orderBy: { salesCount: "desc" }, select: { vendor: { select: { verificationStatus: true } }, ...PRODUCT_SELECT } });
  if (matches.length === 0) return { error: "No encontré ningún producto con ese nombre." };
  const p = matches[0];
  const since = new Date(Date.now() - 30 * DAY_MS);
  const [clicks, sold, reviews, reviewStats, favorites] = await Promise.all([
    prisma.productClickEvent.groupBy({ by: ["source"], where: { productId: p.id, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.orderItem.aggregate({ where: { productId: p.id, order: { createdAt: { gte: since }, status: { not: "CANCELLED" } } }, _sum: { quantity: true } }),
    prisma.review.findMany({ where: { productId: p.id, isHidden: false, rating: { not: null } }, orderBy: { createdAt: "desc" }, take: 3, select: { rating: true, comment: true, createdAt: true } }),
    prisma.review.aggregate({ where: { productId: p.id, isHidden: false, rating: { not: null } }, _avg: { rating: true }, _count: { rating: true } }),
    prisma.favorite.count({ where: { productId: p.id } }),
  ]);
  return {
    ...productRow(p),
    descripcionTiene: p.description ? `${p.description.trim().length} caracteres` : "no tiene",
    etiquetas: p.tags?.length ?? 0,
    tieneCategoria: !!p.categoryId,
    insignia: p.badge ?? null,
    destacadoAManoPorElAdmin: p.isFeatured,
    publicadoEl: day(p.createdAt),
    unidadesVendidasUltimos30dias: sold._sum.quantity ?? 0,
    clicsUltimos30diasPorOrigen: clicks.map((c) => ({ origen: c.source ?? "sin dato", clics: c._count._all })),
    guardadoEnFavoritosPor: favorites,
    ultimasResenas: reviews.map((r) => ({ estrellas: r.rating, comentario: clip(r.comment, 160), fecha: day(r.createdAt) })),
    comoLoVeElAlgoritmo: explainProductRanking(p, reviewStats._count.rating > 0 ? { avgRating: reviewStats._avg.rating, reviewCount: reviewStats._count.rating } : null),
    otrasCoincidencias: matches.slice(1).map((m) => clip(m.name, 60)),
  };
}

// ---------------------------------------------------------------------------
// Mensajes, notificaciones, ofertas, alertas, clientes, chat, perfil, pedidos
// ---------------------------------------------------------------------------
export async function inbox(vendorId) {
  const [messages, unreadFromAdmin, notifications, unreadNotifications] = await Promise.all([
    prisma.vendorMessage.findMany({ where: { vendorId }, orderBy: { createdAt: "desc" }, take: 8, select: { senderRole: true, body: true, readAt: true, createdAt: true } }),
    prisma.vendorMessage.count({ where: { vendorId, senderRole: "ADMIN", readAt: null } }),
    prisma.vendorNotification.findMany({ where: { vendorId }, orderBy: { createdAt: "desc" }, take: 10, select: { type: true, title: true, body: true, readAt: true, createdAt: true } }),
    prisma.vendorNotification.count({ where: { vendorId, readAt: null } }),
  ]);
  return {
    mensajesDelEquipoSinLeer: unreadFromAdmin,
    ultimosMensajes: messages.map((m) => ({ de: m.senderRole === "ADMIN" ? "el equipo de la plataforma" : "la tienda", texto: clip(m.body, 200), leido: !!m.readAt, fecha: iso(m.createdAt) })),
    notificacionesSinLeer: unreadNotifications,
    ultimasNotificaciones: notifications.map((n) => ({ tipo: n.type, titulo: clip(n.title, 80), detalle: clip(n.body, 140), leida: !!n.readAt, fecha: iso(n.createdAt) })),
  };
}

export async function offersAndCodes(vendorId) {
  const now = new Date();
  const [offers, codes, storeOffers] = await Promise.all([
    prisma.offer.findMany({ where: { vendorId }, orderBy: { createdAt: "desc" }, take: 6, select: { title: true, status: true, startsAt: true, expiresAt: true, contentType: true } }),
    prisma.discountCode.findMany({ where: { vendorId }, orderBy: { createdAt: "desc" }, take: 8, select: { code: true, type: true, value: true, usesCount: true, maxUses: true, active: true, expiresAt: true } }),
    prisma.storeOffer.findMany({ where: { vendorId }, orderBy: { createdAt: "desc" }, take: 6, select: { title: true, active: true, isLimitedTime: true, expiresAt: true } }),
  ]);
  return {
    ofertasDelHome: offers.map((o) => ({ titulo: clip(o.title, 60), estado: o.status, tipo: o.contentType, desde: day(o.startsAt), vence: day(o.expiresAt) })),
    codigosDeDescuento: codes.map((c) => ({ codigo: c.code, tipo: c.type, valor: money(c.value), usos: `${c.usesCount}${c.maxUses ? ` de ${c.maxUses}` : ""}`, activo: c.active, vencido: !!c.expiresAt && new Date(c.expiresAt) < now, vence: day(c.expiresAt) })),
    ofertasDeLaTienda: storeOffers.map((o) => ({ titulo: clip(o.title, 60), activa: o.active, porTiempoLimitado: o.isLimitedTime, vence: day(o.expiresAt) })),
  };
}

export async function teamAndTables(vendorId) {
  const since = new Date(Date.now() - 30 * DAY_MS);
  const [tables, tableOrders, staff] = await Promise.all([
    prisma.table.count({ where: { vendorId } }),
    prisma.tableOrder.count({ where: { table: { vendorId }, createdAt: { gte: since }, cancelledAt: null } }),
    prisma.vendorStaff.findMany({ where: { vendorId }, select: { isActive: true, staffType: true, allowedSections: true, user: { select: { fullName: true, lastLoginAt: true } } }, take: 20 }),
  ]);
  return {
    mesas: tables,
    pedidosDeMesaUltimos30dias: tableOrders,
    personal: staff.map((s) => ({ nombre: clip(s.user?.fullName ?? "Sin nombre", 40), tipo: s.staffType ?? "sin tipo", activo: s.isActive, secciones: s.allowedSections?.length ?? 0, ultimoAcceso: iso(s.user?.lastLoginAt) })),
  };
}

export async function alerts(vendorId) {
  const [vendor, reports, anomalies, change, statusLogs] = await Promise.all([
    prisma.vendor.findUnique({ where: { id: vendorId }, select: { isBlocked: true, blockReason: true, status: true, suspensionReason: true, deletionRequestedAt: true } }),
    prisma.report.findMany({ where: { vendorId }, orderBy: { createdAt: "desc" }, take: 5, select: { status: true, message: true, createdAt: true, evidenceDueAt: true } }),
    prisma.rankingAnomaly.findMany({ where: { vendorId }, orderBy: { detectedAt: "desc" }, take: 5, select: { kind: true, status: true, details: true, detectedAt: true } }),
    prisma.vendorChangeRequest.findFirst({ where: { vendorId }, orderBy: { createdAt: "desc" }, select: { status: true, createdAt: true } }),
    prisma.vendorStatusLog.findMany({ where: { vendorId }, orderBy: { at: "desc" }, take: 5, select: { fromStatus: true, toStatus: true, reason: true, at: true } }),
  ]);
  return {
    estadoDeLaCuenta: { bloqueada: vendor?.isBlocked ?? false, motivoDelBloqueo: clip(vendor?.blockReason, 120) || null, estado: vendor?.status, motivoDeSuspension: clip(vendor?.suspensionReason, 120) || null, bajaSolicitada: !!vendor?.deletionRequestedAt },
    reportesDeFraudeRecibidos: reports.map((r) => ({ estado: r.status, fecha: day(r.createdAt), mensaje: clip(r.message, 140), plazoParaEvidencia: day(r.evidenceDueAt) })),
    anomaliasDelRankingDetectadas: anomalies.map((a) => ({ tipo: a.kind, estado: a.status, detalle: clip(a.details, 160), fecha: day(a.detectedAt) })),
    ultimaSolicitudDeCambioDeDatos: change ? { estado: change.status, fecha: day(change.createdAt) } : null,
    cambiosDeEstado: statusLogs.map((s) => ({ de: s.fromStatus, a: s.toStatus, motivo: clip(s.reason, 100), fecha: day(s.at) })),
  };
}

export async function customersAndChat(vendorId) {
  const since = new Date(Date.now() - 30 * DAY_MS);
  const [engagements, favorites, repeat, distinct, chatSessions, chatQuestions, chatTotal] = await Promise.all([
    prisma.vendorEngagement.groupBy({ by: ["type"], where: { vendorId, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.favorite.count({ where: { vendorId } }),
    prisma.order.groupBy({ by: ["customerId"], where: { vendorId, customerId: { not: null }, status: { not: "CANCELLED" } }, having: { customerId: { _count: { gt: 1 } } } }),
    prisma.order.groupBy({ by: ["customerId"], where: { vendorId, customerId: { not: null }, status: { not: "CANCELLED" } } }),
    prisma.chatMessage.groupBy({ by: ["sessionId"], where: { vendorId, createdAt: { gte: since } } }),
    prisma.chatMessage.findMany({ where: { vendorId, role: "user", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 8, select: { content: true } }),
    prisma.chatMessage.count({ where: { vendorId, role: "user", createdAt: { gte: since } } }),
  ]);
  const byType = Object.fromEntries(engagements.map((e) => [e.type, e._count._all]));
  return {
    ultimos30dias: { visitasDeClientesConSesion: byType.VISIT ?? 0, productosAgregadosAlCarrito: byType.CART_ADD ?? 0 },
    clientesQueGuardaronLaTiendaEnFavoritos: favorites,
    clientesRegistradosQueCompraron: distinct.length,
    clientesQueCompraronMasDeUnaVez: repeat.length,
    chatDeLaTienda: { conversacionesUltimos30dias: chatSessions.length, preguntasDeClientes: chatTotal, ultimasPreguntas: chatQuestions.map((q) => clip(q.content, 120)) },
  };
}

export async function storeProfile(vendorId) {
  const v = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: {
      companyName: true, logoUrl: true, description: true, color: true, whatsapp: true, email: true, businessCategoryId: true, categoryId: true, acceptedPaymentMethods: true, aiDocument: true,
      isRestaurant: true, menuPublic: true, isPrivate: true, orderDestination: true,
      _count: { select: { schedules: true, locations: true, products: true } },
    },
  });
  if (!v) return { error: "No se encontró la tienda." };
  const products = await prisma.product.findMany({ where: { vendorId, isActive: true }, select: { images: true, description: true, tags: true } });
  const missing = [];
  if (!v.logoUrl) missing.push("logo de la tienda");
  if (!v.description || v.description.trim().length < 60) missing.push("descripción de la tienda (menos de 60 caracteres)");
  if (v._count.schedules === 0) missing.push("horarios de atención");
  if (v._count.locations === 0) missing.push("ubicación de la tienda");
  if (v.acceptedPaymentMethods.length === 0) missing.push("métodos de pago aceptados");
  if (!v.businessCategoryId) missing.push("rubro del negocio");
  if (!v.aiDocument) missing.push("documento de conocimiento para el chat de la tienda");
  return {
    tienda: v.companyName,
    destinoDePedidos: v.orderDestination,
    esRestaurante: v.isRestaurant,
    menuPublico: v.menuPublic,
    tiendaPrivada: v.isPrivate,
    faltaCompletar: missing,
    productosActivos: products.length,
    productosConMenosDeTresFotos: products.filter((p) => (p.images?.length ?? 0) < 3).length,
    productosSinDescripcion: products.filter((p) => !p.description || p.description.trim().length === 0).length,
    productosSinEtiquetas: products.filter((p) => (p.tags?.length ?? 0) === 0).length,
    metodosDePagoAceptados: v.acceptedPaymentMethods,
  };
}

export async function ordersBreakdown(vendorId, since) {
  const [byStatus, byChannel, reasons, tableOrders] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], where: { vendorId, createdAt: { gte: since } }, _count: { _all: true }, _sum: { total: true } }),
    prisma.order.groupBy({ by: ["channel"], where: { vendorId, createdAt: { gte: since }, status: { not: "CANCELLED" } }, _count: { _all: true }, _sum: { total: true } }),
    prisma.order.groupBy({ by: ["cancelReason"], where: { vendorId, createdAt: { gte: since }, status: "CANCELLED", cancelReason: { not: null } }, _count: { _all: true }, orderBy: { _count: { cancelReason: "desc" } }, take: 5 }),
    prisma.tableOrder.count({ where: { table: { vendorId }, createdAt: { gte: since }, cancelledAt: null } }),
  ]);
  const total = byStatus.reduce((s, r) => s + r._count._all, 0);
  const cancelled = byStatus.find((r) => r.status === "CANCELLED")?._count._all ?? 0;
  const valid = byStatus.filter((r) => r.status !== "CANCELLED");
  const validCount = valid.reduce((s, r) => s + r._count._all, 0);
  const validSum = valid.reduce((s, r) => s + Number(r._sum.total ?? 0), 0);
  return {
    pedidosEnElPeriodo: total,
    porEstado: byStatus.map((r) => ({ estado: r.status, pedidos: r._count._all, total: money(r._sum.total) })),
    porCanal: byChannel.map((r) => ({ canal: r.channel, pedidos: r._count._all, total: money(r._sum.total) })),
    tasaDeCancelacionPorcentaje: total > 0 ? Math.round((cancelled / total) * 1000) / 10 : 0,
    ticketPromedio: validCount > 0 ? money(validSum / validCount) : 0,
    motivosDeCancelacion: reasons.map((r) => ({ motivo: clip(r.cancelReason, 80), veces: r._count._all })),
    pedidosDeMesa: tableOrders,
    umbralPocoStock: LOW_STOCK_THRESHOLD,
  };
}

// ---------------------------------------------------------------------------
// Clientes: potenciales y mejores compradores
// ---------------------------------------------------------------------------
// Bloque 262 (pedido: "¿cuál es el cliente más potencial?"): mismo criterio de
// "potencial" que el Dashboard (cliente con sesión que visitó o agregó al
// carrito en la ventana y NO compró en ella), más un ranking de compradores.
// Como en el Dashboard, el dueño ve el nombre y el teléfono de SUS clientes
// para contactarlos; el correo nunca se entrega.
export async function customersRanking(vendorId, days = 30) {
  const since = new Date(Date.now() - days * DAY_MS);
  const [engage, ordersRecent, ordersAll, favorites] = await Promise.all([
    prisma.vendorEngagement.groupBy({ by: ["customerId", "type"], where: { vendorId, createdAt: { gte: since } }, _count: { _all: true }, _max: { createdAt: true } }),
    prisma.order.groupBy({ by: ["customerId"], where: { vendorId, customerId: { not: null }, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["customerId"], where: { vendorId, customerId: { not: null }, status: { not: "CANCELLED" } }, _count: { _all: true }, _sum: { total: true }, _max: { createdAt: true } }),
    prisma.favorite.findMany({ where: { vendorId, userId: { not: "" } }, select: { userId: true } }),
  ]);
  const people = new Map();
  const get = (id) => {
    if (!people.has(id)) people.set(id, { id, visitas: 0, carritos: 0, pedidos: 0, gastado: 0, ultimoPedido: null, ultimaVisita: null, favorito: false });
    return people.get(id);
  };
  for (const e of engage) {
    const p = get(e.customerId);
    if (e.type === "VISIT") p.visitas += e._count._all;
    else p.carritos += e._count._all;
    if (e._max.createdAt && (!p.ultimaVisita || e._max.createdAt > p.ultimaVisita)) p.ultimaVisita = e._max.createdAt;
  }
  for (const o of ordersAll) {
    const p = get(o.customerId);
    p.pedidos = o._count._all;
    p.gastado = Number(o._sum.total ?? 0);
    p.ultimoPedido = o._max.createdAt;
  }
  for (const f of favorites) get(f.userId).favorito = true;
  const boughtRecently = new Set(ordersRecent.map((o) => o.customerId));
  const ids = [...people.keys()];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, phone: true } }) : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const rows = [...people.values()].map((p) => {
    const potencial = !boughtRecently.has(p.id) && (p.visitas > 0 || p.carritos > 0);
    return {
      ...p,
      nombre: clip(byId[p.id]?.fullName ?? "Cliente sin nombre", 40),
      telefono: byId[p.id]?.phone ?? null,
      potencial,
      puntaje: p.pedidos * 3 + p.carritos * 1.5 + p.visitas * 0.5 + (p.favorito ? 2 : 0),
    };
  });
  const view = (p) => ({
    nombre: p.nombre,
    telefono: p.telefono,
    pedidosEnTotal: p.pedidos,
    totalGastado: money(p.gastado),
    ultimoPedido: day(p.ultimoPedido),
    visitasEnLaVentana: p.visitas,
    agregoAlCarritoEnLaVentana: p.carritos,
    ultimaVisita: day(p.ultimaVisita),
    guardoTuTiendaEnFavoritos: p.favorito,
  });
  return {
    ventanaEnDias: days,
    criterio: "Potencial = cliente con sesión que visitó o agregó al carrito en la ventana y NO hizo un pedido en ella (mismo criterio del Dashboard). El puntaje suma 3 por pedido, 1.5 por agregado al carrito, 0.5 por visita y 2 si guardó la tienda en favoritos.",
    clientesPotenciales: rows.filter((r) => r.potencial).sort((a, b) => b.puntaje - a.puntaje).slice(0, 6).map(view),
    mejoresCompradores: rows.filter((r) => r.pedidos > 0).sort((a, b) => b.gastado - a.gastado).slice(0, 6).map(view),
    clientesConActividadEnTotal: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Un pedido al detalle (por código, o por número si es de mesa)
// ---------------------------------------------------------------------------
export async function orderDetail(vendorId, { codigo }) {
  const code = String(codigo).trim();
  const order = await prisma.order.findFirst({
    where: { vendorId, code: { contains: code, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    select: { code: true, status: true, channel: true, total: true, discountAmount: true, customerName: true, cancelReason: true, createdAt: true, shippingAddress: true, items: { select: { productId: true, name: true, quantity: true, price: true, size: true, currency: true } } },
  });
  if (order) {
    return {
      tipo: "pedido normal",
      codigo: order.code,
      estado: order.status,
      canal: order.channel,
      cliente: clip(order.customerName ?? "Cliente", 40),
      total: money(order.total),
      descuento: order.discountAmount != null ? money(order.discountAmount) : null,
      motivoDeCancelacion: clip(order.cancelReason, 100) || null,
      fecha: iso(order.createdAt),
      entregaEn: clip(order.shippingAddress, 100) || null,
      productos: order.items.map((i) => ({ id: i.productId, nombre: clip(i.name, 60), cantidad: i.quantity, precio: money(i.price), moneda: i.currency, talla: i.size })),
    };
  }
  const number = Number(code.replace(/\D/g, ""));
  if (number > 0) {
    const tableOrder = await prisma.tableOrder.findFirst({ where: { orderNumber: number, table: { vendorId } }, select: { orderNumber: true, total: true, kitchenStatus: true, customerName: true, createdAt: true, deliveredAt: true, cancelledAt: true, cancelReason: true, items: true, table: { select: { tableNumber: true } } } });
    if (tableOrder) {
      const items = Array.isArray(tableOrder.items) ? tableOrder.items : [];
      return {
        tipo: "pedido de mesa",
        numero: tableOrder.orderNumber,
        mesa: tableOrder.table.tableNumber,
        estadoDeCocina: tableOrder.kitchenStatus,
        cliente: clip(tableOrder.customerName ?? "Cliente", 40),
        total: money(tableOrder.total),
        fecha: iso(tableOrder.createdAt),
        entregadoEl: iso(tableOrder.deliveredAt),
        canceladoEl: iso(tableOrder.cancelledAt),
        motivoDeCancelacion: clip(tableOrder.cancelReason, 100) || null,
        productos: items.slice(0, 20).map((i) => ({ nombre: clip(i.name, 60), cantidad: i.quantity, precio: money(i.price) })),
      };
    }
  }
  return { error: "No encontré ningún pedido con ese código o número." };
}
