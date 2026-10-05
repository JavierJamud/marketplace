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
//  - Bloque 247 (pedido explícito — "también el municipio"): el municipio sale
//    del catálogo de la provincia; si no está, se escribe a mano y llega al
//    admin como solicitud igual que el país y la provincia. En Cuba se exige
//    uno de los dos con una provincia real; fuera de Cuba es opcional.
//  - Todo texto manual se devuelve en `suggestions` para que quien llama lo
//    registre como solicitud al admin (ver locationSuggestions.service.js).
export const CUBA_COUNTRY_CODE = "CU";

// Valida un país real del catálogo del admin. Con una provincia real de Cuba
// exige además el municipio (del catálogo, perteneciente a esa provincia); con
// una provincia real de otro país no hay municipio; sin provincia real hace
// falta el nombre escrito a mano. `address` es opcional acá a propósito: cada
// llamador decide si además la exige (hace falta cuando no hay municipio con
// el que ubicar a la persona o a la tienda, ver needsAddress).
export async function resolveRealCountryLocation({ countryId, provinceId, municipalityId, municipalityOther, stateOther, address }) {
  if (!countryId) throw new AppError("Selecciona un país.", 400);
  const country = await prisma.country.findUnique({ where: { id: countryId } });
  if (!country || !country.isActive) throw new AppError("País no válido.", 400);

  const isCuba = country.code === CUBA_COUNTRY_CODE;
  const typedMunicipality = municipalityOther?.trim() || null;
  if (municipalityId && typedMunicipality) {
    throw new AppError("Elige un municipio de la lista O escribe el nombre, no las dos cosas.", 400);
  }

  if (provinceId) {
    const province = await prisma.province.findUnique({ where: { id: provinceId } });
    if (!province || province.countryId !== country.id) {
      throw new AppError("La provincia no corresponde al país elegido.", 400);
    }
    if (municipalityId) {
      const municipality = await prisma.municipality.findUnique({ where: { id: municipalityId } });
      if (!municipality || municipality.provinceId !== province.id) {
        throw new AppError("El municipio no corresponde a la provincia elegida.", 400);
      }
      return { country, isCuba, province, municipality, municipalityOther: null, stateOther: null, address: isCuba ? null : address?.trim() || null, suggestions: [] };
    }
    if (isCuba && !typedMunicipality) throw new AppError("Selecciona tu municipio o escríbelo si no aparece en la lista.", 400);
    return {
      country,
      isCuba,
      province,
      municipality: null,
      municipalityOther: typedMunicipality,
      stateOther: null,
      address: address?.trim() || null,
      suggestions: typedMunicipality ? [{ kind: "MUNICIPALITY", name: typedMunicipality, provinceId: province.id }] : [],
    };
  }

  const manual = stateOther?.trim();
  if (!manual) throw new AppError("Selecciona tu provincia o escríbela si no está en la lista.", 400);
  return {
    country,
    isCuba,
    province: null,
    municipality: null,
    // Con una provincia escrita a mano no hay catálogo contra el cual crear la
    // solicitud del municipio: se guarda el texto y la solicitud se genera sola
    // cuando el admin apruebe la provincia (ver locationSuggestions.service.js).
    municipalityOther: typedMunicipality,
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
export async function assertVendorLocationComplete({ countryId, countryOther, provinceId, municipalityId, municipalityOther, stateOther }) {
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
      municipalityOther: null,
      stateOther: null,
      suggestions: [{ kind: "COUNTRY", name: other }],
    };
  }
  const location = await resolveRealCountryLocation({ countryId, provinceId, municipalityId, municipalityOther, stateOther });
  return { ...location, countryOther: null };
}

