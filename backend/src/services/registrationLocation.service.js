import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

// Bloque 113 (pedido explícito): país/provincia/municipio en el registro
// (cliente Y vendedor) — mismo criterio de validación en los dos lugares
// que lo necesitan (auth.controller.js para la persona, vendors.controller.js
// para dónde opera la tienda), factorizado acá para no divergir con el
// tiempo.
// Bloque 114 (pedido explícito, follow-up): fuera de Cuba el estado era SIEMPRE
// texto libre y Cuba exigía provincia+municipio del catálogo.
// Bloque 244 (pedido explícito — "más libre para recibir negocios de muchos
// lugares, pero que solo puedan registrarse en lo definido por el admin, y si
// no lo encuentran, escribirlo a mano para que el admin lo revise"): reglas
// finales, iguales para cualquier país:
//  - El país sale del catálogo; si no está, se escribe a mano ("otro país").
//    Antes solo las personas podían; ahora también las tiendas.
//  - La provincia/estado sale del catálogo de ESE país; si no está (o el país
//    todavía no tiene provincias cargadas), se escribe a mano.
//  - El municipio sigue siendo solo de Cuba y del catálogo (se deja como
//    estaba, pedido explícito): únicamente se exige cuando se eligió una
//    provincia real de Cuba.
//  - Todo texto manual se devuelve en `suggestions` para que quien llama lo
//    registre como solicitud al admin (ver locationSuggestions.service.js).
export const CUBA_COUNTRY_CODE = "CU";

// Valida un país real del catálogo del admin. Con una provincia real de Cuba
// exige además el municipio (del catálogo, perteneciente a esa provincia); con
// una provincia real de otro país no hay municipio; sin provincia real hace
// falta el nombre escrito a mano. `address` es opcional acá a propósito: cada
// llamador decide si además la exige (hace falta cuando no hay municipio con
// el que ubicar a la persona o a la tienda, ver needsAddress).
export async function resolveRealCountryLocation({ countryId, provinceId, municipalityId, stateOther, address }) {
  if (!countryId) throw new AppError("Selecciona un país.", 400);
  const country = await prisma.country.findUnique({ where: { id: countryId } });
  if (!country || !country.isActive) throw new AppError("País no válido.", 400);

  const isCuba = country.code === CUBA_COUNTRY_CODE;

  if (provinceId) {
    const province = await prisma.province.findUnique({ where: { id: provinceId } });
    if (!province || province.countryId !== country.id) {
      throw new AppError("La provincia no corresponde al país elegido.", 400);
    }
    if (!isCuba) {
      return { country, isCuba, province, municipality: null, stateOther: null, address: address?.trim() || null, suggestions: [] };
    }
    if (!municipalityId) throw new AppError("Selecciona tu municipio.", 400);
    const municipality = await prisma.municipality.findUnique({ where: { id: municipalityId } });
    if (!municipality || municipality.provinceId !== province.id) {
      throw new AppError("El municipio no corresponde a la provincia elegida.", 400);
    }
    return { country, isCuba, province, municipality, stateOther: null, address: null, suggestions: [] };
  }

  const manual = stateOther?.trim();
  if (!manual) throw new AppError("Selecciona tu provincia o escríbela si no está en la lista.", 400);
  return {
    country,
    isCuba,
    province: null,
    municipality: null,
    stateOther: manual,
    address: address?.trim() || null,
    suggestions: [{ kind: "PROVINCE", name: manual, countryId: country.id }],
  };
}

// Sin municipio real no hay forma de ubicar la dirección, así que se pide
// escrita: cualquier país que no sea Cuba, o Cuba con una provincia escrita a
// mano. Un país escrito a mano no la pide (no hay contra qué validarla).
export function needsAddress(location) {
  return !!location.country && !location.municipality;
}

// Variante para la UBICACIÓN DE LA TIENDA (VendorLocation, "dónde presto
// servicio/vendo"). Bloque 244: ahora también admite un país escrito a mano
// (countryId null, countryOther lleno) — antes se rechazaba porque el
// marketplace "no puede listar en un país que no tiene cargado"; la tienda
// queda registrada y su ubicación pendiente hasta que el admin apruebe el
// país. La dirección en sí vive en Vendor.companyAddress (un vendedor
// registra un solo local) — se valida aparte en vendors.controller.js.
export async function assertVendorLocationComplete({ countryId, countryOther, provinceId, municipalityId, stateOther }) {
  const other = countryOther?.trim();
  if (!countryId && !other) throw new AppError('Selecciona el país donde va a operar tu tienda (o "Mi país no aparece" si no está en la lista).', 400);
  if (countryId && other) throw new AppError("Elige un país de la lista O escribe el nombre, no las dos cosas.", 400);
  if (other) {
    return {
      country: null,
      countryOther: other,
      isCuba: false,
      province: null,
      municipality: null,
      stateOther: null,
      suggestions: [{ kind: "COUNTRY", name: other }],
    };
  }
  const location = await resolveRealCountryLocation({ countryId, provinceId, municipalityId, stateOther });
  return { ...location, countryOther: null };
}

// Variante para el registro de UNA PERSONA (cliente o vendedor): admite que su
// país real todavía no esté cargado ("otro país" + texto libre) — nunca lo
// obliga a mentir eligiendo uno que no es el suyo. Sin país real, no hay
// provincia/municipio/estado que validar.
export async function resolvePersonRegistrationLocation({ countryId, countryOther, provinceId, municipalityId, stateOther, address }) {
  const other = countryOther?.trim();
  if (!countryId && !other) {
    throw new AppError('Selecciona tu país (o "Mi país no aparece" si no está en la lista).', 400);
  }
  if (countryId && other) {
    throw new AppError("Elige un país de la lista O escribe el nombre, no las dos cosas.", 400);
  }
  if (other) {
    return {
      registrationCountryId: null,
      registrationCountryOther: other,
      provinceId: null,
      municipalityId: null,
      stateOther: null,
      address: null,
      suggestions: [{ kind: "COUNTRY", name: other }],
    };
  }

  const location = await resolveRealCountryLocation({ countryId, provinceId, municipalityId, stateOther, address });
  if (needsAddress(location) && !location.address) {
    throw new AppError("Indica tu dirección.", 400);
  }
  return {
    registrationCountryId: location.country.id,
    registrationCountryOther: null,
    provinceId: location.province?.id ?? null,
    municipalityId: location.municipality?.id ?? null,
    stateOther: location.stateOther,
    address: location.address,
    suggestions: location.suggestions,
  };
}
