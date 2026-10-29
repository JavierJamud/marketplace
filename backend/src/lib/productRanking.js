// Bloque 98 (pedido explícito): algoritmo de "Destacados" — combina señales
// reales (ventas confirmadas, clics, clics desde búsqueda, tiempo promedio
// en la página, completitud del contenido y calificación) en un solo score,
// en vez de solo isFeatured+fecha como antes. Cada señal se normaliza 0..1
// contra el máximo real del LOTE consultado (min-max) — así el algoritmo se
// adapta solo a medida que crece el catálogo, sin tener que recalibrar
// umbrales a mano ni mantener percentiles globales aparte.
//
// Piso de calidad (pedido explícito — "sin cometer errores de mostrar un
// producto que no mantenga buena calidad, sobre todo con los que no son de
// tienda verificada"): un producto con poco contenido (pocas fotos, sin
// descripción real) o con mala calificación NUNCA se promueve como
// destacado, sin importar cuántas ventas/clics tenga — solo cae al final,
// ordenado por antigüedad como cualquier producto sin señales. El piso de
// completitud es más estricto para tiendas NO verificadas (65 vs 40) — el
// beneficio de la duda es menor cuando no hay KYC de por medio.
//
// Pedido del dueño (2026-10-24): también cuenta el interés que no queda en el producto: cuántos clientes lo tienen en el
// carrito, cuántos lo pidieron en los últimos 30 días (aunque el pedido no esté confirmado todavía) y cuántos lo guardaron en
// favoritos (ver services/productRankingSignals.service.js). Se les hizo lugar bajando un poco el resto; la suma sigue en 1.
const WEIGHTS = {
  sales: 0.24,
  orders: 0.1,
  carts: 0.1,
  favorites: 0.06,
  clicks: 0.12,
  searchClicks: 0.08,
  dwell: 0.08,
  completeness: 0.12,
  reviews: 0.1,
};

const MIN_COMPLETENESS_VERIFIED = 40;
const MIN_COMPLETENESS_UNVERIFIED = 65;
// Si tiene reseñas pero la calificación promedio es mala, se cae del
// ranking igual que si le faltara contenido — no hace falta ser tienda no
// verificada para que esto aplique, una mala calificación es una mala señal
// de calidad en cualquier tienda.
const MIN_RATING_IF_REVIEWED = 3.0;

// Bloque 98: arranque en frío — un producto recién activado con 0
// clics/ventas todavía (no tuvo tiempo de acumular nada) nunca competiría
// contra uno con historial y jamás llegaría a acumular sus propias señales.
// Empujón chico y temporal (14 días) para darle una oportunidad real de
// mostrarse antes de competir 100% por mérito.
const NEW_PRODUCT_BOOST_DAYS = 14;
const NEW_PRODUCT_BOOST = 0.08;

// "Destacada en la portada" (PlanConfig.featuredInHome): la página de planes lo vende como beneficio, pero el ranking no miraba
// el plan y solo lo cumplía el autocompletado. Empujón fijo para los productos de una tienda verificada cuyo plan lo tiene
// encendido: más chico que el +1 del destacado a mano por el admin (ese grupo sigue siempre arriba) y sin saltarse el piso
// de calidad (un producto que no lo pasa no recibe ningún empujón). 0.12 es lo que pesa una señal fuerte (como la ficha
// completa): se nota, pero el mérito manda. Con 0.5 (la mitad de toda la escala) y la rotación exponencial, cualquier producto
// del plan quedaba por encima de casi todo lo orgánico.
const PLAN_FEATURED_BOOST = 0.12;

// Arma la función que dice si la tienda de un producto tiene el beneficio, a partir de getAllPlanConfigs() (lib/planConfig.js).
// Este archivo no consulta la base: cada llamador carga los planes y le pasa el resultado a rankFeaturedProducts.
// featuredInHome exige insignia (requiresBadge): el plan tiene que darla, igual que planAllows en lib/planConfig.js (no se
// importa de ahí porque planConfig.js ya importa este archivo).
export function planFeaturedChecker(plans) {
  const byType = Object.fromEntries((plans ?? []).map((p) => [p.planType, p]));
  return (vendor) => {
    const plan = byType[vendor?.planType];
    return vendor?.verificationStatus === "VERIFIED" && !!plan?.featuredInHome && !!plan?.grantsBadge;
  };
}
const MS_PER_DAY = 86_400_000;

