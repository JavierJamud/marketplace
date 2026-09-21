import { prisma } from "../lib/prisma.js";
import { AppError } from "./AppError.js";

// Todas las rutas de "mi tienda" (panel de vendedor) resuelven el vendorId a
// partir del usuario autenticado — nunca de un vendorId que mande el cliente.
// Bloque 183 (pedido explícito — "usuarios con roles dentro de su
// negocio"): un VENDOR_STAFF no tiene fila propia en Vendor (no es el
// dueño) — su acceso vive en VendorStaff.vendorId. Con este único cambio,
// CADA controller que ya llamaba resolveMyVendor(req.user.id) — casi todo
// tables.controller.js/orders.controller.js/products.controller.js/etc. —
// funciona igual de bien para un usuario de sistema logueado, sin tocar
// una sola línea de esos controllers: reciben el Vendor real del negocio
// al que pertenece, y logActivity ya sigue registrando el actorId real
// (el del usuario de sistema, no el del dueño) porque eso siempre vino de
// req.user.id, nunca de acá.
export async function resolveMyVendor(userId) {
  const vendor = await prisma.vendor.findUnique({ where: { userId } });
  if (vendor) return vendor;

  const staff = await prisma.vendorStaff.findUnique({ where: { userId }, include: { vendor: true } });
  if (staff?.isActive) return staff.vendor;

  throw new AppError("No tienes una tienda registrada.", 404);
}
