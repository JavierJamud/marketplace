import { prisma } from "./prisma.js";

// Visitas al sitio público por día y zona (SiteTrafficDay). La página avisa al cambiar de pantalla; aquí solo se suma.
// Las zonas son una lista cerrada: lo que no está en ella se descarta (nadie puede crear filas con nombres inventados).
export const SITE_AREAS = {
  inicio: "Inicio",
  catalogo: "Catálogo y búsqueda",
  tiendas: "Lista de tiendas",
  tienda: "Página de una tienda",
  producto: "Ficha de producto",
  "ventas-rapidas": "Ventas rápidas",
  carrito: "Carrito y pago",
  cuenta: "Cuenta del cliente",
  planes: "Planes y vender",
  ayuda: "Ayuda, preguntas y contacto",
  rastreo: "Rastrear pedido",
  mesa: "Pedido en mesa (QR)",
  otras: "Otras páginas",
};

export function havanaDay(date = new Date()) {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Havana" }).format(date);
  return new Date(`${s}T00:00:00Z`);
}

export async function bumpSiteTraffic(area, newSession) {
  if (!Object.hasOwn(SITE_AREAS, area)) return;
  const day = havanaDay();
  const sessions = newSession ? 1 : 0;
  await prisma.siteTrafficDay
    .upsert({ where: { day_area: { day, area } }, create: { day, area, views: 1, sessions }, update: { views: { increment: 1 }, sessions: { increment: sessions } } })
    .catch(() => {});
}

// Visitas por zona entre dos días de Cuba (desde incluido, hasta excluido, como los da havanaDay): [{ area, label, views,
// sessions }], de la más vista a la menos.
export async function siteTrafficBetween(fromDay, toDay) {
  const rows = await prisma.siteTrafficDay.groupBy({ by: ["area"], where: { day: { gte: fromDay, lt: toDay } }, _sum: { views: true, sessions: true } });
  return rows
    .map((r) => ({ area: r.area, label: SITE_AREAS[r.area] ?? r.area, views: r._sum.views ?? 0, sessions: r._sum.sessions ?? 0 }))
    .sort((a, b) => b.views - a.views);
}
