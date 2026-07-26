import mjml2html from "mjml";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Bloque 49 (pedido explícito): reemplaza el shell hecho a mano con <div>
// (frágil en Outlook — el motor de Word de Outlook desktop no soporta bien
// CSS en divs/border-radius/box-shadow) por MJML, la librería estándar de
// la industria para email — compila a HTML basado en tablas con los
// fallbacks/condicionales de Outlook (VML, mso-*) y los hacks de cada
// cliente ya resueltos por la librería, no por nosotros a mano. Toda
// plantilla pasa por emailShell() de acá, así todas comparten la misma
// estructura visual (tarjeta blanca de bordes redondeados sobre fondo gris,
// header de marca, footer) y solo cambia el contenido del medio.
// Mismos tokens de color que el resto de la UI (ver tailwind.config.js):
// navy #0e1a28/#232f3e (marca/header), naranja #fe9800 bg + #643900 texto
// (CTA), verde #0cae53/#0a8f42 (verificado), rojo #ba1a1a (error/cancelado),
// teal #337475/#61a0a1 (paneles vendedor/admin).
//
// Fuente: Helvetica/Arial (no un webfont de Google) — a propósito. Es la
// recomendación estándar de toda la documentación de compatibilidad de
// email (Litmus/MJML/Mailchimp): Outlook de escritorio no soporta @import
// de Google Fonts y cae a Times New Roman con un "flash" visible si se pide
// un webfont sin fallback — un stack de fuentes de sistema se ve igual en
// todos los clientes desde el primer render, sin parpadeo.
const FONT_STACK = "Helvetica, Arial, sans-serif";

export function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

// Párrafo de texto — helper fino sobre mj-text para no repetir el mismo
// padding/tag en cada plantilla.
export function paragraph(html, { color = "#44474c", size = "14px", lineHeight = "21px", padding = "0 0 14px" } = {}) {
  return `<mj-text color="${color}" font-size="${size}" line-height="${lineHeight}" padding="${padding}">${html}</mj-text>`;
}

export function smallNote(html) {
  return paragraph(html, { color: "#75777c", size: "12.5px", lineHeight: "19px" });
}

// Botón de acción — un solo estilo en toda la plataforma (mismo naranja que
// "Agregar al carrito"/"Confirmar pedido" en la app).
export function ctaButton(label, href) {
  return `<mj-button href="${href}" background-color="#fe9800" color="#643900" font-family="${FONT_STACK}" font-size="14px" font-weight="700" border-radius="10px" inner-padding="13px 28px" padding="18px 0 4px" align="left">${label}</mj-button>`;
}

// Pastilla de estado (ej. "Preparando", "Verificada") — mismo patrón que
// Badge.jsx en la app: fondo del color al ~12% de opacidad, texto sólido.
export function statusBadge(label, color) {
  return paragraph(
    `<span style="display:inline-block;padding:7px 16px;border-radius:9999px;background:${color}1f;color:${color};font-family:${FONT_STACK};font-weight:800;font-size:13px;">${label}</span>`,
    { padding: "4px 0 16px" }
  );
}

// Código de un solo uso (2FA / reset de contraseña) — bloque grande,
// monoespaciado, fácil de leer/copiar en un vistazo.
export function codeBlock(code) {
  return paragraph(
    `<div style="text-align:center;"><span style="display:inline-block;padding:16px 30px;border-radius:12px;background:#f0edee;font-family:'Courier New',monospace;font-size:32px;font-weight:800;letter-spacing:8px;color:#1b1b1d;">${code}</span></div>`,
    { padding: "8px 0 18px" }
  );
}

// items: [{ name, quantity, price }] — tabla simple de 2 columnas, sigue
// siendo HTML crudo (más control fino que mj-table para este layout
// puntual) pero embebido dentro de mj-text, que sí acepta HTML libre.
export function itemsTable(items) {
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #f0edee;color:#1b1b1d;font-size:13.5px;">${i.quantity}× ${i.name}</td><td style="padding:8px 0;border-bottom:1px solid #f0edee;text-align:right;color:#1b1b1d;font-size:13.5px;">${fmtCUP(Number(i.price) * i.quantity)}</td></tr>`
    )
    .join("");
  return paragraph(`<table role="presentation" width="100%" style="width:100%;border-collapse:collapse;">${rows}</table>`, { padding: "4px 0 8px" });
}

