// Bloques HTML reutilizables para emails transaccionales. Mismos tokens de
// color que el resto de la UI (ver tailwind.config.js) — nada inventado acá:
// navy #0e1a28/#232f3e (marca/header), naranja #fe9800 bg + #643900 texto
// (mismo combo que "Agregar al carrito"/"Confirmar pedido" en la app), verde
// #0cae53/#0a8f42 (verificado), rojo #ba1a1a (error/cancelado), teal
// #337475/#61a0a1 (paneles vendedor/admin).
export function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

// Cabecera de marca. accentColor permite que un email "firmado" por una
// tienda específica (envío manual del vendedor) use el color de esa tienda
// en vez del navy genérico de la plataforma, sin perder el logo ZeuDin.
export function brandHeader({ accentColor = "#0e1a28" } = {}) {
  return `<div style="background:${accentColor};padding:20px 24px;">
    <span style="font-family:Arial,Helvetica,sans-serif;color:#fe9800;font-weight:800;font-size:19px;">Zeu</span><span style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-weight:800;font-size:19px;">Din</span>
  </div>`;
}

export function ctaButton(label, href) {
  return `<table role="presentation" style="margin:22px 0 6px;"><tr><td style="border-radius:8px;background:#fe9800;">
    <a href="${href}" style="display:inline-block;padding:13px 26px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#643900;text-decoration:none;">${label}</a>
  </td></tr></table>`;
}

export function statusBadge(label, color) {
  return `<span style="display:inline-block;padding:6px 14px;border-radius:9999px;background:${color}1f;color:${color};font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:14px;">${label}</span>`;
}

export function emailFooter(storeName) {
  return `<div style="padding:16px 24px;color:#75777c;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:17px;">
    Enviado por <strong>${storeName}</strong> a través de ZeuDin · Marketplace multivendedor de Cuba.<br/>
    Este es un correo automático — si tenés dudas, respondé directo a la tienda por WhatsApp desde tu pedido.
  </div>`;
}

// Envoltorio completo: header + card blanca + footer. Todas las plantillas
// pasan por acá para no repetir el layout base en cada una.
export function emailShell({ title, bodyHtml, storeName, accentColor }) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;">
    ${brandHeader({ accentColor })}
    <div style="padding:26px 24px;background:#ffffff;border:1px solid #eae7e9;border-top:none;">
      <h2 style="margin:0 0 16px;color:#1b1b1d;font-size:19px;">${title}</h2>
      ${bodyHtml}
    </div>
    ${emailFooter(storeName)}
  </div>`;
}
