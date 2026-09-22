import { z } from "zod";
import { prisma } from "./prisma.js";

// Bloque 48: extraído de vendors.controller.js (Bloque 225) para poder
// reusar el MISMO motor de series — con el MISMO bug de timezone ya
// corregido una vez — desde el dashboard de admin (agregado, toda la
// plataforma) en vez de duplicar estas ~90 líneas por segunda vez.

export const MONTH_LABEL = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// `vendorId` es opcional: null/undefined = sin filtro, la plataforma entera
// (usado por el dashboard de admin) — con vendorId, misma consulta de
// siempre para una tienda puntual (getVendorSalesSeries).
export async function rawSalesSeries(vendorId, granularity, from, to) {
  const rows = await prisma.$queryRaw`
    SELECT DATE_TRUNC(${granularity}, t."createdAt") AS bucket, COALESCE(SUM(t.total), 0)::numeric AS total, COUNT(*)::int AS orders
    FROM (
      SELECT "createdAt", total FROM "Order" WHERE (${vendorId}::text IS NULL OR "vendorId" = ${vendorId}) AND "createdAt" >= ${from} AND "createdAt" < ${to} AND status != 'CANCELLED'
      UNION ALL
      SELECT o."createdAt", o.total FROM "TableOrder" o JOIN "Table" tb ON tb.id = o."tableId"
      WHERE (${vendorId}::text IS NULL OR tb."vendorId" = ${vendorId}) AND o."createdAt" >= ${from} AND o."createdAt" < ${to} AND o."cancelledAt" IS NULL
    ) t
    GROUP BY bucket
  `;
  return rows.map((r) => ({ bucket: new Date(r.bucket), total: Number(r.total), orders: r.orders }));
}

// Misma lógica de truncado que Postgres DATE_TRUNC (semana = lunes ISO) —
// tiene que coincidir exacto con lo que ya agrupó la consulta de arriba,
// para que cada fila real caiga en la misma casilla que se va a rellenar acá.
// Todo el cálculo de casillas es 100% en UTC (getUTC*/setUTC*/Date.UTC), sin
// importar en qué timezone corra el servidor — ver Bloque 225 original para
// el bug real que este criterio corrigió.
export function bucketKey(date, granularity) {
  const d = new Date(date);
  if (granularity === "day") return d.toISOString().slice(0, 10);
  if (granularity === "week") {
    const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
    d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
  }
  if (granularity === "month") return d.toISOString().slice(0, 7);
  return String(d.getUTCFullYear());
}

export function bucketLabel(date, granularity) {
  if (granularity === "day") return date.toLocaleDateString("es-CU", { day: "2-digit", month: "short", timeZone: "UTC" });
  if (granularity === "week") return `Sem. ${date.toLocaleDateString("es-CU", { day: "2-digit", month: "short", timeZone: "UTC" })}`;
  if (granularity === "month") return `${MONTH_LABEL[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  return String(date.getUTCFullYear());
}

export function startOfBucket(date, granularity) {
  const d = new Date(date);
  if (granularity === "week") {
    const dow = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dow);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (granularity === "month") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  if (granularity === "year") return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function advanceBucket(date, granularity) {
  const d = new Date(date);
  if (granularity === "day") d.setUTCDate(d.getUTCDate() + 1);
  else if (granularity === "week") d.setUTCDate(d.getUTCDate() + 7);
  else if (granularity === "month") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

// Nunca "salta" casillas vacías — un día/semana/mes/año sin ninguna venta se
// ve en 0, para que la gráfica nunca insinúe continuidad donde no la hay.
// Tope de 400 casillas (p.ej. "día" con un rango de años) — evita que un
// rango mal armado devuelva una gráfica de miles de barras ilegible.
export function fillSeriesGaps(granularity, from, to, rows) {
  const byKey = new Map(rows.map((r) => [bucketKey(r.bucket, granularity), r]));
  const out = [];
  let cursor = startOfBucket(from, granularity);
  let guard = 0;
  while (cursor < to && guard < 400) {
    const key = bucketKey(cursor, granularity);
    const match = byKey.get(key);
    out.push({ key, label: bucketLabel(cursor, granularity), total: match?.total ?? 0, orders: match?.orders ?? 0 });
    cursor = advanceBucket(cursor, granularity);
    guard++;
  }
  return out;
}

export const salesSeriesSchema = z.object({
  granularity: z.enum(["day", "week", "month", "year"]).default("month"),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

// Rango por default cuando no se filtra a mano — suficiente historia para
// que la gráfica diga algo real apenas se entra, sin tener que elegir
// fechas primero.
const DEFAULT_SPAN = { day: 30, week: 12, month: 12, year: 5 };

export function resolveSeriesRange(granularity, from, to) {
  const now = new Date();
  let fromDate;
  let toDate;
  if (from && to) {
    fromDate = new Date(from);
    toDate = new Date(to);
    toDate.setUTCDate(toDate.getUTCDate() + 1); // el día "to" cuenta completo, no hasta las 00:00
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate >= toDate) {
      return null;
    }
  } else {
    toDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    if (granularity === "day") fromDate = new Date(toDate.getTime() - DEFAULT_SPAN.day * 24 * 60 * 60 * 1000);
    else if (granularity === "week") fromDate = new Date(toDate.getTime() - DEFAULT_SPAN.week * 7 * 24 * 60 * 60 * 1000);
    else if (granularity === "month") fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (DEFAULT_SPAN.month - 1), 1));
    else fromDate = new Date(Date.UTC(now.getUTCFullYear() - (DEFAULT_SPAN.year - 1), 0, 1));
  }
  return { fromDate, toDate };
}
