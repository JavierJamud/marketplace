import { prisma } from "./prisma.js";
import { getServedLocations } from "../controllers/locations.controller.js";

// Cambio del lugar de entrega desde el chat. El sitio filtra todo por el lugar que eligió el cliente (país, provincia o estado y
// municipio, solo donde hay tiendas registradas). Si en el chat pregunta por otro lugar o pide cambiarlo, el asistente le explica qué
// lugar tiene elegido y cómo cambiarlo con los botones del sitio, y le ofrece hacerlo desde el chat con las mismas preguntas del
// formulario: país, luego provincia o estado, luego municipio (o todo). Cada respuesta se aplica al elegirla. La acción la ejecuta el
// sitio al recibir el campo `apply`, nunca el modelo de IA, y todo se valida contra los lugares con tiendas.

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasName = (text, name) => new RegExp(`(^| )${escape(fold(name))}( |$)`).test(text);

const CHANGE_INTENT = /(cambi|modific|otra|otro|distint|diferent|ver\s+(solo|otra|otro)|mostrar\s+(otra|otro)).{0,40}(provincia|ubicaci|lugar|zona|pais|filtro|entrega|estado)|(provincia|ubicaci|lugar|zona|filtro).{0,30}(cambi|quit|otra|otro|diferent)/;
const CLEAR_INTENT = /(quit|elimin|borr|desactiv|sin\s+filtro|ver\s+todo|todas\s+las\s+(provincias|tiendas|zonas)|todo\s+el\s+(pais|catalogo))/;
const YES = /^(si|claro|dale|ok|okay|vale|confirmo|confirmar|hazlo|cambia|cambialo|cambiar|por favor|adelante|yes)( |$)/;
const NO = /^(no|cancelar|cancela|salir|dejalo|dejarlo|ninguno|nada|mejor no|dejar)( |$)/;
const ALL = /^(todo|todos|toda|todas|ver todo|todo el|toda la|todos los|cualquiera|sin filtro|quitar|y sus municipios|y sus ciudades)( |$)|^todo/;

export const HOW_TO_CHANGE =
  "Para cambiarlo tú mismo: en la portada toca el botón amarillo «Entrega en…» (junto al título) y, en Catálogo, Tiendas y Venta rápida, el botón con tu lugar que está debajo del título. Elige el país, luego la provincia o el estado y el municipio, y toca «Ver resultados». Para ver todo, usa «Quitar el filtro y ver todo».";

async function placeName({ countryId, provinceId, municipalityId }) {
  const [municipality, province, country] = await Promise.all([
    municipalityId ? prisma.municipality.findUnique({ where: { id: municipalityId }, select: { name: true } }) : null,
    provinceId ? prisma.province.findUnique({ where: { id: provinceId }, select: { name: true } }) : null,
    countryId ? prisma.country.findUnique({ where: { id: countryId }, select: { name: true } }) : null,
  ]);
  return [municipality?.name, province?.name, country?.name].filter(Boolean).join(", ");
}

const reply = (text, { options = [], flow = null, apply = null } = {}) => ({ text, actions: options.length || apply || flow ? { zonePick: { options, flow, apply } } : null, followUps: [] });
const opt = (label) => ({ label });
const CANCEL = opt("Cancelar");

// Preguntas del formulario, en orden: país > provincia o estado > municipio.
function askCountry(served, lead = "") {
  return reply(`${lead}¿En qué país quieres ver los productos? Estos son los países donde tenemos tiendas registradas:`, {
    options: [...served.countries.map((c) => opt(c.name)), opt("Ver todos los países"), CANCEL],
    flow: { step: "country" },
  });
}

function askProvince(served, countryId, lead = "") {
  const country = served.countries.find((c) => c.id === countryId);
  const provinces = served.provinces.filter((p) => p.countryId === countryId);
  const kind = provinces.length && provinces.every((p) => p.type === "STATE") ? "estado" : "provincia";
  return reply(`${lead}¿En qué ${kind} de ${country?.name ?? "ese país"} quieres ver los productos?`, {
    options: [...provinces.map((p) => opt(`${p.name} (${p.count} ${p.count === 1 ? "tienda" : "tiendas"})`)), opt(`Todo ${country?.name ?? "el país"}`), CANCEL],
    flow: { step: "province", countryId },
  });
}

function askMunicipality(served, countryId, provinceId, lead = "") {
  const province = served.provinces.find((p) => p.id === provinceId);
  const municipalities = served.municipalities.filter((m) => m.provinceId === provinceId);
  // Las provincias (Cuba) se dividen en municipios; los estados, en ciudades.
  const isState = province?.type === "STATE";
  const many = isState ? "ciudades" : "municipios";
  const one = isState ? "una ciudad en específico" : "un municipio en específico";
  return reply(`${lead}¿Dónde quieres ver los productos: en todo ${province?.name} y sus ${many}, o en ${one}?`, {
    options: [
      opt(`Todo ${province?.name} y sus ${many}`),
      ...municipalities.map((m) => opt(fold(m.name) === fold(province?.name) ? `${m.name} (${isState ? "solo la ciudad" : "solo el municipio"})` : `${m.name} (${m.count} ${m.count === 1 ? "tienda" : "tiendas"})`)),
      CANCEL,
    ],
    flow: { step: "municipality", countryId, provinceId },
  });
}

