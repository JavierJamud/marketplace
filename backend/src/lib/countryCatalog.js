import { getCountries, getCountryCallingCode } from "libphonenumber-js";
import { prisma } from "./prisma.js";

// Catálogo mundial de países para el panel del admin: todos los países del mundo (código ISO de 2 letras, nombre en español y
// código de marcado), todos apagados al cargarse. El admin enciende los que quiere recibir: solo los activos aparecen en el
// registro y en los teléfonos. Es seguro repetirlo: solo agrega los que faltan y nunca toca nombre ni estado de los existentes.
const regionNames = typeof Intl !== "undefined" && Intl.DisplayNames ? new Intl.DisplayNames(["es"], { type: "region" }) : null;

// Código de marcado (sin "+") de un país por su código ISO, o null si no es un código conocido.
export function callingCodeFor(code) {
  try {
    return getCountryCallingCode(String(code).toUpperCase());
  } catch {
    return null;
  }
}

export async function seedWorldCountries() {
  const existing = await prisma.country.findMany({ select: { code: true } });
  const have = new Set(existing.map((c) => c.code.toUpperCase()));
  const missing = getCountries()
    .filter((code) => !have.has(code))
    .map((code) => ({ code, name: regionNames?.of(code) ?? code, isActive: false }));
  if (missing.length) await prisma.country.createMany({ data: missing, skipDuplicates: true });
  return { created: missing.length, total: have.size + missing.length };
}
