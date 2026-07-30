import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

function publicCustomer(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

export async function getMe(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { province: true } });
  if (!user) throw new AppError("Usuario no encontrado.", 404);
  res.json({ customer: publicCustomer(user) });
}

// Bloque 71 (pedido explícito): `email` YA NO se acepta acá — cambiar de
// correo pasa a exigir el flujo de código de verificación al correo viejo
// (POST /auth/me/email/request-code + /confirm, ver auth.controller.js),
// igual que ya regía para vendedor/admin. Antes este endpoint dejaba
// cambiar el correo del cliente junto con el resto del perfil, sin
// contraseña ni verificación de ningún tipo — hueco real de seguridad.
const updateSchema = z.object({
  fullName: z.string().min(2).optional(),
  phone: z.string().min(8).optional(),
  address: z.string().optional(),
  provinceId: z.string().optional(),
});

export async function updateMe(req, res) {
  const data = updateSchema.parse(req.body);
  const updated = await prisma.user.update({ where: { id: req.user.id }, data, include: { province: true } });
  res.json({ customer: publicCustomer(updated) });
}

// Pedidos del cliente autenticado — nunca confía en un id que venga del
// cliente. Empareja por customerId (pedido hecho logueado) O por
// customerEmail (checkout de invitado con el mismo correo de esta cuenta),
// mismo criterio de aislamiento que resolveMyVendor usa para vendedores.
export async function getMyOrders(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new AppError("Usuario no encontrado.", 404);

  const orders = await prisma.order.findMany({
    where: { OR: [{ customerId: user.id }, { customerEmail: user.email }] },
    include: { items: true, vendor: { select: { companyName: true, slug: true, color: true } } },
    orderBy: { createdAt: "desc" },
  });

  res.json({ orders });
}
