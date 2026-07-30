import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Bloque 62: suspensión automática por 90 días de inactividad
// (vendorLifecycle.job.js) — nunca un admin a mano. Deja explícito que nada
// se borra y cómo reactivarla.
export async function vendorSuspendedEmail({ vendor, reason }) {
  const { siteName } = await getBrandSettings();
  const subject = `Tu tienda ${vendor.companyName} fue pausada por inactividad`;
  const html = await emailShell({
    preview: `Tu tienda se pausó automáticamente: ${reason}`,
    title: "Tu tienda fue pausada",
    badge: { label: "Suspendida", color: "#ba1a1a" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola equipo de <strong>${vendor.companyName}</strong>, tu tienda se pausó automáticamente: <strong>${reason}</strong>.`)}
      ${smallNote("Tus productos, pedidos y datos siguen intactos — nada se borra. Vuelve a estar visible en cuanto se reactive.")}
      ${paragraph("Contáctanos para reactivarla — es un trámite simple, no necesitas volver a verificarte ni cargar nada de nuevo.")}
      ${ctaButton("Contactar soporte", `${env.frontendUrl}/contacto`)}
    `,
  });
  return { subject, html };
}
