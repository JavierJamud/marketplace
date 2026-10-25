import fs from "node:fs";
import { createRequire } from "node:module";
import sharp from "sharp";
import * as opentypeNs from "opentype.js";

// Imagen de vista previa (1200x630) que se ve al compartir el enlace de una tienda: el banner de su página (ver
// renderStoreOgImage abajo). El texto se convierte a trazos con opentype.js a propósito: así no depende de las fuentes instaladas en el
// servidor, que no tiene ninguna.

const opentype = opentypeNs.default ?? opentypeNs;
const require = createRequire(import.meta.url);
// Se dibuja letra por letra (sin ligaduras ni kerning): con las ligaduras de esta fuente algunas letras salían cortadas.
function advance(f, text, size) {
  let w = 0;
  for (const ch of String(text)) w += (f.charToGlyph(ch).advanceWidth * size) / f.unitsPerEm;
  return w;
}

// Los trazos se arman a mano desde los contornos de la letra: el convertidor de opentype.js devolvía NaN en algunas curvas.
function pathData(f, text, x, y, size) {
  const k = size / f.unitsPerEm;
  const n = (v) => (Math.round(v * 100) / 100).toString();
  const out = [];
  let cx = x;
  for (const ch of String(text)) {
    const g = f.charToGlyph(ch);
    for (const c of g.path.commands) {
      const X = (v) => n(cx + v * k);
      const Y = (v) => n(y - v * k);
      if (c.type === "M" || c.type === "L") out.push(`${c.type}${X(c.x)} ${Y(c.y)}`);
      else if (c.type === "Q") out.push(`Q${X(c.x1)} ${Y(c.y1)} ${X(c.x)} ${Y(c.y)}`);
      else if (c.type === "C") out.push(`C${X(c.x1)} ${Y(c.y1)} ${X(c.x2)} ${Y(c.y2)} ${X(c.x)} ${Y(c.y)}`);
      else if (c.type === "Z") out.push("Z");
    }
    cx += g.advanceWidth * k;
  }
  return out.join("");
}

const W = 1200;
const H = 630;

