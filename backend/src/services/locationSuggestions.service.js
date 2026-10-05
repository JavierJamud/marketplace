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

const CUBA_CODE = "CU";

// "Panamá", "panama" y " PANAMÁ " son lo mismo — se compara sin tildes, sin
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

async function findMatchingIds(client, { kind, normalizedName, countryId }) {
  if (kind === "COUNTRY") {
    const [users, locations] = await Promise.all([
      client.user.findMany({ where: { registrationCountryOther: { not: null } }, select: { id: true, registrationCountryOther: true } }),
      client.vendorLocation.findMany({ where: { countryOther: { not: null } }, select: { id: true, countryOther: true } }),
    ]);
    return {
      userIds: users.filter((u) => normalizeLocationName(u.registrationCountryOther) === normalizedName).map((u) => u.id),
      locationIds: locations.filter((l) => normalizeLocationName(l.countryOther) === normalizedName).map((l) => l.id),
    };
  }
  const [users, locations] = await Promise.all([
    client.user.findMany({ where: { registrationCountryId: countryId, stateOther: { not: null } }, select: { id: true, stateOther: true } }),
    client.vendorLocation.findMany({ where: { countryId, stateOther: { not: null } }, select: { id: true, stateOther: true } }),
  ]);
  return {
    userIds: users.filter((u) => normalizeLocationName(u.stateOther) === normalizedName).map((u) => u.id),
    locationIds: locations.filter((l) => normalizeLocationName(l.stateOther) === normalizedName).map((l) => l.id),
  };
}

// Apunta a todos los que escribieron ese texto a la entrada real y limpia el
// texto manual. Devuelve cuántas personas y tiendas se enlazaron.
async function relink(tx, suggestion, { countryId, provinceId }) {
  const { userIds, locationIds } = await findMatchingIds(tx, suggestion);
  if (suggestion.kind === "COUNTRY") {
    if (userIds.length) await tx.user.updateMany({ where: { id: { in: userIds } }, data: { registrationCountryId: countryId, registrationCountryOther: null } });
    if (locationIds.length) await tx.vendorLocation.updateMany({ where: { id: { in: locationIds } }, data: { countryId, countryOther: null } });
  } else {
    if (userIds.length) await tx.user.updateMany({ where: { id: { in: userIds } }, data: { provinceId, stateOther: null } });
    if (locationIds.length) await tx.vendorLocation.updateMany({ where: { id: { in: locationIds } }, data: { provinceId, stateOther: null } });
  }
  return { people: userIds.length, stores: locationIds.length };
}

// --- Registrar (lo llaman el registro de cliente y el de tienda) -----------

