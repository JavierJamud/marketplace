import { prisma } from "./prisma.js";
import { AppError } from "../utils/AppError.js";

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

export async function findBlacklisted({ email, phone, idNumber }) {
  const or = [];
  if (normEmail(email)) or.push({ email: normEmail(email) });
  if (normPhone(phone)) or.push({ phone: normPhone(phone) });
  if (normIdNumber(idNumber)) or.push({ idNumber: normIdNumber(idNumber) });
  if (!or.length) return null;
  return prisma.blacklistEntry.findFirst({ where: { removedAt: null, OR: or }, select: { id: true } });
}

// Se usa al registrarse (cliente o tienda) y al cambiar correo o teléfono. El mensaje no dice qué dato coincidió.
export async function assertNotBlacklisted(data) {
  if (await findBlacklisted(data)) {
    throw new AppError("No podemos crear la cuenta con estos datos. Si crees que es un error, escribe a soporte.", 403);
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
    reason,
    userId: user?.id ?? null,
    vendorId: vendor?.id ?? null,
    addedById,
  };
  const rows = (phones.length ? phones : [null]).map((phone, i) => ({ ...base, phone, ...(i > 0 ? { email: null, idNumber: null } : {}) }));
  await prisma.blacklistEntry.createMany({ data: rows });
}