// Tras aplicar un lugar: pregunta el siguiente nivel si hay lugares con tiendas debajo, o termina.
async function afterApply(served, zone, lead) {
  const label = await placeName(zone);
  // Cada elección se aplica al sitio al instante (el siguiente nivel se pregunta aparte), como en el formulario.
  const withApply = (r) => ({ ...r, actions: { zonePick: { ...r.actions.zonePick, apply: zone } } });
  if (zone.provinceId && !zone.municipalityId && served.municipalities.some((m) => m.provinceId === zone.provinceId)) {
    return withApply(askMunicipality(served, zone.countryId, zone.provinceId, `${lead} `));
  }
  if (zone.countryId && !zone.provinceId && served.provinces.some((p) => p.countryId === zone.countryId)) {
    return withApply(askProvince(served, zone.countryId, `${lead} `));
  }
  return reply(`Listo, ahora ves solo productos y tiendas de ${label}. ¿Qué te gustaría buscar?`, { apply: zone });
}

// Una respuesta escrita (o un botón) dentro de un cambio en curso. Devuelve null si no hay cambio en curso.
export async function routeZoneFlow(message, chatZone, flow) {
  if (!flow?.step) return null;
  const text = fold(message);
  const served = await getServedLocations();

  if (NO.test(text) || text === "cancelar") {
    const current = chatZone?.provinceId || chatZone?.countryId ? await placeName(chatZone) : "";
    return reply(`De acuerdo, dejo tu lugar como está${current ? ` (${current})` : ""}. ¿En qué más te ayudo?`);
  }

  if (flow.step === "clear") {
    if (YES.test(text)) return reply("Listo, quité el filtro: ahora ves productos y tiendas de todos los lugares. ¿Qué te gustaría buscar?", { apply: { clear: true } });
    return reply("¿Quieres que quite el filtro y te muestre todo? Responde sí o no.", { options: [opt("Sí, quitar el filtro"), opt("No, dejarlo")], flow });
  }

  if (flow.step === "confirm") {
    const t = flow.target ?? {};
    if (YES.test(text)) {
      const zone = { countryId: t.countryId ?? null, provinceId: t.provinceId ?? null, municipalityId: null };
      return afterApply(served, zone, `Listo, tu lugar es ahora ${await placeName(zone)}.`);
    }
    return reply(`¿Quieres que cambie tu lugar a ${await placeName(t)}? Responde sí o no.`, { options: [opt(`Sí, cambiar a ${await placeName(t)}`), opt("No, dejarlo")], flow });
  }

  if (flow.step === "country") {
    if (ALL.test(text) || /todos los paises/.test(text)) return reply("Listo, quité el filtro: ahora ves productos y tiendas de todos los países. ¿Qué te gustaría buscar?", { apply: { clear: true } });
    const hit = served.countries.find((c) => hasName(text, c.name) || (text.length >= 3 && fold(c.name).includes(text)));
    if (hit) return afterApply(served, { countryId: hit.id, provinceId: null, municipalityId: null }, `Listo, país: ${hit.name}.`);
    // Existe en el catálogo pero todavía no tiene tiendas, o no es un país que conozcamos.
    const countries = await prisma.country.findMany({ where: { isActive: true }, select: { name: true } });
    const known = countries.find((c) => hasName(text, c.name));
    return askCountry(served, known ? `En ${known.name} todavía no tenemos tiendas registradas. ` : "No encontré ese país entre los que tienen tiendas registradas. ");
  }

  if (flow.step === "province") {
    const provinces = served.provinces.filter((p) => p.countryId === flow.countryId);
    if (ALL.test(text)) return afterApplyCountryOnly(served, flow.countryId);
    const hit = provinces.find((p) => hasName(text, p.name) || (text.length >= 3 && fold(p.name).includes(text)));
    if (hit) return afterApply(served, { countryId: flow.countryId, provinceId: hit.id, municipalityId: null }, `Listo, ${hit.name}.`);
    const all = await prisma.province.findMany({ where: { isActive: true, countryId: flow.countryId }, select: { name: true } });
    const known = all.find((p) => hasName(text, p.name));
    return askProvince(served, flow.countryId, known ? `En ${known.name} todavía no tenemos tiendas registradas. ` : "No encontré esa opción entre los lugares con tiendas. ");
  }

  if (flow.step === "municipality") {
    const municipalities = served.municipalities.filter((m) => m.provinceId === flow.provinceId);
    const province = served.provinces.find((p) => p.id === flow.provinceId);
    // "Todo Santiago y sus municipios" = toda la provincia; el nombre del municipio, solo ese municipio.
    if (ALL.test(text) || /y sus municipios/.test(text) || (text.startsWith("todo ") && province && hasName(text, province.name))) {
      const zone = { countryId: flow.countryId, provinceId: flow.provinceId, municipalityId: null };
      return reply(`Listo, ahora ves productos y tiendas de todo ${await placeName(zone)}, incluidos todos sus municipios. ¿Qué te gustaría buscar?`, { apply: zone });
    }
    const hit = municipalities.find((m) => hasName(text, m.name) || (text.length >= 3 && fold(m.name).includes(text)));
    if (hit) {
      const zone = { countryId: flow.countryId, provinceId: flow.provinceId, municipalityId: hit.id };
      return reply(`Listo, ahora ves solo productos y tiendas del municipio ${hit.name} (${await placeName({ countryId: flow.countryId, provinceId: flow.provinceId })}). ¿Qué te gustaría buscar?`, { apply: zone });
    }
    const all = await prisma.municipality.findMany({ where: { isActive: true, provinceId: flow.provinceId }, select: { name: true } });
    const known = all.find((m) => hasName(text, m.name));
    return askMunicipality(served, flow.countryId, flow.provinceId, known ? `En ${known.name} todavía no tenemos tiendas registradas. ` : "No encontré ese municipio entre los que tienen tiendas. ");
  }
  return null;
}

