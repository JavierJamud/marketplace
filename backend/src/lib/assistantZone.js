import { prisma } from "./prisma.js";
import { getServedLocations } from "../controllers/locations.controller.js";

// Cambio del lugar de entrega desde el chat. El sitio filtra todo por el lugar que eligió el cliente; si en el chat pregunta por otro
// lugar, el asistente no mezcla resultados: le explica qué lugar tiene elegido, cómo cambiarlo con los botones del sitio y le ofrece
// cambiarlo por él desde el chat, siempre pidiendo confirmación (la acción la ejecuta el sitio al tocar el botón, nunca el modelo).

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
const hasName = (text, name) => new RegExp(`(^| )${fold(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(text);

const CHANGE_INTENT = /(cambi|modific|otra|otro|distint|diferent|ver\s+(solo|otra|otro)|mostrar\s+(otra|otro)).{0,40}(provincia|ubicaci|lugar|zona|pais|filtro|entrega|estado)|(provincia|ubicaci|lugar|zona|filtro).{0,30}(cambi|quit|otra|otro|diferent)/;
const CLEAR_INTENT = /(quit|elimin|borr|desactiv|sin\s+filtro|ver\s+todo|todas\s+las\s+(provincias|tiendas|zonas)|todo\s+el\s+(pais|catalogo))/;

export const HOW_TO_CHANGE =
  "Para cambiarlo tú mismo: en la portada toca el botón amarillo «Entrega en…» (junto al título) y, en Catálogo, Tiendas y Venta rápida, el botón con tu lugar que está debajo del título. Elige el país y luego la provincia o el estado, y toca «Ver resultados». Para ver todo, usa «Quitar el filtro y ver todo».";

async function placeName({ countryId, provinceId, municipalityId }) {
  const [municipality, province, country] = await Promise.all([
    municipalityId ? prisma.municipality.findUnique({ where: { id: municipalityId }, select: { name: true } }) : null,
    provinceId ? prisma.province.findUnique({ where: { id: provinceId }, select: { name: true } }) : null,
    countryId ? prisma.country.findUnique({ where: { id: countryId }, select: { name: true } }) : null,
  ]);
  return [municipality?.name, province?.name, country?.name].filter(Boolean).join(", ");
}

// Devuelve null si el mensaje no trata de cambiar de lugar; si sí, la respuesta lista para el cliente (texto + botones de confirmación).
export async function routeZoneChange(message, chatZone) {
  const text = fold(message);
  const wantsClear = CLEAR_INTENT.test(text) && /(filtro|lugar|ubicacion|zona|provincia|todo|todas)/.test(text);
  const wantsChange = CHANGE_INTENT.test(text);
  const served = await getServedLocations();

  // Lugar mencionado (de los que tienen tiendas), el más específico primero.
  const provinceHit = served.provinces.find((p) => p.id !== chatZone?.provinceId && hasName(text, p.name));
  const countryHit = !provinceHit ? served.countries.find((c) => c.id !== chatZone?.countryId && hasName(text, c.name)) : null;

  // Con un lugar elegido, cualquier mención de otro lugar cuenta; sin lugar elegido solo si pide cambiar o ver solo ese lugar.
  const target = provinceHit
    ? { label: [provinceHit.name, served.countries.find((c) => c.id === provinceHit.countryId)?.name].filter(Boolean).join(", "), countryId: provinceHit.countryId, provinceId: provinceHit.id }
    : countryHit
      ? { label: countryHit.name, countryId: countryHit.id, provinceId: null }
      : null;
  const hasZone = !!(chatZone?.provinceId || chatZone?.countryId);

  if (wantsClear && hasZone) {
    const current = await placeName(chatZone);
    return {
      text: `Ahora estás viendo solo resultados de ${current}, el lugar de entrega que elegiste. ${HOW_TO_CHANGE}\n\nTambién puedo quitar el filtro por ti desde aquí. ¿Quieres que quite el filtro y te muestre todo?`,
      actions: { zoneChange: { clear: true, confirmLabel: "Sí, quitar el filtro", keepLabel: "No, dejarlo" } },
      followUps: [],
    };
  }

  if (target && (hasZone || wantsChange)) {
    const current = hasZone ? await placeName(chatZone) : "";
    const intro = hasZone
      ? `Ahora estás viendo solo resultados de ${current}, el lugar de entrega que elegiste, y por eso no te muestro otros lugares. ${HOW_TO_CHANGE}\n\nTambién puedo cambiarlo por ti desde aquí. ¿Quieres que cambie tu lugar a ${target.label}?`
      : `Puedo poner ${target.label} como tu lugar de entrega: desde ese momento verás solo productos y tiendas de allí. ¿Quieres que lo cambie?`;
    return {
      text: intro,
      actions: { zoneChange: { countryId: target.countryId, provinceId: target.provinceId, label: target.label, confirmLabel: `Sí, cambiar a ${target.label}`, keepLabel: "No, dejarlo" } },
      followUps: [],
    };
  }

  // Menciona una provincia que existe pero todavía no tiene tiendas registradas.
  if (hasZone) {
    const provinces = await prisma.province.findMany({ where: { isActive: true }, select: { id: true, name: true } });
    const unserved = provinces.find((p) => p.id !== chatZone.provinceId && !served.provinces.some((s) => s.id === p.id) && hasName(text, p.name));
    if (unserved) {
      const current = await placeName(chatZone);
      return {
        text: `Todavía no hay tiendas registradas en ${unserved.name}. Ahora estás viendo solo resultados de ${current}, el lugar de entrega que elegiste. ${HOW_TO_CHANGE}`,
        actions: null,
        followUps: [],
      };
    }
  }

  if (wantsChange && hasZone) {
    const current = await placeName(chatZone);
    return {
      text: `Ahora estás viendo solo resultados de ${current}, el lugar de entrega que elegiste. ${HOW_TO_CHANGE}\n\nSi prefieres, dime a qué provincia, estado o país quieres cambiarlo y lo hago desde aquí (te pediré confirmación).`,
      actions: null,
      followUps: [],
    };
  }
  return null;
}
