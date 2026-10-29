import { logVendorLifecycle, LIFECYCLE_ACTIONS, vendorSnapshot } from "./vendorLifecycle.js";
import { prisma } from "./prisma.js";
import { releaseVendorSlugData } from "./vendorSlug.js";

// Bloque 211: un solo lugar para el estado final de "cuenta eliminada" —
// reusado por el borrado instantáneo que dispara un admin
// (admin.controller.js: deleteCustomer/deleteVendor) Y por el cron de
// auto-eliminación a los 30 días (jobs/accountDeletion.job.js), para que
// los dos caminos terminen exactamente en el mismo estado sin duplicar la
// lógica. La fila de User NUNCA se borra de verdad: Vendor.userId es
// onDelete:Cascade y no-nullable (borrar la fila del dueño borraría en
// cascada toda la tienda, sus productos y sus pedidos) — en cambio
// Order.customerId/Review.userId son SetNull, pero se mantiene el mismo
// criterio de anonimizado en los 3 roles por consistencia. El email se
// reescribe para liberar la columna @unique para un futuro registro nuevo.
// `record`: cómo se eliminó, para el admin. source: CUSTOMER_REQUEST (lo pidió el cliente), ADMIN (un admin, al momento),
// ADMIN_PENDING (eliminación pendiente de una tienda que venció), MODERATION (reportes confirmados), ADMIN_MERGE (unida con
// la cuenta de su tienda, lib/accountMerge.js). byId: el admin, si hubo.
export async function finalizeUserDeletion(userId, record = {}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { vendor: true, vendorStaffProfile: true },
  });
  if (!user) return;

  const now = new Date();
  const anonymizedEmail = `deleted+${user.id}@zeudin.invalid`;
  // Foto de la tienda ANTES de soltar su enlace y anonimizar la cuenta: es lo que el admin ve después en Tiendas > Eliminadas.
  const snapshot = user.vendor ? await vendorSnapshot(user.vendor.id) : null;
  // El personal de la tienda eliminada también pierde el acceso al momento: antes seguía activo y con sesión, leyendo
  // pedidos y clientes de una tienda que ya no existe (auditoría run-2).
  const staffUserIds = user.vendor
    ? (await prisma.vendorStaff.findMany({ where: { vendorId: user.vendor.id }, select: { userId: true } })).map((s) => s.userId)
    : [];

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      // El correo real queda en deletedEmail, visible solo para el admin (decisión del dueño de la plataforma).
      data: {
        deletedAt: now,
        isSuspended: true,
        email: anonymizedEmail,
        deletedEmail: user.deletedEmail ?? (user.email.endsWith("@zeudin.invalid") ? null : user.email),
        deletionSource: record.source ?? null,
        deletedById: record.byId ?? null,
        deletionReason: record.reason ?? null,
      },
    }),
    ...(user.vendor
      ? // La tienda suelta su enlace (/tienda/<slug>): una nueva con el mismo nombre lo puede usar (ver lib/vendorSlug.js).
        [prisma.vendor.update({ where: { id: user.vendor.id }, data: { deletedAt: now, isBlocked: true, ...releaseVendorSlugData(user.vendor.id) } })]
      : []),
    // Sus anuncios de venta rápida dejan de estar activos: el sitio ya los ocultaba por la cuenta eliminada, pero en el
    // admin seguían marcados "Activo" (ver lib/publicVisibility.js).
    prisma.customerListing.updateMany({ where: { ownerId: user.id, isActive: true }, data: { isActive: false } }),
    ...(user.vendorStaffProfile
      ? [prisma.vendorStaff.update({ where: { id: user.vendorStaffProfile.id }, data: { isActive: false } })]
      : []),
    // Cualquier sesión que siguiera viva se corta ya mismo — a partir de acá
    // deletedAt bloquea login/refresh de todas formas, pero no hace falta
    // esperar a que expire sola (mismo criterio que vendorStaff.controller.js
    // al desactivar personal).
    prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
    ...(staffUserIds.length
      ? [
          prisma.vendorStaff.updateMany({ where: { vendorId: user.vendor.id }, data: { isActive: false } }),
          prisma.session.updateMany({ where: { userId: { in: staffUserIds }, revokedAt: null }, data: { revokedAt: now } }),
        ]
      : []),
  ]);

  if (user.vendor) {
    const how = { CUSTOMER_REQUEST: "a pedido de su dueño", ADMIN: "por un administrador", ADMIN_PENDING: "al vencer la eliminación pendiente", MODERATION: "por moderación (reportes confirmados)" }[record.source] ?? "";
    await logVendorLifecycle({
      vendorId: user.vendor.id,
      actorId: record.byId ?? user.id,
      actorRole: record.byId ? "ADMIN" : "VENDOR",
      action: LIFECYCLE_ACTIONS.deleted,
      description: `Se eliminó la tienda ${snapshot?.companyName ?? user.vendor.companyName}${how ? ` ${how}` : ""}.`,
      extra: { snapshot, ownerEmail: user.email.endsWith("@zeudin.invalid") ? user.deletedEmail ?? null : user.email, ownerName: user.fullName ?? null, source: record.source ?? null, reason: record.reason ?? null, byId: record.byId ?? null },
    });
  }
}

// Cuentas eliminadas antes de guardar deletedEmail: se recupera el correo real solo de fuentes seguras, en este orden:
// la lista negra (moderación), el correo que dejó en sus pedidos, o el aviso de "cuenta eliminada" que se le mandó en el
// mismo minuto en que se borró (solo si hubo uno). Si nada coincide, queda sin correo: mejor vacío que uno equivocado.
export async function recoverDeletedAccountEmails() {
  const users = await prisma.user.findMany({
    where: { deletedAt: { not: null }, deletedEmail: null },
    select: { id: true, deletedAt: true, deletionRequestedAt: true, deletionSource: true },
  });
  let recovered = 0;
  for (const u of users) {
    const fromBlacklist = await prisma.blacklistEntry.findFirst({ where: { userId: u.id, email: { not: null } }, select: { email: true } });
    const fromOrders = fromBlacklist ? null : await prisma.order.findFirst({ where: { customerId: u.id, customerEmail: { not: null } }, orderBy: { createdAt: "desc" }, select: { customerEmail: true } });
    let fromEmail = null;
    if (!fromBlacklist && !fromOrders) {
      const sent = await prisma.emailLog.findMany({
        where: { type: "ACCOUNT_DELETION_COMPLETED", createdAt: { gte: new Date(u.deletedAt.getTime() - 10 * 60_000), lte: new Date(u.deletedAt.getTime() + 60_000) } },
        select: { to: true },
        take: 2,
      });
      if (sent.length === 1) fromEmail = sent[0].to;
    }
    const email = fromBlacklist?.email ?? fromOrders?.customerEmail ?? fromEmail;
    const source = u.deletionSource ?? (fromBlacklist ? "MODERATION" : u.deletionRequestedAt ? "CUSTOMER_REQUEST" : null);
    if (!email && source === u.deletionSource) continue;
    await prisma.user.update({ where: { id: u.id }, data: { deletedEmail: email ?? undefined, deletionSource: source } });
    if (email) recovered++;
  }
  if (recovered) console.log(`[cuentas eliminadas] correos reales recuperados: ${recovered}`);
}
