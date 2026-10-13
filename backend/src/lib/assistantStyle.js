import { vendorZoneWhere } from "./vendorZone.js";
import { prisma } from "./prisma.js";

// Estilo y datos reales del asistente de la portada.
//  - tightenReply: aunque el modelo se alargue, la respuesta final sale corta y sin relleno (máximo dos oraciones; las listas y
//    tablas se respetan).
//  - getLiveSnapshot: cifras reales de la plataforma, leídas de la base de datos, para que el modelo no tenga que adivinar
//    cuántas tiendas, productos o categorías hay.

const OPENERS = /^\s*(¡?\s*(hola|claro|por supuesto|con gusto|desde luego|perfecto|entendido|genial|excelente|buena pregunta)\s*[!,.:¡]*\s*)+/i;

export function tightenReply(text, { maxSentences = 2, maxChars = 280 } = {}) {
  let t = String(text ?? "").trim();
  if (!t) return t;
  // Las listas y las tablas ya son estructura pedida: solo se limpia el arranque.
  const structured = /(^|\n)\s*([-*•]|\d+[.)])\s|\|.+\|/.test(t);
  t = t.replace(OPENERS, "").replace(/[¡!]+/g, ".").replace(/\.{2,}/g, ".").replace(/\s+\./g, ".").trim();
  if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
  if (structured) return t;

  const sentences = t.match(/[^.?]+[.?]+(\s|$)|[^.?]+$/g) ?? [t];
  let out = "";
  for (const s of sentences.slice(0, maxSentences)) {
    if ((out + s).length > maxChars && out) break;
    out += s;
  }
  out = out.trim();
  if (out.length > maxChars) out = out.slice(0, maxChars).replace(/\s+\S*$/, "").replace(/[,;:\s]+$/, "") + ".";
  return out;
}

let cache = null;
const TTL_MS = 5 * 60 * 1000;

// Con un lugar elegido por el cliente (zone), las cifras son solo de las tiendas que cubren ese lugar. Se guarda una copia por lugar.
const zoneSnapshots = new Map();
export async function getLiveSnapshot(zone = null, zoneLabel = "") {
  const zoneKey = zone ? `${zone.countryId ?? ""}|${zone.provinceId ?? ""}|${zone.municipalityId ?? ""}` : "";
  const hit = zoneKey ? zoneSnapshots.get(zoneKey) : cache;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.text;
  const zoneWhere = vendorZoneWhere(zone ?? {});
  const activeVendor = { isBlocked: false, status: "ACTIVE", isPrivate: false, ...(zoneWhere ? { locations: zoneWhere } : {}) };
  const inStock = { isActive: true, hiddenFromStore: false, overQuota: false, OR: [{ unlimitedStock: true }, { stock: { gt: 0 } }] };
  const [vendors, verified, products, cats] = await Promise.all([
    prisma.vendor.count({ where: activeVendor }),
    prisma.vendor.count({ where: { ...activeVendor, verificationStatus: "VERIFIED" } }),
    prisma.product.count({ where: { ...inStock, vendor: activeVendor } }),
    prisma.category.findMany({
      where: { parentId: null },
      select: { name: true, _count: { select: { products: { where: { ...inStock, vendor: activeVendor } } } } },
    }),
  ]);
  const topCats = cats
    .filter((c) => c._count.products > 0)
    .sort((a, b) => b._count.products - a._count.products)
    .slice(0, 8)
    .map((c) => `${c.name} (${c._count.products})`);
  const scope = zoneWhere ? ` EN EL LUGAR QUE ELIGIÓ EL CLIENTE (${zoneLabel || "su zona"})` : "";
  const text = `DATOS REALES DE LA PLATAFORMA${scope} (de la base de datos, hoy): ${vendors} tienda(s) activa(s), ${verified} verificada(s); ${products} producto(s) disponible(s) ahora. Categorías con productos: ${topCats.length ? topCats.join(", ") : "ninguna todavía"}. Para cualquier cifra o conteo usa SOLO estos datos.`;
  if (zoneKey) {
    if (zoneSnapshots.size >= 100) zoneSnapshots.delete(zoneSnapshots.keys().next().value);
    zoneSnapshots.set(zoneKey, { at: Date.now(), text });
  } else {
    cache = { at: Date.now(), text };
  }
  return text;
}