async function afterApplyCountryOnly(served, countryId) {
  const zone = { countryId, provinceId: null, municipalityId: null };
  return reply(`Listo, ahora ves productos y tiendas de todo ${await placeName(zone)}, incluidas todas sus provincias o estados. ¿Qué te gustaría buscar?`, { apply: zone });
}

// Inicio de un cambio de lugar a partir de lo que escribió el cliente. Devuelve null si el mensaje no trata de cambiar de lugar.
export async function routeZoneChange(message, chatZone) {
  const text = fold(message);
  const wantsClear = CLEAR_INTENT.test(text) && /(filtro|lugar|ubicacion|zona|provincia|todo|todas)/.test(text);
  const wantsChange = CHANGE_INTENT.test(text);
  const served = await getServedLocations();

  // Lugar mencionado (de los que tienen tiendas).
  const provinceHit = served.provinces.find((p) => p.id !== chatZone?.provinceId && hasName(text, p.name));
  const countryHit = !provinceHit ? served.countries.find((c) => c.id !== chatZone?.countryId && hasName(text, c.name)) : null;
  const target = provinceHit
    ? { countryId: provinceHit.countryId, provinceId: provinceHit.id }
    : countryHit
      ? { countryId: countryHit.id, provinceId: null }
      : null;
  const hasZone = !!(chatZone?.provinceId || chatZone?.countryId);
  const current = hasZone ? await placeName(chatZone) : "";
  const where = hasZone ? `Ahora estás viendo solo resultados de ${current}, el lugar de entrega que elegiste, y por eso no te muestro otros lugares. ${HOW_TO_CHANGE}\n\n` : "";

  if (wantsClear && hasZone) {
    return reply(`${where}También puedo quitar el filtro por ti desde aquí. ¿Quieres que quite el filtro y te muestre todo?`, {
      options: [opt("Sí, quitar el filtro"), opt("No, dejarlo")],
      flow: { step: "clear" },
    });
  }

  if (target && (hasZone || wantsChange)) {
    const label = await placeName(target);
    return reply(hasZone ? `${where}También puedo cambiarlo por ti desde aquí. ¿Quieres que cambie tu lugar a ${label}?` : `Puedo poner ${label} como tu lugar de entrega: desde ese momento verás solo productos y tiendas de allí. ¿Quieres que lo cambie?`, {
      options: [opt(`Sí, cambiar a ${label}`), opt("No, dejarlo")],
      flow: { step: "confirm", target },
    });
  }

  // Menciona una provincia que existe pero todavía no tiene tiendas registradas.
  if (hasZone) {
    const provinces = await prisma.province.findMany({ where: { isActive: true }, select: { id: true, name: true } });
    const unserved = provinces.find((p) => p.id !== chatZone.provinceId && !served.provinces.some((s) => s.id === p.id) && hasName(text, p.name));
    if (unserved) return reply(`Todavía no hay tiendas registradas en ${unserved.name}. Ahora estás viendo solo resultados de ${current}, el lugar de entrega que elegiste. ${HOW_TO_CHANGE}`);
  }

  if (wantsChange) {
    if (!served.countries.length) return reply("Todavía no hay tiendas registradas en ningún lugar, así que no hay un lugar que elegir.");
    return askCountry(served, `${where}Puedo cambiarlo por ti desde aquí con las mismas preguntas del formulario. `);
  }
  return null;
}
