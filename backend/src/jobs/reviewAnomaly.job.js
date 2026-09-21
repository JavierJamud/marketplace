import cron from "node-cron";
import { prisma } from "../lib/prisma.js";

// Bloque 229 (pedido explícito — Fase 2, "cron de anomalías de reseñas —
// marca ráfagas de 5.0 desde cuentas nuevas. Solo levanta bandera, no
// decide"): un patrón clásico de reseñas falsas es una ráfaga de varias
// calificaciones de 5★ en poco tiempo, desde cuentas recién creadas (nunca
// tuvieron tiempo de comprar de verdad en ningún lado) — nunca actúa sobre
// esto solo, solo lo deja en RankingAnomaly (ver schema.prisma) para que un
// admin lo revise a mano.

const WINDOW_HOURS = 24; // ventana en la que se busca la ráfaga
const NEW_ACCOUNT_DAYS = 14; // "cuenta nueva" = creada hace menos de esto
const BURST_THRESHOLD = 3; // mínimo de reseñas de 5★ de cuentas nuevas para contar como ráfaga

async function detectReviewBursts() {
  const windowStart = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);
  const accountAgeThreshold = new Date(Date.now() - NEW_ACCOUNT_DAYS * 24 * 60 * 60 * 1000);

  // Agrupado por producto (o por tienda, para reseñas sin producto — ver
  // Review.productId nullable en schema.prisma) — mismo criterio de UNION
  // que ya usa vendors.controller.js para juntar 2 fuentes en una consulta.
  const rows = await prisma.$queryRaw`
    SELECT r."productId", r."vendorId", COUNT(*)::int AS "burstCount",
           COUNT(*) FILTER (WHERE r."isVerifiedPurchase" = false)::int AS "unverifiedCount"
    FROM "Review" r
    JOIN "User" u ON u.id = r."userId"
    WHERE r.rating = 5
      AND r."isHidden" = false
      AND r."createdAt" >= ${windowStart}
      AND u."createdAt" >= ${accountAgeThreshold}
    GROUP BY r."productId", r."vendorId"
    HAVING COUNT(*) >= ${BURST_THRESHOLD}
  `;

  let created = 0;
  for (const row of rows) {
    // No duplicar la bandera mientras la anterior siga sin revisar — si el
    // admin ya la marcó DISMISSED/ACTIONED, una ráfaga NUEVA sí vuelve a
    // levantar bandera.
    const existing = await prisma.rankingAnomaly.findFirst({
      where: { kind: "REVIEW_BURST", status: "PENDING", productId: row.productId, vendorId: row.vendorId },
      select: { id: true },
    });
    if (existing) continue;

    const details =
      `${row.burstCount} reseñas de 5★ en las últimas ${WINDOW_HOURS}h, de cuentas creadas hace menos de ` +
      `${NEW_ACCOUNT_DAYS} días (${row.unverifiedCount} de esas ${row.burstCount} sin compra verificada en esta tienda).`;

    await prisma.rankingAnomaly.create({
      data: { kind: "REVIEW_BURST", productId: row.productId, vendorId: row.vendorId, details },
    });
    created++;
  }
  return created;
}

export async function runReviewAnomalyJob() {
  const created = await detectReviewBursts();
  console.log(`[reviewAnomalyJob] anomalías nuevas=${created}`);
  return { created };
}

// 10:00am hora Cuba — después de fraudReports (9:00) y accountDeletion (9:30).
export function startReviewAnomalyJob() {
  cron.schedule(
    "0 10 * * *",
    () => {
      runReviewAnomalyJob().catch((err) => console.error("[reviewAnomalyJob] error:", err));
    },
    { timezone: "America/Havana" }
  );
}
