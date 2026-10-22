import { prisma } from "./prisma.js";
import { AppError } from "../utils/AppError.js";
import { slugify } from "../utils/slugify.js";
import { normalizeUsername } from "./username.js";

// Lista negra (BlacklistEntry): personas eliminadas por avisos acumulados o agregadas por el admin. Decisión del dueño:
// bloquea volver a registrarse con el mismo correo, teléfono o documento. Se compara normalizado (correo en minúsculas,
// teléfono solo dígitos, documento sin espacios y en mayúsculas). Solo cuentan las entradas que el admin no sacó.
export const normEmail = (v) => (v ? String(v).trim().toLowerCase() : null);
export const normPhone = (v) => {
  const d = v ? String(v).replace(/\D/g, "") : "";
  return d.length >= 7 ? d : null;
};
export const normIdNumber = (v) => {
  const d = v ? String(v).replace(/\s+/g, "").toUpperCase() : "";
  return d.length >= 5 ? d : null;
};

export const normStoreKey = (v) => {
  const k = v ? slugify(String(v)) : "";
  return k.length >= 2 ? k : null;
};

// `self`: { userId, vendorId } de quien edita sus propios datos. Una cuenta suspendida y en la lista negra que el admin
// reactivó puede seguir usando lo suyo; lo que no puede es otra persona registrarse con esos datos.
export async function findBlacklisted({ email, phone, idNumber, storeName, username }, self = {}) {
  const or = [];
  if (normEmail(email)) or.push({ email: normEmail(email) });
  if (normPhone(phone)) or.push({ phone: normPhone(phone) });
  if (normIdNumber(idNumber)) or.push({ idNumber: normIdNumber(idNumber) });
  if (normStoreKey(storeName)) or.push({ storeKey: normStoreKey(storeName) });
  if (username && normalizeUsername(username)) or.push({ username: normalizeUsername(username) });
  if (!or.length) return null;
  const notSelf = [self.userId && { userId: self.userId }, self.vendorId && { vendorId: self.vendorId }].filter(Boolean);
  return prisma.blacklistEntry.findFirst({ where: { removedAt: null, OR: or, ...(notSelf.length ? { NOT: { OR: notSelf } } : {}) }, select: { id: true } });
}

// Se usa al registrarse (cliente o tienda) y al cambiar correo, teléfono, nombre de tienda o usuario. El mensaje no dice qué
// dato coincidió (no se le revela a nadie qué está en la lista negra).
export async function assertNotBlacklisted(data, self = {}) {
  if (await findBlacklisted(data, self)) {
    throw new AppError("No podemos usar estos datos en la plataforma. Si crees que es un error, escribe a soporte.", 403);
  }
}

// Guarda a alguien en la lista negra (antes de eliminar su cuenta: después el correo queda anonimizado).
// Una tienda puede tener dos teléfonos (el de la cuenta y el WhatsApp de la tienda): se guarda una fila por cada uno.
export async function addToBlacklist({ kind, user, vendor = null, reason, addedById = null }) {
  const phones = [...new Set([normPhone(vendor?.whatsapp), normPhone(user?.phone)].filter(Boolean))];
  const base = {
    kind,
    email: normEmail(user?.email),
    idNumber: normIdNumber(vendor?.ownerIdNumber),
    fullName: user?.fullName ?? vendor?.ownerName ?? null,
    storeName: vendor?.companyName ?? null,
    storeKey: normStoreKey(vendor?.companyName),
    username: vendor?.slug && !vendor.slug.startsWith("eliminada-") ? normalizeUsername(vendor.slug) : null,
    reason,
    userId: user?.id ?? null,
    vendorId: vendor?.id ?? null,
    addedById,
  };
  const rows = (phones.length ? phones : [null]).map((phone, i) => ({ ...base, phone, ...(i > 0 ? { email: null, idNumber: null, storeKey: null, username: null } : {}) }));
  await prisma.blacklistEntry.createMany({ data: rows });
}

// Filas de antes de guardar storeKey: se completa con el nombre de la tienda (al arrancar, una sola vez por fila).
export async function backfillBlacklistStoreKeys() {
  const rows = await prisma.blacklistEntry.findMany({ where: { storeKey: null, storeName: { not: null } }, select: { id: true, storeName: true } });
  for (const r of rows) await prisma.blacklistEntry.update({ where: { id: r.id }, data: { storeKey: normStoreKey(r.storeName) } });
}