// Bloque 228 (pedido explícito — Fase 1, "blindar el ranking": "promedio
// bayesiano en reseñas... elimina el hueco de '5.0 con 2 reseñas'"): la
// media bayesiana YA existía acá (línea ~130), pero con un prior de peso 2
// era demasiado débil — 2 reseñas de 5★ todavía sacaban ~0.84/1.0, casi
// igual que un producto con historial real y decenas de reseñas. Subir el
// peso del prior a 8 obliga a un producto con pocas reseñas a "demostrar"
// más antes de que el algoritmo confíe en ese promedio.
const REVIEW_PRIOR_WEIGHT = 8;

// Bloque 228 (Fase 1, "log-escalar ventas y clics antes de normalizar...
// arregla el problema del outlier que aplasta a todos"): con min-max lineal,
// un solo producto viral con 10 000 clics deja a todo el resto del catálogo
// (con 10, 50, 200 clics) normalizado casi a 0 — la diferencia entre "poco"
// y "algo" de tráfico se volvía invisible al lado de ese outlier. log1p
// comprime esa escala (10 000 vs 200 deja de ser 50x, pasa a ser ~1.7x en
// log) sin cambiar el ORDEN relativo — el que tiene más sigue puntuando más,
// solo que un extremo ya no aplasta la variación real de todos los demás.
function logNormalize(value, maxValue) {
  return normalize(Math.log1p(Math.max(0, value)), Math.log1p(Math.max(0, maxValue)));
}

// Bloque 230 (Fase 3, pedido explícito — "decaimiento temporal en
// Destacados: 'destacado' pasa a significar 'relevante ahora'"): sin esto,
// un producto que fue viral una vez hace 8 meses y no ha vuelto a moverse
// sigue empujando arriba por su salesCount/clickCount ACUMULADO, aunque hoy
// nadie lo mire — "destacado" terminaba significando "tuvo un buen mes en
// algún momento del pasado", no "vale la pena mostrarlo ahora mismo".
// Solo decae la porción de tráfico/ventas (WEIGHTS.sales+clicks+
// searchClicks+dwell) — completitud/reseñas siguen siendo señales de
// CALIDAD intrínseca del producto, no de actividad reciente, así que no
// tiene sentido que también se apaguen con el tiempo.
const RECENCY_HALF_LIFE_DAYS = 21; // a los 21 días sin actividad, el peso de tráfico/ventas ya se redujo a la mitad
const RECENCY_FLOOR = 0.15; // nunca llega a 0 — un producto con historial real no desaparece de un día para otro, solo pierde prioridad frente a algo activo ahora

function recencyMultiplier(lastActivityAt, now) {
  if (!lastActivityAt) return 1; // nunca tuvo actividad con gate (clic real/venta) — nada que decaer, su score de tráfico ya es 0 de por sí
  const daysSinceActivity = (now - new Date(lastActivityAt).getTime()) / MS_PER_DAY;
  if (daysSinceActivity <= 0) return 1;
  return Math.max(RECENCY_FLOOR, Math.pow(0.5, daysSinceActivity / RECENCY_HALF_LIFE_DAYS));
}

// Puntaje 0-100 de "qué tan completo" está el contenido del producto — la
// única señal de este algoritmo que no depende de tráfico/ventas, así un
// producto nuevo bien cargado igual puede calificar para el ranking.
// Bloque 230 (Fase 3, pedido explícito — "score de salud de tienda para el
// vendedor (semáforo) — reutiliza completitud... que ya calculas"):
// exportada para que vendors.controller.js la reuse tal cual en
// computeVendorHealthScore, en vez de reimplementar el mismo criterio de
// "qué tan completo está un producto" en dos lugares.
export function completenessScore(product) {
  let score = 0;
  score += Math.min(product.images?.length ?? 0, 3) * 10; // hasta 30 con 3+ fotos
  if (product.description) score += product.description.trim().length > 60 ? 25 : 12;
  if (product.tags?.length > 0) score += 15;
  if (product.categoryId) score += 10;
  if (product.priceTiers?.length > 0) score += 10;
  if (product.badge) score += 10;
  return Math.min(score, 100);
}