// Nunca rompe un registro: si algo falla acá, la cuenta ya se creó bien y el
// texto manual queda guardado igual — a lo sumo la solicitud se pierde.
export async function recordLocationSuggestions(items) {
  for (const item of items ?? []) {
    try {
      const normalizedName = normalizeLocationName(item.name);
      if (!normalizedName) continue;
      const kind = item.kind;
      const countryId = kind === "PROVINCE" ? item.countryId ?? null : null;

      const existing = await prisma.locationSuggestion.findFirst({ where: { kind, normalizedName, countryId } });
      if (existing) {
        await prisma.locationSuggestion.update({ where: { id: existing.id }, data: { mentionCount: { increment: 1 }, lastSeenAt: new Date() } });
        // Ya resuelta antes (el cliente tenía la lista vieja en pantalla): se
        // enlaza de una a la entrada real en vez de dejar otro texto suelto.
        if (existing.status === "APPROVED" || existing.status === "MERGED") {
          await prisma.$transaction((tx) =>
            relink(tx, existing, { countryId: existing.resolvedCountryId, provinceId: existing.resolvedProvinceId })
          );
        }
        continue;
      }

      const created = await prisma.locationSuggestion.create({ data: { kind, name: String(item.name).trim(), normalizedName, countryId } });
      let where = "";
      if (kind === "PROVINCE" && countryId) {
        const country = await prisma.country.findUnique({ where: { id: countryId }, select: { name: true } });
        where = country ? ` en ${country.name}` : "";
      }
      // Solo la primera vez que aparece ese nombre — las menciones repetidas
      // suben el contador, no mandan otro correo.
      await notifyAdminActionNeeded(
        `📍 Nueva solicitud de ${kind === "COUNTRY" ? "país" : "provincia"}: ${created.name}`,
        `Alguien escribió a mano ${kind === "COUNTRY" ? "el país" : "la provincia o estado"} "${created.name}"${where} al registrarse porque no lo encontró en la lista.\n\n` +
          `Revísala en Admin → Países y provincias → Solicitudes: puedes aprobarla (se crea y se enlaza a quien la escribió), fusionarla con una que ya existe, o rechazarla.`
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
    include: { country: { select: { id: true, name: true, code: true } } },
    orderBy: [{ mentionCount: "desc" }, { createdAt: "desc" }],
  });
  if (suggestions.length === 0) return [];

  // Cuántas personas y tiendas hay hoy detrás de cada texto: se lee una vez el
  // conjunto de textos manuales (son pocos) y se reparte por nombre
  // normalizado, nunca una consulta por solicitud.
  const [usersCountry, usersState, locCountry, locState] = await Promise.all([
    prisma.user.findMany({ where: { registrationCountryOther: { not: null } }, select: { registrationCountryOther: true } }),
    prisma.user.findMany({ where: { stateOther: { not: null }, registrationCountryId: { not: null } }, select: { stateOther: true, registrationCountryId: true } }),
    prisma.vendorLocation.findMany({ where: { countryOther: { not: null } }, select: { countryOther: true } }),
    prisma.vendorLocation.findMany({ where: { stateOther: { not: null }, countryId: { not: null } }, select: { stateOther: true, countryId: true } }),
  ]);
  const tally = (rows, textOf, countryOf) => {
    const map = new Map();
    for (const row of rows) {
      const key = `${countryOf ? countryOf(row) : ""}|${normalizeLocationName(textOf(row))}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  };
  const peopleCountry = tally(usersCountry, (r) => r.registrationCountryOther);
  const peopleState = tally(usersState, (r) => r.stateOther, (r) => r.registrationCountryId);
  const storesCountry = tally(locCountry, (r) => r.countryOther);
  const storesState = tally(locState, (r) => r.stateOther, (r) => r.countryId);

  return suggestions.map((s) => {
    const key = `${s.kind === "PROVINCE" ? s.countryId : ""}|${s.normalizedName}`;
    return {
      id: s.id,
      kind: s.kind,
      name: s.name,
      country: s.country,
      status: s.status,
      mentionCount: s.mentionCount,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      reviewedAt: s.reviewedAt,
      people: (s.kind === "COUNTRY" ? peopleCountry : peopleState).get(key) ?? 0,
      stores: (s.kind === "COUNTRY" ? storesCountry : storesState).get(key) ?? 0,
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

  return prisma.$transaction(async (tx) => {
    let linked;
    let resolvedCountryId = null;
    let resolvedProvinceId = null;

    if (suggestion.kind === "COUNTRY") {
      const upper = String(code ?? "").trim().toUpperCase();
      if (!/^[A-Z]{2,3}$/.test(upper)) throw new AppError("El código del país son 2 o 3 letras (ej. PA para Panamá).", 400);
      if (await tx.country.findUnique({ where: { code: upper } })) throw new AppError(`Ya existe un país con el código ${upper}.`, 409);
      const country = await tx.country.create({ data: { code: upper, name: finalName, isActive: true } });
      resolvedCountryId = country.id;
      linked = await relink(tx, suggestion, { countryId: country.id });
    } else {
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
    }

    await tx.locationSuggestion.update({
      where: { id },
      data: { status: "APPROVED", resolvedCountryId, resolvedProvinceId, reviewedAt: new Date() },
    });
    return linked;
  });
}

export async function mergeSuggestion(id, { targetId }) {
  const suggestion = await getPending(id);

  return prisma.$transaction(async (tx) => {
    let linked;
    let resolvedCountryId = null;
    let resolvedProvinceId = null;

    if (suggestion.kind === "COUNTRY") {
      const country = await tx.country.findUnique({ where: { id: targetId } });
      if (!country) throw new AppError("El país elegido no existe.", 404);
      resolvedCountryId = country.id;
      linked = await relink(tx, suggestion, { countryId: country.id });
    } else {
      const province = await tx.province.findUnique({ where: { id: targetId } });
      if (!province) throw new AppError("La provincia elegida no existe.", 404);
      if (province.countryId !== suggestion.countryId) throw new AppError("Esa provincia pertenece a otro país.", 400);
      resolvedCountryId = province.countryId;
      resolvedProvinceId = province.id;
      linked = await relink(tx, suggestion, { provinceId: province.id });
    }

    await tx.locationSuggestion.update({
      where: { id },
      data: { status: "MERGED", resolvedCountryId, resolvedProvinceId, reviewedAt: new Date() },
    });
    return linked;
  });
}

// Rechazar no borra el texto de quien lo escribió (sigue siendo su dato),
// solo cierra la solicitud: si alguien más escribe lo mismo, suma menciones a
// la solicitud ya rechazada sin volver a avisar al admin.
export async function rejectSuggestion(id) {
  await getPending(id);
  await prisma.locationSuggestion.update({ where: { id }, data: { status: "REJECTED", reviewedAt: new Date() } });
}
