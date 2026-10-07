import { prisma } from "./prisma.js";
import { DAY_MS, clip, money } from "./assistantData.js";

// Bloque 276 (pedido explícito — "el asistente debe poder decir cuántas tiendas están suspendidas,
// quién es Pedro Sosa, qué tiendas tienen agentes de ventas, y ver los clientes, sus compras y
// lo que miran"): herramientas de SOLO LECTURA sobre personas, estados de tiendas y clientes.
// Cada una devuelve nombres legibles (nunca ids en los textos) y, cuando aplica, el enlace
// exacto al lugar del panel donde ver el detalle.
//
// Alcance: las funciones `*Admin*` leen toda la plataforma; las de vendedor reciben el
// vendorId que sale de la sesión (nunca de un argumento) y solo ven a SUS clientes.

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const ROLE_LABEL = { CUSTOMER: "cliente", VENDOR: "dueño de tienda", ADMIN: "administrador", VENDOR_STAFF: "usuario de sistema de una tienda" };
const STAFF_LABEL = { SALES_AGENT: "agente de ventas", WAITER: "mesero" };

// Enlace a una pantalla del panel con una búsqueda ya puesta (ver validateLinks).
const linkWithSearch = (path, q) => `${path}?q=${encodeURIComponent(String(q).slice(0, 60))}`;

// Una tienda puede estar "sin operar" por cuatro motivos distintos y el panel los muestra en
// pantallas distintas: suscripción suspendida (verificationStatus), suspendida por inactividad,
// bloqueada por el admin y eliminación pendiente. Quien pregunta por "tiendas suspendidas" espera
// ver TODAS juntas con su motivo, así que esta herramienta las lista todas y las clasifica.
export async function storesByState() {
  const live = { deletedAt: null };
  const [all, notOperating] = await Promise.all([
    prisma.vendor.count({ where: live }),
    prisma.vendor.findMany({
      where: { ...live, OR: [{ verificationStatus: "SUSPENDED" }, { status: "SUSPENDED" }, { isBlocked: true }, { adminDeletionRequestedAt: { not: null } }] },
      orderBy: { createdAt: "asc" },
      select: { companyName: true, planType: true, verificationStatus: true, status: true, suspendedAt: true, suspensionReason: true, isBlocked: true, blockedAt: true, blockReason: true, adminDeletionRequestedAt: true },
    }),
  ]);
  const rows = notOperating.map((v) => {
    const motivos = [];
    if (v.adminDeletionRequestedAt) motivos.push("eliminación pendiente");
    else if (v.isBlocked) motivos.push("bloqueada por el administrador");
    if (v.status === "SUSPENDED") motivos.push("suspendida por inactividad");
    if (v.verificationStatus === "SUSPENDED") motivos.push("suscripción suspendida");
    const since = v.adminDeletionRequestedAt ?? (v.isBlocked ? v.blockedAt : null) ?? v.suspendedAt;
    return { tienda: clip(v.companyName, 50), estado: motivos.join(" y "), desde: day(since), motivo: clip(v.blockReason ?? v.suspensionReason, 100) || null, plan: v.planType };
  });
  const count = (label) => rows.filter((r) => r.estado.includes(label)).length;
  return {
    totalDeTiendas: all,
    tiendasSinOperar: rows.length,
    desglose: {
      suscripcionSuspendida: count("suscripción suspendida"),
      suspendidasPorInactividad: count("inactividad"),
      bloqueadasPorElAdmin: count("bloqueada"),
      enEliminacionPendiente: count("eliminación pendiente"),
    },
    tiendas: rows,
    nota: "Cuenta TODAS las tiendas que no operan con normalidad, sea cual sea el motivo. Di el total y el desglose, y lista cada tienda en la tabla con su estado.",
  };
}

