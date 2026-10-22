import { prisma } from "./prisma.js";

// Calificación de tiendas y productos. Un solo lugar para calcularla:
// - Lo que se MUESTRA es el promedio real de las reseñas visibles con estrellas, con su cantidad y el desglose de 1 a 5.
//   Sin reseñas no hay número (antes una tienda quedaba en 5.0 sin ninguna, porque al borrar productos se borraban sus
//   reseñas y el promedio guardado no se recalculaba).
// - Para ORDENAR y destacar se usa un puntaje ponderado (promedio bayesiano): cada tienda empieza "como si" tuviera unas
//   cuantas reseñas de 4 estrellas, y sus reseñas reales lo van moviendo. Así una sola reseña mala no hunde a una tienda
//   con muchas buenas, y 2 reseñas de 5 no ponen a una tienda nueva por encima de una con cientos de 4.8.
const PRIOR_MEAN = 4;
const PRIOR_WEIGHT = 5;

export function ratingScore(average, count) {
  const n = Number(count ?? 0);
  if (!n) return PRIOR_MEAN * 0.9; // sin reseñas: detrás de cualquier tienda con buenas reseñas, delante de las malas
  return (PRIOR_MEAN * PRIOR_WEIGHT + Number(average) * n) / (PRIOR_WEIGHT + n);
}

const round1 = (n) => Math.round(n * 10) / 10;

// Promedio, cantidad y desglose (5 → 1) de un conjunto de reseñas.
export async function ratingSummary(where) {
  const grouped = await prisma.review.groupBy({ by: ["rating"], where: { ...where, rating: { not: null }, isHidden: false }, _count: true });
  const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let count = 0;
  let sum = 0;
  for (const g of grouped) {
    breakdown[g.rating] = g._count;
    count += g._count;
    sum += g.rating * g._count;
  }
  const average = count ? round1(sum / count) : 0;
  return { average, count, breakdown, score: Math.round(ratingScore(average, count) * 100) / 100 };
}

export async function recalcVendorRating(vendorId) {
  if (!vendorId) return;
  const { average, count } = await ratingSummary({ vendorId });
  await prisma.vendor.update({ where: { id: vendorId }, data: { rating: average, reviewCount: count } });
}

export async function recalcProductRating(productId) {
  if (!productId) return;
  const { average, count } = await ratingSummary({ productId });
  await prisma.product.update({ where: { id: productId }, data: { rating: average, reviewCount: count } }).catch(() => {});
}

// Al arrancar: corrige cualquier tienda o producto cuyo promedio guardado no coincida con sus reseñas reales.
export async function reconcileRatings() {
  const [vendorAgg, productAgg] = await Promise.all([
    prisma.review.groupBy({ by: ["vendorId"], where: { vendorId: { not: null }, rating: { not: null }, isHidden: false }, _avg: { rating: true }, _count: { rating: true } }),
    prisma.review.groupBy({ by: ["productId"], where: { productId: { not: null }, rating: { not: null }, isHidden: false }, _avg: { rating: true }, _count: { rating: true } }),
  ]);
  const vReal = new Map(vendorAgg.map((g) => [g.vendorId, { rating: round1(g._avg.rating), count: g._count.rating }]));
  const pReal = new Map(productAgg.map((g) => [g.productId, { rating: round1(g._avg.rating), count: g._count.rating }]));

  let fixed = 0;
  const vendors = await prisma.vendor.findMany({ select: { id: true, rating: true, reviewCount: true } });
  for (const v of vendors) {
    const real = vReal.get(v.id) ?? { rating: 0, count: 0 };
    if (Number(v.rating) !== real.rating || v.reviewCount !== real.count) {
      await prisma.vendor.update({ where: { id: v.id }, data: { rating: real.rating, reviewCount: real.count } });
      fixed++;
    }
  }
  const products = await prisma.product.findMany({ where: { OR: [{ reviewCount: { gt: 0 } }, { rating: { gt: 0 } }, { id: { in: [...pReal.keys()] } }] }, select: { id: true, rating: true, reviewCount: true } });
  for (const p of products) {
    const real = pReal.get(p.id) ?? { rating: 0, count: 0 };
    if (Number(p.rating) !== real.rating || p.reviewCount !== real.count) {
      await prisma.product.update({ where: { id: p.id }, data: { rating: real.rating, reviewCount: real.count } });
      fixed++;
    }
  }
  if (fixed) console.log(`[calificaciones] corregidas: ${fixed}`);
  return fixed;
}
