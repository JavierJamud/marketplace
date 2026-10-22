import { prisma } from "./prisma.js";
import { slugify } from "../utils/slugify.js";

// Nombre de usuario de una tienda = su enlace público (baznova.com/tienda/<usuario>, columna Vendor.slug). Decisión del dueño:
// de 3 a 20 caracteres, solo minúsculas, números, punto y guion bajo, y único. Al cambiarlo, el anterior queda en
// previousSlugs y lo ya compartido sigue llevando a la tienda (ver lib/vendorSlug.js). Las tiendas de antes conservan su
// enlace aunque no cumpla estas reglas (con guiones o más largo); las reglas se aplican al elegir uno nuevo.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
const PATTERN = /^[a-z0-9](?:[a-z0-9._]*[a-z0-9])?$/;

// Rutas y palabras del sitio que no pueden ser el usuario de una tienda.
const RESERVED = new Set([
  "admin", "administrador", "api", "baznova", "zeudin", "soporte", "ayuda", "tienda", "tiendas", "vendedor", "vendedores",
  "cuenta", "catalogo", "carrito", "checkout", "pago", "pagos", "mesa", "socio", "socios", "ventas", "venta", "oficial",
  "eliminada", "null", "undefined",
]);

export function normalizeUsername(value) {
  return String(value ?? "").trim().toLowerCase().replace(/^@/, "");
}

// Mensaje de por qué no sirve, o null si cumple las reglas.
export function usernameFormatError(value) {
  const u = normalizeUsername(value);
  if (u.length < USERNAME_MIN) return `El nombre de usuario necesita al menos ${USERNAME_MIN} caracteres.`;
  if (u.length > USERNAME_MAX) return `El nombre de usuario admite hasta ${USERNAME_MAX} caracteres.`;
  if (!PATTERN.test(u)) return "Usa solo minúsculas, números, punto o guion bajo, sin espacios ni tildes. No puede empezar ni terminar con punto o guion bajo.";
  if (/[._]{2}/.test(u)) return "No pongas dos signos seguidos (.. o __).";
  if (RESERVED.has(u) || u.startsWith("eliminada")) return "Ese nombre de usuario está reservado. Elige otro.";
  return null;
}

// Lo usa otra tienda viva, como enlace actual o anterior (un enlace anterior sigue llevando a su tienda).
export async function usernameTaken(username, exceptVendorId = null) {
  const u = normalizeUsername(username);
  const not = exceptVendorId ? { id: { not: exceptVendorId } } : {};
  const holder = await prisma.vendor.findFirst({
    where: { ...not, deletedAt: null, OR: [{ slug: u }, { previousSlugs: { has: u } }] },
    select: { id: true },
  });
  return !!holder;
}

// Propuesta a partir del nombre de la tienda: "La Esquina Caliente" -> "la.esquina.caliente", con número si ya existe.
export async function suggestUsername(companyName, exceptVendorId = null) {
  let base = slugify(companyName).replace(/-/g, ".").slice(0, USERNAME_MAX).replace(/[._]+$/, "");
  if (base.length < USERNAME_MIN || usernameFormatError(base)) base = `tienda${base}`.slice(0, USERNAME_MAX);
  if (!(await usernameTaken(base, exceptVendorId))) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n);
    const candidate = `${base.slice(0, USERNAME_MAX - suffix.length).replace(/[._]+$/, "")}${suffix}`;
    if (!(await usernameTaken(candidate, exceptVendorId))) return candidate;
  }
  return `tienda${Date.now().toString(36)}`.slice(0, USERNAME_MAX);
}
