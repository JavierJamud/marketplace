import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Bloque 198 (pedido explícito — "se enviará un correo a los usuarios que
// ese día tienen que ir y reportar todas las ventas de la semana, o del
// día o del mes, como el administrador lo configure"): mismo criterio
// visual que lowStockAlertEmail.js — un solo número claro (cuánto vendió
// en el período), sin cifras adicionales que distraigan del objetivo real
// del correo (ir a depositar). `totalSales`/`currency` ya vienen resueltos
// por cashCloseReminder.job.js — este archivo solo arma el HTML.
export async function cashCloseReminderEmail({ vendor, staffFullName, totalSales, currency, frequencyLabel }) {
  const { siteName } = await getBrandSettings();
  const subject = `Hoy es tu día de cuadre de caja en ${vendor.companyName}`;

  const html = await emailShell({
    preview: `Reporta y deposita tus ventas de ${frequencyLabel} en ${vendor.companyName}`,
    title: "Día de cuadre de caja",
    badge: { label: "Recordatorio", color: "#337475" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola <strong>${staffFullName}</strong>, hoy es el día que <strong>${vendor.companyName}</strong> designó para cuadrar la caja de ${frequencyLabel}.`)}
      ${paragraph(`<div style="text-align:center;padding:14px 0;"><span style="font-size:11.5px;color:#75777c;">Vendiste en este período</span><br/><span style="font-size:26px;font-weight:800;color:#0A8F42;">${Number(totalSales).toLocaleString("es-CU")} ${currency}</span></div>`, { padding: "4px 0 8px" })}
      ${smallNote("Reporta tus ventas y deposita el dinero correspondiente hoy — así el dueño puede llevar el control al día de lo que cada quien vende.")}
      ${ctaButton("Ir a Agentes de Ventas", `${env.frontendUrl}/vendedor/ventas-manuales`)}
    `,
  });
  return { subject, html };
}