// Busca a una persona por nombre, correo o teléfono y la describe con TODO su perfil: rol,
// contacto, ubicación, tiendas que tiene o donde trabaja, y su actividad.
export async function findPerson(search) {
  const q = String(search).trim();
  const digits = q.replace(/\D/g, "");
  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 6 ? [{ phone: { contains: digits } }] : []),
        // Dueño o contacto de una tienda con ese nombre.
        { vendor: { is: { ownerName: { contains: q, mode: "insensitive" } } } },
      ],
    },
    take: 5,
    orderBy: { lastLoginAt: "desc" },
    select: {
      id: true, fullName: true, email: true, phone: true, address: true, role: true, createdAt: true, lastLoginAt: true, isSuspended: true, totpEnabledAt: true,
      province: { select: { name: true } }, municipality: { select: { name: true } },
      vendor: { select: { id: true, companyName: true, ownerName: true, whatsapp: true, email: true, companyAddress: true, planType: true, verificationStatus: true, status: true, isBlocked: true, currency: true, createdAt: true, rating: true } },
      vendorStaffProfile: { select: { staffType: true, isActive: true, vendor: { select: { companyName: true } } } },
    },
  });
  if (users.length === 0) return { error: "No encontré a ninguna persona con ese nombre, correo o teléfono." };

  const since = new Date(Date.now() - 90 * DAY_MS);
  const people = await Promise.all(
    users.map(async (u) => {
      const [orders, listings, visits] = await Promise.all([
        prisma.order.aggregate({ where: { customerId: u.id, status: { not: "CANCELLED" } }, _count: { _all: true }, _sum: { total: true } }),
        prisma.customerListing.count({ where: { ownerId: u.id } }),
        prisma.vendorEngagement.count({ where: { customerId: u.id, createdAt: { gte: since } } }),
      ]);
      const v = u.vendor;
      const out = {
        nombre: u.fullName,
        rol: ROLE_LABEL[u.role] ?? u.role,
        correo: u.email,
        telefono: u.phone ?? null,
        direccion: u.address ?? null,
        ubicacion: [u.municipality?.name, u.province?.name].filter(Boolean).join(", ") || null,
        registradoEl: day(u.createdAt),
        ultimoAcceso: day(u.lastLoginAt),
        cuentaSuspendida: u.isSuspended,
        verificacionEnDosPasosConApp: !!u.totpEnabledAt,
        comprasComoCliente: { pedidos: orders._count._all, total: money(orders._sum.total) },
        anunciosDeVentaRapida: listings,
        interaccionesConTiendasUltimos90dias: visits,
      };
      if (v) {
        out.tiendaPropia = {
          nombre: v.companyName,
          responsable: v.ownerName,
          whatsapp: v.whatsapp,
          correoDeLaTienda: v.email,
          direccion: v.companyAddress,
          plan: v.planType,
          verificacion: v.verificationStatus,
          estado: v.isBlocked ? "bloqueada" : v.status === "SUSPENDED" ? "suspendida" : "activa",
          moneda: v.currency,
          valoracion: Number(v.rating),
          creadaEl: day(v.createdAt),
        };
        out.enlaces = {
          perfilArchivadoDeVerificacion: `/admin/verificaciones?archivo=${v.id}`,
          tiendaEnElPanel: linkWithSearch("/admin/tiendas", v.companyName),
        };
      }
      if (u.vendorStaffProfile) out.trabajaEn = { tienda: u.vendorStaffProfile.vendor?.companyName, cargo: STAFF_LABEL[u.vendorStaffProfile.staffType] ?? "usuario de sistema", activo: u.vendorStaffProfile.isActive };
      return out;
    })
  );
  return { coincidencias: people.length, personas: people };
}

