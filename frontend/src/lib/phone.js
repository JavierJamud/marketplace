import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, AsYouType } from "libphonenumber-js";

// Cuba, Estados Unidos y México primero (pedido explícito), luego el resto
// en orden alfabético por nombre en español. Nombres vía Intl.DisplayNames
// (nativo del motor JS, sin librería aparte) — nunca hardcodeamos los ~195
// países ni sus códigos de marcado a mano; ambos vienen de libphonenumber-js
// (getCountries/getCountryCallingCode) + Intl.DisplayNames.
const PRIORITY_COUNTRIES = ["CU", "US", "MX"];
const regionNames = typeof Intl !== "undefined" && Intl.DisplayNames ? new Intl.DisplayNames(["es"], { type: "region" }) : null;

let cachedOptions = null;

export function getCountryOptions() {
  if (cachedOptions) return cachedOptions;

  const all = getCountries().map((code) => ({
    code,
    name: regionNames?.of(code) ?? code,
    callingCode: getCountryCallingCode(code),
  }));

  const priority = PRIORITY_COUNTRIES.map((code) => all.find((c) => c.code === code)).filter(Boolean);
  const rest = all.filter((c) => !PRIORITY_COUNTRIES.includes(c.code)).sort((a, b) => a.name.localeCompare(b.name, "es"));

  cachedOptions = [...priority, ...rest];
  return cachedOptions;
}

// Arma un E.164 real (+5355512345) a partir del país elegido y lo que el
// usuario tipeó en la parte local — así los links wa.me/<telefono> siguen
// funcionando sin cambios en el resto del código.
export function toE164(country, nationalNumber) {
  const digits = (nationalNumber ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const parsed = parsePhoneNumberFromString(digits, country);
  if (parsed) return parsed.number;
  // Si libphonenumber no pudo parsear (número corto/atípico), concatenamos
  // igual el código de país en vez de perder lo que el usuario ya escribió.
  const callingCode = getCountryCallingCode(country);
  return `+${callingCode}${digits}`;
}

// Inverso: recibe un E.164 guardado (o un teléfono viejo sin +) y devuelve
// {country, national} para precargar el input al editar un perfil existente.
export function splitE164(value) {
  if (!value) return { country: "CU", national: "" };
  const withPlus = value.startsWith("+") ? value : `+${value}`;
  const parsed = parsePhoneNumberFromString(withPlus);
  if (parsed) return { country: parsed.country ?? "CU", national: parsed.nationalNumber };
  // Teléfonos sembrados antes de este bloque, sin "+": se asumen Cuba.
  return { country: "CU", national: value.replace(/\D/g, "") };
}

export function formatAsYouType(country, nationalNumber) {
  const formatter = new AsYouType(country);
  return formatter.input(nationalNumber ?? "");
}
