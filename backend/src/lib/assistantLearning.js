import { prisma } from "./prisma.js";
import { getBrandSettings } from "../controllers/settings.controller.js";
import { pickFaqQuestions } from "./siteKnowledge.js";

// Aprendizaje automático del asistente de compras. Una vez al día (o al pedirlo el admin) se resume lo que preguntan y buscan
// los clientes y se arman las preguntas sugeridas que aparecen al abrir el chat. No usa IA ni gasta tokens: son conteos de
// conversaciones reales y de las búsquedas y rubros más vistos. Con el aprendizaje desactivado se muestran las preguntas base.

const PERIOD_DAYS = 14;
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MESSAGES = 4000;

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Temas de interés para la empresa y las palabras que los reconocen en lo que escribe el cliente.
const THEMES = [
  { key: "buy", label: "Cómo comprar", re: /como (compro|comprar|pido|se compra|hago un pedido)|quiero comprar|comprar en/ },
  { key: "sell", label: "Cómo vender", re: /vender|abrir.{0,10}tienda|crear.{0,10}tienda|registrar.{0,10}(tienda|negocio)/ },
  { key: "plans", label: "Planes y precios", re: /\bplanes?\b|suscripci|membresia|cuanto cuesta|precio de (vender|la tienda)/ },
  { key: "order", label: "Estado de un pedido", re: /(estado|seguimiento|donde (esta|va)).{0,25}(pedido|orden|compra)|mi pedido|numero de pedido/ },
  { key: "verification", label: "Verificar una tienda", re: /verific|insignia|badge/ },
  { key: "shipping", label: "Entrega y envíos", re: /entrega|envio|domicilio|delivery/ },
  { key: "payment", label: "Formas de pago", re: /pagar|pago|transferencia|efectivo|zelle/ },
];

async function baseChips() {
  const { siteName } = await getBrandSettings();
  return {
    buy: "¿Cómo comprar?",
    sell: `¿Cómo vender en ${siteName}?`,
    plans: "¿Qué planes ofrecen?",
    order: "Estado de mi pedido",
    verification: "¿Cómo verifico mi tienda?",
    shipping: "¿Cómo funciona la entrega?",
    payment: "¿Qué formas de pago hay?",
  };
}

export async function defaultSuggestions() {
  const c = await baseChips();
  return [c.buy, c.sell, c.plans, c.order];
}

// Calcula el resumen con datos reales y lo guarda. Devuelve el resumen.
export async function computeLearningSnapshot() {
  const since = new Date(Date.now() - PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const chips = await baseChips();

  const [messages, productsBySearch, categories] = await Promise.all([
    prisma.marketplaceChatMessage.findMany({ where: { role: "user", createdAt: { gte: since } }, select: { content: true }, orderBy: { createdAt: "desc" }, take: MAX_MESSAGES }),
    prisma.product.findMany({
      where: { isActive: true, hiddenFromStore: false, overQuota: false, vendor: { isBlocked: false, status: "ACTIVE", isPrivate: false } },
      orderBy: [{ searchClickCount: "desc" }, { clickCount: "desc" }],
      take: 40,
      select: { searchClickCount: true, clickCount: true, category: { select: { name: true } } },
    }),
    prisma.businessCategory.findMany({
      where: { active: true },
      select: { name: true, _count: { select: { vendors: { where: { isBlocked: false, status: "ACTIVE", isPrivate: false, products: { some: { isActive: true } } } } } } },
    }),
  ]);

  // Preguntas más repetidas (agrupadas por texto normalizado) y temas.
  const groups = new Map();
  const themeCount = Object.fromEntries(THEMES.map((t) => [t.key, 0]));
  for (const { content } of messages) {
    const norm = fold(content).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    if (norm.length < 4) continue;
    const key = norm.slice(0, 80);
    const g = groups.get(key) ?? { text: String(content).trim().slice(0, 120), count: 0 };
    g.count++;
    groups.set(key, g);
    for (const t of THEMES) if (t.re.test(norm)) themeCount[t.key]++;
  }
  const topQuestions = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 10);
  const themes = THEMES.map((t) => ({ key: t.key, label: t.label, count: themeCount[t.key] })).sort((a, b) => b.count - a.count);

  // Rubros más buscados (clics desde búsquedas) y, si no hay datos, los rubros con más tiendas.
  const byCategory = new Map();
  for (const p of productsBySearch) {
    const name = p.category?.name;
    if (!name) continue;
    byCategory.set(name, (byCategory.get(name) ?? 0) + (p.searchClickCount || 0) * 3 + (p.clickCount || 0));
  }
  const topCategories = [...byCategory.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, score]) => ({ name, score }));
  const fallbackCategory = [...categories].sort((a, b) => b._count.vendors - a._count.vendors).find((c) => c._count.vendors > 0)?.name ?? null;
  const categoryName = topCategories[0]?.name ?? fallbackCategory;

  // Sugerencias: siempre comprar y vender (lo que más le importa a la empresa), el tema más preguntado de los demás y el rubro más buscado.
  const rest = themes.filter((t) => !["buy", "sell"].includes(t.key) && t.count > 0);
  const extraTheme = rest[0]?.key ?? "plans";
  const suggestions = [chips.buy, chips.sell, chips[extraTheme], categoryName ? `Buscar ${categoryName}` : chips.order];

  const snapshot = { periodDays: PERIOD_DAYS, messagesAnalyzed: messages.length, topQuestions, themes, topCategories, suggestions: [...new Set(suggestions)], computedAt: new Date().toISOString() };
  const settings = await prisma.siteSettings.findFirst();
  if (settings) await prisma.siteSettings.update({ where: { id: settings.id }, data: { botLearningSnapshot: snapshot, botLearningAt: new Date() } });
  return snapshot;
}

