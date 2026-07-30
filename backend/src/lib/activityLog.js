import { prisma } from "./prisma.js";

// Bloque 70 (pedido explícito): best-effort, igual que notifyAdminActionNeeded
// — nunca debe romper la acción real del vendedor/cliente si el registro de
// actividad falla por cualquier motivo.
export async function logActivity({ actorId, actorRole, vendorId, action, description, meta }) {
  await prisma.activityLog
    .create({ data: { actorId, actorRole, vendorId: vendorId ?? null, action, description, meta: meta ?? undefined } })
    .catch(() => {});
}
