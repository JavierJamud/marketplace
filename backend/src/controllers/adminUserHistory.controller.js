import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { describeUserAgent } from "../lib/userAgent.js";

// Historial de una cuenta para el admin (también eliminadas): quién es (con su correo real si se eliminó), cómo y por qué se
// eliminó, y una línea de tiempo con lo que hizo: alta, accesos, pedidos, anuncios, reportes que hizo y que recibió, y sus
// acciones registradas. Sirve para valorar una eliminación o un reclamo sin entrar a la base de datos.

const SOURCE_LABEL = {
  CUSTOMER_REQUEST: "La pidió el propio cliente",
  ADMIN: "La eliminó un administrador",
  ADMIN_PENDING: "Venció la eliminación pendiente que puso un administrador",
  MODERATION: "Por reportes confirmados (moderación)",
};
const REPORT_STATUS = {
  PENDING: "pendiente",
  EVIDENCE_REQUESTED: "esperando pruebas",
  RESOLVED_NO_ACTION: "revisado, sin cambios",
  RESOLVED_SUSPENDED: "confirmado, se suspendió",
  DISMISSED: "descartado",
};
const ORDER_STATUS = { NEW: "pendiente", PREPARING: "en preparación", READY: "listo", DELIVERED: "entregado", CANCELLED: "cancelado" };
const MAX_EVENTS = 80;

export async function getUserHistory(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      lastLoginAt: true,
      isSuspended: true,
      fraudBlockedAt: true,
      deletionRequestedAt: true,
      deletedAt: true,
      deletedEmail: true,
      deletionSource: true,
      deletedById: true,
      deletionReason: true,
      vendor: { select: { companyName: true } },
    },
  });
  if (!user) throw new AppError("Cuenta no encontrada.", 404);

  const [deletedBy, sessions, orders, listings, reportsMade, reportsReceived, actions, blacklist] = await Promise.all([
    user.deletedById ? prisma.user.findUnique({ where: { id: user.deletedById }, select: { fullName: true } }) : null,
    prisma.session.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 15, select: { createdAt: true, userAgent: true } }),
    prisma.order.findMany({ where: { customerId: user.id }, orderBy: { createdAt: "desc" }, take: 20, select: { code: true, status: true, createdAt: true, vendor: { select: { companyName: true } } } }),
    prisma.customerListing.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" }, take: 20, select: { name: true, createdAt: true, isSold: true, suspendedAt: true } }),
    prisma.report.findMany({ where: { reporterId: user.id }, orderBy: { createdAt: "desc" }, take: 15, select: { createdAt: true, status: true, targetLabel: true } }),
    prisma.report.findMany({ where: { targetOwnerId: user.id }, orderBy: { createdAt: "desc" }, take: 15, select: { createdAt: true, status: true, targetLabel: true, message: true } }),
    prisma.activityLog.findMany({ where: { actorId: user.id }, orderBy: { createdAt: "desc" }, take: 20, select: { createdAt: true, description: true } }),
    prisma.blacklistEntry.findFirst({ where: { userId: user.id }, select: { createdAt: true, reason: true } }),
  ]);

  const events = [{ at: user.createdAt, kind: "account", text: "Creó la cuenta" }];
  for (const s of sessions) {
    // Los accesos anteriores al registro del navegador no traen datos: solo "Inició sesión".
    const ua = s.userAgent ? describeUserAgent(s.userAgent) : null;
    events.push({ at: s.createdAt, kind: "login", text: ua ? `Inició sesión · ${ua.browser} en ${ua.os}` : "Inició sesión" });
  }
  for (const o of orders) events.push({ at: o.createdAt, kind: "order", text: `Hizo el pedido ${o.code} en ${o.vendor?.companyName ?? "una tienda"} (${ORDER_STATUS[o.status] ?? o.status})` });
  for (const l of listings) {
    events.push({ at: l.createdAt, kind: "listing", text: `Publicó el anuncio "${l.name}"${l.isSold ? " (luego marcado vendido)" : ""}` });
    if (l.suspendedAt) events.push({ at: l.suspendedAt, kind: "warning", text: `Le suspendieron el anuncio "${l.name}" por un reporte` });
  }
  for (const r of reportsMade) events.push({ at: r.createdAt, kind: "report", text: `Reportó "${r.targetLabel ?? "un anuncio"}" (${REPORT_STATUS[r.status] ?? r.status})` });
  for (const r of reportsReceived) events.push({ at: r.createdAt, kind: "warning", text: `Recibió un reporte sobre "${r.targetLabel ?? "su anuncio"}" (${REPORT_STATUS[r.status] ?? r.status})`, detail: r.message?.slice(0, 200) });
  // Los pedidos ya salen arriba con su número y estado; no se repiten desde el registro de acciones.
  for (const a of actions) if (!/^Hizo un pedido/i.test(a.description)) events.push({ at: a.createdAt, kind: "action", text: a.description });
  if (user.fraudBlockedAt) events.push({ at: user.fraudBlockedAt, kind: "warning", text: "Cuenta bloqueada por avisos acumulados" });
  if (user.deletionRequestedAt) events.push({ at: user.deletionRequestedAt, kind: "delete", text: "Pidió eliminar su cuenta" });
  if (blacklist) events.push({ at: blacklist.createdAt, kind: "delete", text: "Entró en la lista negra", detail: blacklist.reason });
  if (user.deletedAt) events.push({ at: user.deletedAt, kind: "delete", text: "Cuenta eliminada", detail: [SOURCE_LABEL[user.deletionSource], user.deletionReason].filter(Boolean).join(" · ") || null });
  events.sort((a, b) => new Date(b.at) - new Date(a.at));

  const isDeleted = !!user.deletedAt;
  res.json({
    user: {
      id: user.id,
      fullName: user.fullName,
      role: user.role,
      storeName: user.vendor?.companyName ?? null,
      // Correo real: el de la cuenta, o el guardado al eliminarla (null si se eliminó antes de guardarlo y no se pudo recuperar).
      email: isDeleted ? user.deletedEmail : user.email,
      phone: user.phone,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      isSuspended: user.isSuspended && !isDeleted,
      deletedAt: user.deletedAt,
      deletionRequestedAt: user.deletionRequestedAt,
      deletion: isDeleted
        ? { source: SOURCE_LABEL[user.deletionSource] ?? "No quedó registrado cómo se eliminó", by: deletedBy?.fullName ?? null, reason: user.deletionReason }
        : null,
    },
    events: events.slice(0, MAX_EVENTS),
  });
}
