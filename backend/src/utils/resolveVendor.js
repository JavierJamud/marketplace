import { prisma } from "../lib/prisma.js";
import { AppError } from "./AppError.js";

// Todas las rutas de "mi tienda" (panel de vendedor) resuelven el vendorId a
// partir del usuario autenticado — nunca de un vendorId que mande el cliente.
export async function resolveMyVendor(userId) {
  const vendor = await prisma.vendor.findUnique({ where: { userId } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);
  return vendor;
}