// Variante para el registro de UNA PERSONA (cliente o vendedor): admite que su
// país real todavía no esté cargado ("otro país" + texto libre) — nunca lo
// obliga a mentir eligiendo uno que no es el suyo. Sin país real, no hay
// provincia/municipio/estado que validar.
export async function resolvePersonRegistrationLocation({ countryId, countryOther, provinceId, municipalityId, municipalityOther, stateOther, address }) {
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
      municipalityOther: null,
      stateOther: null,
      address: null,
      suggestions: [{ kind: "COUNTRY", name: other }],
    };
  }

  const location = await resolveRealCountryLocation({ countryId, provinceId, municipalityId, municipalityOther, stateOther, address });
  if (needsAddress(location) && !location.address) {
    throw new AppError("Indica tu dirección.", 400);
  }
  return {
    registrationCountryId: location.country.id,
    registrationCountryOther: null,
    provinceId: location.province?.id ?? null,
    municipalityId: location.municipality?.id ?? null,
    municipalityOther: location.municipalityOther,
    stateOther: location.stateOther,
    address: location.address,
    suggestions: location.suggestions,
  };
}

// Bloque 247 (pedido explícito — "no deben quedar bloqueados los negocios"):
// la ubicación LEGAL de la verificación (país, provincia y municipio de
// registro del negocio) acepta lo mismo que el registro: una entrada del
// catálogo o, si todavía no está, el nombre escrito a mano. Antes exigía ids
// del catálogo y un negocio registrado con una provincia escrita a mano
// quedaba sin poder verificarse hasta que el admin la aprobara. Cada texto
// manual se devuelve en `suggestions` para que el admin lo revise, y se enlaza
// solo cuando lo apruebe.
export async function resolveLegalLocation({ countryId, countryOther, provinceId, provinceOther, municipalityId, municipalityOther }) {
  const typedCountry = countryOther?.trim() || null;
  const typedProvince = provinceOther?.trim() || null;
  const typedMunicipality = municipalityOther?.trim() || null;

  if (!countryId && !typedCountry) throw new AppError('Elige el país de registro legal de tu negocio (o "Mi país no aparece" si no está en la lista).', 400);
  if (countryId && typedCountry) throw new AppError("Elige un país de la lista O escribe el nombre, no las dos cosas.", 400);
  if (provinceId && typedProvince) throw new AppError("Elige una provincia de la lista O escribe el nombre, no las dos cosas.", 400);
  if (municipalityId && typedMunicipality) throw new AppError("Elige un municipio de la lista O escribe el nombre, no las dos cosas.", 400);
  if (!provinceId && !typedProvince) throw new AppError("Elige o escribe la provincia de registro legal.", 400);

  const out = {
    registrationCountryId: null,
    registrationCountryOther: null,
    legalProvinceId: null,
    legalProvinceOther: null,
    legalMunicipalityId: null,
    legalMunicipalityOther: null,
    suggestions: [],
  };

  let country = null;
  if (countryId) {
    country = await prisma.country.findUnique({ where: { id: countryId } });
    if (!country || !country.isActive) throw new AppError("País no válido.", 400);
    out.registrationCountryId = country.id;
  } else {
    out.registrationCountryOther = typedCountry;
    out.suggestions.push({ kind: "COUNTRY", name: typedCountry });
  }

  let province = null;
  if (provinceId) {
    // Con un país escrito a mano no existe ninguna provincia del catálogo que
    // pertenezca a él: no se acepta un id de provincia suelto.
    if (!country) throw new AppError("La provincia no corresponde al país elegido.", 400);
    province = await prisma.province.findUnique({ where: { id: provinceId } });
    if (!province || province.countryId !== country.id) throw new AppError("La provincia no corresponde al país elegido.", 400);
    out.legalProvinceId = province.id;
  } else {
    out.legalProvinceOther = typedProvince;
    if (country) out.suggestions.push({ kind: "PROVINCE", name: typedProvince, countryId: country.id });
  }

  if (municipalityId) {
    if (!province) throw new AppError("El municipio no corresponde a la provincia elegida.", 400);
    const municipality = await prisma.municipality.findUnique({ where: { id: municipalityId } });
    if (!municipality || municipality.provinceId !== province.id) throw new AppError("El municipio no corresponde a la provincia elegida.", 400);
    out.legalMunicipalityId = municipality.id;
  } else if (typedMunicipality) {
    out.legalMunicipalityOther = typedMunicipality;
    if (province) out.suggestions.push({ kind: "MUNICIPALITY", name: typedMunicipality, provinceId: province.id });
  }
  return out;
}