// Usuarios de sistema (agentes de ventas y meseros). `vendorId` null = toda la plataforma.
export async function salesAgents({ vendorId = null, tipo = "agentes" } = {}) {
  const since = new Date(Date.now() - 30 * DAY_MS);
  // Un "agente de ventas" es quien tiene ese cargo, quien recibió la sección "Agentes de Ventas" del
  // panel o quien ya registró ventas manuales (aunque el dueño no le haya puesto un cargo).
  const sellers = await prisma.vendorStaffSale.groupBy({ by: ["vendorStaffId"], where: vendorId ? { vendorId } : {} });
  const isAgent = { OR: [{ staffType: "SALES_AGENT" }, { allowedSections: { has: "ventas-manuales" } }, { id: { in: sellers.map((x) => x.vendorStaffId) } }] };
  const where = { ...(vendorId ? { vendorId } : {}), ...(tipo === "agentes" ? isAgent : tipo === "meseros" ? { staffType: "WAITER" } : {}) };
  const staff = await prisma.vendorStaff.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { id: true, staffType: true, isActive: true, receivesOrderNotifications: true, phone: true, createdAt: true, allowedSections: true, user: { select: { fullName: true, lastLoginAt: true } }, vendor: { select: { companyName: true } } },
  });
  const sales = await prisma.vendorStaffSale.groupBy({ by: ["vendorStaffId"], where: { vendorStaffId: { in: staff.map((s) => s.id) }, createdAt: { gte: since } }, _sum: { total: true }, _count: { _all: true } });
  const byStaff = Object.fromEntries(sales.map((s) => [s.vendorStaffId, s]));
  const rows = staff.map((s) => ({
    tienda: clip(s.vendor?.companyName, 50),
    nombre: clip(s.user?.fullName, 40),
    cargo: STAFF_LABEL[s.staffType] ?? (s.allowedSections?.includes("ventas-manuales") || byStaff[s.id] ? "agente de ventas (sin cargo fijado)" : "sin cargo"),
    activo: s.isActive,
    ultimoAcceso: day(s.user?.lastLoginAt),
    ventasManualesUltimos30dias: byStaff[s.id] ? { ventas: byStaff[s.id]._count._all, total: money(byStaff[s.id]._sum.total) } : { ventas: 0, total: 0 },
  }));
  const stores = new Map();
  for (const r of rows) stores.set(r.tienda, (stores.get(r.tienda) ?? 0) + 1);
  return {
    totalDePersonas: rows.length,
    tiendasConAlMenosUna: [...stores.entries()].map(([tienda, personas]) => ({ tienda, personas })),
    personas: rows.slice(0, 25),
    nota: rows.length === 0 ? "Ninguna tienda tiene registrado ese tipo de usuario de sistema." : undefined,
  };
}

// Anuncios de venta rápida (los publican los clientes, no las tiendas): solo el admin.
export async function quickSales() {
  const now = new Date();
  const [active, publicNow, sold, expired, inactive, recent, reported, owners] = await Promise.all([
    prisma.customerListing.count({ where: { isActive: true, expiresAt: { gt: now } } }),
    prisma.customerListing.count({ where: { isActive: true, isSold: false, publicVisibleUntil: { gt: now } } }),
    prisma.customerListing.count({ where: { isSold: true } }),
    prisma.customerListing.count({ where: { expiresAt: { lte: now } } }),
    prisma.customerListing.count({ where: { isActive: false } }),
    prisma.customerListing.findMany({ orderBy: { createdAt: "desc" }, take: 8, select: { name: true, price: true, currency: true, isActive: true, isSold: true, createdAt: true, publicVisibleUntil: true, owner: { select: { fullName: true } } } }),
    prisma.report.count({ where: { customerListingId: { not: null }, status: { in: ["PENDING", "EVIDENCE_REQUESTED"] } } }),
    prisma.customerListing.groupBy({ by: ["ownerId"], where: { isActive: true, expiresAt: { gt: now } } }).then((r) => r.length),
  ]);
  return {
    anunciosActivos: active,
    visiblesAlPublicoAhora: publicNow,
    marcadosComoVendidos: sold,
    vencidos: expired,
    sinActivar: inactive,
    personasConAnunciosActivos: owners,
    reportesPendientesSobreAnuncios: reported,
    ultimosAnuncios: recent.map((l) => ({ anuncio: clip(l.name, 50), publicadoPor: clip(l.owner?.fullName, 40), precio: `${money(l.price)} ${l.currency}`, estado: l.isSold ? "vendido" : l.isActive ? "activo" : "sin activar", publicadoEl: day(l.createdAt), visibleHasta: day(l.publicVisibleUntil) })),
  };
}

