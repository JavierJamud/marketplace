import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph, metaList, esc } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Correos al admin (services/adminReports.service.js): el aviso de cada tienda nueva y el resumen semanal de la plataforma.
// Todo texto que no escribimos nosotros (nombres de tiendas, lo que escribió la IA) se escapa.
const fmt = (n) => Number(n ?? 0).toLocaleString("es-CU", { maximumFractionDigits: 1 });
const site = () => String(env.frontendUrl).replace(/\/+$/, "");
const strong = (t) => `<strong style="color:#1b1c1d;">${t}</strong>`;
const yesNo = (v) => (v ? "Sí" : "No");

function list(title, items, render) {
  if (!items?.length) return "";
  return paragraph(`${strong(title)}<ul style="margin:8px 0 0;padding-left:18px;">${items.map((i) => `<li style="margin:0 0 7px;">${render(i)}</li>`).join("")}</ul>`);
}

// Cuadrícula de dos columnas (se mantiene legible a 375 px): [etiqueta, valor, comparación opcional].
function grid(title, cells) {
  const cell = ([label, value, note]) =>
    `<td width="50%" style="padding:10px 12px;border:1px solid #e4e2e3;border-radius:10px;vertical-align:top;"><div style="font-size:12px;color:#5f6368;line-height:16px;">${label}</div><div style="font-size:18px;font-weight:700;color:#1b1c1d;line-height:24px;word-break:break-word;">${value}</div>${note ? `<div style="font-size:11.5px;color:#5f6368;line-height:15px;">${note}</div>` : ""}</td>`;
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>${cell(cells[i])}${cells[i + 1] ? cell(cells[i + 1]) : '<td width="50%"></td>'}</tr>`);
  return `${paragraph(strong(title), { padding: "6px 0 0" })}<mj-text padding="2px 0 12px"><table role="presentation" width="100%" cellspacing="6" cellpadding="0" style="border-collapse:separate;width:100%;">${rows.join("")}</table></mj-text>`;
}

// "antes: 12" para comparar con la semana anterior.
const before = (prev) => (prev == null ? "" : `La semana anterior: ${fmt(prev)}`);

// --- Tienda nueva ---------------------------------------------------------------------------------------------------------
export async function newVendorAdminEmail(s) {
  const { siteName } = await getBrandSettings();
  const subject = `Tienda nueva en ${siteName}: ${s.companyName}`;
  const html = await emailShell({
    preview: `${s.companyName} se acaba de registrar${s.place ? ` en ${s.place}` : ""}.`,
    title: "Se registró una tienda nueva",
    badge: { label: "Tienda nueva", color: "#1a5f60" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`${strong(esc(s.companyName))} acaba de crear su tienda. Estos son sus datos:`)}
      ${metaList([
        ["Tienda", esc(s.companyName)],
        ["Enlace", `<a href="${site()}/tienda/${encodeURIComponent(s.slug)}" style="color:#1a5f60;">${esc(`${site()}/tienda/${s.slug}`)}</a>`],
        ["Tipo de negocio", esc(s.category ?? "Sin indicar")],
        ["Dueño", esc(s.ownerName ?? "Sin indicar")],
        ["Correo de la cuenta", esc(s.accountEmail ?? "Sin correo")],
        ["Correo de la tienda", esc(s.storeEmail ?? "Sin correo")],
        ["WhatsApp", esc(s.whatsapp ?? "Sin indicar")],
        ["Dónde vende", esc(s.place ?? "Sin indicar")],
        ["País de registro de la persona", esc(s.personCountry ?? "Sin indicar")],
        ["Plan", esc(s.planName)],
        ["Restaurante", s.isRestaurant ? `Sí${s.tableCount ? `, ${fmt(s.tableCount)} mesas` : ""}` : "No"],
        s.partnerName ? ["Llegó por el socio", esc(s.partnerName)] : null,
        ["Registrada", esc(s.createdAtLabel)],
      ])}
      ${paragraph(`${strong("Pasos del registro")}<br>Correo confirmado con código: ${yesNo(s.checks.emailVerified)}<br>Cuenta de vendedor (rol): ${esc(s.checks.role)}<br>Tienda creada con su plan: ${yesNo(s.checks.hasPlan)}<br>Ubicación indicada: ${yesNo(s.checks.hasLocation)}<br>Verificación de la tienda: ${esc(s.checks.verification)}`)}
      ${paragraph("Ahora le falta cargar sus productos (cada uno con al menos una foto), poner el logo y la portada y, si quiere la insignia, completar la verificación.")}
      ${ctaButton("Ver la tienda en el panel", `${site()}/admin/tiendas/${s.id}`)}
      ${smallNote("Te avisamos cada vez que se registra una tienda.")}
    `,
  });
  return { subject, html };
}

