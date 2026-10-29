import { prisma } from "./prisma.js";
import { AppError } from "../utils/AppError.js";

// Un teléfono no se repite dentro de un mismo rol (decisión del dueño, 2026-10-29): no puede haber dos clientes ni dos
// vendedores con el mismo número, pero un cliente y un vendedor sí pueden compartirlo (son la misma persona en sus dos
// papeles, aunque tengan cuentas separadas de antes de unirlas). `self.scope` dice qué se está registrando o editando:
// - "customer": choca solo con otra cuenta de cliente.
// - "vendor": choca con otra cuenta de vendedor o con el WhatsApp de una tienda de otro dueño.
// - sin scope (personal de tienda, socios de la API): choca con cualquier cuenta o tienda, como antes.
// El dueño de una tienda puede usar el mismo número en su cuenta y en el WhatsApp de su tienda. Se compara por los dígitos
// (con o sin "+"). Las cuentas y tiendas eliminadas no cuentan. `self`: { userId, vendorId, scope } de quien registra o edita.

const digits = (v) => String(v ?? "").replace(/\D/g, "");

export async function findPhoneOwner(phone, self = {}) {
  const d = digits(phone);
  if (d.length < 7) return null;
  const variants = [`+${d}`, d];
  const scope = self.scope ?? null;
  const roleFilter = scope === "customer" ? { role: "CUSTOMER" } : scope === "vendor" ? { role: "VENDOR" } : {};
  const [user, vendor] = await Promise.all([
    prisma.user.findFirst({
      where: { phone: { in: variants }, deletedAt: null, ...roleFilter, ...(self.userId ? { id: { not: self.userId } } : {}) },
      select: { id: true },
    }),
    // El WhatsApp de una tienda solo choca con otro vendedor (o con cualquiera si no hay scope): a un cliente no le afecta.
    scope === "customer"
      ? null
      : prisma.vendor.findFirst({
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

const DEFAULT_MESSAGE = {
  customer: "Ese teléfono ya lo usa otro cliente. Usa uno tuyo distinto.",
  vendor: "Ese teléfono ya lo usa otro vendedor o tienda. Usa uno tuyo distinto.",
};

export async function assertPhoneFree(phone, self = {}, message = DEFAULT_MESSAGE[self.scope] ?? "Ese teléfono ya lo usa otra cuenta. Usa uno tuyo distinto.") {
  if (await findPhoneOwner(phone, self)) throw new AppError(message, 409, { conflicts: { phone: message } });
}
