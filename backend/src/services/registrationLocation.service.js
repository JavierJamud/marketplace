import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

// Bloque 113 (pedido explícito): país/provincia/municipio en el registro
// (cliente Y vendedor) — mismo criterio de validación en los dos lugares
// que lo necesitan (auth.controller.js para la persona, vendors.controller.js
// para dónde opera la tienda), factorizado acá para no divergir con el
// tiempo.
// Bloque 114 (pedido explícito, follow-up): fuera de Cuba ya NO se elige una
// provincia/estado del catálogo (`Province` type=STATE) — el admin solo
// necesita cargar el PAÍS (ni siquiera hace falta que tenga subdivisiones
// cargadas, ver locations.controller.js:listActiveCountries?all=true); el
// cliente/vendedor escribe a mano el estado y la dirección. Reglas finales:
// si el país elegido es Cuba, hace falta provincia Y municipio reales del
// catálogo (uno perteneciendo al otro); si es cualquier otro país real ya
// cargado por el admin, hace falta un estado (texto libre) y una dirección
// (texto libre) — nunca provincia/municipio (el modelo de "municipio" es
// específicamente cubano, ver locations.controller.js:createMunicipality,
// que ya rechaza crear uno bajo un Estado).
export const CUBA_COUNTRY_CODE = "CU";

// Valida un país real del catálogo del admin (nunca "otro país" — usado
// donde el lugar tiene que poder resolverse a algo real: la tienda siempre,
// la persona cuando no eligió "otro país"). Si es Cuba, valida
// provincia+municipio reales; si no, exige un estado de texto libre (nunca
// provincia/municipio del catálogo). `address` es opcional acá a propósito
// — cada llamador decide si además exige una dirección y con qué mensaje
// (la tienda la valida contra Vendor.companyAddress, ver vendors.controller.js;
// la persona, contra su propio campo `address`).
export async function resolveRealCountryLocation({ countryId, provinceId, municipalityId, stateOther, address }) {
  if (!countryId) throw new AppError("Selecciona un país.", 400);
  const country = await prisma.country.findUnique({ where: { id: countryId } });
  if (!country || !country.isActive) throw new AppError("País no válido.", 400);

  const isCuba = country.code === CUBA_COUNTRY_CODE;

  if (!isCuba) {
    const state = stateOther?.trim();
    if (!state) throw new AppError("Indica el estado/provincia.", 400);
    return { country, isCuba, province: null, municipality: null, stateOther: state, address: address?.trim() || null };
  }

  if (!provinceId) throw new AppError("Selecciona tu provincia.", 400);
  const province = await prisma.province.findUnique({ where: { id: provinceId } });
  if (!province || province.countryId !== country.id) {
    throw new AppError("La provincia no corresponde al país elegido.", 400);
  }

  if (!municipalityId) throw new AppError("Selecciona tu municipio.", 400);
  const municipality = await prisma.municipality.findUnique({ where: { id: municipalityId } });
  if (!municipality || municipality.provinceId !== province.id) {
    throw new AppError("El municipio no corresponde a la provincia elegida.", 400);
  }
  return { country, isCuba, province, municipality, stateOther: null, address: null };
}

// Variante para la UBICACIÓN DE LA TIENDA (VendorLocation, "dónde presto
// servicio/vendo") — a diferencia de la persona, acá SIEMPRE tiene que ser
// un país real del catálogo (nunca "otro país" — el marketplace no puede
// listar/entregar en un país que no tiene cargado). La dirección en sí vive
// en Vendor.companyAddress (un vendedor registra un solo local) — se valida
// aparte en vendors.controller.js, no acá.
export async function assertVendorLocationComplete({ countryId, provinceId, municipalityId, stateOther }) {
  return resolveRealCountryLocation({ countryId, provinceId, municipalityId, stateOther });
}

// Variante para el registro de UNA PERSONA (cliente o vendedor): a
// diferencia de arriba, admite que su país real todavía no esté cargado
// ("otro país" + texto libre) — nunca lo obliga a mentir eligiendo uno
// que no es el suyo. Sin país real, no hay provincia/municipio/estado que
// validar.
export async function resolvePersonRegistrationLocation({ countryId, countryOther, provinceId, municipalityId, stateOther, address }) {
  const other = countryOther?.trim();
  if (!countryId && !other) {
    throw new AppError('Selecciona tu país (o "Otro país" si no está en la lista).', 400);
  }
  if (countryId && other) {
    throw new AppError("Elige un país de la lista O escribe el nombre — no las dos cosas.", 400);
  }
  if (other) {
    return {
      registrationCountryId: null,
      registrationCountryOther: other,
      provinceId: null,
      municipalityId: null,
      stateOther: null,
      address: null,
    };
  }

  const location = await resolveRealCountryLocation({ countryId, provinceId, municipalityId, stateOther, address });
  if (!location.isCuba && !location.address) {
    throw new AppError("Indica tu dirección.", 400);
  }
  return {
    registrationCountryId: location.country.id,
    registrationCountryOther: null,
    provinceId: location.province?.id ?? null,
    municipalityId: location.municipality?.id ?? null,
    stateOther: location.stateOther,
    address: location.address,
  };
}