function normalize(value, max) {
  return max > 0 ? value / max : 0;
}

// Rotación (pedido del dueño, 2026-10-24: "no tiene por qué mostrarse los productos fijos siempre en la misma posición, hace
// ver a la plataforma muerta"): con `seed`, el orden final se sortea pesando cada producto por su puntaje. El que tiene más
// interacción sale arriba casi siempre, pero dos productos con puntajes parecidos se turnan, y uno algo más flojo a veces sube.
// La temperatura decide cuánto: con 0.15, entre dos productos, una ventaja de 0.1 en el puntaje sale primero ~66% de las veces
// y una de 0.3, ~88%. Se sortea por grupos que nunca se mezclan: primero los destacados a mano por el admin, después el resto,
// y al final los que no pasan el piso de calidad. Misma semilla, mismo orden: así una persona no ve saltar las tarjetas
// mientras navega.
const ROTATION_TEMPERATURE = 0.15;

// Número 0..1 estable para (semilla, producto): FNV-1a de 32 bits más el mezclado final de MurmurHash3. Sin ese mezclado, los
// id de producto, que solo cambian en los últimos caracteres, daban números muy parecidos y el sorteo dejaba de ser parejo.
function seededUnit(seed, id) {
  let h = 0x811c9dc5;
  const str = `${seed}:${id}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) + 0.5) / 4294967296;
}

// Semilla de la rotación: la que manda la página en cada visita (solo letras y números) más la hora en curso. Así el orden
// cambia cuando la persona vuelve a entrar o recarga y, aunque no lo haga, al menos cada hora.
export function rotationSeed(visitSeed) {
  const visit = typeof visitSeed === "string" && /^[a-z0-9]{1,16}$/i.test(visitSeed) ? visitSeed : "";
  return `${visit}h${Math.floor(Date.now() / 3_600_000)}`;
}

// Sorteo ponderado sin reemplazo (Efraimidis-Spirakis): clave = -ln(u) / peso, la más chica va primero.
function rotate(scored, seed) {
  const draw = (group, weighted) =>
    group
      .map((s) => ({ s, k: -Math.log(seededUnit(seed, s.product.id)) / (weighted ? Math.exp(s.score / ROTATION_TEMPERATURE) : 1) }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.s.product);
  const manual = scored.filter((s) => s.score >= 0 && s.product.isFeatured);
  const rest = scored.filter((s) => s.score >= 0 && !s.product.isFeatured);
  const floor = scored.filter((s) => s.score < 0);
  return [...draw(manual, true), ...draw(rest, true), ...draw(floor, false)];
}

// reviewStatsByProductId: Map<productId, { avgRating: number, reviewCount: number }>
// engagement: Map<productId, { favorites, orders, carts }> (services/productRankingSignals.service.js); sin él cuentan 0.
// options.seed: si viene, el orden rota (ver rotate arriba); sin semilla es el orden puro por puntaje.
// options.isPlanFeatured: (vendor) => boolean, ver planFeaturedChecker. Sin ella no se aplica el empujón del plan (la página
// de una tienda, donde todos los productos son de la misma tienda y el empujón no cambiaría nada).
export function rankFeaturedProducts(products, reviewStatsByProductId, engagement = new Map(), options = {}) {
  if (products.length === 0) return [];
  const signal = (p, k) => engagement.get(p.id)?.[k] ?? 0;
  const maxFavorites = Math.max(1, ...products.map((p) => signal(p, "favorites")));
  const maxOrders = Math.max(1, ...products.map((p) => signal(p, "orders")));
  const maxCarts = Math.max(1, ...products.map((p) => signal(p, "carts")));

  const maxSales = Math.max(1, ...products.map((p) => p.salesCount));
  const maxClicks = Math.max(1, ...products.map((p) => p.clickCount));
  const maxSearchClicks = Math.max(1, ...products.map((p) => p.searchClickCount));
  const maxDwell = Math.max(1, ...products.map((p) => (p.viewCount > 0 ? Number(p.totalDwellMs) / p.viewCount : 0)));
  const now = Date.now();

  // Bloque 228 (Fase 1): prior de la media bayesiana calculado del propio
  // lote consultado, en vez de un 3.5★ fijo — mismo criterio de
  // "autocalibrado" que ya usan maxSales/maxClicks/etc. arriba (se adapta
  // solo a medida que cambia el catálogo real, sin recalibrar a mano). Si
  // todavía no hay ninguna reseña en el lote, cae al 3.5★ neutro de
  // siempre — nunca se rompe por falta de datos.
  const ratedStats = [...reviewStatsByProductId.values()].filter((s) => s.reviewCount > 0);
  const globalAvgRating = ratedStats.length > 0 ? ratedStats.reduce((sum, s) => sum + s.avgRating, 0) / ratedStats.length : 3.5;

  const scored = products.map((product) => {
    const stats = reviewStatsByProductId.get(product.id);
    const avgRating = stats?.avgRating ?? null;
    const reviewCount = stats?.reviewCount ?? 0;
    const completeness = completenessScore(product);
    const isVerified = product.vendor?.verificationStatus === "VERIFIED";
    const minCompleteness = isVerified ? MIN_COMPLETENESS_VERIFIED : MIN_COMPLETENESS_UNVERIFIED;
    const failsQualityFloor = completeness < minCompleteness || (reviewCount > 0 && avgRating < MIN_RATING_IF_REVIEWED);

    if (failsQualityFloor) {
      // Nunca se excluye del catálogo — solo nunca se "empuja" como
      // destacado. Score fijo bajo; el orden entre estos se resuelve por el
      // orderBy de la consulta original (createdAt desc), que Array.sort
      // conserva entre empates por ser un sort estable.
      return { product, score: -1 };
    }

    const avgDwell = product.viewCount > 0 ? Number(product.totalDwellMs) / product.viewCount : 0;
    // Media bayesiana contra el prior real del lote (ver globalAvgRating
    // arriba), con peso REVIEW_PRIOR_WEIGHT=8 — 2 reseñas de 5★ ya no
    // pesan casi igual que un producto con historial real de decenas.
    const reviewScore =
      reviewCount > 0 ? (avgRating * reviewCount + globalAvgRating * REVIEW_PRIOR_WEIGHT) / (reviewCount + REVIEW_PRIOR_WEIGHT) / 5 : 0.5;

    const daysSinceActivated = product.activatedAt ? (now - new Date(product.activatedAt).getTime()) / MS_PER_DAY : Infinity;
    const newBoost = daysSinceActivated <= NEW_PRODUCT_BOOST_DAYS ? NEW_PRODUCT_BOOST : 0;

    // Bloque 228 (Fase 1): sales/clicks/searchClicks/dwell pasan a
    // logNormalize (ver la función arriba) — antes normalize() lineal dejaba
    // que un solo outlier viral aplastara la señal real de todo el resto
    // del catálogo.
    const trafficScore =
      WEIGHTS.sales * logNormalize(product.salesCount, maxSales) +
      WEIGHTS.clicks * logNormalize(product.clickCount, maxClicks) +
      WEIGHTS.searchClicks * logNormalize(product.searchClickCount, maxSearchClicks) +
      WEIGHTS.dwell * logNormalize(avgDwell, maxDwell) +
      WEIGHTS.favorites * logNormalize(signal(product, "favorites"), maxFavorites);
    // Pedidos y carritos ya vienen acotados a los últimos 30 días: no se les aplica el decaimiento por inactividad.
    const interestScore =
      WEIGHTS.orders * logNormalize(signal(product, "orders"), maxOrders) + WEIGHTS.carts * logNormalize(signal(product, "carts"), maxCarts);

    // Bloque 230 (Fase 3): decae solo la parte de tráfico/ventas, nunca
    // completitud/reseñas (ver comentario de recencyMultiplier arriba).
    let score =
      trafficScore * recencyMultiplier(product.lastActivityAt, now) +
      interestScore +
      WEIGHTS.completeness * (completeness / 100) +
      WEIGHTS.reviews * reviewScore +
      newBoost;

    // isFeatured (palanca manual del admin) sigue siendo más fuerte que
    // cualquier combinación de señales automáticas — nunca lo pisa el
    // algoritmo, solo decide el orden DENTRO del grupo de destacados a mano.
    if (product.isFeatured) score += 1;
    if (options.isPlanFeatured?.(product.vendor)) score += PLAN_FEATURED_BOOST;

    return { product, score };
  });

  if (options.seed) return rotate(scored, String(options.seed));
  return scored.sort((a, b) => b.score - a.score).map((s) => s.product);
}

// Bloque 260 (pedido explícito — el asistente de negocio debe poder explicar
// "qué es el algoritmo en tu tienda pública"): las constantes REALES del
// algoritmo de arriba, para que la explicación del asistente nunca diverja de
// lo que de verdad se calcula (se lee de acá, no se copia a un texto aparte).
export const RANKING_RULES = {
  pesos: WEIGHTS,
  pisoDeCompletitudTiendaVerificada: MIN_COMPLETENESS_VERIFIED,
  pisoDeCompletitudTiendaSinVerificar: MIN_COMPLETENESS_UNVERIFIED,
  calificacionMinimaSiTieneResenas: MIN_RATING_IF_REVIEWED,
  diasDeEmpujonProductoNuevo: NEW_PRODUCT_BOOST_DAYS,
  empujonProductoNuevo: NEW_PRODUCT_BOOST,
  empujonPorPlanDestacado: PLAN_FEATURED_BOOST,
  mitadDeVidaDeLaActividadEnDias: RECENCY_HALF_LIFE_DAYS,
  pesoMinimoDeLaActividadAntigua: RECENCY_FLOOR,
  ventanaDeCarritosYPedidosEnDias: 30,
  temperaturaDeRotacion: ROTATION_TEMPERATURE,
  rotacion:
    "En la portada, el catálogo y la página de la tienda el orden se sortea pesando cada producto por su puntaje: el de más interacción sale arriba casi siempre y los de puntaje parecido se turnan. Cambia en cada visita y, como mínimo, cada hora.",
};

// Las señales de UN producto tal como las ve el algoritmo (mismas funciones y
// umbrales que rankFeaturedProducts), sin recalcular el orden. Sirve para
// decirle al dueño POR QUÉ un producto sube o no (piso de calidad, actividad
// reciente, completitud, empujón de producto nuevo, empujón del plan).
// isPlanFeatured: la misma función que recibe rankFeaturedProducts; sin ella, ese dato sale como null (desconocido).
export function explainProductRanking(product, stats, now = Date.now(), { isPlanFeatured } = {}) {
  const completeness = completenessScore(product);
  const isVerified = product.vendor?.verificationStatus === "VERIFIED";
  const minCompleteness = isVerified ? MIN_COMPLETENESS_VERIFIED : MIN_COMPLETENESS_UNVERIFIED;
  const avgRating = stats?.avgRating ?? null;
  const reviewCount = stats?.reviewCount ?? 0;
  const reasons = [];
  if (completeness < minCompleteness) reasons.push(`la ficha está al ${completeness}% y el mínimo para esta tienda es ${minCompleteness}% (faltan fotos, descripción, etiquetas o categoría)`);
  if (reviewCount > 0 && avgRating < MIN_RATING_IF_REVIEWED) reasons.push(`su calificación promedio (${Number(avgRating).toFixed(1)}) está por debajo del mínimo ${MIN_RATING_IF_REVIEWED}`);
  const daysSinceActivity = product.lastActivityAt ? Math.floor((now - new Date(product.lastActivityAt).getTime()) / MS_PER_DAY) : null;
  const daysSinceActivated = product.activatedAt ? Math.floor((now - new Date(product.activatedAt).getTime()) / MS_PER_DAY) : null;
  return {
    completitud: completeness,
    pisoDeCompletitud: minCompleteness,
    seMuestraComoDestacado: reasons.length === 0,
    motivosDePenalizacion: reasons,
    diasDesdeLaUltimaActividad: daysSinceActivity,
    pesoDeLaActividadReciente: Math.round(recencyMultiplier(product.lastActivityAt, now) * 100) / 100,
    empujonDeProductoNuevoActivo: daysSinceActivated !== null && daysSinceActivated <= NEW_PRODUCT_BOOST_DAYS,
    destacadoAManoPorElAdmin: !!product.isFeatured,
    empujonPorElPlanDeLaTienda: isPlanFeatured ? reasons.length === 0 && isPlanFeatured(product.vendor) : null,
  };
}