export function totalRow(label, amount) {
  return paragraph(
    `<table role="presentation" width="100%" style="width:100%;"><tr><td style="font-weight:800;color:#1b1b1d;font-size:15px;">${label}</td><td style="text-align:right;font-weight:800;color:#1b1b1d;font-size:15px;">${amount}</td></tr></table>`,
    { padding: "6px 0 4px" }
  );
}

// Ficha de datos clave/valor (ej. Nº de pedido, método de pago) — misma
// tipografía chica y muted que el resto de metadata secundaria.
export function metaList(rows) {
  const html = rows
    .filter(Boolean)
    .map(([k, v]) => `<div style="margin:2px 0;"><strong style="color:#44474c;">${k}:</strong> ${v}</div>`)
    .join("");
  return paragraph(html, { color: "#75777c", size: "12.5px", lineHeight: "19px", padding: "14px 0 4px" });
}

// Envoltorio completo — header de marca + tarjeta blanca + footer, TODO
// dentro de un solo mj-wrapper con bordes redondeados (border-radius en
// mj-wrapper + overflow:hidden vía css-class, ver mj-style abajo) para que
// se vea como una sola tarjeta continua, no 3 bloques pegados.
// preview = preheader (el textito gris que se ve en la lista de la bandeja
// de entrada al lado del asunto, antes de abrir el correo) — mj-preview lo
// genera automático (span oculto), es una práctica estándar de email
// moderno que la plantilla anterior no tenía.
export async function emailShell({ preview, title, bodyMjml, storeName, accentColor = "#0e1a28", footerNote }) {
  // Bloque 49: nombre/logo de la plataforma, editable desde "Marca de la
  // plataforma" en el admin — ya no el "Zeu"/"Din" a dos colores hardcodeado.
  // Con logo propio se usa la imagen; sin logo, el nombre en texto plano
  // (el partido a dos colores era específico de la palabra "ZeuDin" y no
  // tiene forma de generalizarse a un nombre cualquiera).
  const { siteName, logoUrl } = await getBrandSettings();
  const headerMjml = logoUrl
    ? `<mj-image src="${logoUrl}" alt="${siteName}" width="120px" align="left" padding="0" />`
    : `<mj-text font-size="20px" font-weight="800" color="#ffffff" align="left" padding="0">${siteName}</mj-text>`;

  const mjml = `
<mjml>
  <mj-head>
    <mj-title>${title}</mj-title>
    ${preview ? `<mj-preview>${preview}</mj-preview>` : ""}
    <mj-attributes>
      <mj-all font-family="${FONT_STACK}" />
      <mj-text font-size="14px" color="#44474c" line-height="21px" />
    </mj-attributes>
    <mj-style>
      .email-shell { overflow: hidden; }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f0edee" width="600px">
    <mj-wrapper border-radius="18px" padding="0" css-class="email-shell">
      <mj-section background-color="${accentColor}" padding="22px 26px">
        <mj-column>
          ${headerMjml}
        </mj-column>
      </mj-section>
      <mj-section background-color="#ffffff" padding="28px 26px 6px">
        <mj-column>
          <mj-text font-size="19px" font-weight="800" color="#1b1b1d" padding="0 0 16px">${title}</mj-text>
          ${bodyMjml}
        </mj-column>
      </mj-section>
      <mj-section background-color="#ffffff" padding="6px 26px 24px">
        <mj-column>
          <mj-divider border-color="#eae7e9" border-width="1px" padding="0 0 14px" />
          <mj-text font-size="11.5px" color="#75777c" line-height="17px" padding="0">
            Enviado por <strong style="color:#44474c;">${storeName}</strong> a través de ${siteName} · Marketplace multivendedor de Cuba.<br/>
            ${footerNote ?? "Este es un correo automático — si tienes dudas, responde directo a la tienda por WhatsApp desde tu pedido."}
          </mj-text>
        </mj-column>
      </mj-section>
    </mj-wrapper>
  </mj-body>
</mjml>`;

  const { html, errors } = await mjml2html(mjml, { validationLevel: "soft" });
  if (errors?.length) {
    console.error("[email] advertencias al compilar MJML:", JSON.stringify(errors.map((e) => e.formattedMessage ?? e.message)));
  }
  return html;
}
