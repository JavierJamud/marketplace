import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { slugify } from "../utils/slugify.js";
import { normalizeUsername, usernameFormatError, usernameTaken } from "../lib/username.js";
import { findPhoneOwner } from "../lib/phoneUniqueness.js";

// Una tienda no puede repetir el nombre, el WhatsApp ni el correo de otra, y una persona (por su número de documento) solo
// puede ser responsable de una tienda. Cada cuenta ya tiene como mucho una tienda (Vendor.userId es único); esto evita que la
// misma persona abra varias con cuentas distintas para repetir la prueba gratis o esquivar un bloqueo.
// Se usa al registrar la tienda, al editarla (la tienda o el admin), al aprobar un cambio de datos y en la comprobación
// previa del formulario de registro. `exceptVendorId` excluye a la propia tienda al editar.
const digits = (v) => String(v ?? "").replace(/\D/g, "");
const docKey = (v) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// `ownerUserId`: el dueño (o quien se está registrando), para que su propio teléfono de cuenta no choque con el WhatsApp de su
// tienda. `username`: el nombre de usuario (= enlace) que elige; se valida su forma y que nadie más lo tenga.
export async function findVendorConflicts({ companyName, whatsapp, email, ownerIdNumber, username, ownerUserId = null }, exceptVendorId = null) {
  const not = exceptVendorId ? { id: { not: exceptVendorId } } : {};
  const conflicts = {};

  if (companyName?.trim()) {
    // Mismo nombre sin importar mayúsculas, tildes ni signos: se compara por el slug (que ya quita todo eso).
    const slug = slugify(companyName);
    const candidates = await prisma.vendor.findMany({
      where: { ...not, deletedAt: null, OR: [{ slug }, { slug: { startsWith: `${slug}-` } }, { companyName: { equals: companyName.trim(), mode: "insensitive" } }] },
      select: { companyName: true },
      take: 20,
    });
    if (candidates.some((c) => slugify(c.companyName) === slug)) conflicts.companyName = "Ya existe una tienda con ese nombre. Elige otro.";
  }

  if (digits(whatsapp).length >= 7) {
    const d = digits(whatsapp);
    const found = await prisma.vendor.findFirst({ where: { ...not, deletedAt: null, OR: [{ whatsapp: `+${d}` }, { whatsapp: d }] }, select: { id: true } });
    if (found) conflicts.whatsapp = "Ese WhatsApp ya está registrado en otra tienda.";
    // Tampoco el teléfono de la cuenta de otra persona.
    else if (await findPhoneOwner(whatsapp, { userId: ownerUserId, vendorId: exceptVendorId, scope: "vendor" })) conflicts.whatsapp = "Ese número ya lo usa otra cuenta. Usa un WhatsApp tuyo distinto.";
  }

  if (username !== undefined && username !== null) {
    const u = normalizeUsername(username);
    // Primero si ya es de otra tienda (también los enlaces viejos con guiones), después si cumple las reglas.
    if (await usernameTaken(u, exceptVendorId)) conflicts.username = "Ese nombre de usuario ya lo usa otra tienda. Elige otro.";
    else if (usernameFormatError(u)) conflicts.username = usernameFormatError(u);
  }

  if (email?.trim()) {
    const found = await prisma.vendor.findFirst({ where: { ...not, deletedAt: null, email: { equals: email.trim(), mode: "insensitive" } }, select: { id: true } });
    if (found) conflicts.email = "Ese correo ya es el de otra tienda.";
  }

  if (docKey(ownerIdNumber).length >= 4) {
    const key = docKey(ownerIdNumber);
    const rows = await prisma.vendor.findMany({ where: { ...not, deletedAt: null, ownerIdNumber: { not: null } }, select: { ownerIdNumber: true } });
    if (rows.some((r) => docKey(r.ownerIdNumber) === key)) conflicts.ownerIdNumber = "Esa persona ya es responsable de otra tienda. Cada persona puede tener una sola tienda.";
  }

  return conflicts;
}

export async function assertVendorUnique(fields, exceptVendorId = null) {
  const conflicts = await findVendorConflicts(fields, exceptVendorId);
  const first = Object.values(conflicts)[0];
  if (first) throw new AppError(first, 409, { conflicts });
}
