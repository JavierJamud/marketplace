import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { describeContext, LIFECYCLE_ACTIONS } from "../lib/vendorLifecycle.js";
import { describeUserAgent } from "../lib/userAgent.js";

// Tiendas > Eliminadas: las tiendas eliminadas (y las que tienen la eliminación pendiente) quedaban fuera de todas las
// listas del admin y no había forma de saber qué pasó con ellas (pedido del dueño). Las filas nunca se borran de verdad
// (lib/accountDeletion.js), así que todo su historial sigue en la base: aquí se junta para el admin.

const listSchema = z.object({
  status: z.enum(["deleted", "pending", "all"]).default("all"),
  q: z.string().trim().max(80).optional(),
});

const SOURCE_LABEL = {
  CUSTOMER_REQUEST: "La pidió su dueño",
  ADMIN: "La eliminó un administrador",
  ADMIN_PENDING: "Venció la eliminación pendiente",
  MODERATION: "Moderación (reportes confirmados)",
};

// GET /admin/deleted-vendors?status=deleted|pending|all&q=
export async function listDeletedVendors(req, res) {
  const { status, q } = listSchema.parse(req.query);
  const scope =
    status === "deleted"
      ? { deletedAt: { not: null } }
      : status === "pending"
        ? { deletedAt: null, OR: [{ deletionRequestedAt: { not: null } }, { adminDeletionRequestedAt: { not: null } }] }
        : { OR: [{ deletedAt: { not: null } }, { deletionRequestedAt: { not: null } }, { adminDeletionRequestedAt: { not: null } }] };
  const search = q
    ? { OR: [{ companyName: { contains: q, mode: "insensitive" } }, { user: { fullName: { contains: q, mode: "insensitive" } } }, { user: { deletedEmail: { contains: q, mode: "insensitive" } } }, { user: { email: { contains: q, mode: "insensitive" } } }] }
    : {};
  const vendors = await prisma.vendor.findMany({
    where: { AND: [scope, search] },
    orderBy: [{ deletedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true, companyName: true, slug: true, color: true, createdAt: true, deletedAt: true, deletionRequestedAt: true, adminDeletionRequestedAt: true,
      planType: true,
      user: { select: { fullName: true, email: true, deletedEmail: true, deletionSource: true, deletionReason: true } },
      _count: { select: { products: true, orders: true } },
    },
  });
  // El enlace original (antes de soltarlo al eliminar) y el motivo están en la foto que guardó la eliminación.
  const deletedEvents = await prisma.activityLog.findMany({
    where: { vendorId: { in: vendors.map((v) => v.id) }, action: LIFECYCLE_ACTIONS.deleted },
    select: { vendorId: true, meta: true },
  });
  const snapById = new Map(deletedEvents.map((e) => [e.vendorId, e.meta?.snapshot ?? null]));
  res.json({
    vendors: vendors.map((v) => ({
      id: v.id,
      companyName: snapById.get(v.id)?.companyName ?? v.companyName,
      slug: snapById.get(v.id)?.slug ?? v.slug,
      color: v.color,
      ownerName: v.user?.fullName ?? null,
      ownerEmail: v.user?.deletedEmail ?? (v.user?.email?.endsWith("@zeudin.invalid") ? null : v.user?.email) ?? null,
      createdAt: v.createdAt,
      deletedAt: v.deletedAt,
      pendingSince: v.deletedAt ? null : v.deletionRequestedAt ?? v.adminDeletionRequestedAt,
      status: v.deletedAt ? "deleted" : "pending",
      source: v.user?.deletionSource ?? null,
      sourceLabel: SOURCE_LABEL[v.user?.deletionSource] ?? (v.deletedAt ? "Sin dato (eliminada antes de este registro)" : null),
      reason: v.user?.deletionReason ?? null,
      products: v._count.products,
      orders: v._count.orders,
    })),
  });
}

// GET /admin/deleted-vendors/:id: ficha con creación, eliminación y toda la historia de la tienda.
export async function getDeletedVendor(req, res) {
  res.json(await buildVendorHistory(req.params.id, { onlyDeleted: true }));
}

// GET /admin/vendors/:id/history: la misma historia para cualquier tienda (pestaña Historial de Gestionar tienda).
export async function getVendorHistory(req, res) {
  res.json(await buildVendorHistory(req.params.id, { onlyDeleted: false }));
}

async function buildVendorHistory(rawId, { onlyDeleted }) {
  const id = z.string().min(1).max(40).parse(rawId);
  const v = await prisma.vendor.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, email: true, deletedEmail: true, phone: true, createdAt: true, lastLoginAt: true, deletedAt: true, deletionSource: true, deletionReason: true, deletedById: true } },
      locations: { include: { province: { select: { name: true } }, municipality: { select: { name: true } }, country: { select: { name: true } } } },
      _count: { select: { products: true, orders: true } },
    },
  });
  if (!v) throw new AppError("Tienda no encontrada.", 404);
  if (onlyDeleted && !v.deletedAt && !v.deletionRequestedAt && !v.adminDeletionRequestedAt) {
    throw new AppError("Esta tienda no está eliminada. Ábrela desde Tiendas.", 409);
  }

  const [activity, planChanges, statusLogs, sessions, deletedBy] = await Promise.all([
    prisma.activityLog.findMany({
      where: { vendorId: id },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, action: true, description: true, actorRole: true, createdAt: true, meta: true, actor: { select: { fullName: true, role: true } } },
    }),
    prisma.vendorPlanChange.findMany({ where: { vendorId: id }, orderBy: { createdAt: "desc" }, select: { id: true, fromPlan: true, toPlan: true, reason: true, createdAt: true } }),
    prisma.verificationStatusLog.findMany({ where: { vendorId: id }, orderBy: { at: "desc" }, select: { id: true, fromStatus: true, toStatus: true, reason: true, source: true, at: true } }),
    // Dispositivos con los que el dueño entró (las sesiones quedan aunque se cierren).
    v.user ? prisma.session.findMany({ where: { userId: v.user.id }, orderBy: { createdAt: "desc" }, take: 30, select: { userAgent: true, createdAt: true, lastUsedAt: true } }) : [],
    v.user?.deletedById ? prisma.user.findUnique({ where: { id: v.user.deletedById }, select: { fullName: true, email: true } }) : null,
  ]);

  const created = activity.find((a) => a.action === LIFECYCLE_ACTIONS.created) ?? null;
  const deleted = activity.find((a) => a.action === LIFECYCLE_ACTIONS.deleted) ?? null;
  const snapshot = deleted?.meta?.snapshot ?? null;
  const withContext = (a) => (a ? { ...a, context: describeContext(a.meta?.request) } : null);

  // Una sola línea de tiempo con todo lo que pasó en la tienda, de lo más nuevo a lo más viejo.
  const timeline = [
    ...activity.map((a) => ({ id: `a-${a.id}`, at: a.createdAt, kind: "activity", action: a.action, text: a.description, who: a.actor?.fullName ?? null, whoRole: a.actorRole, context: describeContext(a.meta?.request) })),
    ...planChanges.map((p) => ({ id: `p-${p.id}`, at: p.createdAt, kind: "plan", text: `Plan: ${p.fromPlan ?? "sin plan"} → ${p.toPlan} (${p.reason})` })),
    ...statusLogs.map((s) => ({ id: `s-${s.id}`, at: s.at, kind: "verification", text: `Verificación: ${s.fromStatus} → ${s.toStatus}${s.reason ? `. ${s.reason}` : ""}` })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  return {
    vendor: {
      id: v.id,
      companyName: snapshot?.companyName ?? v.companyName,
      slug: snapshot?.slug ?? v.slug,
      color: v.color,
      whatsapp: snapshot?.whatsapp ?? v.whatsapp,
      email: snapshot?.email ?? v.email,
      ownerName: snapshot?.ownerName ?? v.ownerName,
      ownerIdNumber: snapshot?.ownerIdNumber ?? v.ownerIdNumber,
      companyAddress: snapshot?.companyAddress ?? v.companyAddress,
      planType: v.planType,
      verificationStatus: v.verificationStatus,
      currency: v.currency,
      createdAt: v.createdAt,
      deletedAt: v.deletedAt,
      deletionRequestedAt: v.deletionRequestedAt ?? v.adminDeletionRequestedAt,
      locations: v.locations.map((l) => [l.municipality?.name ?? l.municipalityOther, l.province?.name ?? l.stateOther, l.country?.name ?? l.countryOther].filter(Boolean).join(", ")),
      products: v._count.products,
      orders: v._count.orders,
    },
    owner: v.user
      ? {
          fullName: v.user.fullName,
          email: v.user.deletedEmail ?? (v.user.email.endsWith("@zeudin.invalid") ? null : v.user.email),
          phone: v.user.phone,
          registeredAt: v.user.createdAt,
          lastLoginAt: v.user.lastLoginAt,
        }
      : null,
    deletion: {
      source: v.user?.deletionSource ?? null,
      sourceLabel: SOURCE_LABEL[v.user?.deletionSource] ?? null,
      reason: v.user?.deletionReason ?? null,
      by: deletedBy?.fullName ?? deletedBy?.email ?? null,
    },
    created: withContext(created),
    devices: sessions.map((s) => ({ ...describeUserAgent(s.userAgent ?? ""), userAgent: s.userAgent, firstSeen: s.createdAt, lastSeen: s.lastUsedAt })),
    timeline,
  };
}
