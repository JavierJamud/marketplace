import { emailShell } from "./_shared.js";

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
export function contactMessageEmail({ name, email, message }) {
  const subject = `Nuevo mensaje de contacto — ${name}`;
  const html = emailShell({
    title: "Mensaje de contacto",
    storeName: "ZeuDin",
    bodyHtml: `
      <p style="color:#75777c;font-size:12.5px;margin:0 0 14px;">De <strong style="color:#1b1b1d;">${escapeHtml(name)}</strong> (${escapeHtml(email)}), vía el formulario de /contacto.</p>
      <p style="color:#44474c;font-size:14px;line-height:22px;white-space:pre-wrap;">${escapeHtml(message)}</p>
    `,
  });
  return { subject, html };
}
