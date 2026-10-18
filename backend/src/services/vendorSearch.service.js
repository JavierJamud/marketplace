import { prisma } from "../lib/prisma.js";
import { LOW_STOCK_THRESHOLD } from "../constants/inventory.js";

// Buscador del panel de la tienda. Encuentra lo que la persona puede ver en su panel: productos (por nombre, descripción,
// etiquetas de búsqueda, código de barras o estado de stock), pedidos, pedidos de mesa, ventas de caja, clientes, códigos de
// descuento, ofertas y reseñas. Sin importar tildes ni mayúsculas, igual que el buscador de la página principal. Si no hay nada
// parecido literal, prueba por similitud de palabras (pg_trgm) para errores de tipeo.
// `sections`: null = dueño (todo); un array = secciones asignadas a ese usuario del equipo.
const LIMIT = 6;

const normalize = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Palabras de disponibilidad: "agotados" lista los productos sin stock, "stock bajo" los que se están acabando, etc.
const STATUS_WORDS = [
  { status: "out", label: "Sin stock", words: ["agotado", "agotados", "sin stock", "sin existencias", "agotada", "agotadas"] },
  { status: "low", label: "Stock bajo", words: ["stock bajo", "poco stock", "por agotarse", "se acaba", "bajo stock"] },
  { status: "paused", label: "Pausados", words: ["pausado", "pausados", "inactivo", "inactivos", "oculto", "ocultos", "desactivado", "desactivados"] },
  { status: "active", label: "Disponibles", words: ["disponible", "disponibles", "activo", "activos", "en stock", "con stock"] },
  { status: "unlimited", label: "Siempre disponibles", words: ["ilimitado", "ilimitados", "siempre disponible", "stock ilimitado"] },
  { status: "quota", label: "Fuera del cupo del plan", words: ["fuera de cupo", "fuera del cupo", "cupo", "limite del plan"] },
];

export function statusFromQuery(q) {
  const n = normalize(q);
  if (n.length < 3) return null;
  return STATUS_WORDS.find((s) => s.words.some((w) => w === n || (w.startsWith(n) && n.length >= 4))) ?? null;
}

export function productStatus(p) {
  if (p.overQuota) return "quota";
  if (!p.isActive) return "paused";
  if (p.unlimitedStock) return "unlimited";
  if (p.stock <= 0) return "out";
  if (p.stock <= LOW_STOCK_THRESHOLD) return "low";
  return "active";
}

const STATUS_WHERE = {
  out: { isActive: true, unlimitedStock: false, stock: { lte: 0 } },
  low: { isActive: true, unlimitedStock: false, stock: { gt: 0, lte: LOW_STOCK_THRESHOLD } },
  paused: { isActive: false },
  active: { isActive: true, overQuota: false, OR: [{ unlimitedStock: true }, { stock: { gt: 0 } }] },
  unlimited: { isActive: true, unlimitedStock: true },
  quota: { overQuota: true },
};

// Productos que contienen el texto en el nombre, la descripción, alguna etiqueta o el código de barras. El orden premia
// donde aparece: el nombre empieza así, luego el nombre lo contiene, luego una etiqueta, luego la descripción.
async function productIdsByText(vendorId, q) {
  const rows = await prisma.$queryRaw`
    WITH t AS (SELECT regexp_replace(unaccent(lower(${q})), '[^a-z0-9]+', ' ', 'g') AS q)
    SELECT p.id,
      CASE
        WHEN regexp_replace(unaccent(lower(p.name)), '[^a-z0-9]+', ' ', 'g') LIKE t.q || '%' THEN 0
        WHEN regexp_replace(unaccent(lower(p.name)), '[^a-z0-9]+', ' ', 'g') LIKE '%' || t.q || '%' THEN 1
        WHEN EXISTS (SELECT 1 FROM unnest(p.tags) tag WHERE regexp_replace(unaccent(lower(tag)), '[^a-z0-9]+', ' ', 'g') LIKE '%' || t.q || '%') THEN 2
        WHEN lower(coalesce(p.barcode, '')) = lower(${q}) THEN 2
        ELSE 3
      END AS rank
    FROM "Product" p, t
    WHERE p."vendorId" = ${vendorId}
      AND length(t.q) > 0
      AND (
        regexp_replace(unaccent(lower(p.name)), '[^a-z0-9]+', ' ', 'g') LIKE '%' || t.q || '%'
        OR regexp_replace(unaccent(lower(coalesce(p.description, ''))), '[^a-z0-9]+', ' ', 'g') LIKE '%' || t.q || '%'
        OR EXISTS (SELECT 1 FROM unnest(p.tags) tag WHERE regexp_replace(unaccent(lower(tag)), '[^a-z0-9]+', ' ', 'g') LIKE '%' || t.q || '%')
        OR lower(coalesce(p.barcode, '')) LIKE lower(${q}) || '%'
      )
    ORDER BY rank, p."createdAt" DESC
    LIMIT 50`;
  return rows.map((r) => r.id);
}

