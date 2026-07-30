import mjml2html from "mjml";
import { env } from "../config/env.js";
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

// Bloque 61: mismo criterio que formatLogoUrl/getBrandSettings en
// settings.controller.js — el logo de una TIENDA (Vendor.logoUrl) puede ser
// un link externo ya absoluto o una ruta relativa servida por este mismo
// backend; un correo se abre fuera del navegador (sin origin propio), así
// que una ruta relativa necesita el host antepuesto a mano. `null` si no
// hay nada — nunca se inventa una URL.
export function resolveAssetUrl(pathOrUrl) {
  if (!pathOrUrl) return null;
  return /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${env.backendUrl}${pathOrUrl}`;
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

// Bloque 61 (rediseño del shell, pedido explícito): fila de logo/inicial +
// nombre, usada tanto para el header de marca de la plataforma como para el
// de una tienda (mismo layout, distintos datos). Una sola tabla HTML cruda
// (no mj-column) para tener control fino de la alineación vertical
// logo+texto en una sola línea sin pelear con los anchos automáticos de
// MJML — mismo criterio que itemsTable/totalRow más arriba en este archivo.
function brandRowHtml({ imgSrc, imgAlt, name, subtitle }) {
  const avatar = imgSrc
    ? `<img src="${imgSrc}" width="40" height="40" alt="${imgAlt}" style="display:block;width:40px;height:40px;border-radius:10px;object-fit:cover;" />`
    : `<div style="width:40px;height:40px;border-radius:10px;background:#fe9800;color:#0e1a28;font-family:${FONT_STACK};font-size:18px;font-weight:800;text-align:center;line-height:40px;">${(name || "?").charAt(0).toUpperCase()}</div>`;

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <td style="vertical-align:middle;padding-right:12px;">${avatar}</td>
        <td style="vertical-align:middle;">
          <div style="font-family:${FONT_STACK};font-size:19px;font-weight:800;color:#ffffff;line-height:22px;">${name}</div>
          ${subtitle ? `<div style="font-family:${FONT_STACK};font-size:11.5px;color:#9aa3ad;line-height:15px;margin-top:2px;">${subtitle}</div>` : ""}
        </td>
      </tr>
    </table>`;
}

function viaPillHtml(siteName) {
  return `<span style="display:inline-block;padding:5px 12px;border-radius:9999px;background:rgba(255,255,255,0.14);color:#ffffff;font-family:${FONT_STACK};font-size:11px;font-weight:700;white-space:nowrap;">vía ${siteName}</span>`;
}

// left = brandRowHtml(...), rightPill = viaPillHtml(...) o null — una sola
// tabla de 2 celdas (contenido a la izquierda, pastilla a la derecha) en vez
// de 2 mj-column, mismo criterio de arriba.
function headerRowHtml(left, rightPill) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
      <tr>
        <td style="vertical-align:middle;">${left}</td>
        ${rightPill ? `<td style="vertical-align:middle;text-align:right;white-space:nowrap;">${rightPill}</td>` : ""}
      </tr>
    </table>`;
}

// Bloque 61: fila de redes de la plataforma — bulletproof (tabla HTML +
// círculos con sigla, cero imágenes externas) en vez de mj-social, que por
// default tira de íconos alojados en el CDN de MJML. "Sitio web" siempre se
// muestra (env.frontendUrl); WhatsApp/Instagram/Facebook solo si el admin
// cargó el link real en "Marca de la plataforma" — nunca un placeholder.
function socialIconsRowHtml({ whatsappUrl, instagramUrl, facebookUrl }) {
  const icons = [
    whatsappUrl && { label: "WA", href: whatsappUrl },
    instagramUrl && { label: "IG", href: instagramUrl },
    facebookUrl && { label: "FB", href: facebookUrl },
    { label: "WEB", href: env.frontendUrl },
  ].filter(Boolean);

  const cells = icons
    .map(
      (i) =>
        `<td style="padding:0 5px;"><a href="${i.href}" style="display:inline-block;width:34px;height:34px;line-height:34px;border-radius:50%;background:#0e1a28;color:#ffffff;font-family:${FONT_STACK};font-size:10px;font-weight:800;text-align:center;text-decoration:none;">${i.label}</a></td>`
    )
    .join("");

  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>${cells}</tr></table>`;
}

