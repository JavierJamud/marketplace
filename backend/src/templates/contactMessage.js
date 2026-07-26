import { emailShell, paragraph } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Bloque 48: a diferencia de vendorMessage.js (texto de un vendedor ya
// logueado) o adminDirectEmail.js (lo escribe el propio admin), acá los 3
// campos vienen de un formulario público SIN login — cualquiera en
// internet puede mandar cualquier cosa. Se escapa antes de insertar en el
// HTML del correo para que un "nombre" con <script> o etiquetas no se
// interprete como marcado real en el cliente de correo del admin.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// Bloque 48: mensaje del formulario público de /contacto — va al correo del
// admin, nunca al revés (esto no es una respuesta automática al visitante).
export async function contactMessageEmail({ name, email, message }) {
  const { siteName } = await getBrandSettings();
  const subject = `Nuevo mensaje de contacto — ${name}`;
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br/>");
  const html = await emailShell({
    preview: message.slice(0, 120),
    title: "Mensaje de contacto",
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`De <strong style="color:#1b1b1d;">${escapeHtml(name)}</strong> (${escapeHtml(email)}), vía el formulario de /contacto.`, { color: "#75777c", size: "12.5px", padding: "0 0 14px" })}
      ${paragraph(safeMessage, { color: "#44474c", size: "14px", lineHeight: "22px" })}
    `,
  });
  return { subject, html };
}
