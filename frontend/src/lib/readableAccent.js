// Color de acento legible sobre un fondo oscuro: el color de la tienda si tiene contraste AA (4,5:1) con el fondo, y si no el
// naranja de la marca. Lo usan las pantallas de la caja, que se miran de lejos.
const FALLBACK = "#fe9800";

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function readableAccent(color, background = "#0e1a28") {
  const a = luminance(color);
  const b = luminance(background);
  if (a == null || b == null) return FALLBACK;
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return ratio >= 4.5 ? color : FALLBACK;
}
