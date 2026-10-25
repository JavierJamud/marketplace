import { prisma } from "../lib/prisma.js";

// Datos que el algoritmo de lib/productRanking.js necesita además de las columnas del propio producto: reseñas visibles y el
// interés de los clientes que no queda en el producto (cuántos lo tienen en el carrito, en favoritos o lo pidieron hace poco).
// Pedido del dueño: "que varios clientes lo tengan agregado al carrito, si alguien ha hecho los pedidos" también cuenta.
// Ninguna de estas tres cuenta al dueño de la tienda: si él mismo guarda o pide su producto, no sube.
const INTEREST_WINDOW_DAYS = 30;

// Candidatos para el algoritmo cuando hay más productos que el tope: antes eran los `size` más nuevos, así que un producto
// viejo con ventas y visitas de hoy quedaba fuera solo por su fecha. Ahora entran primero los que tuvieron actividad más
// reciente, y se reserva una parte para los recién publicados (sin actividad todavía), que si no nunca tendrían su oportunidad.
export async function fetchRankingPool({ where, include, size = 300, newShare = 0.2 }) {
  const newCount = Math.round(size * newShare);
  const [active, fresh] = await Promise.all([
    prisma.product.findMany({
      where: { ...where, lastActivityAt: { not: null } },
      include,
      take: size - newCount,
      orderBy: [{ isFeatured: "desc" }, { lastActivityAt: "desc" }],
    }),
    prisma.product.findMany({ where, include, take: size, orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }] }),
  ]);
  const seen = new Set(active.map((p) => p.id));
  const pool = [...active];
  for (const p of fresh) {
    if (pool.length >= size) break;
    if (!seen.has(p.id)) pool.push(p);
  }
  return pool;
}

export async function loadRankingSignals(productIds) {
  const reviewStats = new Map();
  const engagement = new Map();
  if (productIds.length === 0) return { reviewStats, engagement };
  const since = new Date(Date.now() - INTEREST_WINDOW_DAYS * 86_400_000);

  const [reviewAgg, favorites, orders, carts] = await Promise.all([
    prisma.review.groupBy({
      by: ["productId"],
      where: { productId: { in: productIds }, rating: { not: null }, isHidden: false },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    prisma.$queryRaw`
      SELECT f."productId" AS id, COUNT(*)::int AS n
      FROM "Favorite" f
      JOIN "Product" p ON p.id = f."productId"
      JOIN "Vendor" v ON v.id = p."vendorId"
      WHERE f."productId" = ANY(${productIds}) AND f."userId" <> v."userId"
      GROUP BY f."productId"`,
    // Pedidos hechos (no solo los confirmados, que ya cuenta salesCount), sin los cancelados. Se cuentan clientes distintos,
    // no pedidos: diez pedidos de la misma persona no valen como diez clientes interesados.
    prisma.$queryRaw`
      SELECT oi."productId" AS id, COUNT(DISTINCT COALESCE(o."customerId", o.id))::int AS n
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      JOIN "Vendor" v ON v.id = o."vendorId"
      WHERE oi."productId" = ANY(${productIds}) AND o."createdAt" >= ${since} AND o.status <> 'CANCELLED'
        AND (o."customerId" IS NULL OR o."customerId" <> v."userId")
      GROUP BY oi."productId"`,
    // Carritos de clientes con sesión que se movieron en los últimos 30 días (los anónimos viven solo en su teléfono).
    prisma.$queryRaw`
      SELECT item->>'productId' AS id, COUNT(DISTINCT cs."userId")::int AS n
      FROM "CartSnapshot" cs
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(cs.items) = 'array' THEN cs.items ELSE '[]'::jsonb END) item
      JOIN "Product" p ON p.id = item->>'productId'
      JOIN "Vendor" v ON v.id = p."vendorId"
      WHERE cs."updatedAt" >= ${since} AND item->>'productId' = ANY(${productIds}) AND cs."userId" <> v."userId"
      GROUP BY item->>'productId'`,
  ]);

  for (const a of reviewAgg) reviewStats.set(a.productId, { avgRating: a._avg.rating ?? 0, reviewCount: a._count.rating });
  const add = (rows, key) => {
    for (const r of rows) {
      const cur = engagement.get(r.id) ?? { favorites: 0, orders: 0, carts: 0 };
      cur[key] = r.n;
      engagement.set(r.id, cur);
    }
  };
  add(favorites, "favorites");
  add(orders, "orders");
  add(carts, "carts");
  return { reviewStats, engagement };
}
