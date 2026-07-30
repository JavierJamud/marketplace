import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Bloque 62: recordatorio de 7 días sin acceder al panel de vendedor — tono
// útil, no alarmista (el vendedor no hizo nada malo, es solo un aviso). Se
// re-envía cada 7 días de inactividad continua (ver vendorLifecycle.job.js,
// Vendor.lastInactivityEmailAt evita reenviarlo todos los días).
export async function vendorInactivityReminderEmail({ vendor, daysInactive }) {
  const { siteName } = await getBrandSettings();
  const subject = `Hace ${daysInactive} días no entras a tu panel de ${vendor.companyName}`;
  const html = await emailShell({
    preview: `Tu tienda ${vendor.companyName} sigue activa — entra a tu panel cuando quieras`,
    title: "Te extrañamos por acá",
    badge: { label: "Recordatorio", color: "#8A5100" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola equipo de <strong>${vendor.companyName}</strong>, hace <strong>${daysInactive} días</strong> que no entras a tu panel de vendedor.`)}
      ${paragraph("Tus productos y pedidos siguen exactamente como los dejaste — solo pasa a saludar cuando puedas.")}
      ${smallNote("Si pasan 90 días seguidos sin acceder, tu tienda se pausa automáticamente (nada se borra — productos, pedidos y datos quedan intactos, y se reactiva apenas contactes a soporte).")}
      ${ctaButton("Entrar a mi panel", `${env.frontendUrl}/vendedor`)}
    `,
  });
  return { subject, html };
}
