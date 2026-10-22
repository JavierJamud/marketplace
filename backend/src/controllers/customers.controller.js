import { assertPhoneFree } from "../lib/phoneUniqueness.js";
import { assertNotBlacklisted } from "../lib/blacklist.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { cancelOrderForCustomer, editOrderItemsForCustomer, storeContactFor, CUSTOMER_CAN_CANCEL, CUSTOMER_CAN_EDIT } from "./orders.controller.js";
import { sendOrderCancelHelpEmail } from "../lib/email.js";
import { resolvePersonRegistrationLocation } from "../services/registrationLocation.service.js";
import { recordLocationSuggestions } from "../services/locationSuggestions.service.js";

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
  phone: z.string().regex(/^\+\d{7,15}$/, "El teléfono debe incluir el código del país.").optional(),
  // ISO del país del teléfono (el registro lo guarda junto al teléfono).
  country: z.string().length(2).optional(),
  address: z.string().optional(),
  provinceId: z.string().optional(),
  // Ubicación completa del perfil (la misma que se pide al registrarse). Si llega registrationCountryId o registrationCountryOther
  // se valida y se guarda entera; sin ellas, solo cambian los campos sueltos de arriba (la pestaña de direcciones).
  registrationCountryId: z.string().min(1).optional(),
  registrationCountryOther: z.string().trim().min(2).max(80).optional(),
  municipalityId: z.string().min(1).optional(),
  municipalityOther: z.string().trim().min(2).max(80).optional(),
  stateOther: z.string().trim().min(1).max(80).optional(),
});

// País y provincia (o estado) del perfil: sin ellos no se publica una venta rápida, porque los compradores la ven según su lugar.
// Un país escrito a mano (que aún no está en la lista) no basta: no hay con qué ubicar el anuncio.
export function profileLocationMissing(user) {
  const missing = [];
  if (!user.phone?.trim()) missing.push("teléfono");
  // Quien se registró antes solo tiene la provincia: su país sale de ella.
  if (!user.registrationCountryId && !user.province?.countryId) missing.push("país");
  else if (!user.provinceId && !user.stateOther?.trim()) missing.push("provincia o estado");
  return missing;
}

export async function updateMe(req, res) {
  const { registrationCountryId, registrationCountryOther, municipalityId, municipalityOther, stateOther, country, ...basic } = updateSchema.parse(req.body);
  const data = { ...basic };
  // Teléfono nuevo: ni de otra persona ni en la lista negra.
  if (basic.phone) {
    const current = await prisma.user.findUnique({ where: { id: req.user.id }, select: { phone: true } });
    if (basic.phone !== current?.phone) {
      await assertNotBlacklisted({ phone: basic.phone }, { userId: req.user.id });
      await assertPhoneFree(basic.phone, { userId: req.user.id });
    }
  }
  if (country) {
    const phoneCountry = await prisma.country.findFirst({ where: { code: country.toUpperCase(), isActive: true }, select: { id: true } });
    if (!phoneCountry) throw new AppError("Ese país todavía no está habilitado. Contacta a soporte para pedir que lo activen.", 400);
    data.country = country.toUpperCase();
  }

  let suggestions = [];
  if (registrationCountryId || registrationCountryOther) {
    const location = await resolvePersonRegistrationLocation({
      countryId: registrationCountryId,
      countryOther: registrationCountryOther,
      provinceId: basic.provinceId,
      municipalityId,
      municipalityOther,
      stateOther,
      address: basic.address,
    });
    const { suggestions: found, ...columns } = location;
    Object.assign(data, columns);
    suggestions = found;
  } else if (basic.provinceId) {
    // Solo la provincia (pestaña de direcciones): el país sale de la provincia y el municipio anterior ya no vale.
    const province = await prisma.province.findUnique({ where: { id: basic.provinceId }, select: { countryId: true } });
    if (!province) throw new AppError("Provincia no válida.", 400);
    if (province.countryId) data.registrationCountryId = province.countryId;
    data.registrationCountryOther = null;
    data.municipalityId = null;
    data.municipalityOther = null;
    data.stateOther = null;
  }

  if (data.provinceId === "") data.provinceId = null;
  const updated = await prisma.user.update({ where: { id: req.user.id }, data, include: { province: true } });
  void recordLocationSuggestions(suggestions);
  res.json({ customer: publicCustomer(updated), profileComplete: profileLocationMissing(updated).length === 0 });
}