const fontCache = {};
function font(weight) {
  if (!fontCache[weight]) {
    const file = require.resolve(`@fontsource/montserrat/files/montserrat-latin-${weight}-normal.woff`);
    const buf = fs.readFileSync(file);
    fontCache[weight] = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  return fontCache[weight];
}

// Parte un texto en líneas que caben en `maxWidth`; si sobra texto, la última termina en "...".
function fit(f, text, size, maxWidth) {
  if (advance(f, text, size) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && advance(f, `${s}...`, size) > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
}

function wrap(f, text, size, maxWidth, maxLines) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (!line || advance(f, test, size) <= maxWidth) line = test;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]}...`;
    return kept.map((l) => fit(f, l, size, maxWidth));
  }
  return lines.map((l) => fit(f, l, size, maxWidth));
}

function textPath(f, text, x, y, size, fill, opacity = 1) {
  return `<path d="${pathData(f, text, x, y, size)}" fill="${fill}" fill-opacity="${opacity}"/>`;
}

// Dibujos de íconos y temas del banner, copiados de la web (frontend/scripts/export-og-icons.mjs): la imagen usa
// exactamente los mismos íconos que el banner de la tienda.
const OG = JSON.parse(fs.readFileSync(new URL("../assets/og-icons.json", import.meta.url), "utf8"));
const KEYWORDS = OG.keywordTheme.map(([src, theme]) => [new RegExp(src), theme]);

function iconSvg(name, x, y, size, { stroke = "#fff", opacity = 1, strokeWidth = 2, fill = "none" } = {}) {
  const inner = OG.icons[name] ?? OG.icons.Store;
  const k = size / 24;
  return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(4)})" fill="${fill}" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
}

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/-/g, " ");
function themeIcons(vendor) {
  if (vendor.isRestaurant) return OG.themes.food;
  const direct = OG.categoryTheme[vendor.categorySlug];
  if (direct) return OG.themes[direct];
  const text = `${fold(vendor.categorySlug)} ${fold(vendor.category)}`;
  const match = KEYWORDS.find(([re]) => re.test(text));
  return OG.themes[match?.[1]] ?? OG.themes.default;
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFrom(id) {
  let hash = 0;
  for (const ch of String(id ?? "")) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash || 1;
}

// Fondo de íconos del rubro: mismas reglas que el banner (frontend components/BannerIcons.jsx): cada ícono en su celda
// (no se pisan), filas alternadas, sin huecos y nunca el mismo ícono junto a sus vecinos.
function iconPattern(vendor, { cell = 92, minSize = 26, maxSize = 52 } = {}) {
  const icons = themeIcons(vendor);
  const rand = mulberry32(seedFrom(vendor.id));
  const cols = Math.max(3, Math.round(W / cell));
  const rows = Math.max(2, Math.round(H / cell));
  const cw = W / cols;
  const ch = H / rows;
  const fitSize = Math.min(cw, ch) - 6;
  const biggest = Math.max(8, Math.min(maxSize, fitSize / 1.42));
  const smallest = Math.min(minSize, biggest);
  let bag = [];
  const draw = (exclude) => {
    for (let tries = 0; tries < icons.length * 2; tries++) {
      if (!bag.length) {
        bag = icons.slice();
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }
      }
      const c = bag.pop();
      if (!exclude.has(c) || icons.length <= exclude.size) return c;
      bag.unshift(c);
    }
    return bag.pop() ?? icons[0];
  };
  const out = [];
  const byRow = [];
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 ? -cw / 2 : 0;
    const count = r % 2 ? cols + 1 : cols;
    const row = [];
    for (let c = 0; c < count; c++) {
      const cx = offset + c * cw + cw / 2;
      const cy = r * ch + ch / 2;
      const exclude = new Set();
      if (row.length) exclude.add(row[row.length - 1].name);
      for (const up of byRow[r - 1] ?? []) if (Math.abs(up.cx - cx) <= cw) exclude.add(up.name);
      const name = draw(exclude);
      const size = smallest + rand() * (biggest - smallest);
      const room = Math.max(0, fitSize - size * 1.42) / 2;
      const x = cx + (rand() * 2 - 1) * room;
      const y = cy + (rand() * 2 - 1) * room;
      const rot = Math.floor(rand() * 360);
      const op = 0.16 + rand() * 0.12;
      row.push({ name, cx });
      const k = size / 24;
      out.push(
        `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot}) scale(${k.toFixed(4)}) translate(-12 -12)" fill="none" stroke="#fff" stroke-opacity="${op.toFixed(2)}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${OG.icons[name] ?? ""}</g>`
      );
    }
    byRow.push(row);
  }
  return out.join("");
}