// Envoltorio completo — header de marca + tarjeta blanca + footer, TODO
// dentro de un solo mj-wrapper con bordes redondeados (border-radius en
// mj-wrapper + overflow:hidden vía css-class, ver mj-style abajo) para que
// se vea como una sola tarjeta continua, no 3 bloques pegados.
// preview = preheader (el textito gris que se ve en la lista de la bandeja
// de entrada al lado del asunto, antes de abrir el correo) — mj-preview lo
// genera automático (span oculto), es una práctica estándar de email
// moderno que la plantilla anterior no tenía.
//
// Bloque 61 (rediseño, pedido explícito) — parámetros nuevos:
// - badge {label, color}: pastilla de categoría/estado ARRIBA del título
//   (statusBadge ya existente) — antes cada template la insertaba suelta en
//   bodyMjml, ahora es una posición fija del shell para las 3 plantillas que
//   ya la usaban (verificationUpdate/statusUpdate/tableOrderStatus) y las 3
//   de código de un solo uso (2FA/reset/registro), que no la tenían.
// - storeLogoUrl: si el correo lo manda una TIENDA (no la plataforma) y esa
//   tienda tiene su propio logo (Vendor.logoUrl, ver resolveAssetUrl más
//   arriba), el header muestra el logo/nombre de la tienda + una pastilla
//   "vía {siteName}" a la derecha. Sin logo propio, el header sigue siendo
//   el de la plataforma de siempre (logo real o el cuadrado con la inicial).
export async function emailShell({ preview, title, bodyMjml, storeName, storeLogoUrl, accentColor = "#0e1a28", footerNote, badge }) {
  // Bloque 49: nombre/logo de la plataforma, editable desde "Marca de la
  // plataforma" en el admin. Bloque 61: sin logo propio, ya no se muestra
  // solo el nombre suelto — cae al mismo cuadrado con inicial + subtítulo
  // que usa Footer.jsx en el sitio (mismo criterio, reusado acá).
  const { siteName, logoUrl, whatsappUrl, instagramUrl, facebookUrl } = await getBrandSettings();

  const headerHtml = storeLogoUrl
    ? headerRowHtml(brandRowHtml({ imgSrc: storeLogoUrl, imgAlt: storeName, name: storeName }), viaPillHtml(siteName))
    : logoUrl
    ? headerRowHtml(brandRowHtml({ imgSrc: logoUrl, imgAlt: siteName, name: siteName }))
    : headerRowHtml(brandRowHtml({ name: siteName, subtitle: "Marketplace multivendedor de Cuba" }));

  const badgeMjml = badge ? statusBadge(badge.label, badge.color) : "";

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
      <mj-section background-color="${accentColor}" padding="20px 26px">
        <mj-column>
          <mj-text padding="0">${headerHtml}</mj-text>
        </mj-column>
      </mj-section>
      <mj-section background-color="#ffffff" padding="30px 26px 6px">
        <mj-column>
          ${badgeMjml}
          <mj-text font-size="22px" font-weight="800" color="#1b1b1d" line-height="27px" padding="0 0 16px">${title}</mj-text>
          ${bodyMjml}
        </mj-column>
      </mj-section>
      <mj-section background-color="#ffffff" padding="10px 26px 26px">
        <mj-column>
          <mj-divider border-color="#eae7e9" border-width="1px" padding="0 0 18px" />
          <mj-text padding="0 0 16px">${socialIconsRowHtml({ whatsappUrl, instagramUrl, facebookUrl })}</mj-text>
          <mj-text font-size="11.5px" color="#75777c" line-height="17px" padding="0">
            Enviado por <strong style="color:#44474c;">${storeName}</strong> a través de ${siteName} · Marketplace multivendedor de Cuba.<br/>
            ${footerNote ?? "Este es un correo automático — si tienes dudas, responde directo a la tienda por WhatsApp desde tu pedido."}
          </mj-text>
          <mj-text font-size="10.5px" color="#9a9da1" line-height="15px" align="center" padding="14px 0 0">
            ${siteName} · Cuba — <a href="${env.frontendUrl}/privacidad" style="color:#75777c;">Privacidad</a> ·
            <a href="${env.frontendUrl}/privacidad" style="color:#75777c;">Preferencias de correo</a>
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
