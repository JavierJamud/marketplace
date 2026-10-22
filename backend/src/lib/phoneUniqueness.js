import { prisma } from "./prisma.js";
import { AppError } from "../utils/AppError.js";

// Un teléfono pertenece a una sola persona (decisión del dueño): no lo pueden compartir dos cuentas (clientes, vendedores,
// personal) ni dos tiendas, ni un cliente con la tienda de otro. Excepción: el dueño de una tienda puede usar el mismo número
// en su cuenta y en el WhatsApp de su tienda. Se compara por los dígitos (con o sin "+"). Las cuentas y tiendas eliminadas
// no cuentan. `self`: { userId, vendorId } de quien registra o edita (lo suyo no choca consigo mismo).

const digits = (v) => String(v ?? "").replace(/\D/g, "");

export async function findPhoneOwner(phone, self = {}) {
  const d = digits(phone);
  if (d.length < 7) return null;
  const variants = [`+${d}`, d];
  const [user, vendor] = await Promise.all([
    prisma.user.findFirst({
      where: { phone: { in: variants }, deletedAt: null, ...(self.userId ? { id: { not: self.userId } } : {}) },
      select: { id: true },
    }),
    prisma.vendor.findFirst({
      where: {
        whatsapp: { in: variants },
        deletedAt: null,
        ...(self.vendorId ? { id: { not: self.vendorId } } : {}),
        // La tienda del propio dueño no cuenta como "otra persona".
        ...(self.userId ? { userId: { not: self.userId } } : {}),
      },
      select: { id: true },
    }),
  ]);
  // Una cuenta de otra persona... salvo que sea el dueño de la tienda que se está editando.
  if (user && self.vendorId) {
    const owner = await prisma.vendor.findUnique({ where: { id: self.vendorId }, select: { userId: true } });
    if (owner?.userId === user.id) return vendor ? "vendor" : null;
  }
  return user ? "user" : vendor ? "vendor" : null;
}

export async function assertPhoneFree(phone, self = {}, message = "Ese teléfono ya lo usa otra cuenta. Usa uno tuyo distinto.") {
  if (await findPhoneOwner(phone, self)) throw new AppError(message, 409, { conflicts: { phone: message } });
}
