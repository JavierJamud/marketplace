import { prisma } from "./prisma.js";

// Contador diario de visitas a la tienda y vistas de sus productos (VendorDailyStat), en el día de Cuba. Nunca rompe lo que
// lo llama: si falla, la página del cliente sigue igual. Lo lee el resumen semanal (controllers/usage.controller.js).
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|headless/i;

function havanaDay(date = new Date()) {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Havana" }).format(date);
  return new Date(`${s}T00:00:00Z`);
}

export function isBotRequest(req) {
  return BOT.test(String(req.get?.("user-agent") ?? req.headers?.["user-agent"] ?? ""));
}

export async function bumpVendorStat(vendorId, field) {
  if (!vendorId || !["storeViews", "productViews"].includes(field)) return;
  const day = havanaDay();
  await prisma.vendorDailyStat
    .upsert({ where: { vendorId_day: { vendorId, day } }, create: { vendorId, day, [field]: 1 }, update: { [field]: { increment: 1 } } })
    .catch(() => {});
}

export async function vendorStatsSince(vendorId, since) {
  const agg = await prisma.vendorDailyStat.aggregate({ where: { vendorId, day: { gte: havanaDay(since) } }, _sum: { storeViews: true, productViews: true } });
  return { storeViews: agg._sum.storeViews ?? 0, productViews: agg._sum.productViews ?? 0 };
}