// Pedidos del cliente autenticado — nunca confía en un id que venga del
// cliente. Empareja por customerId (pedido hecho logueado) O por
// customerEmail (checkout de invitado con el mismo correo de esta cuenta),
// mismo criterio de aislamiento que resolveMyVendor usa para vendedores.
export async function getMyOrders(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new AppError("Usuario no encontrado.", 404);

  const orders = await prisma.order.findMany({
    where: { OR: [{ customerId: user.id }, { customerEmail: { equals: user.email, mode: "insensitive" } }] },
    include: { items: true, vendor: { select: { companyName: true, slug: true, color: true, whatsapp: true } } },
    orderBy: { createdAt: "desc" },
  });

  // Qué puede hacer el cliente con cada pedido (lo decide el servidor; el botón solo lo refleja).
  res.json({
    orders: orders.map((o) => ({ ...o, canCancel: CUSTOMER_CAN_CANCEL.includes(o.status), canAskToCancel: o.status === "PREPARING" || o.status === "READY" || o.status === "DELIVERED", canEdit: CUSTOMER_CAN_EDIT.includes(o.status) && !o.discountCodeId && !o.loyaltyPointsRedeemed })),
  });
}

// El pedido tiene que ser del cliente autenticado: hecho con su sesión o con el mismo correo de su cuenta.
async function loadOwnOrder(userId, orderId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("Usuario no encontrado.", 404);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  const owns = order && (order.customerId === user.id || (order.customerEmail ?? "").trim().toLowerCase() === user.email.trim().toLowerCase());
  // Mismo mensaje exista o no, para no revelar pedidos de otras personas.
  if (!order || !owns) throw new AppError("Pedido no encontrado.", 404);
  return order;
}

const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() });
const STATUS_TEXT = { PREPARING: "en preparación", READY: "en camino", DELIVERED: "entregado" };

export async function cancelMyOrder(req, res) {
  const { reason } = cancelSchema.parse(req.body ?? {});
  const order = await loadOwnOrder(req.user.id, req.params.id);

  // La plataforma solo cancela pedidos que la tienda todavía no confirmó. Si ya está en preparación, en camino o entregado, no se
  // cancela: se le manda al cliente un correo con el pedido y cómo contactar a la tienda, y la pantalla se lo avisa.
  if (order.status !== "NEW" && order.status !== "CANCELLED") {
    const full = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        items: { include: { product: { select: { images: true } } } },
        vendor: { select: { companyName: true, slug: true, whatsapp: true, email: true, companyAddress: true, logoUrl: true } },
      },
    });
    const emailSent = await sendOrderCancelHelpEmail(full).catch(() => false);
    const store = await storeContactFor(order.vendorId);
    return res.status(409).json({
      error: `Tu pedido ${order.code} ya está ${STATUS_TEXT[order.status] ?? "en proceso"}, así que no se puede cancelar desde aquí.`,
      code: "CONTACT_STORE",
      orderCode: order.code,
      status: order.status,
      emailSent,
      email: order.customerEmail,
      store,
    });
  }

  const updated = await cancelOrderForCustomer(order, reason, "su cuenta");
  res.json({ order: { id: updated.id, code: updated.code, status: updated.status, cancelReason: updated.cancelReason } });
}

export async function editMyOrderItems(req, res) {
  const order = await loadOwnOrder(req.user.id, req.params.id);
  const updated = await editOrderItemsForCustomer(order, req.body?.items, "su cuenta");
  res.json({ order: updated });
}