// Un cliente concreto y TODO lo que hace: compras, productos que más compra, lo que mira y
// agrega al carrito, favoritos, pedidos de productos y reseñas. `vendorId` null (admin) = en
// toda la plataforma; con vendorId (vendedor) solo cuenta lo que ocurrió en SU tienda.
export async function customerDetail({ vendorId = null, search }) {
  const q = String(search).trim();
  const customers = await prisma.user.findMany({ where: { role: "CUSTOMER", deletedAt: null, fullName: { contains: q, mode: "insensitive" }, ...(vendorId ? { orders: { some: { vendorId } } } : {}) }, take: 3, select: { id: true, fullName: true, createdAt: true, lastLoginAt: true, ...(vendorId ? {} : { email: true, phone: true }) } });
  // Un vendedor también ve a quien solo visitó o guardó su tienda, no solo a quien compró.
  const extra = vendorId && customers.length === 0
    ? await prisma.user.findMany({ where: { role: "CUSTOMER", deletedAt: null, fullName: { contains: q, mode: "insensitive" }, OR: [{ vendorEngagements: { some: { vendorId } } }, { favorites: { some: { OR: [{ vendorId }, { product: { vendorId } }] } } }] }, take: 3, select: { id: true, fullName: true, createdAt: true, lastLoginAt: true } })
    : [];
  const found = [...customers, ...extra];
  if (found.length === 0) return { error: vendorId ? "No encontré a ningún cliente con ese nombre que haya comprado o visitado tu tienda." : "No encontré a ningún cliente con ese nombre." };

  const since = new Date(Date.now() - 90 * DAY_MS);
  const vendorFilter = vendorId ? { vendorId } : {};
  return {
    clientes: await Promise.all(
      found.map(async (c) => {
        const [orders, items, engagement, favs, requests, reviews] = await Promise.all([
          prisma.order.findMany({ where: { customerId: c.id, status: { not: "CANCELLED" }, ...vendorFilter }, orderBy: { createdAt: "desc" }, take: 6, select: { code: true, total: true, status: true, createdAt: true, vendor: { select: { companyName: true, currency: true } } } }),
          prisma.orderItem.groupBy({ by: ["name"], where: { order: { customerId: c.id, status: { not: "CANCELLED" }, ...vendorFilter } }, _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: 5 }),
          prisma.vendorEngagement.groupBy({ by: ["type"], where: { customerId: c.id, createdAt: { gte: since }, ...vendorFilter }, _count: { _all: true } }),
          prisma.favorite.count({ where: { userId: c.id, ...(vendorId ? { OR: [{ vendorId }, { product: { vendorId } }] } : {}) } }),
          prisma.productRequest.count({ where: { customerId: c.id, ...vendorFilter } }),
          prisma.review.count({ where: { userId: c.id, ...(vendorId ? { OR: [{ vendorId }, { product: { vendorId } }] } : {}) } }),
        ]);
        const totals = await prisma.order.aggregate({ where: { customerId: c.id, status: { not: "CANCELLED" }, ...vendorFilter }, _count: { _all: true }, _sum: { total: true } });
        const eng = Object.fromEntries(engagement.map((e) => [e.type, e._count._all]));
        return {
          nombre: c.fullName,
          ...(c.email ? { correo: c.email, telefono: c.phone ?? null } : {}),
          registradoEl: day(c.createdAt),
          ultimoAcceso: day(c.lastLoginAt),
          compras: { pedidos: totals._count._all, total: money(totals._sum.total) },
          ultimosPedidos: orders.map((o) => ({ tienda: clip(o.vendor?.companyName, 40), total: `${money(o.total)} ${o.vendor?.currency ?? ""}`.trim(), estado: o.status, fecha: day(o.createdAt) })),
          productosQueMasCompra: items.map((i) => ({ producto: clip(i.name, 50), unidades: i._sum.quantity ?? 0 })),
          queHaceEnLaTiendaUltimos90dias: { visitasConSesion: eng.VISIT ?? 0, productosAgregadosAlCarrito: eng.CART_ADD ?? 0 },
          favoritos: favs,
          productosPedidosALaTienda: requests,
          resenasEscritas: reviews,
        };
      })
    ),
  };
}

