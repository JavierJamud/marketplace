import { prisma } from "./prisma.js";
import { AppError } from "../utils/AppError.js";
import { completenessScore } from "./productRanking.js";

// Bloque 52 (pedido explícito — "que todo esté bien agrupado en la sección
// de suscripciones... una concordancia con todo y una configuración
// correcta"): ÚNICO punto del código que decide qué puede hacer una tienda
// según su plan — reemplaza las constantes hardcodeadas y columnas pareadas
// sueltas que vivían repartidas en products.controller.js,
// orders.controller.js, vendors.controller.js y varios controllers de
// features (chat/offers/storeOffers/reviews). Ver PlanConfig en
// schema.prisma para el detalle de cada columna.

// Caché corta (5s): esta función se llama en casi todas las rutas de
// vendedor/tienda — sin caché sería una consulta extra de base por request.
// 5s es intencionalmente corto: un admin que acaba de guardar un cambio en
// "Configuración de planes" lo ve reflejado casi al instante, sin tener que
// reiniciar el backend.
let cache = null;
let cacheAt = 0;
const CACHE_MS = 5000;

async function loadPlanConfigs() {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
  const rows = await prisma.planConfig.findMany();
  cache = Object.fromEntries(rows.map((r) => [r.planType, r]));
  cacheAt = Date.now();
  return cache;
}

// Se llama después de cualquier escritura a PlanConfig (ver settings
// controller) para que el cambio se vea de inmediato, sin esperar los 5s.
export function invalidatePlanConfigCache() {
  cache = null;
}

export async function getPlanConfig(planType) {
  const configs = await loadPlanConfigs();
  return configs[planType] ?? null;
}

export async function getAllPlanConfigs() {
  const configs = await loadPlanConfigs();
  return [configs.REGULAR, configs.BUSINESS].filter(Boolean);
}

// Bloque 52 (pedido explícito, decisión confirmada — "las dos cosas"): una
// función/límite "Premium" exige AMBAS condiciones, nunca una sola. Antes
// del Bloque 52 esto era solo `verificationStatus === "VERIFIED"` en una
// decena de lugares — funcionaba por una coincidencia de datos (el admin
// solo otorgaba planType:"BUSINESS" junto con la verificación, nunca por
// separado), pero una tienda Premium activada a mano SIN estar verificada
// quedaría con todas las funciones encendidas igual si siguiéramos mirando
// solo verificationStatus. La insignia de verificado sigue siendo nada más
// que un sello de confianza — nunca una llave de funciones por sí sola.
export function isPremiumActive(vendor) {
  return vendor.planType === "BUSINESS" && vendor.verificationStatus === "VERIFIED";
}

// Límite numérico efectivo de una tienda para `key` (ej. "maxProducts").
// null = sin límite. Nunca lanza — el caller decide qué hacer con el número.
export async function getPlanLimit(vendor, key) {
  const config = await getPlanConfig(vendor.planType);
  return config?.[key] ?? null;
}

// Lanza un AppError en español si la tienda no tiene encendido `flag` (ej.
// "allowAiChatbot") PARA SU PLAN ACTUAL. Esto es el gate de "¿el plan lo
// permite en absoluto?" — para "¿está Premium de verdad activo?" (plan +
// verificación) usar isPremiumActive() además, donde corresponda.
// Lo mismo que assertPlanAllows pero sin lanzar: para tareas automáticas (correos, pantallas públicas) que se saltan en silencio.
export async function planAllows(planType, flag) {
  const config = await getPlanConfig(planType);
  return !!config?.[flag];
}

export async function assertPlanAllows(vendor, flag, message) {
  const config = await getPlanConfig(vendor.planType);
  if (!config?.[flag]) {
    throw new AppError(message ?? "Tu plan actual no incluye esta función.", 403);
  }
}

// Bloque 52 (pedido explícito — al bajar el cupo de productos, "se muestran
// solo los últimos productos del límite que se define y los demás quedan en
// el panel del vendedor... no públicos"): recalcula qué productos activos de
// una tienda quedan DENTRO del cupo (overQuota:false, visibles en la web
// pública) y cuáles quedan afuera (overQuota:true, el vendedor los sigue
// viendo y administrando en su panel, pero ningún listado público los
// muestra — mismo criterio de exclusión que hiddenFromStore). Los más
// recientes (`createdAt desc`) ganan el cupo por default; el vendedor puede
// reordenar la prioridad con swapProductQuota más abajo.
//
// Se llama: al guardar la configuración de un plan (el cupo de TODAS las
// tiendas de ese plan pudo cambiar), al cambiar el planType de una tienda
// puntual, y al crear/activar/desactivar un producto de una tienda.
export async function recalcVendorProductQuota(vendorId) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { planType: true } });
  if (!vendor) return;
  const maxProducts = await getPlanLimit(vendor, "maxProducts");

  if (maxProducts === null) {
    await prisma.product.updateMany({ where: { vendorId, isActive: true, overQuota: true }, data: { overQuota: false } });
    return;
  }

  const active = await prisma.product.findMany({
    where: { vendorId, isActive: true },
    select: { id: true, createdAt: true, quotaPinnedAt: true, salesCount: true, rating: true, reviewCount: true, images: true, description: true, tags: true, categoryId: true, badge: true },
  });
  const withinQuota = new Set(rankForQuota(active).slice(0, maxProducts).map((p) => p.id));

  await prisma.$transaction([
    prisma.product.updateMany({
      where: { vendorId, isActive: true, id: { in: [...withinQuota] } },
      data: { overQuota: false },
    }),
    prisma.product.updateMany({
      where: { vendorId, isActive: true, id: { notIn: [...withinQuota] } },
      data: { overQuota: true },
    }),
  ]);
}