let inflight = null;
async function freshSnapshot() {
  const settings = await prisma.siteSettings.findFirst({ select: { botLearningSnapshot: true, botLearningAt: true } });
  const fresh = settings?.botLearningAt && Date.now() - settings.botLearningAt.getTime() < SNAPSHOT_TTL_MS;
  if (fresh && settings.botLearningSnapshot) return settings.botLearningSnapshot;
  inflight ??= computeLearningSnapshot().finally(() => (inflight = null));
  return inflight;
}

// Preguntas sugeridas al abrir el chat: tres preguntas frecuentes reales del sitio (cómo pedir, cómo pagar y la API para
// socios), que se responden al instante con el texto oficial, y una búsqueda del rubro más buscado (o de las tiendas
// verificadas). Si las preguntas frecuentes todavía no están cargadas, quedan las sugerencias base.
async function siteSuggestions(snap) {
  const [order, pay, api] = await pickFaqQuestions([/hago un pedido/, /pago mi pedido|como pago/, /\bapi\b/]);
  const browse = snap?.suggestions?.find((s) => s.startsWith("Buscar ")) ?? "¿Qué tiendas están verificadas?";
  const chips = [order, pay, browse, api].filter(Boolean);
  return chips.length >= 3 ? chips : null;
}

export const MAX_CUSTOM_SUGGESTIONS = 6;

export async function getAssistantSuggestions() {
  const settings = await prisma.siteSettings.findFirst({ select: { botAutoLearn: true, botCustomSuggestions: true } });
  if (settings?.botCustomSuggestions?.length) return { chips: settings.botCustomSuggestions, auto: false, custom: true };
  const auto = !(settings && settings.botAutoLearn === false);
  const snap = auto ? await freshSnapshot().catch(() => null) : null;
  const chips = (await siteSuggestions(snap).catch(() => null)) ?? (snap?.suggestions?.length ? snap.suggestions : await defaultSuggestions());
  return { chips, auto: !!snap };
}

// Vista del admin: ajuste, resumen y cuántas correcciones han enseñado criterios.
export async function getLearningOverview() {
  const [settings, lessons, examples, current] = await Promise.all([
    prisma.siteSettings.findFirst({ select: { botAutoLearn: true, botLearningSnapshot: true, botLearningAt: true, botCustomSuggestions: true } }),
    prisma.chatTrainingExample.count({ where: { botTipo: "GENERAL", activo: true, leccion: { not: null } } }),
    prisma.chatTrainingExample.count({ where: { botTipo: "GENERAL", activo: true } }),
    getAssistantSuggestions().catch(() => null),
  ]);
  return {
    autoLearn: settings?.botAutoLearn ?? true,
    computedAt: settings?.botLearningAt ?? null,
    snapshot: settings?.botLearningSnapshot ?? null,
    lessons,
    examples,
    // Lo que el chat muestra de verdad ahora mismo (las del admin, o las automáticas) y la lista del admin.
    currentSuggestions: current?.chips ?? [],
    customSuggestions: settings?.botCustomSuggestions ?? [],
    maxCustomSuggestions: MAX_CUSTOM_SUGGESTIONS,
  };
}

export async function setCustomSuggestions(list) {
  const settings = await prisma.siteSettings.findFirst();
  if (settings) await prisma.siteSettings.update({ where: { id: settings.id }, data: { botCustomSuggestions: list } });
}

export async function setAutoLearn(value) {
  const settings = await prisma.siteSettings.findFirst();
  if (settings) await prisma.siteSettings.update({ where: { id: settings.id }, data: { botAutoLearn: !!value } });
}
