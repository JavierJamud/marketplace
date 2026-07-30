import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Bloque 62: confirmación cuando un admin reactiva una tienda suspendida
// desde AdminSuspendedVendors.jsx — `reason` es el motivo que el admin
// escribió al reactivar (obligatorio en ese formulario).
export async function vendorReactivatedEmail({ vendor, reason }) {
  const { siteName } = await getBrandSettings();
  const subject = `Tu tienda ${vendor.companyName} fue reactivada`;
  const html = await emailShell({
    preview: `Ya puedes volver a gestionar tu tienda ${vendor.companyName}`,
    title: "Tu tienda está activa de nuevo",
    badge: { label: "Reactivada", color: "#0CAE53" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola equipo de <strong>${vendor.companyName}</strong>, tu tienda ya está activa de nuevo — vuelve a estar visible en el marketplace tal cual la dejaste.`)}
      ${reason ? smallNote(`Nota del equipo de ${siteName}: ${reason}`) : ""}
      ${ctaButton("Ir a mi panel", `${env.frontendUrl}/vendedor`)}
    `,
  });
  return { subject, html };
}
