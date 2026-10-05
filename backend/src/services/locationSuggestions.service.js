import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { notifyAdminActionNeeded } from "../lib/adminNotify.js";

// Bloque 244 (pedido explícito — "si el cliente no encuentra su país o
// provincia, puede escribirla a mano y el admin la revisa y la agrega"):
// hasta ahora esos textos (User.registrationCountryOther/stateOther,
// VendorLocation.stateOther) quedaban guardados pero ningún panel los leía.
// Acá se juntan en solicitudes (LocationSuggestion) y se resuelven: aprobar
// crea el país/provincia real, fusionar la enlaza a uno que ya existía, y en
// los dos casos TODAS las personas y tiendas que la habían escrito pasan a
// apuntar a la entrada real (y su texto manual se limpia).
// Bloque 247 (pedido explícito): también el MUNICIPIO, y también los datos
// legales de la verificación (Vendor.registrationCountryOther, etc.), para que
// ningún negocio quede bloqueado por una ubicación que todavía no está en el
// catálogo. Al aprobar, la entrada nueva aparece en las listas del registro
// para todas las personas que se registren después en ese mismo lugar.

const CUBA_CODE = "CU";

// "Panamá", "panama" y " PANAMÁ " son lo mismo: se compara sin tildes, sin
// mayúsculas y con espacios simples. Se hace en JS (no con unaccent() de
// Postgres) porque los conjuntos a comparar son los textos manuales, que son
// pocos, y así no depende de la extensión.
export function normalizeLocationName(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// --- Enlazar a las personas y tiendas que escribieron el texto -------------
//
// Hay tres lugares donde se escribe a mano: la persona (User), el lugar donde
// opera una tienda (VendorLocation) y los datos legales de la verificación
// (Vendor.registrationCountryOther / legalProvinceOther / legalMunicipalityOther).
// Los tres se enlazan juntos al aprobar o fusionar.

async function findMatchingIds(client, { kind, normalizedName, countryId, provinceId }) {
  const same = (text) => normalizeLocationName(text) === normalizedName;
  if (kind === "COUNTRY") {
    const [users, locations, vendors] = await Promise.all([
      client.user.findMany({ where: { registrationCountryOther: { not: null } }, select: { id: true, registrationCountryOther: true } }),
      client.vendorLocation.findMany({ where: { countryOther: { not: null } }, select: { id: true, countryOther: true } }),
      client.vendor.findMany({ where: { registrationCountryOther: { not: null } }, select: { id: true, registrationCountryOther: true } }),
    ]);
    return {
      userIds: users.filter((u) => same(u.registrationCountryOther)).map((u) => u.id),
      locationIds: locations.filter((l) => same(l.countryOther)).map((l) => l.id),
      vendorIds: vendors.filter((v) => same(v.registrationCountryOther)).map((v) => v.id),
    };
  }
  if (kind === "PROVINCE") {
    const [users, locations, vendors] = await Promise.all([
      client.user.findMany({ where: { registrationCountryId: countryId, stateOther: { not: null } }, select: { id: true, stateOther: true } }),
      client.vendorLocation.findMany({ where: { countryId, stateOther: { not: null } }, select: { id: true, stateOther: true } }),
      client.vendor.findMany({ where: { registrationCountryId: countryId, legalProvinceOther: { not: null } }, select: { id: true, legalProvinceOther: true } }),
    ]);
    return {
      userIds: users.filter((u) => same(u.stateOther)).map((u) => u.id),
      locationIds: locations.filter((l) => same(l.stateOther)).map((l) => l.id),
      vendorIds: vendors.filter((v) => same(v.legalProvinceOther)).map((v) => v.id),
    };
  }
  const [users, locations, vendors] = await Promise.all([
    client.user.findMany({ where: { provinceId, municipalityOther: { not: null } }, select: { id: true, municipalityOther: true } }),
    client.vendorLocation.findMany({ where: { provinceId, municipalityOther: { not: null } }, select: { id: true, municipalityOther: true } }),
    client.vendor.findMany({ where: { legalProvinceId: provinceId, legalMunicipalityOther: { not: null } }, select: { id: true, legalMunicipalityOther: true } }),
  ]);
  return {
    userIds: users.filter((u) => same(u.municipalityOther)).map((u) => u.id),
    locationIds: locations.filter((l) => same(l.municipalityOther)).map((l) => l.id),
    vendorIds: vendors.filter((v) => same(v.legalMunicipalityOther)).map((v) => v.id),
  };
}

// Apunta a todos los que escribieron ese texto a la entrada real y limpia el
// texto manual. Devuelve cuántas personas y tiendas se enlazaron.
async function relink(tx, suggestion, { countryId, provinceId, municipalityId }) {
  const { userIds, locationIds, vendorIds } = await findMatchingIds(tx, suggestion);
  const forUsers = { id: { in: userIds } };
  const forLocations = { id: { in: locationIds } };
  const forVendors = { id: { in: vendorIds } };
  if (suggestion.kind === "COUNTRY") {
    if (userIds.length) await tx.user.updateMany({ where: forUsers, data: { registrationCountryId: countryId, registrationCountryOther: null } });
    if (locationIds.length) await tx.vendorLocation.updateMany({ where: forLocations, data: { countryId, countryOther: null } });
    if (vendorIds.length) await tx.vendor.updateMany({ where: forVendors, data: { registrationCountryId: countryId, registrationCountryOther: null } });
  } else if (suggestion.kind === "PROVINCE") {
    if (userIds.length) await tx.user.updateMany({ where: forUsers, data: { provinceId, stateOther: null } });
    if (locationIds.length) await tx.vendorLocation.updateMany({ where: forLocations, data: { provinceId, stateOther: null } });
    if (vendorIds.length) await tx.vendor.updateMany({ where: forVendors, data: { legalProvinceId: provinceId, legalProvinceOther: null } });
  } else {
    if (userIds.length) await tx.user.updateMany({ where: forUsers, data: { municipalityId, municipalityOther: null } });
    if (locationIds.length) await tx.vendorLocation.updateMany({ where: forLocations, data: { municipalityId, municipalityOther: null } });
    if (vendorIds.length) await tx.vendor.updateMany({ where: forVendors, data: { legalMunicipalityId: municipalityId, legalMunicipalityOther: null } });
  }
  return { people: userIds.length, stores: locationIds.length + vendorIds.length };
}

// Cuando se aprueba una provincia, los municipios que la gente había escrito a
// mano junto con ella (guardados como texto, sin solicitud porque la provincia
// aún no existía) pasan a ser solicitudes de municipio de esa provincia nueva.
async function spawnMunicipalitySuggestions(provinceId) {
  const [users, locations, vendors] = await Promise.all([
    prisma.user.findMany({ where: { provinceId, municipalityOther: { not: null } }, select: { municipalityOther: true } }),
    prisma.vendorLocation.findMany({ where: { provinceId, municipalityOther: { not: null } }, select: { municipalityOther: true } }),
    prisma.vendor.findMany({ where: { legalProvinceId: provinceId, legalMunicipalityOther: { not: null } }, select: { legalMunicipalityOther: true } }),
  ]);
  const names = new Map();
  for (const text of [...users.map((u) => u.municipalityOther), ...locations.map((l) => l.municipalityOther), ...vendors.map((v) => v.legalMunicipalityOther)]) {
    const key = normalizeLocationName(text);
    if (key && !names.has(key)) names.set(key, text);
  }
  await recordLocationSuggestions([...names.values()].map((name) => ({ kind: "MUNICIPALITY", name, provinceId })));
}

// --- Registrar (lo llaman el registro de cliente, el de tienda y la verificación) ---

const KIND_LABEL = { COUNTRY: "país", PROVINCE: "provincia", MUNICIPALITY: "municipio" };
const KIND_PHRASE = { COUNTRY: "el país", PROVINCE: "la provincia o estado", MUNICIPALITY: "el municipio" };

// Nunca rompe un registro: si algo falla acá, la cuenta ya se creó bien y el
// texto manual queda guardado igual, a lo sumo la solicitud se pierde.
export async function recordLocationSuggestions(items) {
  for (const item of items ?? []) {
    try {
      const normalizedName = normalizeLocationName(item.name);
      if (!normalizedName) continue;
      const kind = item.kind;
      const countryId = kind === "PROVINCE" ? item.countryId ?? null : null;
      const provinceId = kind === "MUNICIPALITY" ? item.provinceId ?? null : null;
      // Una provincia necesita su país y un municipio su provincia: sin eso no
      // hay dónde crearlos al aprobar (el texto igual queda guardado).
      if (kind === "PROVINCE" && !countryId) continue;
      if (kind === "MUNICIPALITY" && !provinceId) continue;

      const existing = await prisma.locationSuggestion.findFirst({ where: { kind, normalizedName, countryId, provinceId } });
      if (existing) {
        await prisma.locationSuggestion.update({ where: { id: existing.id }, data: { mentionCount: { increment: 1 }, lastSeenAt: new Date() } });
        // Ya resuelta antes (el cliente tenía la lista vieja en pantalla): se
        // enlaza de una a la entrada real en vez de dejar otro texto suelto.
        if (existing.status === "APPROVED" || existing.status === "MERGED") {
          await prisma.$transaction((tx) =>
            relink(tx, existing, {
              countryId: existing.resolvedCountryId,
              provinceId: existing.resolvedProvinceId,
              municipalityId: existing.resolvedMunicipalityId,
            })
          );
        }
        continue;
      }

      const created = await prisma.locationSuggestion.create({ data: { kind, name: String(item.name).trim(), normalizedName, countryId, provinceId } });
      let where = "";
      if (kind === "PROVINCE" && countryId) {
        const country = await prisma.country.findUnique({ where: { id: countryId }, select: { name: true } });
        where = country ? ` en ${country.name}` : "";
      }
      if (kind === "MUNICIPALITY" && provinceId) {
        const province = await prisma.province.findUnique({ where: { id: provinceId }, select: { name: true } });
        where = province ? ` en ${province.name}` : "";
      }
      // Solo la primera vez que aparece ese nombre: las menciones repetidas
      // suben el contador, no mandan otro correo.
      await notifyAdminActionNeeded(
        `📍 Nueva solicitud de ${KIND_LABEL[kind]}: ${created.name}`,
        `Alguien escribió a mano ${KIND_PHRASE[kind]} "${created.name}"${where} porque no lo encontró en la lista.\n\n` +
          `Revísala en Admin → Países y provincias → Solicitudes: puedes aprobarla (se crea, se enlaza a quien la escribió y desde ese momento aparece en la lista para los demás), fusionarla con una que ya existe, o rechazarla.`
      ).catch(() => {});
    } catch (err) {
      console.error("[locationSuggestions] no se pudo registrar la solicitud:", err);
    }
  }
}

// --- Listar -----------------------------------------------------------------

export async function countPendingSuggestions() {
  return prisma.locationSuggestion.count({ where: { status: "PENDING" } });
}

export async function listSuggestions(status = "PENDING") {
  const suggestions = await prisma.locationSuggestion.findMany({
    where: status === "ALL" ? {} : { status },
    include: {
      country: { select: { id: true, name: true, code: true } },
      province: { select: { id: true, name: true, country: { select: { name: true } } } },
    },
    orderBy: [{ mentionCount: "desc" }, { createdAt: "desc" }],
  });
  if (suggestions.length === 0) return [];

  // Cuántas personas y tiendas hay hoy detrás de cada texto: se lee una vez el
  // conjunto de textos manuales (son pocos) y se reparte por nombre
  // normalizado, nunca una consulta por solicitud.
  const [uCountry, uState, uMuni, lCountry, lState, lMuni, vCountry, vState, vMuni] = await Promise.all([
    prisma.user.findMany({ where: { registrationCountryOther: { not: null } }, select: { registrationCountryOther: true } }),
    prisma.user.findMany({ where: { stateOther: { not: null }, registrationCountryId: { not: null } }, select: { stateOther: true, registrationCountryId: true } }),
    prisma.user.findMany({ where: { municipalityOther: { not: null }, provinceId: { not: null } }, select: { municipalityOther: true, provinceId: true } }),
    prisma.vendorLocation.findMany({ where: { countryOther: { not: null } }, select: { countryOther: true } }),
    prisma.vendorLocation.findMany({ where: { stateOther: { not: null }, countryId: { not: null } }, select: { stateOther: true, countryId: true } }),
    prisma.vendorLocation.findMany({ where: { municipalityOther: { not: null }, provinceId: { not: null } }, select: { municipalityOther: true, provinceId: true } }),
    prisma.vendor.findMany({ where: { registrationCountryOther: { not: null } }, select: { registrationCountryOther: true } }),
    prisma.vendor.findMany({ where: { legalProvinceOther: { not: null }, registrationCountryId: { not: null } }, select: { legalProvinceOther: true, registrationCountryId: true } }),
    prisma.vendor.findMany({ where: { legalMunicipalityOther: { not: null }, legalProvinceId: { not: null } }, select: { legalMunicipalityOther: true, legalProvinceId: true } }),
  ]);
  const tally = (rows, textOf, scopeOf) => {
    const map = new Map();
    for (const row of rows) {
      const key = `${scopeOf ? scopeOf(row) : ""}|${normalizeLocationName(textOf(row))}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  };
  const counts = {
    COUNTRY: {
      people: tally(uCountry, (r) => r.registrationCountryOther),
      stores: tally([...lCountry.map((r) => ({ t: r.countryOther })), ...vCountry.map((r) => ({ t: r.registrationCountryOther }))], (r) => r.t),
    },
    PROVINCE: {
      people: tally(uState, (r) => r.stateOther, (r) => r.registrationCountryId),
      stores: tally(
        [...lState.map((r) => ({ t: r.stateOther, c: r.countryId })), ...vState.map((r) => ({ t: r.legalProvinceOther, c: r.registrationCountryId }))],
        (r) => r.t,
        (r) => r.c
      ),
    },
    MUNICIPALITY: {
      people: tally(uMuni, (r) => r.municipalityOther, (r) => r.provinceId),
      stores: tally(
        [...lMuni.map((r) => ({ t: r.municipalityOther, p: r.provinceId })), ...vMuni.map((r) => ({ t: r.legalMunicipalityOther, p: r.legalProvinceId }))],
        (r) => r.t,
        (r) => r.p
      ),
    },
  };

  return suggestions.map((s) => {
    const scope = s.kind === "PROVINCE" ? s.countryId : s.kind === "MUNICIPALITY" ? s.provinceId : "";
    const key = `${scope}|${s.normalizedName}`;
    return {
      id: s.id,
      kind: s.kind,
      name: s.name,
      country: s.country,
      province: s.province ? { id: s.province.id, name: s.province.name, countryName: s.province.country?.name ?? null } : null,
      status: s.status,
      mentionCount: s.mentionCount,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      reviewedAt: s.reviewedAt,
      people: counts[s.kind].people.get(key) ?? 0,
      stores: counts[s.kind].stores.get(key) ?? 0,
    };
  });
}

// --- Resolver ---------------------------------------------------------------

async function getPending(id) {
  const suggestion = await prisma.locationSuggestion.findUnique({ where: { id } });
  if (!suggestion) throw new AppError("Solicitud no encontrada.", 404);
  if (suggestion.status !== "PENDING") throw new AppError("Esta solicitud ya fue resuelta.", 409);
  return suggestion;
}

function slugForCode(name) {
  return normalizeLocationName(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase().slice(0, 14);
}

// Province.code es único y obligatorio: se arma "<país>-<nombre>" y, si ya
// existe, se le suma un número.
async function uniqueProvinceCode(tx, countryCode, name) {
  const base = `${countryCode}-${slugForCode(name) || "X"}`;
  let code = base;
  for (let n = 2; await tx.province.findUnique({ where: { code } }); n++) code = `${base}-${n}`;
  return code;
}

export async function approveSuggestion(id, { code, name }) {
  const suggestion = await getPending(id);
  const finalName = (name ?? suggestion.name).trim();

  const result = await prisma.$transaction(async (tx) => {
    let linked;
    let resolvedCountryId = null;
    let resolvedProvinceId = null;
    let resolvedMunicipalityId = null;

    if (suggestion.kind === "COUNTRY") {
      const upper = String(code ?? "").trim().toUpperCase();
      if (!/^[A-Z]{2,3}$/.test(upper)) throw new AppError("El código del país son 2 o 3 letras (ej. PA para Panamá).", 400);
      if (await tx.country.findUnique({ where: { code: upper } })) throw new AppError(`Ya existe un país con el código ${upper}.`, 409);
      const country = await tx.country.create({ data: { code: upper, name: finalName, isActive: true } });
      resolvedCountryId = country.id;
      linked = await relink(tx, suggestion, { countryId: country.id });
    } else if (suggestion.kind === "PROVINCE") {
      const country = await tx.country.findUnique({ where: { id: suggestion.countryId } });
      if (!country) throw new AppError("El país de esta solicitud ya no existe.", 409);
      const province = await tx.province.create({
        data: {
          code: await uniqueProvinceCode(tx, country.code, finalName),
          name: finalName,
          type: country.code === CUBA_CODE ? "PROVINCE" : "STATE",
          countryId: country.id,
          isActive: true,
        },
      });
      resolvedCountryId = country.id;
      resolvedProvinceId = province.id;
      linked = await relink(tx, suggestion, { provinceId: province.id });
    } else {
      const province = await tx.province.findUnique({ where: { id: suggestion.provinceId } });
      if (!province) throw new AppError("La provincia de esta solicitud ya no existe.", 409);
      const duplicate = await tx.municipality.findFirst({ where: { provinceId: province.id, name: { equals: finalName, mode: "insensitive" } } });
      if (duplicate) throw new AppError(`Ya existe el municipio "${duplicate.name}" en ${province.name}: fusiona la solicitud con ese en vez de crear otro.`, 409);
      const municipality = await tx.municipality.create({ data: { provinceId: province.id, name: finalName, isActive: true } });
      resolvedCountryId = province.countryId;
      resolvedProvinceId = province.id;
      resolvedMunicipalityId = municipality.id;
      linked = await relink(tx, suggestion, { municipalityId: municipality.id });
    }

    await tx.locationSuggestion.update({
      where: { id },
      data: { status: "APPROVED", resolvedCountryId, resolvedProvinceId, resolvedMunicipalityId, reviewedAt: new Date() },
    });
    return { linked, newProvinceId: suggestion.kind === "PROVINCE" ? resolvedProvinceId : null };
  });
  if (result.newProvinceId) await spawnMunicipalitySuggestions(result.newProvinceId);
  return result.linked;
}

export async function mergeSuggestion(id, { targetId }) {
  const suggestion = await getPending(id);

  const result = await prisma.$transaction(async (tx) => {
    let linked;
    let resolvedCountryId = null;
    let resolvedProvinceId = null;
    let resolvedMunicipalityId = null;

    if (suggestion.kind === "COUNTRY") {
      const country = await tx.country.findUnique({ where: { id: targetId } });
      if (!country) throw new AppError("El país elegido no existe.", 404);
      resolvedCountryId = country.id;
      linked = await relink(tx, suggestion, { countryId: country.id });
    } else if (suggestion.kind === "PROVINCE") {
      const province = await tx.province.findUnique({ where: { id: targetId } });
      if (!province) throw new AppError("La provincia elegida no existe.", 404);
      if (province.countryId !== suggestion.countryId) throw new AppError("Esa provincia pertenece a otro país.", 400);
      resolvedCountryId = province.countryId;
      resolvedProvinceId = province.id;
      linked = await relink(tx, suggestion, { provinceId: province.id });
    } else {
      const municipality = await tx.municipality.findUnique({ where: { id: targetId }, include: { province: true } });
      if (!municipality) throw new AppError("El municipio elegido no existe.", 404);
      if (municipality.provinceId !== suggestion.provinceId) throw new AppError("Ese municipio pertenece a otra provincia.", 400);
      resolvedCountryId = municipality.province.countryId;
      resolvedProvinceId = municipality.provinceId;
      resolvedMunicipalityId = municipality.id;
      linked = await relink(tx, suggestion, { municipalityId: municipality.id });
    }

    await tx.locationSuggestion.update({
      where: { id },
      data: { status: "MERGED", resolvedCountryId, resolvedProvinceId, resolvedMunicipalityId, reviewedAt: new Date() },
    });
    return { linked, newProvinceId: suggestion.kind === "PROVINCE" ? resolvedProvinceId : null };
  });
  if (result.newProvinceId) await spawnMunicipalitySuggestions(result.newProvinceId);
  return result.linked;
}

// Rechazar no borra el texto de quien lo escribió (sigue siendo su dato),
// solo cierra la solicitud: si alguien más escribe lo mismo, suma menciones a
// la solicitud ya rechazada sin volver a avisar al admin.
export async function rejectSuggestion(id) {
  await getPending(id);
  await prisma.locationSuggestion.update({ where: { id }, data: { status: "REJECTED", reviewedAt: new Date() } });
}