// --- Resumen semanal de la plataforma ---------------------------------------------------------------------------------------
export async function adminWeeklySummaryEmail(r) {
  const { siteName } = await getBrandSettings();
  const subject = `Resumen semanal de ${siteName}: ${fmt(r.newVendors.length)} ${r.newVendors.length === 1 ? "tienda nueva" : "tiendas nuevas"}, ${fmt(r.stats.orders)} ${r.stats.orders === 1 ? "pedido" : "pedidos"}`;
  const ai = r.insight;
  const html = await emailShell({
    preview: ai?.resumen?.slice(0, 120) ?? `Del ${r.rangeLabel}.`,
    title: "Así fue la semana en la plataforma",
    badge: { label: "Resumen semanal", color: "#1a5f60" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Del ${esc(r.rangeLabel)}, comparado con los 7 días anteriores.`)}
      ${ai?.resumen ? paragraph(esc(ai.resumen)) : ""}
      ${grid("Crecimiento", [
        ["Tiendas nuevas", fmt(r.newVendors.length), before(r.stats.newVendorsPrev)],
        ["Clientes nuevos", fmt(r.stats.newCustomers), before(r.stats.newCustomersPrev)],
        ["Pedidos", fmt(r.stats.orders), before(r.stats.ordersPrev)],
        ["Tiendas activas en total", fmt(r.stats.activeStores)],
      ])}
      ${grid("Visitas al sitio", [
        ["Visitas (entradas al sitio)", fmt(r.traffic.sessions), before(r.traffic.sessionsPrev)],
        ["Páginas vistas", fmt(r.traffic.views), before(r.traffic.viewsPrev)],
        ["Visitas a tiendas", fmt(r.traffic.storeViews), before(r.traffic.storeViewsPrev)],
        ["Vistas de productos", fmt(r.traffic.productViews), before(r.traffic.productViewsPrev)],
      ])}
      ${list("Zonas del sitio más visitadas", r.traffic.areas.slice(0, 5), (a) => `${esc(a.label)}: ${fmt(a.views)} ${a.views === 1 ? "página vista" : "páginas vistas"}`)}
      ${list("Zonas del sitio menos visitadas", r.traffic.leastAreas, (a) => `${esc(a.label)}: ${fmt(a.views)} ${a.views === 1 ? "página vista" : "páginas vistas"}`)}
      ${list("Tiendas nuevas", r.newVendors.slice(0, 15), (v) => `<a href="${site()}/admin/tiendas/${v.id}" style="color:#1a5f60;font-weight:700;">${esc(v.companyName)}</a>: ${esc(v.category ?? "sin rubro")}, ${esc(v.place ?? "sin ubicación")}. ${fmt(v.products)} ${v.products === 1 ? "producto" : "productos"}.`)}
      ${list("Provincias y países con más altas", r.geo.top, (g) => `${esc(g.name)}: ${fmt(g.vendors)} ${g.vendors === 1 ? "tienda" : "tiendas"} y ${fmt(g.customers)} ${g.customers === 1 ? "cliente" : "clientes"}`)}
      ${list("Tiendas con más pedidos", r.topStores, (v) => `${esc(v.companyName)}: ${fmt(v.orders)} ${v.orders === 1 ? "pedido" : "pedidos"}`)}
      ${list("Lo más buscado esta semana", r.searches, (t) => `${esc(t.term)} (${fmt(t.count)} ${t.count === 1 ? "búsqueda" : "búsquedas"} en total)`)}
      ${list("Panel de las tiendas: lo más usado", r.panel.top, (s) => `${esc(s.label)}: ${fmt(s.stores)} ${s.stores === 1 ? "tienda" : "tiendas"}, ${fmt(s.minutes)} min`)}
      ${list("Panel de las tiendas: lo menos usado", r.panel.least, (s) => `${esc(s.label)}: ${fmt(s.stores)} ${s.stores === 1 ? "tienda" : "tiendas"}`)}
      ${list("Revisión del sistema", r.scan, (x) => esc(x))}
      ${list("Sugerencias de la IA", ai?.sugerencias, (x) => `${strong(esc(x.titulo))}: ${esc(x.detalle)}`)}
      ${list("Correcciones y arreglos que propone la IA", ai?.correcciones, (x) => `${strong(esc(x.titulo))}: ${esc(x.detalle)}`)}
      ${ai ? "" : paragraph("Esta semana la IA no pudo escribir el análisis. Los números de arriba son reales y están completos.")}
      ${ctaButton("Abrir el panel de admin", `${site()}/admin`)}
      ${smallNote(`Te enviamos este resumen cada sábado a las 12:00 (hora de Cuba). Los números salen de la base de datos de ${esc(siteName)}; el análisis y las sugerencias los escribe un asistente con inteligencia artificial.`)}
    `,
  });
  return { subject, html };
}
