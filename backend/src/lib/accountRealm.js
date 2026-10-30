import { prisma } from "./prisma.js";

// Cliente y vendedor son cuentas separadas, como en Uber Eats (pedido del dueño, 2026-10-30): la misma persona puede tener
// una cuenta de cliente y otra de negocio con el mismo correo y teléfono, y nunca se unen ni se mezclan. Cada puerta de
// entrada busca solo en su lado:
// - "customer": cuentas de cliente (CUSTOMER). Entran por /cuenta.
// - "business": vendedor, personal de tienda, socio y admin. Entran por /vendedor/ingresar, /socio/ingresar y /admin/ingresar.
// Dentro de un mismo lado el correo no se repite (índices únicos parciales de la migración 20261201000000_separate_customer_
// and_business_accounts); entre lados sí.
export const BUSINESS_ROLES = ["VENDOR", "VENDOR_STAFF", "ADMIN", "PARTNER"];

export function realmForRole(role) {
  return role === "CUSTOMER" ? "customer" : "business";
}

// `context` es el formulario de ingreso que se usó ("admin" | "vendor" | "partner"; sin valor o "customer" = /cuenta).
export function realmForContext(context) {
  return context === "admin" || context === "vendor" || context === "partner" ? "business" : "customer";
}

export function realmRoleFilter(realm) {
  return realm === "customer" ? { role: "CUSTOMER" } : { role: { in: BUSINESS_ROLES } };
}

// El correo ya llega en minúsculas (emailField). Se busca sin distinguir mayúsculas por las cuentas viejas que la migración
// 20261128050000 no pudo pasar a minúsculas; con varias, la más antigua (mismo criterio de antes).
export function findAccountByEmail(email, realm) {
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, ...realmRoleFilter(realm) },
    orderBy: { createdAt: "asc" },
  });
}

// ¿La cuenta de cliente es de la misma persona que tiene la tienda? Con cuentas separadas el dueño compra desde su cuenta
// de cliente (otro id), así que comparar ids no basta: cuenta como la misma persona la misma cuenta, o una con el mismo
// correo o el mismo teléfono que la cuenta del dueño (son los datos que se repiten a propósito entre sus dos cuentas).
// Lo usan las reglas contra el beneficio propio: puntos en su tienda, reseñas a su tienda y recordatorios de su carrito.
export async function isStoreOwnerPerson(customerUserId, ownerUserId) {
  if (!customerUserId || !ownerUserId) return false;
  if (customerUserId === ownerUserId) return true;
  const rows = await prisma.user.findMany({ where: { id: { in: [customerUserId, ownerUserId] } }, select: { id: true, email: true, phone: true } });
  const customer = rows.find((r) => r.id === customerUserId);
  const owner = rows.find((r) => r.id === ownerUserId);
  if (!customer || !owner) return false;
  const sameEmail = !!customer.email && customer.email.trim().toLowerCase() === owner.email?.trim().toLowerCase();
  const digits = (v) => String(v ?? "").replace(/\D/g, "");
  const samePhone = digits(customer.phone).length >= 7 && digits(customer.phone) === digits(owner.phone);
  return sameEmail || samePhone;
}

// ¿El correo ya es de otra cuenta del mismo lado? `exceptUserId` excluye la cuenta que se está editando.
export async function emailTakenInRealm(email, realm, exceptUserId = null) {
  const found = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, ...realmRoleFilter(realm), ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
    select: { id: true },
  });
  return !!found;
}
