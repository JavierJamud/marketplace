import fs from "node:fs";
import { createRequire } from "node:module";
import sharp from "sharp";
import * as opentypeNs from "opentype.js";

// Imagen de vista previa (1200x630) que se ve al compartir el enlace de una tienda: es una referencia de su banner (el
// mismo degradado con el color de la tienda, formas suaves de fondo, logo o inicial, nombre, rubro, ubicación y sello de
// verificada). El texto se convierte a trazos con opentype.js a propósito: así no depende de las fuentes instaladas en el
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

function seeded(str) {
  let h = 1779033703 ^ String(str).length;
  for (let i = 0; i < String(str).length; i++) {
    h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Formas translúcidas repartidas por todo el fondo, siempre las mismas para la misma tienda.
function pattern(seed) {
  const rand = seeded(seed);
  const shapes = [];
  const cols = 10;
  const rows = 5;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * (W / cols) + (rand() - 0.5) * 50;
      const y = (r + 0.5) * (H / rows) + (rand() - 0.5) * 50;
      const s = 14 + rand() * 20;
      const rot = Math.floor(rand() * 360);
      const op = (0.1 + rand() * 0.1).toFixed(2);
      const kind = Math.floor(rand() * 3);
      const g = `transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) rotate(${rot})" fill="none" stroke="#fff" stroke-opacity="${op}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;
      if (kind === 0) shapes.push(`<circle r="${s.toFixed(0)}" ${g}/>`);
      else if (kind === 1) shapes.push(`<rect x="${(-s).toFixed(0)}" y="${(-s).toFixed(0)}" width="${(s * 2).toFixed(0)}" height="${(s * 2).toFixed(0)}" rx="8" ${g}/>`);
      else shapes.push(`<path d="M${(-s).toFixed(0)} 0H${s.toFixed(0)}M0 ${(-s).toFixed(0)}V${s.toFixed(0)}" ${g}/>`);
    }
  }
  return shapes.join("");
}

async function logoBuffer(logoUrl, size) {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const input = Buffer.from(await res.arrayBuffer());
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);
    return await sharp(input).resize(size, size, { fit: "cover" }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  } catch {
    return null;
  }
}

// vendor: { id, companyName, color, logoUrl (absoluta), category, place, verified }
export async function renderStoreOgImage(vendor) {
  const bold = font(800);
  const semi = font(600);
  const avatar = 220;
  const logo = vendor.logoUrl ? await logoBuffer(vendor.logoUrl, avatar) : null;
  const color = /^#[0-9a-f]{6}$/i.test(vendor.color ?? "") ? vendor.color : "#232F3E";
  const ax = 90;
  const ay = 150;
  const textX = ax + avatar + 56;
  const textW = W - textX - 80;

  const nameSize = 68;
  const lines = wrap(bold, vendor.companyName, nameSize, textW, 2);
  const blockH = lines.length * (nameSize + 10);
  const subY = ay + 20 + blockH + 40;
  const parts = [vendor.category, vendor.place].filter(Boolean).join("  ·  ");

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<defs>`,
    `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W * 0.55}" y2="${H}">`,
    `<stop offset="0" stop-color="${color}"/><stop offset="0.55" stop-color="${color}" stop-opacity="0.87"/><stop offset="1" stop-color="#111827"/>`,
    `</linearGradient>`,
    `<radialGradient id="r"><stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`,
    `</defs>`,
    `<rect width="${W}" height="${H}" fill="#111827"/>`,
    `<rect width="${W}" height="${H}" fill="url(#g)"/>`,
    pattern(vendor.id),
    `<circle cx="${W - 60}" cy="40" r="260" fill="url(#r)" fill-opacity="0.12"/>`,
    `<circle cx="60" cy="${H - 40}" r="180" fill="url(#r)" fill-opacity="0.08"/>`,
    `<rect y="${H - 110}" width="${W}" height="110" fill="#000" fill-opacity="0.28"/>`,
    // avatar
    `<circle cx="${ax + avatar / 2}" cy="${ay + avatar / 2}" r="${avatar / 2 + 4}" fill="#fff" fill-opacity="0.28"/>`,
    `<circle cx="${ax + avatar / 2}" cy="${ay + avatar / 2}" r="${avatar / 2}" fill="#fff" fill-opacity="0.14"/>`,
    logo ? "" : textPath(bold, (vendor.companyName[0] ?? "?").toUpperCase(), ax + avatar / 2 - advance(bold, (vendor.companyName[0] ?? "?").toUpperCase(), 110) / 2, ay + avatar / 2 + 38, 110, "#fff"),
    // nombre
    ...lines.map((l, i) => textPath(bold, l, textX, ay + 62 + i * (nameSize + 10), nameSize, "#fff")),
    parts ? textPath(semi, fit(semi, parts, 32, textW), textX, subY, 32, "#fff", 0.85) : "",
    // sello verificada
    vendor.verified
      ? `<g><rect x="${textX}" y="${subY + 34}" width="${advance(semi, "Tienda verificada", 26) + 64}" height="50" rx="25" fill="#fff" fill-opacity="0.18"/>` +
        `<circle cx="${textX + 27}" cy="${subY + 59}" r="13" fill="#22c55e"/><path d="M${textX + 20} ${subY + 59}l5 5 9-10" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>` +
        textPath(semi, "Tienda verificada", textX + 52, subY + 68, 26, "#fff") +
        `</g>`
      : "",
    // pie de marca
    `<rect x="90" y="${H - 72}" width="12" height="34" rx="3" fill="#fe9800"/>`,
    textPath(bold, "Baznova", 118, H - 44, 34, "#fff"),
    textPath(semi, "baznova.com", W - 90 - advance(semi, "baznova.com", 28), H - 44, 28, "#fff", 0.8),
    `</svg>`,
  ].join("");

  const layers = [];
  if (logo) layers.push({ input: logo, left: ax, top: ay });
  return sharp(Buffer.from(svg)).composite(layers).png({ compressionLevel: 9 }).toBuffer();
}
