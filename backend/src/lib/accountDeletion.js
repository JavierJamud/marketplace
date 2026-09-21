import { prisma } from "./prisma.js";

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
export async function finalizeUserDeletion(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { vendor: true, vendorStaffProfile: true },
  });
  if (!user) return;

  const now = new Date();
  const anonymizedEmail = `deleted+${user.id}@zeudin.invalid`;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: now, isSuspended: true, email: anonymizedEmail },
    }),
    ...(user.vendor
      ? [prisma.vendor.update({ where: { id: user.vendor.id }, data: { deletedAt: now, isBlocked: true } })]
      : []),
    ...(user.vendorStaffProfile
      ? [prisma.vendorStaff.update({ where: { id: user.vendorStaffProfile.id }, data: { isActive: false } })]
      : []),
    // Cualquier sesión que siguiera viva se corta ya mismo — a partir de acá
    // deletedAt bloquea login/refresh de todas formas, pero no hace falta
    // esperar a que expire sola (mismo criterio que vendorStaff.controller.js
    // al desactivar personal).
    prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
  ]);
}
