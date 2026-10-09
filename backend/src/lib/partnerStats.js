import { prisma } from "./prisma.js";
import { liveCounters } from "./partnerUsage.js";

// Métricas reales de uso de la API, calculadas en el momento desde PartnerApiUsageHour (totales
// por hora) y PartnerApiLog (movimientos recientes). Las usan el panel admin y el del socio.

export async function usageSummary(partnerId, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);
  const startToday = new Date();
  startToday.setUTCHours(0, 0, 0, 0);

  const [totals, today, byDay, byEndpoint, rejected] = await Promise.all([
    prisma.partnerApiUsageHour.aggregate({
      where: { partnerId, hour: { gte: since } },
      _sum: { requests: true, errors: true, totalMs: true },
    }),
    prisma.partnerApiUsageHour.aggregate({ where: { partnerId, hour: { gte: startToday } }, _sum: { requests: true, errors: true } }),
    prisma.$queryRaw`
      SELECT to_char(date_trunc('day', "hour"), 'YYYY-MM-DD') AS day,
             SUM("requests")::int AS requests, SUM("errors")::int AS errors
      FROM "PartnerApiUsageHour"
      WHERE "partnerId" = ${partnerId} AND "hour" >= ${since}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw`
      SELECT "endpoint", SUM("requests")::int AS requests, SUM("errors")::int AS errors,
             CASE WHEN SUM("requests") > 0 THEN ROUND(SUM("totalMs")::numeric / SUM("requests"))::int ELSE 0 END AS "avgMs"
      FROM "PartnerApiUsageHour"
      WHERE "partnerId" = ${partnerId} AND "hour" >= ${since}
      GROUP BY "endpoint" ORDER BY requests DESC LIMIT 30`,
    prisma.partnerApiLog.count({ where: { partnerId, endpoint: { in: ["(rechazada)", "(límite)"] }, createdAt: { gte: since } } }),
  ]);

  const requests = totals._sum.requests ?? 0;
  return {
    days,
    requests,
    errors: totals._sum.errors ?? 0,
    avgMs: requests > 0 ? Math.round(Number(totals._sum.totalMs ?? 0) / requests) : 0,
    requestsToday: today._sum.requests ?? 0,
    errorsToday: today._sum.errors ?? 0,
    rejected,
    byDay,
    byEndpoint,
  };
}

export async function recentMovements(partnerId, { page = 1, pageSize = 25, keyId, status } = {}) {
  const where = { partnerId, keyId: keyId || undefined, status: status || undefined };
  const [total, rows] = await Promise.all([
    prisma.partnerApiLog.count({ where }),
    prisma.partnerApiLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { key: { select: { name: true, prefix: true } } } }),
  ]);
  return { total, rows };
}

export async function keysWithLive(partnerId) {
  const keys = await prisma.partnerApiKey.findMany({ where: { partnerId }, orderBy: { createdAt: "desc" } });
  return Promise.all(
    keys.map(async (k) => {
      const { keyHash, ...safe } = k;
      return { ...safe, live: k.status === "ACTIVE" ? await liveCounters(k) : null };
    })
  );
}
