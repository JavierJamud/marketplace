import cron from "node-cron";
import { prisma } from "../lib/prisma.js";

// Bloque 229 (pedido explícito — Fase 2, "cron de picos de clics — mismo
// patrón, detecta el auto-clic que la Fase 1 ya está deduplicando. Uno
// confirma al otro"): la Fase 1 (products.controller.js, trackProductClick)
// ya deduplica clics repetidos de la MISMA ip dentro de 30 min — esto no
// vuelve a mirar eso, mira el patrón de más arriba: un producto que de
// pronto recibe clics de MUCHAS ips distintas muy por encima de su propio
// histórico (compra de tráfico, bots distribuidos, etc). Solo levanta
// bandera, nunca decide nada.

const RECENT_WINDOW_HOURS = 3; // coincide con la frecuencia del propio cron
const BASELINE_WINDOW_DAYS = 7; // histórico contra el que se compara
const SPIKE_MULTIPLIER = 4; // el reciente debe ser esto veces el promedio normal
const MIN_FLOOR = 20; // piso mínimo de ips distintas para que valga la pena mirar (evita ruido en productos de bajo tráfico)
const EVENT_RETENTION_DAYS = 30; // ProductClickEvent solo se usa para dedup (30 min) y esta línea base (7 días) — no hay razón para guardar más

async function detectClickSpikes() {
  const windowsInBaseline = (BASELINE_WINDOW_DAYS * 24) / RECENT_WINDOW_HOURS;

  // El promedio de línea base es una aproximación (ips distintas del período
  // completo / cantidad de ventanas), no una suma exacta ventana-por-ventana
  // de conteos distintos — de sobra para un detector que solo levanta
  // bandera para que un humano revise, no para una decisión automática.
  const rows = await prisma.$queryRaw`
    WITH recent AS (
      SELECT "productId", COUNT(DISTINCT "ipHash")::int AS "recentCount"
      FROM "ProductClickEvent"
      WHERE "createdAt" >= NOW() - (${RECENT_WINDOW_HOURS} || ' hours')::interval
      GROUP BY "productId"
    ),
    baseline AS (
      SELECT "productId", COUNT(DISTINCT "ipHash")::float / ${windowsInBaseline} AS "avgPerWindow"
      FROM "ProductClickEvent"
      WHERE "createdAt" < NOW() - (${RECENT_WINDOW_HOURS} || ' hours')::interval
        AND "createdAt" >= NOW() - (${RECENT_WINDOW_HOURS + BASELINE_WINDOW_DAYS * 24} || ' hours')::interval
      GROUP BY "productId"
    )
    SELECT recent."productId", p."vendorId", recent."recentCount",
           COALESCE(baseline."avgPerWindow", 0) AS "baselineAvg"
    FROM recent
    JOIN "Product" p ON p.id = recent."productId"
    LEFT JOIN baseline ON baseline."productId" = recent."productId"
    WHERE recent."recentCount" >= ${MIN_FLOOR}
      AND recent."recentCount" >= COALESCE(baseline."avgPerWindow", 0) * ${SPIKE_MULTIPLIER}
  `;

  let created = 0;
  for (const row of rows) {
    const existing = await prisma.rankingAnomaly.findFirst({
      where: { kind: "CLICK_SPIKE", status: "PENDING", productId: row.productId },
      select: { id: true },
    });
    if (existing) continue;

    const baselineAvg = Number(row.baselineAvg).toFixed(1);
    const details =
      `${row.recentCount} ips distintas hicieron clic en las últimas ${RECENT_WINDOW_HOURS}h, contra un ` +
      `promedio normal de ~${baselineAvg} por cada ventana de ${RECENT_WINDOW_HOURS}h en los últimos ${BASELINE_WINDOW_DAYS} días.`;

    await prisma.rankingAnomaly.create({
      data: { kind: "CLICK_SPIKE", productId: row.productId, vendorId: row.vendorId, details },
    });
    created++;
  }
  return created;
}

async function pruneOldClickEvents() {
  const cutoff = new Date(Date.now() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.productClickEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}

export async function runClickAnomalyJob() {
  const created = await detectClickSpikes();
  const pruned = await pruneOldClickEvents();
  console.log(`[clickAnomalyJob] anomalías nuevas=${created} eventos podados=${pruned}`);
  return { created, pruned };
}

// Cada 3 horas — necesita más frecuencia que los crons diarios porque un
// pico de clics pierde valor de detección si se espera hasta el día
// siguiente (a diferencia de una ráfaga de reseñas, que es igual de visible
// horas después).
export function startClickAnomalyJob() {
  cron.schedule(
    "0 */3 * * *",
    () => {
      runClickAnomalyJob().catch((err) => console.error("[clickAnomalyJob] error:", err));
    },
    { timezone: "America/Havana" }
  );
}