// logoPath es una ruta del disco ya validada (brandingLogoDiskPath); nunca una URL.
async function logoBuffer(logoPath, size) {
  if (!logoPath) return null;
  try {
    const input = await fs.promises.readFile(logoPath);
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);
    return await sharp(input)
      .resize(size, size, { fit: "cover", background: "#ffffff" })
      .flatten({ background: "#ffffff" })
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

const SOCIAL = [
  ["whatsapp", "MessageCircle", "#25D366"],
  ["facebook", "Facebook", "#1877F2"],
  ["instagram", "Instagram", "url(#ig)"],
  ["tiktok", null, "#FE2C55"],
  ["youtube", "Youtube", "#FF0000"],
  ["telegram", "Send", "#29A9EB"],
];
const TIKTOK = `<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.5 2.6 2.4 4.4 5 4.6"/>`;
const PAYMENT_LABEL = {
  zelle: "Zelle",
  visa: "Visa",
  mastercard: "Mastercard",
  usdt: "USDT",
  tropipay: "Tropipay",
  card: "Tarjeta de crédito/débito",
  bizum: "Bizum",
  postepay: "Postepay",
  iban: "IBAN / Transferencia",
  paypal: "PayPal",
  cashapp: "Cash App",
  venmo: "Venmo",
};

// Imagen de vista previa al compartir el enlace de una tienda (1200x630): el banner de la tienda tal como se ve en su
// página (pedido del dueño): fondo con el color de la tienda e íconos de su rubro, logo, nombre con el sello, pastilla
// del rubro con su ícono, descripción, redes encendidas, y la franja de abajo con estrellas, productos, ubicación, año,
// envío y métodos de pago. No lleva "abierto/cerrado": WhatsApp guarda la vista previa y quedaría desactualizada.
// vendor: { id, companyName, color, logoUrl (absoluta), category, categorySlug, categoryIcon, isRestaurant, place,
//           verified, description, socialLinks ({ red: url } solo encendidas), rating, reviewCount, productCount,
//           year, shippingText, payments: [ids] }
export async function renderStoreOgImage(vendor) {
  const bold = font(800);
  const semi = font(600);
  const color = /^#[0-9a-f]{6}$/i.test(vendor.color ?? "") ? vendor.color : "#232F3E";
  const PX = 64;
  const avatar = 150;
  const ax = PX;
  const ay = 56;
  const tx = ax + avatar + 40;
  const tw = W - tx - PX;
  const parts = [];

  // Nombre en una línea (si no cabe se achica y, si aún no, termina en "...") con el sello al lado.
  const seal = vendor.verified ? 48 : 0;
  let nameSize = 54;
  while (nameSize > 38 && advance(bold, vendor.companyName, nameSize) > tw - seal) nameSize -= 4;
  const name = fit(bold, vendor.companyName, nameSize, tw - seal);
  parts.push(textPath(bold, name, tx, ay + 58, nameSize, "#fff"));
  if (vendor.verified) {
    const sx = tx + advance(bold, name, nameSize) + 14;
    parts.push(
      `<circle cx="${sx + 17}" cy="${ay + 40}" r="17" fill="#22c55e"/><path d="M${sx + 9} ${ay + 40}l6 6 11-12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
    );
  }

  // Pastilla blanca con el ícono y el nombre del rubro.
  let y = ay + 82;
  if (vendor.category) {
    const label = fit(semi, vendor.category, 22, tw - 70);
    const pw = advance(semi, label, 22) + 66;
    parts.push(`<rect x="${tx}" y="${y}" width="${pw.toFixed(1)}" height="42" rx="21" fill="#fff"/>`);
    parts.push(iconSvg(vendor.categoryIcon ?? "Store", tx + 16, y + 9, 24, { stroke: "#337475", strokeWidth: 2 }));
    parts.push(textPath(semi, label, tx + 50, y + 29, 22, "#0e1a28"));
    y += 42;
  }

  // Descripción en su bloque oscuro redondeado (dos líneas).
  if (vendor.description) {
    y += 20;
    const lines = wrap(semi, vendor.description, 21, tw - 40, 2);
    const bh = 28 + lines.length * 31;
    parts.push(`<rect x="${tx}" y="${y}" width="${tw}" height="${bh}" rx="22" fill="#000" fill-opacity="0.25"/>`);
    lines.forEach((l, i) => parts.push(textPath(semi, l, tx + 20, y + 38 + i * 31, 21, "#fff", 0.9)));
    y += bh;
  }

  // Redes encendidas: círculo negro al 50 % con el ícono en el color de cada red.
  const socials = SOCIAL.filter(([key]) => vendor.socialLinks?.[key]);
  if (socials.length) {
    y += 16;
    socials.forEach(([, icon, stroke], i) => {
      const cx = tx + 26 + i * 64;
      parts.push(`<circle cx="${cx}" cy="${y + 26}" r="26" fill="#000" fill-opacity="0.5"/>`);
      if (icon) parts.push(iconSvg(icon, cx - 13, y + 13, 26, { stroke, strokeWidth: 2 }));
      else parts.push(`<g transform="translate(${cx - 13} ${y + 13}) scale(1.0833)" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TIKTOK}</g>`);
    });
  }

  // Franja oscura de abajo: los datos de la tienda, igual que en su página. Lo que no cabe en una línea pasa a la siguiente
  // y la franja crece; se dibuja en coordenadas propias y después se baja a su lugar.
  const stats = [];
  const LINE = 40;
  let sx = PX;
  let sy = 48;
  const room = (w) => {
    if (sx + w > W - PX && sx > PX) {
      sx = PX;
      sy += LINE;
    }
  };
  const stat = (icon, text) => {
    const w = (icon ? 32 : 0) + advance(semi, text, 22);
    room(w);
    if (icon) stats.push(iconSvg(icon, sx, sy - 21, 24, { stroke: "#fff", opacity: 0.75, strokeWidth: 2 }));
    stats.push(textPath(semi, text, sx + (icon ? 32 : 0), sy, 22, "#fff", 0.92));
    sx += w + 30;
  };
  if (vendor.reviewCount > 0) {
    const filled = Math.round(Number(vendor.rating));
    const label = `${Number(vendor.rating).toFixed(1)} (${vendor.reviewCount} ${vendor.reviewCount === 1 ? "reseña" : "reseñas"})`;
    room(5 * 26 + 8 + advance(semi, label, 22));
    for (let i = 0; i < 5; i++) {
      stats.push(iconSvg("Star", sx + i * 26, sy - 21, 23, { stroke: "#fe9800", fill: i < filled ? "#fe9800" : "none", strokeWidth: 2 }));
    }
    sx += 5 * 26 + 8;
    stats.push(textPath(semi, label, sx, sy, 22, "#fff", 0.92));
    sx += advance(semi, label, 22) + 30;
  } else {
    stat(null, "Sin reseñas todavía");
  }
  stat("Package", `${vendor.productCount} ${vendor.productCount === 1 ? "producto" : "productos"}`);
  if (vendor.place) stat("MapPin", vendor.place);
  stat("CalendarDays", `Desde ${vendor.year}`);
  if (vendor.shippingText) stat("Truck", vendor.shippingText);

  // Métodos de pago como pastillas, en la línea siguiente (las que no caben se omiten, sin pisar la marca).
  let px = PX;
  const py = sy + 28;
  let hasPayments = false;
  for (const id of vendor.payments ?? []) {
    const label = PAYMENT_LABEL[id] ?? id;
    const w = advance(semi, label, 18) + 28;
    if (px + w > W - PX - 170) break;
    stats.push(`<rect x="${px.toFixed(1)}" y="${py}" width="${w.toFixed(1)}" height="34" rx="17" fill="#fff" fill-opacity="0.1"/>`);
    stats.push(textPath(semi, label, px + 14, py + 23, 18, "#fff", 0.9));
    px += w + 10;
    hasPayments = true;
  }
  const stripH = (hasPayments ? py + 34 : sy + 8) + 34;
  const stripY = H - stripH;
  stats.push(textPath(semi, "baznova.com", W - PX - advance(semi, "baznova.com", 20), stripH - 26, 20, "#fff", 0.6));

  const initial = (vendor.companyName[0] ?? "?").toUpperCase();
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<defs>`,
    `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${W * 0.25}" y1="0" x2="${W * 0.75}" y2="${H}">`,
    `<stop offset="0" stop-color="${color}"/><stop offset="0.55" stop-color="${color}" stop-opacity="0.87"/><stop offset="1" stop-color="#111827"/>`,
    `</linearGradient>`,
    `<linearGradient id="ig" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stop-color="#FEDA75"/><stop offset="30%" stop-color="#FA7E1E"/><stop offset="60%" stop-color="#D62976"/><stop offset="100%" stop-color="#4F5BD5"/></linearGradient>`,
    `</defs>`,
    `<rect width="${W}" height="${H}" fill="#111827"/>`,
    `<rect width="${W}" height="${H}" fill="url(#g)"/>`,
    iconPattern(vendor),
    `<rect y="${stripY}" width="${W}" height="${H - stripY}" fill="#000" fill-opacity="0.25"/>`,
    `<circle cx="${ax + avatar / 2}" cy="${ay + avatar / 2}" r="${avatar / 2 + 5}" fill="#fff"/>`,
    `<circle cx="${ax + avatar / 2}" cy="${ay + avatar / 2}" r="${avatar / 2}" fill="${color}"/>`,
    vendor.logoUrl ? "" : textPath(bold, initial, ax + avatar / 2 - advance(bold, initial, 76) / 2, ay + avatar / 2 + 27, 76, "#fff"),
    ...parts,
    `<g transform="translate(0 ${stripY})">${stats.join("")}</g>`,
    `</svg>`,
  ].join("");

  const logo = vendor.logoUrl ? await logoBuffer(vendor.logoUrl, avatar) : null;
  return sharp(Buffer.from(svg))
    .composite(logo ? [{ input: logo, left: ax, top: ay }] : [])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// Luminancia relativa (WCAG) de un color #rrggbb.
function luminance(hex) {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

// Foto del producto recortada en cuadrado con esquinas redondeadas. photoPath es una ruta del disco ya validada
// (productImageDiskPath); nunca una URL.
async function photoBuffer(photoPath, size, radius) {
  if (!photoPath) return null;
  try {
    const input = await fs.promises.readFile(photoPath);
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}"/></svg>`);
    return await sharp(input)
      .resize(size, size, { fit: "cover", background: "#ffffff" })
      .flatten({ background: "#ffffff" })
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

// Imagen de vista previa al compartir el enlace de un producto (1200x630, JPEG), pedido del dueño: la foto a la izquierda y, a
// la derecha, quién lo vende (logo, nombre, sello), el nombre del producto, el precio con su rebaja, la descripción y los
// datos que deciden la compra (valoración, disponibilidad, envío, ubicación). Fondo con el color y los íconos de la
// tienda, igual que su banner, para que se reconozca de quién es. Todo sale de la base; lo que falta no se dibuja.
// p: { name, description, priceText, oldPriceText, discount, inStock, rating, reviewCount, shippingText, place, category,
//      photoPath, siteHost, store: { id, companyName, color, logoPath, verified, isRestaurant, category, categorySlug } }
export async function renderProductOgImage(p) {
  const bold = font(800);
  const semi = font(600);
  const s = p.store;
  const color = /^#[0-9a-f]{6}$/i.test(s.color ?? "") ? s.color : "#232F3E";
  const PAD = 40;
  const S = H - PAD * 2;
  const R = 28;
  const x0 = PAD + S + 48;
  const tw = W - x0 - 56;
  const parts = [];

  // Quién lo vende: logo (o inicial), "Vendido por" y el nombre con el sello de verificada.
  const logo = 60;
  const ly = 46;
  const [photo, logoImg] = await Promise.all([photoBuffer(p.photoPath, S, R), s.logoPath ? logoBuffer(s.logoPath, logo) : null]);
  parts.push(`<circle cx="${x0 + logo / 2}" cy="${ly + logo / 2}" r="${logo / 2 + 3}" fill="#fff"/>`);
  parts.push(`<circle cx="${x0 + logo / 2}" cy="${ly + logo / 2}" r="${logo / 2}" fill="${color}"/>`);
  if (!logoImg) {
    const initial = (s.companyName[0] ?? "?").toUpperCase();
    parts.push(textPath(bold, initial, x0 + logo / 2 - advance(bold, initial, 30) / 2, ly + logo / 2 + 11, 30, "#fff"));
  }
  const nx = x0 + logo + 16;
  const seal = s.verified ? 34 : 0;
  parts.push(textPath(semi, "Vendido por", nx, ly + 22, 17, "#fff", 0.65));
  const storeName = fit(bold, s.companyName, 25, tw - logo - 16 - seal);
  parts.push(textPath(bold, storeName, nx, ly + 52, 25, "#fff"));
  if (s.verified) {
    const sx = nx + advance(bold, storeName, 25) + 10;
    parts.push(
      `<circle cx="${sx + 12}" cy="${ly + 43}" r="12" fill="#22c55e"/><path d="M${sx + 6.5} ${ly + 43}l4 4 7.5-8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
    );
  }

  // Datos de abajo como pastillas (las que no caben en dos filas se omiten). Se calculan primero para saber cuánto
  // espacio le queda a la descripción.
  const chips = [];
  if (p.reviewCount > 0) chips.push({ icon: "Star", star: true, text: `${Number(p.rating).toFixed(1)} (${p.reviewCount} ${p.reviewCount === 1 ? "reseña" : "reseñas"})` });
  // Agotado ya va como etiqueta sobre la foto.
  if (p.inStock) chips.push({ icon: "PackageCheck", text: "Disponible" });
  if (p.place) chips.push({ icon: "MapPin", text: p.place });
  if (p.shippingText) chips.push({ icon: "Truck", text: p.shippingText });
  if (p.category) chips.push({ icon: "Tag", text: p.category });
  const CH = 40;
  const GAP = 10;
  const rows = [[]];
  let rx = 0;
  for (const c of chips) {
    const label = fit(semi, c.text, 19, tw - 62);
    const w = 46 + advance(semi, label, 19) + 16;
    if (rx + w > tw && rows[rows.length - 1].length) {
      if (rows.length === 2) continue;
      rows.push([]);
      rx = 0;
    }
    rows[rows.length - 1].push({ ...c, label, x: rx, w });
    rx += w + GAP;
  }
  const footerY = H - PAD - 4;
  const chipsTop = footerY - 34 - rows.length * (CH + GAP) + GAP;
  rows.forEach((row, ri) => {
    const cy = chipsTop + ri * (CH + GAP);
    for (const c of row) {
      const cx = x0 + c.x;
      parts.push(`<rect x="${cx.toFixed(1)}" y="${cy}" width="${c.w.toFixed(1)}" height="${CH}" rx="${CH / 2}" fill="#fff" fill-opacity="0.13"/>`);
      parts.push(iconSvg(c.icon, cx + 14, cy + 9, 22, c.star ? { stroke: "#fe9800", fill: "#fe9800", strokeWidth: 2 } : { stroke: "#fff", opacity: 0.85, strokeWidth: 2 }));
      parts.push(textPath(semi, c.label, cx + 46, cy + 27, 19, "#fff", 0.95));
    }
  });
  parts.push(textPath(semi, p.siteHost, W - 56 - advance(semi, p.siteHost, 18), footerY, 18, "#fff", 0.55));

  // Nombre del producto: hasta 3 líneas. Se usa la letra más grande (de 50 a 38) con la que entra en menos líneas, así
  // no queda una palabra sola abajo ni se corta con "..." si achicando cabe entero.
  let nameSize = 50;
  let nameLines = wrap(bold, p.name, nameSize, tw, 3);
  const cut = (ls) => ls.some((l) => l.endsWith("..."));
  for (let size = 46; size >= 38; size -= 4) {
    const ls = wrap(bold, p.name, size, tw, 3);
    if (ls.length < nameLines.length || (cut(nameLines) && !cut(ls))) {
      nameSize = size;
      nameLines = ls;
    }
  }
  const nameLH = Math.round(nameSize * 1.14);
  let y = ly + logo + 40 + nameSize * 0.8;
  nameLines.forEach((l, i) => parts.push(textPath(bold, l, x0, y + i * nameLH, nameSize, "#fff")));
  y += (nameLines.length - 1) * nameLH;

  // Precio, y si tiene rebaja, el anterior tachado al lado.
  y += 68;
  parts.push(textPath(bold, p.priceText, x0, y, 48, "#fff"));
  if (p.oldPriceText) {
    const ox = x0 + advance(bold, p.priceText, 48) + 18;
    const ow = advance(semi, p.oldPriceText, 24);
    if (ox + ow <= x0 + tw) {
      parts.push(textPath(semi, p.oldPriceText, ox, y - 3, 24, "#fff", 0.6));
      parts.push(`<line x1="${ox}" y1="${y - 11}" x2="${(ox + ow).toFixed(1)}" y2="${y - 11}" stroke="#fff" stroke-opacity="0.6" stroke-width="2"/>`);
    }
  }

  // Descripción en el alto que queda, hasta 3 líneas.
  if (p.description) {
    const LH = 30;
    const first = y + 48;
    const lines = Math.min(3, Math.floor((chipsTop - 22 - first) / LH) + 1);
    if (lines > 0) wrap(semi, p.description, 21, tw, lines).forEach((l, i) => parts.push(textPath(semi, l, x0, first + i * LH, 21, "#fff", 0.82)));
  }

  // Fondo oscurecido: luminancia L·(1-a)^2.2. Con blanco a 4.5:1 hace falta L <= 0.183; se apunta a 0.15 por los íconos claros.
  const lum = luminance(color);
  const veil = Math.min(0.75, Math.max(0.22, 1 - Math.min(1, 0.15 / Math.max(lum, 0.001)) ** (1 / 2.2)));
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${W * 0.25}" y1="0" x2="${W * 0.75}" y2="${H}">`,
    `<stop offset="0" stop-color="${color}"/><stop offset="0.55" stop-color="${color}" stop-opacity="0.87"/><stop offset="1" stop-color="#111827"/>`,
    `</linearGradient></defs>`,
    `<rect width="${W}" height="${H}" fill="#111827"/>`,
    `<rect width="${W}" height="${H}" fill="url(#g)"/>`,
    iconPattern(s),
    // Velo oscuro detrás del texto: el texto es blanco y el color de la tienda puede ser claro. Se oscurece lo justo para
    // que el blanco contraste al menos 4.5:1 (AA) sobre la parte más clara del fondo, que es el color puro de arriba.
    `<rect x="${x0 - 24}" width="${W - x0 + 24}" height="${H}" fill="#000" fill-opacity="${veil.toFixed(2)}"/>`,
    `<rect x="${PAD - 4}" y="${PAD - 4}" width="${S + 8}" height="${S + 8}" rx="${R + 4}" fill="#fff" fill-opacity="0.9"/>`,
    photo ? "" : `<rect x="${PAD}" y="${PAD}" width="${S}" height="${S}" rx="${R}" fill="#e5e7eb"/>${iconSvg("ImageOff", PAD + S / 2 - 40, PAD + S / 2 - 64, 80, { stroke: "#6b7280", strokeWidth: 1.5 })}${textPath(semi, "Sin fotos todavía", PAD + S / 2 - advance(semi, "Sin fotos todavía", 24) / 2, PAD + S / 2 + 56, 24, "#4b5563")}`,
    ...parts,
    `</svg>`,
  ].join("");

  // Etiquetas sobre la foto (rebaja y agotado): van en otra capa porque la foto se pega encima del fondo.
  const badges = [];
  let bx = PAD + 20;
  if (p.discount > 0) {
    const t = `-${p.discount}%`;
    const w = advance(bold, t, 26) + 32;
    badges.push(`<rect x="${bx}" y="${PAD + 20}" width="${w.toFixed(1)}" height="46" rx="23" fill="#fe9800"/>`, textPath(bold, t, bx + 16, PAD + 53, 26, "#0e1a28"));
    bx += w + 10;
  }
  if (!p.inStock) {
    const t = "Agotado";
    const w = advance(bold, t, 22) + 32;
    badges.push(`<rect x="${bx.toFixed(1)}" y="${PAD + 20}" width="${w.toFixed(1)}" height="46" rx="23" fill="#0e1a28" fill-opacity="0.85"/>`, textPath(bold, t, bx + 16, PAD + 51, 22, "#fff"));
  }

  const layers = [];
  if (photo) layers.push({ input: photo, left: PAD, top: PAD });
  if (logoImg) layers.push({ input: logoImg, left: x0, top: ly });
  if (badges.length) layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${badges.join("")}</svg>`), left: 0, top: 0 });
  // JPEG y no PNG: con una foto adentro el PNG pasa de 400 KB, y WhatsApp deja de mostrar vistas previas mucho más pesadas
  // que unos 300 KB.
  return sharp(Buffer.from(svg)).composite(layers).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
}