// Bloque 277 (pedido explícito — "que el chat de asistencia del administrador pueda consultar los
// datos del responsable de la tienda"): resumen de la ficha completa del responsable (la misma que
// ve el admin en Tiendas). Solo ámbito admin. Las fotos no se leen: se ven con el enlace.
export async function representativeSummary(search) {
  const { getRepresentativeFile } = await import("../services/representativeFile.service.js");
  const vendors = await prisma.vendor.findMany({
    where: { deletedAt: null, OR: [{ companyName: { contains: search, mode: "insensitive" } }, { slug: { contains: search, mode: "insensitive" } }, { ownerName: { contains: search, mode: "insensitive" } }, { user: { fullName: { contains: search, mode: "insensitive" } } }] },
    select: { id: true, companyName: true },
    take: 3,
  });
  if (vendors.length === 0) return { error: "No encontré ninguna tienda o responsable con ese nombre." };
  const file = await getRepresentativeFile(vendors[0].id);
  const a = file.archives.find((x) => x.id === file.currentArchiveId) ?? file.archives[0] ?? null;
  const v = file.vendor;
  return {
    tienda: v.companyName,
    otrasCoincidencias: vendors.slice(1).map((x) => x.companyName),
    responsable: a
      ? {
          nombreCompleto: a.fullName ?? a.ownerName,
          responsableDeLaTienda: a.ownerName,
          tipoDeDocumento: a.idDocumentType,
          numeroDeDocumento: a.idNumber,
          idDelPropietario: a.ownerIdNumber,
          idFiscalDeLaEmpresa: a.companyTaxId,
          direccionDeLaEmpresa: a.companyAddress,
          pais: a.registrationCountryName,
          provincia: a.legalProvinceName,
          municipio: a.legalMunicipalityName,
          enviadoEl: day(a.submittedAt),
          revisadoEl: day(a.reviewedAt),
          revisadoPor: a.reviewedBy?.fullName ?? null,
          verificadoEl: day(a.verifiedAt),
          rechazadoEl: day(a.rejectedAt),
          fotosSubidas: { fotoDelResponsable: !!a.selfieUrl, documentoFrente: !!a.idPhotoFrontUrl, documentoReverso: !!a.idPhotoBackUrl, videoDeVida: !!a.selfieVideoUrl },
          notasDelArchivo: clip(a.notes, 300) || null,
        }
      : { aviso: "Esta tienda todavía no envió documentos de verificación." },
    cuentaDelDueno: { nombre: v.user?.fullName, correo: v.user?.email, telefono: v.user?.phone, ultimoAcceso: day(v.user?.lastLoginAt), cuentaCreadaEl: day(v.user?.createdAt) },
    estadoDeLaTienda: { plan: v.planType, verificacion: v.verificationStatus, estado: v.isBlocked ? "bloqueada" : v.status === "SUSPENDED" ? "suspendida" : "activa", motivoDeBloqueo: clip(v.blockReason, 160) || null, motivoDeSuspension: clip(v.suspensionReason, 160) || null, enEliminacionDesde: day(v.adminDeletionRequestedAt) },
    notasDeLaRevision: clip(file.requestNotes, 300) || null,
    incumplimientosYReportes: { total: file.reports.length, ultimos: file.reports.slice(0, 5).map((r) => ({ fecha: day(r.createdAt), estado: r.status, motivo: clip(r.message, 140), resolucion: clip(r.resolutionNote, 140) || null })) },
    historialDeEstados: file.statusLog.slice(0, 5).map((s) => ({ fecha: day(s.at), de: s.fromStatus, a: s.toStatus, motivo: clip(s.reason, 120) || null })),
    historialDeVerificacion: file.verificationLog.slice(0, 6).map((s) => ({ fecha: day(s.at), de: s.fromStatus, a: s.toStatus, motivo: clip(s.reason, 120) || null })),
    solicitudesDeCambioDeDatos: file.changeRequests.slice(0, 4).map((c) => ({ fecha: day(c.createdAt), estado: c.status, motivo: clip(c.reason, 120), notaDelAdmin: clip(c.adminNotes, 120) || null })),
    enlaces: { fichaCompletaConFotos: `/admin/tiendas?responsable=${v.id}`, archivoDeVerificacion: `/admin/verificaciones?archivo=${v.id}` },
  };
}
