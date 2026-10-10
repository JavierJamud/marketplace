import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph, esc } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";
import { apiBase } from "../lib/partnerDto.js";

// Correos del ciclo de socios de la API: solicitud recibida, aprobada (con su credencial), credencial nueva o
// regenerada, y rechazada. Todo lo que escribe la persona (nombre, empresa, motivo) va escapado.

const trim = (u) => String(u).replace(/\/+$/, "");
const docsUrl = () => `${trim(env.frontendUrl)}/api-socios`;
const loginUrl = () => `${trim(env.frontendUrl)}/socio/ingresar`;

// La credencial se muestra en un bloque aparte, monoespaciado y que parte líneas largas.
function keyBlock(apiKey) {
  return paragraph(
    `<div style="background:#0f172a;border-radius:10px;padding:14px 16px;font-family:Consolas,Menlo,monospace;font-size:13px;line-height:20px;color:#e2e8f0;word-break:break-all;">${esc(apiKey)}</div>`,
    { padding: "4px 0 12px" }
  );
}

function accessList(domains = [], ips = []) {
  const parts = [];
  if (domains.length) parts.push(`<strong>Sitios autorizados:</strong> ${esc(domains.join(", "))}`);
  if (ips.length) parts.push(`<strong>Direcciones IP autorizadas:</strong> ${esc(ips.join(", "))}`);
  return parts.length ? paragraph(parts.join("<br/>"), { color: "#44474c", size: "13px", padding: "0 0 12px" }) : "";
}

export async function partnerApplicationReceivedEmail({ firstName, companyName }) {
  const { siteName } = await getBrandSettings();
  const subject = `Recibimos tu solicitud para usar la API de ${siteName}`;
  const html = await emailShell({
    preview: `Revisaremos la solicitud de ${companyName} y te escribimos con la respuesta`,
    title: "Recibimos tu solicitud",
    badge: { label: "Solicitud recibida", color: "#337475" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola ${esc(firstName)}, recibimos la solicitud de <strong>${esc(companyName)}</strong> para usar la API de socios de ${esc(siteName)}.`)}
      ${paragraph("El equipo la va a revisar. Si la aprueba, te escribimos a este mismo correo con tu credencial de la API y ya podrás entrar a tu panel con la contraseña que elegiste.")}
      ${smallNote("Si no hiciste esta solicitud, ignora este correo.")}
    `,
  });
  return { subject, html };
}

export async function partnerApprovedEmail({ firstName, companyName, apiKey, partnerCode, domains, ips }) {
  const { siteName } = await getBrandSettings();
  const subject = `Aprobamos tu solicitud: esta es tu credencial de la API de ${siteName}`;
  const html = await emailShell({
    preview: `${companyName} ya puede usar la API de ${siteName}`,
    title: "Tu solicitud fue aprobada",
    badge: { label: "Aprobada", color: "#0CAE53" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola ${esc(firstName)}, aprobamos la solicitud de <strong>${esc(companyName)}</strong>. Esta es tu credencial de la API, la única que necesitas para productos, tiendas, carrito y pedidos:`)}
      ${keyBlock(apiKey)}
      ${paragraph(`Dirección de la API: <strong>${esc(apiBase())}</strong><br/>Tu código de socio: <strong>${esc(partnerCode)}</strong>`, { size: "13px", padding: "0 0 12px" })}
      ${accessList(domains, ips)}
      ${paragraph("Envíala en cada solicitud en el encabezado <strong>Authorization: Bearer TU_CREDENCIAL</strong>. Para crear pedidos lo más seguro es llamar a la API desde tu servidor. También puedes verla siempre en tu panel de socio.")}
      ${ctaButton("Entrar a mi panel de socio", loginUrl())}
      ${smallNote(`Documentación: ${docsUrl()}. Si la credencial se filtra, avísanos y la regeneramos. Solo el equipo de ${esc(siteName)} puede regenerarla o cambiar su configuración.`)}
    `,
  });
  return { subject, html };
}

export async function partnerKeyChangedEmail({ firstName, companyName, apiKey, partnerCode, domains, ips, reason }) {
  const { siteName } = await getBrandSettings();
  const regenerated = reason === "regenerated";
  const subject = regenerated ? `Tu credencial de la API de ${siteName} fue regenerada` : `Esta es tu credencial de la API de ${siteName}`;
  const intro = regenerated
    ? `regeneramos la credencial de la API de <strong>${esc(companyName)}</strong>. <strong>La anterior dejó de funcionar</strong>: cambia la credencial en tu sitio por esta`
    : `esta es la credencial de la API de <strong>${esc(companyName)}</strong>`;
  const html = await emailShell({
    preview: regenerated ? "La credencial anterior ya no funciona: usa la nueva" : `Credencial de la API para ${companyName}`,
    title: regenerated ? "Credencial regenerada" : "Tu credencial de la API",
    badge: { label: regenerated ? "Nueva credencial" : "Credencial", color: regenerated ? "#8A5100" : "#337475" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola ${esc(firstName)}, ${intro}:`)}
      ${keyBlock(apiKey)}
      ${paragraph(`Dirección de la API: <strong>${esc(apiBase())}</strong><br/>Tu código de socio: <strong>${esc(partnerCode)}</strong>`, { size: "13px", padding: "0 0 12px" })}
      ${accessList(domains, ips)}
      ${ctaButton("Ver mi credencial en el panel", `${trim(env.frontendUrl)}/socio/llaves`)}
      ${smallNote(`Si no esperabas este cambio, escríbenos de inmediato. Solo el equipo de ${esc(siteName)} puede regenerar o reconfigurar tu credencial.`)}
    `,
  });
  return { subject, html };
}

export async function partnerRejectedEmail({ firstName, companyName, reason }) {
  const { siteName } = await getBrandSettings();
  const subject = `Sobre tu solicitud para la API de ${siteName}`;
  const html = await emailShell({
    preview: `No pudimos aprobar la solicitud de ${companyName}`,
    title: "No pudimos aprobar tu solicitud",
    badge: { label: "Solicitud no aprobada", color: "#8A5100" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola ${esc(firstName)}, revisamos la solicitud de <strong>${esc(companyName)}</strong> y por ahora no la podemos aprobar.`)}
      ${reason ? paragraph(`<strong>Motivo:</strong> ${esc(reason)}`) : ""}
      ${smallNote("Si crees que es un error o quieres corregir algún dato, puedes enviar una solicitud nueva.")}
    `,
  });
  return { subject, html };
}
