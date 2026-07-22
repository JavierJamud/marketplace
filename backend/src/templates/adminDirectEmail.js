import { emailShell } from "./_shared.js";

// Bloque 47: correo puntual admin -> cliente/tienda (distinto del envío
// masivo segmentado de AdminCampaigns.jsx) — mismo shell base que
// vendorMessage.js, sin el contexto de un pedido (acá no hay ninguno).
export function adminDirectEmail({ subject, message, recipientName }) {
  const html = emailShell({
    title: subject,
    storeName: "ZeuDin",
    bodyHtml: `
      <p style="color:#75777c;font-size:12.5px;margin:0 0 14px;">Mensaje del equipo de <strong style="color:#1b1b1d;">ZeuDin</strong>${recipientName ? ` para ${recipientName}` : ""}</p>
      <p style="color:#44474c;font-size:14px;line-height:22px;white-space:pre-wrap;">${message}</p>
    `,
  });
  return { subject, html };
}