// Qué productos quedan visibles cuando la tienda tiene más que su cupo (por ejemplo, al terminar la prueba gratis). Antes
// ganaban los más recientes, y eso premiaba cargar muchos productos al final de la prueba. Ahora el orden es por mérito:
//  1. los que la tienda eligió a mano para el cupo (el más reciente primero);
//  2. los que vendieron de verdad;
//  3. los mejor valorados por clientes, y después los de ficha más completa (fotos, descripción, categoría);
//  4. a igualdad, el más antiguo: un producto con historia pesa más que uno recién creado.
export function rankForQuota(products) {
  return [...products].sort((a, b) => {
    const pa = a.quotaPinnedAt ? new Date(a.quotaPinnedAt).getTime() : 0;
    const pb = b.quotaPinnedAt ? new Date(b.quotaPinnedAt).getTime() : 0;
    if (pa !== pb) return pb - pa;
    if (b.salesCount !== a.salesCount) return b.salesCount - a.salesCount;
    const ra = Number(a.rating) * Math.min(a.reviewCount, 5);
    const rb = Number(b.rating) * Math.min(b.reviewCount, 5);
    if (rb !== ra) return rb - ra;
    const ca = completenessScore(a);
    const cb = completenessScore(b);
    if (cb !== ca) return cb - ca;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
}

// Intercambio explícito pedido por el dueño ("agregar un botón que luego de
// eliminar algunos solo deberá activar otros para que sean visibles"): el
// vendedor elige qué producto EXCEDENTE pasa a ocupar el cupo — nunca
// automático. Si no hay cupo libre, baja de categoría al producto activo
// menos prioritario (el más viejo) para hacerle lugar, en vez de fallar.
const QUOTA_SWAPS_PER_DAY = 5;

export async function swapProductQuota(vendorId, productIdToActivate) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { planType: true } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);

  const target = await prisma.product.findFirst({ where: { id: productIdToActivate, vendorId, isActive: true } });
  if (!target) throw new AppError("Producto no encontrado.", 404);
  if (!target.overQuota) return; // ya estaba dentro del cupo, nada que hacer

  // Tope de cambios por día: sin él, una tienda podría ir rotando qué productos se ven y mostrar todo su catálogo con el
  // cupo de un plan menor.
  const swapsToday = await prisma.product.count({ where: { vendorId, quotaPinnedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
  if (swapsToday >= QUOTA_SWAPS_PER_DAY) {
    throw new AppError(`Puedes cambiar hasta ${QUOTA_SWAPS_PER_DAY} productos visibles por día. Prueba de nuevo mañana o pasa a Premium para publicarlos todos.`, 429);
  }

  const maxProducts = await getPlanLimit(vendor, "maxProducts");
  if (maxProducts === null) {
    await prisma.product.update({ where: { id: target.id }, data: { overQuota: false, quotaPinnedAt: new Date() } });
    return;
  }

  const withinQuotaCount = await prisma.product.count({ where: { vendorId, isActive: true, overQuota: false } });
  if (withinQuotaCount < maxProducts) {
    await prisma.product.update({ where: { id: target.id }, data: { overQuota: false, quotaPinnedAt: new Date() } });
    return;
  }

  // Sin lugar libre: cede el puesto el que menos merece estar según rankForQuota (el último de la lista), y pierde su marca de
  // "elegido a mano" para que no vuelva a entrar solo en el próximo recálculo.
  const within = await prisma.product.findMany({
    where: { vendorId, isActive: true, overQuota: false },
    select: { id: true, createdAt: true, quotaPinnedAt: true, salesCount: true, rating: true, reviewCount: true, images: true, description: true, tags: true, categoryId: true, badge: true },
  });
  const leaving = rankForQuota(within).at(-1);
  await prisma.$transaction([
    prisma.product.update({ where: { id: target.id }, data: { overQuota: false, quotaPinnedAt: new Date() } }),
    ...(leaving ? [prisma.product.update({ where: { id: leaving.id }, data: { overQuota: true, quotaPinnedAt: null } })] : []),
  ]);
}