// Errores de tipeo ("telefno" → "teléfono"): similitud de palabras contra el nombre y las etiquetas. Si la extensión pg_trgm no
// está instalada en esa base, simplemente no hay resultados aproximados (nunca rompe la búsqueda).
async function productIdsByTrigram(vendorId, q) {
  try {
    const rows = await prisma.$queryRaw`
      WITH t AS (SELECT regexp_replace(unaccent(lower(${q})), '[^a-z0-9]+', ' ', 'g') AS q)
      SELECT p.id, GREATEST(
        word_similarity(t.q, regexp_replace(unaccent(lower(p.name)), '[^a-z0-9]+', ' ', 'g')),
        coalesce((SELECT max(word_similarity(t.q, regexp_replace(unaccent(lower(tag)), '[^a-z0-9]+', ' ', 'g'))) FROM unnest(p.tags) tag), 0)
      ) AS score
      FROM "Product" p, t
      WHERE p."vendorId" = ${vendorId}
      ORDER BY score DESC
      LIMIT 6`;
    return rows.filter((r) => Number(r.score) >= 0.45).map((r) => r.id);
  } catch {
    return [];
  }
}

// Distancia de edición con letras intercambiadas (Damerau): "pnael" está a 1 de "panel". Los trigramas no lo ven.
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Última red para errores de tipeo: cada palabra buscada se compara con las palabras del nombre y de las etiquetas de los
// productos de la tienda (un catálogo de tienda es chico; se miran hasta 2000). Hasta 1 letra de diferencia en palabras de 4-5
// letras y 2 en palabras más largas.
async function productIdsByTypo(vendorId, q) {
  const words = normalize(q).split(" ").filter((w) => w.length >= 4);
  if (!words.length) return [];
  const rows = await prisma.product.findMany({ where: { vendorId }, select: { id: true, name: true, tags: true }, take: 2000 });
  const scored = [];
  for (const p of rows) {
    const vocab = new Set(normalize([p.name, ...(p.tags ?? [])].join(" ")).split(" ").filter((w) => w.length >= 3));
    let hits = 0;
    let dist = 0;
    for (const w of words) {
      const max = w.length >= 6 ? 2 : 1;
      let best = Infinity;
      for (const v of vocab) if (Math.abs(v.length - w.length) <= max) best = Math.min(best, editDistance(w, v));
      if (best <= max) {
        hits++;
        dist += best;
      }
    }
    if (hits === words.length) scored.push({ id: p.id, dist });
  }
  return scored.sort((a, b) => a.dist - b.dist).slice(0, 20).map((s) => s.id);
}

// En qué coincidió (para mostrarlo debajo del nombre): una etiqueta, la descripción o el código de barras.
function matchedBy(p, q) {
  const n = normalize(q);
  if (!n) return null;
  if (normalize(p.name).includes(n)) return null;
  const tag = (p.tags ?? []).find((t) => normalize(t).includes(n));
  if (tag) return `Etiqueta: ${tag}`;
  if (p.barcode && p.barcode.toLowerCase().startsWith(String(q).toLowerCase())) return `Código: ${p.barcode}`;
  if (normalize(p.description).includes(n)) {
    const text = String(p.description);
    const i = normalize(text).indexOf(n);
    const start = Math.max(0, i - 20);
    return `…${text.slice(start, start + 60).trim()}…`;
  }
  return "Parecido";
}

const productSelect = { id: true, name: true, price: true, currency: true, images: true, stock: true, unlimitedStock: true, isActive: true, overQuota: true, tags: true, description: true, barcode: true };
const shapeProduct = (p, q) => ({
  id: p.id,
  name: p.name,
  price: Number(p.price),
  currency: p.currency,
  image: p.images?.[0] ?? null,
  stock: p.unlimitedStock ? null : p.stock,
  status: productStatus(p),
  matchedBy: q ? matchedBy(p, q) : null,
});

