import { prisma } from "./prisma.js";

// Bloque 70 (pedido explícito): best-effort, igual que notifyAdminActionNeeded
// — nunca debe romper la acción real del vendedor/cliente si el registro de
// actividad falla por cualquier motivo.
export async function logActivity({ actorId, actorRole, vendorId, action, description, meta }) {
  await prisma.activityLog
    .create({ data: { actorId, actorRole, vendorId: vendorId ?? null, action, description, meta: meta ?? undefined } })
    .catch(() => {});
}

// Bloque 183 (pedido explícito — "si un usuario hace clic en aceptar el
// pedido, se registrará como que ese usuario fue el que aceptó ese
// pedido... el vendedor podrá ver qué ha hecho cada usuario"): todo
// controller del panel de vendedor arma `actorRole: "VENDOR"` a mano — este
// helper es el único cambio que hace falta en cada uno de esos sitios para
// que, cuando quien está logueado es un usuario de sistema (VENDOR_STAFF)
// y no el dueño, el registro lo diga así de una — `actorId` YA venía de
// req.user.id siempre (nunca cambia), así que quién exactamente lo hizo
// nunca se perdió; esto solo hace explícita la categoría a simple vista en
// el historial (dueño vs. usuario con acceso), sin tener que abrir cada
// entrada para saberlo.
export function actorRoleForVendorAction(req) {
  return req.user?.role === "VENDOR_STAFF" ? "VENDOR_STAFF" : "VENDOR";
}
