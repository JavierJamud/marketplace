// Copia para el servidor los dibujos de íconos que usa la web (lucide-react de este frontend) y los temas del fondo de
// la cabecera de la tienda (src/lib/vendorBannerIcons.js). Con esto, la imagen de vista previa al compartir una tienda
// (backend lib/ogImage.js) dibuja exactamente los mismos íconos que su banner. El servidor tiene otra versión de la
// librería, sin los logos de redes. Volver a correrlo si cambian los temas: node scripts/export-og-icons.mjs
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Lucide from "lucide-react";
import { THEMES, CATEGORY_THEME, KEYWORD_THEME } from "../src/lib/vendorBannerIcons.js";

const icons = {};
for (const [name, Icon] of Object.entries(Lucide)) {
  if (!/^[A-Z]/.test(name) || name.endsWith("Icon") || name.startsWith("Lucide") || typeof Icon !== "object") continue;
  try {
    const svg = renderToStaticMarkup(createElement(Icon));
    icons[name] = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  } catch {
    // no es un ícono
  }
}
const themes = Object.fromEntries(Object.entries(THEMES).map(([k, list]) => [k, list.map((I) => I.displayName)]));
const out = {
  icons,
  themes,
  categoryTheme: CATEGORY_THEME,
  keywordTheme: KEYWORD_THEME.map(([re, theme]) => [re.source, theme]),
};
fs.writeFileSync(new URL("../../backend/src/assets/og-icons.json", import.meta.url), JSON.stringify(out));
console.log(`${Object.keys(icons).length} íconos, ${Object.keys(themes).length} temas`);