export async function searchVendorPanel(vendor, rawQ, sections) {
  const q = String(rawQ ?? "").trim().slice(0, 80);
  const can = (key) => !sections || sections.includes(key);
  const empty = { orders: [], tableOrders: [], products: [], productTotal: 0, statusFilter: null, posSales: [], customers: [], discountCodes: [], storeOffers: [], reviews: [] };
  if (q.length < 2) return empty;
  const like = { contains: q, mode: "insensitive" };
  const vendorId = vendor.id;
  const asNumber = Number(q);
  const isNumeric = !Number.isNaN(asNumber);

  const tasks = {};

  if (can("productos")) {
    tasks.products = (async () => {
      const status = statusFromQuery(q);
      if (status) {
        const where = { vendorId, ...STATUS_WHERE[status.status] };
        const [rows, total] = await Promise.all([
          prisma.product.findMany({ where, select: productSelect, orderBy: { createdAt: "desc" }, take: LIMIT }),
          prisma.product.count({ where }),
        ]);
        return { products: rows.map((p) => shapeProduct(p, null)), productTotal: total, statusFilter: { status: status.status, label: status.label } };
      }
      let ids = await productIdsByText(vendorId, q);
      let fuzzy = false;
      if (ids.length === 0) {
        ids = await productIdsByTrigram(vendorId, q);
        if (ids.length === 0) ids = await productIdsByTypo(vendorId, q);
        fuzzy = ids.length > 0;
      }
      const rows = await prisma.product.findMany({ where: { id: { in: ids.slice(0, LIMIT) } }, select: productSelect });
      const byId = new Map(rows.map((p) => [p.id, p]));
      return {
        products: ids.slice(0, LIMIT).map((id) => byId.get(id)).filter(Boolean).map((p) => shapeProduct(p, q)),
        productTotal: ids.length,
        statusFilter: null,
        fuzzy,
      };
    })();
  }

  if (can("pedidos")) {
    tasks.orders = prisma.order.findMany({
      where: { vendorId, OR: [{ code: like }, { customerName: like }, { customerPhone: like }, { customerEmail: like }] },
      select: { id: true, code: true, customerName: true, total: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
    });
  }

  if ((can("pedidos") || can("mesas")) && vendor.isRestaurant) {
    tasks.tableOrders = prisma.tableOrder.findMany({
      where: { table: { vendorId }, OR: [...(isNumeric ? [{ orderNumber: Math.trunc(asNumber) }] : []), { customerName: like }] },
      include: { table: true },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
    });
  }

  if (can("caja")) {
    tasks.posSales = prisma.posSale.findMany({
      where: { vendorId, OR: [{ code: { equals: q.toUpperCase() } }, { customerName: like }] },
      select: { id: true, code: true, customerName: true, total: true, currency: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
    });
  }

  if (can("clientes")) {
    tasks.customers = prisma.vendorCustomer.findMany({
      where: { vendorId, OR: [{ name: like }, { phone: like }, { email: like }, { notes: like }] },
      select: { id: true, name: true, phone: true, email: true },
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
    });
  }

  if (can("codigos-descuento")) {
    tasks.discountCodes = prisma.discountCode.findMany({ where: { vendorId, code: like }, select: { id: true, code: true, active: true, type: true, value: true }, take: LIMIT });
  }

  if (can("ofertas-tienda")) {
    tasks.storeOffers = prisma.storeOffer.findMany({ where: { vendorId, OR: [{ title: like }, { description: like }] }, select: { id: true, title: true, active: true }, take: LIMIT });
  }

  if (can("resenas")) {
    tasks.reviews = prisma.review.findMany({
      where: { vendorId, OR: [{ comment: like }, { authorName: like }, { title: like }] },
      select: { id: true, authorName: true, rating: true, comment: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
    });
  }

  const keys = Object.keys(tasks);
  const values = await Promise.all(keys.map((k) => tasks[k]));
  const out = { ...empty };
  keys.forEach((k, i) => {
    if (k === "products") Object.assign(out, values[i]);
    else out[k] = values[i];
  });
  out.orders = out.orders.map((o) => ({ ...o, total: Number(o.total) }));
  out.posSales = out.posSales.map((s) => ({ ...s, total: Number(s.total) }));
  out.discountCodes = out.discountCodes.map((c) => ({ ...c, value: Number(c.value) }));
  out.reviews = out.reviews.map((r) => ({ ...r, comment: r.comment ? r.comment.slice(0, 90) : null }));
  return out;
}
