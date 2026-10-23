import { env } from "../config/env.js";
import { CODE_TTL_MINUTES } from "../lib/codeTtl.js";
import { emailShell, ctaButton, codeBlock, paragraph, smallNote, pickVariant, esc } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// El código va al correo NUEVO: es la única prueba de que quien pide el cambio controla esa dirección.
// Los pedidos de invitado se asignan a la cuenta por su correo, así que un correo sin verificar daría acceso
// a pedidos ajenos (auditoría run-2). El correo viejo recibe aparte un aviso sin código (emailChangeNoticeEmail).
export async function emailChangeCodeEmail({ fullName, code, newEmail }) {
  const { siteName } = await getBrandSettings();
  const first = fullName ? String(fullName).split(" ")[0] : null;
  const subject = pickVariant(code, first
    ? [`${first}, confirma tu nuevo correo`, `${first}, valida tu nuevo correo`]
    : ["Confirma tu nuevo correo", "Valida tu nuevo correo"]);
  const html = await emailShell({
    preview: "Usa este código para confirmar tu nuevo correo",
    title: "Confirmar nuevo correo",
    badge: { label: "Seguridad de la cuenta", color: "#0CAE53" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola ${esc(fullName)}, pediste usar <strong>${esc(newEmail)}</strong> como correo de tu cuenta en ${esc(siteName)}. Escribe este código para confirmarlo. Vence en <strong>${CODE_TTL_MINUTES} minutos</strong>.`)}
      ${codeBlock(code)}
      ${smallNote("Si no pediste este cambio, ignora este correo: sin este código nadie puede usar tu dirección.")}
      ${ctaButton(`Ir a ${siteName}`, `${env.frontendUrl}/cuenta`)}
    `,
  });
  return { subject, html };
}

// Aviso al correo actual de la cuenta: sin código, solo para que el dueño reconozca un cambio que no pidió.
export async function emailChangeNoticeEmail({ fullName, newEmail }) {
  const { siteName } = await getBrandSettings();
  const subject = "Pidieron cambiar el correo de tu cuenta";
  const html = await emailShell({
    preview: "Alguien pidió cambiar el correo de tu cuenta",
    title: "Cambio de correo pedido",
    badge: { label: "Seguridad de la cuenta", color: "#0CAE53" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola ${esc(fullName)}, se pidió cambiar el correo de tu cuenta a <strong>${esc(newEmail)}</strong>. El cambio solo se aplica si se confirma con el código enviado a esa dirección.`)}
      ${smallNote("Si no fuiste tú, cambia tu contraseña y cierra la sesión en todos tus dispositivos.")}
      ${ctaButton(`Ir a ${siteName}`, `${env.frontendUrl}/cuenta`)}
    `,
  });
  return { subject, html };
}
