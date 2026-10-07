import mjml2html from "mjml";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Bloque 46 (bug real reportado en vivo — "el ícono de la marca no se ve en
// las plantillas de correos... ya está seleccionado un ícono en admin"): el
// logo de la plataforma dejó de subirse/pegar por link desde Admin — ahora
// es un archivo fijo del código (backend/src/assets/logo.png, copia de
// frontend/src/assets/images/logo.png). Antes, emailShell() le pedía este
// mismo archivo AL PROPIO BACKEND por HTTP (inlineIfSmall, ya eliminado) para
// poder incrustarlo — un fetch que fallaba en silencio apenas el backend no
// podía alcanzarse a sí mismo por esa URL (típico sin BACKEND_URL público
// en producción), cayendo siempre al círculo con la inicial aunque el logo
// SÍ estuviera bien configurado. Leer el archivo directo del disco, una
// sola vez al arrancar el proceso (nunca cambia en runtime, ya no es
// editable desde Admin), elimina esa clase entera de bug — no hay red de
// por medio, no hay forma de que falle.
//
// Corrección posterior (el logo seguía sin verse en Gmail/Outlook): un
// data: URI dentro del <img> lo bloquean Gmail y Outlook — la imagen sale
// rota o directamente no aparece. Lo mismo pasa con SVG. Un correo solo
// muestra de forma confiable un PNG/JPG con URL absoluta https alcanzable
// desde internet. Por eso ahora el disco solo se lee para conocer el
// tamaño real del PNG (atributos width/height, que Outlook necesita) y la
// imagen se referencia por URL pública:
//   1) logo de marca de getBrandSettings() → ${BACKEND_URL}/brand/logo.png
//      (en producción https://baznova.com/api/brand/logo.png — nginx manda
//      /api/ a la raíz del backend, y app.js sirve /brand desde assets/).
//   2) si eso no sirve (SVG, sin URL pública), el PNG fijo del frontend:
//      ${FRONTEND_URL}/email-logo.png (frontend/public/email-logo.png,
//      rasterizado una vez desde favicon.svg — nunca en cada envío).
//   3) si tampoco, el nombre del sitio como texto. Nunca una imagen rota.
const LOGO_DISPLAY_SIZE = 44;

// Ancho/alto de un PNG leyendo su cabecera IHDR (bytes 16-23) — sin
// dependencias ni async. null si el archivo no está o no es PNG.
function readPngSize(filePath) {
  try {
    const buf = readFileSync(filePath);
    if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

// Escala (ancho, alto) para que el lado mayor mida LOGO_DISPLAY_SIZE.
function fitLogoSize(size) {
  if (!size?.width || !size?.height) return { width: LOGO_DISPLAY_SIZE, height: LOGO_DISPLAY_SIZE };
  const scale = LOGO_DISPLAY_SIZE / Math.max(size.width, size.height);
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

const BRAND_LOGO_SIZE = fitLogoSize(
  readPngSize(join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "logo-color.png"))
);

// ¿Esta URL la puede descargar un cliente de correo? Absoluta, sin data:,
// sin SVG. En producción además exige https y un host que no sea local
// (localhost solo sirve para previsualizar en desarrollo).
export function isEmailSafeImageUrl(url) {
  if (typeof url !== "string" || !url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (/\.svgz?$/i.test(parsed.pathname)) return false;
  if (env.nodeEnv === "production") {
    if (parsed.protocol !== "https:") return false;
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(parsed.hostname)) return false;
  }
  return true;
}

// Logo de la plataforma para el header: { src, width, height } o null
// (null = header solo con texto).
// Bloque 284 (pedido explícito — "usa el logo a color, el blanco casi no se ve"): el
// correo siempre usa el logo A COLOR (backend/src/assets/logo-color.png, copia del de
// frontend/src/assets/images), servido en ${BACKEND_URL}/brand/logo-color.png.
function resolvePlatformLogo() {
  const colorLogo = `${trimSlash(env.backendUrl)}/brand/logo-color.png`;
  if (isEmailSafeImageUrl(colorLogo)) return { src: colorLogo, ...BRAND_LOGO_SIZE };
  const fallback = `${trimSlash(env.frontendUrl)}/email-logo.png`;
  if (isEmailSafeImageUrl(fallback)) return { src: fallback, width: LOGO_DISPLAY_SIZE, height: LOGO_DISPLAY_SIZE };
  return null;
}

function trimSlash(url) {
  return String(url ?? "").replace(/\/+$/, "");
}

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

// Bloque 284 (pedido explícito — "asuntos variados y personalizados para que no parezca
// una campaña ni caiga en spam"): elige un asunto entre varias redacciones según una
// semilla (el código, el pedido...), así dos correos seguidos no llevan el mismo asunto.
export function pickVariant(seed, options) {
  let h = 0;
  for (const ch of String(seed ?? "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return options[h % options.length];
}

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
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${trimSlash(env.backendUrl)}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

// Bloque 203 (historia): acá vivía inlineIfSmall(), que descargaba el logo
// de la tienda y lo incrustaba como data: URI. Gmail y Outlook bloquean los
// data: URI en <img>, así que el logo seguía sin verse — se eliminó. Los
// logos de tienda ahora van por URL absoluta (resolveAssetUrl) y solo si
// isEmailSafeImageUrl() los acepta; si no, se muestra la inicial.

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
  return `<mj-button href="${href}" background-color="#fe9800" color="#643900" font-family="${FONT_STACK}" font-size="15px" font-weight="700" line-height="20px" border-radius="10px" inner-padding="14px 30px" padding="18px 0 4px" align="left">${label}</mj-button>`;
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

// items: [{ name, quantity, price, imageUrl?, size? }] — tabla simple, sigue
// siendo HTML crudo (más control fino que mj-table para este layout
// puntual) pero embebido dentro de mj-text, que sí acepta HTML libre.
// Bloque 231 (pedido explícito — "las plantillas de correo enviada a los
// clientes debe contener más información de su pedido para que el cliente
// sepa qué artículos son"): antes era solo texto ("2× Nombre") — ahora cada
// fila lleva la foto real del producto (si tiene, mismo criterio de
// resolveAssetUrl que el logo) para que se reconozca a simple vista, no
// solo por el nombre. Sin foto, cae a un cuadrado con el ícono de bolsa de
// compra (mismo SVG que ya usa socialIconCellHtml de acá abajo para "Sitio
// web" — un solo set de glyphs en todo el correo, nunca uno nuevo).
const BAG_ICON_SVG =
  '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>';

function itemThumbHtml(imageUrl) {
  if (imageUrl) {
    return `<img src="${imageUrl}" width="40" height="40" alt="" border="0" style="display:block;width:40px;height:40px;border:0;outline:none;border-radius:8px;object-fit:cover;" />`;
  }
  return `<table role="presentation" width="40" height="40" cellpadding="0" cellspacing="0" bgcolor="#f0edee" style="width:40px;height:40px;border-radius:8px;background:#f0edee;">
    <tr><td align="center" valign="middle" style="width:40px;height:40px;border-radius:8px;">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9a9da1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${BAG_ICON_SVG}</svg>
    </td></tr>
  </table>`;
}

export function itemsTable(items) {
  const rows = items
    .map(
      (i) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #f0edee;width:48px;">${itemThumbHtml(i.imageUrl)}</td>
        <td style="padding:8px 0 8px 10px;border-bottom:1px solid #f0edee;color:#1b1b1d;font-size:13.5px;">
          ${i.quantity}× ${i.name}${i.size ? `<span style="color:#75777c;"> (talla ${i.size})</span>` : ""}
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #f0edee;text-align:right;color:#1b1b1d;font-size:13.5px;white-space:nowrap;">${fmtCUP(Number(i.price) * i.quantity)}</td>
      </tr>`
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
// imgWidth/imgHeight: tamaño real a mostrar (atributos html, no solo CSS —
// Outlook de escritorio ignora el CSS y usa los atributos). showInitial:
// sin imagen, ¿mostrar el cuadrado con la inicial? (tiendas sí; la
// plataforma sin logo usable queda solo con el nombre como texto).
function brandRowHtml({ imgSrc, imgAlt, imgWidth = 40, imgHeight = 40, name, subtitle, href, showInitial = true }) {
  let avatar = "";
  if (imgSrc) {
    const img = `<img src="${imgSrc}" width="${imgWidth}" height="${imgHeight}" alt="${imgAlt ?? ""}" border="0" style="display:block;width:${imgWidth}px;height:${imgHeight}px;border:0;outline:none;text-decoration:none;border-radius:10px;" />`;
    avatar = href ? `<a href="${href}" style="text-decoration:none;border:0;">${img}</a>` : img;
  } else if (showInitial) {
    avatar = `<table role="presentation" width="40" height="40" cellpadding="0" cellspacing="0" bgcolor="#fe9800" style="width:40px;height:40px;border-radius:10px;background:#fe9800;"><tr><td align="center" valign="middle" style="width:40px;height:40px;font-family:${FONT_STACK};font-size:18px;font-weight:800;color:#0e1a28;">${(name || "?").charAt(0).toUpperCase()}</td></tr></table>`;
  }
  const nameHtml = href
    ? `<a href="${href}" style="color:#ffffff;text-decoration:none;">${name}</a>`
    : name;

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        ${avatar ? `<td style="vertical-align:middle;padding-right:12px;">${avatar}</td>` : ""}
        <td style="vertical-align:middle;">
          <div style="font-family:${FONT_STACK};font-size:19px;font-weight:800;color:#ffffff;line-height:22px;">${nameHtml}</div>
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

// Bloque 284 (pedido explícito — "los iconos del pie solo el icono, sin fondo de color, un
// solo color de trazo, con la librería de iconos actual"): los glifos son los de
// lucide-react (message-circle, instagram, facebook, globe), dibujados con trazo fino de
// UN color (#5b6470) y guardados como PNG en backend/src/assets/social. Van como <img> y
// no como SVG en línea porque Gmail y Outlook no muestran SVG. "Sitio web" siempre
// aparece; WhatsApp/Instagram/Facebook solo si el admin cargó el link real.
const SOCIAL_ICON_LABELS = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook", web: "Sitio web" };

function socialIconCellHtml(key, href) {
  const src = `${trimSlash(env.backendUrl)}/brand/social/${key}.png`;
  const label = SOCIAL_ICON_LABELS[key];
  return `<td style="padding:0 7px;">
    <a href="${href}" style="text-decoration:none;border:0;" title="${label}">
      <img src="${src}" width="24" height="24" alt="${label}" border="0" style="display:block;width:24px;height:24px;border:0;outline:none;" />
    </a>
  </td>`;
}

function socialIconsRowHtml({ whatsappUrl, instagramUrl, facebookUrl }) {
  const cells = [
    whatsappUrl && socialIconCellHtml("whatsapp", whatsappUrl),
    instagramUrl && socialIconCellHtml("instagram", instagramUrl),
    facebookUrl && socialIconCellHtml("facebook", facebookUrl),
    socialIconCellHtml("web", env.frontendUrl),
  ]
    .filter(Boolean)
    .join("");

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${cells}</tr></table>`;
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
  // Bloque 49: nombre de la plataforma, editable desde "Marca de la
  // plataforma" en el admin. El logo sale de resolvePlatformLogo() (arriba):
  // siempre una URL https pública a un PNG, o texto si no hay ninguna.
  const { siteName, whatsappUrl, instagramUrl, facebookUrl } = await getBrandSettings();
  const siteUrl = trimSlash(env.frontendUrl);
  const siteHost = siteUrl.replace(/^https?:\/\//, "");
  const platformLogo = resolvePlatformLogo();

  let headerHtml;
  if (storeLogoUrl) {
    const storeImg = isEmailSafeImageUrl(storeLogoUrl) ? storeLogoUrl : null;
    headerHtml = headerRowHtml(
      brandRowHtml({ imgSrc: storeImg, imgAlt: storeName, name: storeName }),
      viaPillHtml(siteName)
    );
  } else if (platformLogo) {
    headerHtml = headerRowHtml(
      brandRowHtml({
        imgSrc: platformLogo.src,
        imgAlt: siteName,
        imgWidth: platformLogo.width,
        imgHeight: platformLogo.height,
        name: siteName,
        subtitle: "Marketplace multivendedor de Cuba",
        href: siteUrl,
      })
    );
  } else {
    headerHtml = headerRowHtml(
      brandRowHtml({ name: siteName, subtitle: "Marketplace multivendedor de Cuba", href: siteUrl, showInitial: false })
    );
  }

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
      <mj-section background-color="#fe9800" padding="0"><mj-column><mj-spacer height="3px" /></mj-column></mj-section>
      <mj-section background-color="#ffffff" padding="30px 26px 6px">
        <mj-column>
          ${badgeMjml}
          <mj-text font-size="22px" font-weight="800" color="#1b1b1d" line-height="27px" padding="0 0 16px">${title}</mj-text>
          ${bodyMjml}
        </mj-column>
      </mj-section>
      <mj-section background-color="#ffffff" padding="6px 26px 0">
        <mj-column>
          <mj-divider border-color="#eae7e9" border-width="1px" padding="10px 0 0" />
        </mj-column>
      </mj-section>
      <mj-section background-color="#f7f5f6" padding="22px 26px 8px">
        <mj-column width="55%" vertical-align="top">
          <mj-text font-size="14px" font-weight="800" color="#1b1b1d" line-height="18px" padding="0 0 4px"><a href="${siteUrl}" style="color:#1b1b1d;text-decoration:none;">${siteName}</a></mj-text>
          <mj-text font-size="12px" color="#75777c" line-height="18px" padding="0 0 12px">Marketplace multivendedor de Cuba</mj-text>
          <mj-text padding="0 0 14px" align="left">${socialIconsRowHtml({ whatsappUrl, instagramUrl, facebookUrl })}</mj-text>
        </mj-column>
        <mj-column width="45%" vertical-align="top">
          <mj-text font-size="12.5px" color="#75777c" line-height="22px" padding="0 0 14px">
            <a href="${siteUrl}" style="color:#44474c;text-decoration:none;font-weight:700;">${siteHost}</a><br/>
            <a href="${siteUrl}/terminos" style="color:#75777c;text-decoration:none;">Términos y condiciones</a><br/>
            <a href="${siteUrl}/privacidad" style="color:#75777c;text-decoration:none;">Política de privacidad</a>
          </mj-text>
        </mj-column>
      </mj-section>
      <mj-section background-color="#f7f5f6" padding="0 26px 24px">
        <mj-column>
          <mj-text font-size="11px" color="#8a8d92" line-height="16px" padding="0">
            Enviado por <strong style="color:#5b6470;">${storeName}</strong> a través de ${siteName}.<br/>
            ${footerNote ?? "Este es un correo automático: si tienes dudas, responde directo a la tienda por WhatsApp desde tu pedido."}<br/>
            © ${new Date().getFullYear()} ${siteName}. Todos los derechos reservados.
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
