import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph, esc } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Resumen semanal de la tienda (jobs/weeklyVendorSummary.job.js): los números reales de su semana (vitrina, ventas y
// rapidez), lo que tiene pendiente de atender con el enlace exacto del panel, y el texto que escribió la IA para el vendedor.
// Todo texto que no escribimos nosotros (la IA, nombres de productos) se escapa.
const fmt = (n) => Number(n ?? 0).toLocaleString("es-CU", { maximumFractionDigits: 2 });

function minutesLabel(m) {
  if (m == null) return "Sin pedidos";
  if (m < 60) return `${m} min`;
  const h = Math.round((m / 60) * 10) / 10;
  return h < 48 ? `${fmt(h)} h` : `${fmt(Math.round(h / 24))} días`;
}

// Cuadrícula de dos columnas que se mantiene a 375 px: cada celda ocupa la mitad y el texto puede partirse.
function grid(title, cells) {
  const cell = ([label, value]) =>
    `<td width="50%" style="padding:10px 12px;border:1px solid #e4e2e3;border-radius:10px;vertical-align:top;"><div style="font-size:12px;color:#5f6368;line-height:16px;">${label}</div><div style="font-size:18px;font-weight:700;color:#1b1c1d;line-height:24px;word-break:break-word;">${value}</div></td>`;
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>${cell(cells[i])}${cells[i + 1] ? cell(cells[i + 1]) : '<td width="50%"></td>'}</tr>`);
  return `${paragraph(`<strong style="color:#1b1c1d;">${title}</strong>`, { padding: "6px 0 0" })}<mj-text padding="2px 0 12px"><table role="presentation" width="100%" cellspacing="6" cellpadding="0" style="border-collapse:separate;width:100%;">${rows.join("")}</table></mj-text>`;
}

function linkList(title, items, render) {
  if (!items?.length) return "";
  return paragraph(`<strong style="color:#1b1c1d;">${title}</strong><ul style="margin:8px 0 0;padding-left:18px;">${items.map((i) => `<li style="margin:0 0 9px;">${render(i)}</li>`).join("")}</ul>`);
}

const link = (path, label) => `<a href="${env.frontendUrl}${path}" style="color:#1a5f60;font-weight:700;text-decoration:underline;">${label}</a>`;

export async function vendorWeeklySummaryEmail({ vendor, stats, pending = [], insight, panelPath }) {
  const { siteName } = await getBrandSettings();
  const subject =
    stats.orders > 0
      ? `Tu semana en ${vendor.companyName}: ${stats.orders} ${stats.orders === 1 ? "pedido" : "pedidos"}`
      : stats.storeViews + stats.clicks > 0
        ? `Tu semana en ${vendor.companyName}: ${fmt(stats.storeViews + stats.productViews)} visitas`
        : `Tu semana en ${vendor.companyName} y cómo vender más`;
  const html = await emailShell({
    preview: insight.resumen.slice(0, 120),
    title: "El resumen de tu semana",
    badge: { label: "Resumen semanal", color: "#1a5f60" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola, <strong>${esc(vendor.companyName)}</strong>. Así te fue en los últimos 7 días:`)}
      ${grid("Tu vitrina", [
        ["Visitas a tu tienda", fmt(stats.storeViews)],
        ["Vistas de tus productos", fmt(stats.productViews)],
        ["Clics en tus productos", fmt(stats.clicks)],
        ["Personas distintas", fmt(stats.visitors)],
        ["Favoritos nuevos", fmt(stats.newFavorites)],
        ["Clientes con cuenta", fmt(stats.loggedVisitors)],
      ])}
      ${grid("Tus ventas y tu rapidez", [
        ["Pedidos", fmt(stats.orders)],
        ["Ventas", `${fmt(stats.sales)} ${esc(stats.currency)}`],
        ["Tiempo en responder", minutesLabel(stats.avgResponseMinutes)],
        ["Cerrados sin respuesta", fmt(stats.autoCancelled)],
      ])}
      ${linkList("Lo más visto", stats.topProducts, (p) => `${esc(p.name)}: ${fmt(p.clicks)} ${p.clicks === 1 ? "clic" : "clics"}`)}
      ${linkList("Pendiente de atender", pending, (p) => link(p.path, esc(p.label)))}
      ${paragraph(esc(insight.resumen))}
      ${linkList("Secciones de tu panel que te pueden ayudar", insight.capacitar, (i) => `${link(panelPath(i.section), esc(i.label))}: ${esc(i.motivo)}`)}
      ${linkList("Herramientas para probar", insight.ofrecer, (i) => `${link(panelPath(i.section ?? i.tool), esc(i.label))}: ${esc(i.motivo)}`)}
      ${ctaButton("Entrar a mi panel", `${env.frontendUrl}/vendedor`)}
      ${smallNote(`Te enviamos este resumen cada viernes. Los números salen de tu tienda en ${esc(siteName)}; el texto lo escribe un asistente con inteligencia artificial.`)}
    `,
  });
  return { subject, html };
}
