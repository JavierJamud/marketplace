import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { getBrandSettings } from "./settings.controller.js";

// Bloque 137 (pedido explícito — "cuando se comparte el enlace de una
// tienda, debe previsualizarse en ese link los datos e imágenes de ESA
// tienda, y no lo del sitio web en general"): el frontend es una SPA pura
// (Vite+React, sin SSR) servida como archivos estáticos — un bot de
// previsualización (WhatsApp, Facebook, Twitter/X, Telegram, Discord...)
// NUNCA ejecuta el JS de React, así que sin importar qué haga Store.jsx en
// un useEffect, esos bots solo ven el <head> ESTÁTICO de index.html, con
// los meta tags fijos del sitio entero — jamás los datos reales de la
// tienda compartida.
//
// Esta ruta arma un HTML mínimo aparte, con los meta tags REALES de la
// tienda pedida, pensado para que un bot lo lea (nunca ejecuta JS: le
// alcanza con leer el <head> una sola vez) — un visitante humano real que
// caiga acá se redirige de una al link real de la SPA (meta refresh + script
// de respaldo, doble red por si uno de los dos falla en algún navegador raro).
//
// OJO — pieza pendiente para producción: hoy el frontend (dist/) se sirve
// como estático puro desde OTRO host (Vercel/Netlify/nginx, todavía sin
// decidir — no hay vercel.json/netlify.toml en el repo), completamente
// aparte de este backend Express. Para que un link compartido de verdad
// dispare ESTA ruta en vez de servir directo el index.html estático, hace
// falta UNA regla de rewrite/proxy en la capa de hosting que elijan —
// ejemplo con Vercel (vercel.json): reescribir "/tienda/:slug" hacia
// "${BACKEND_URL}/og/tienda/:slug" (con o sin filtrar por user-agent de
// bot — server puede servir sin filtrar UA porque igual redirige a los
// humanos de una). Documentado también en ADDENDUM_ZEUDIN.md, Bloque 137.
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function absoluteUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${env.backendUrl}${path}`;
}

// env.frontendUrl puede traer varios orígenes separados por coma (mismo
// formato que ya usa app.js para CORS, ver allowedOrigins) — acá hace
// falta UN solo link real para el redirect/og:url, así que se toma el
// primero de la lista como el canónico.
const CANONICAL_FRONTEND_URL = env.frontendUrl.split(",")[0].trim();

export async function renderStoreOgPage(req, res) {
  const { slug } = req.params;
  const brand = await getBrandSettings();
  const realUrl = `${CANONICAL_FRONTEND_URL}/tienda/${encodeURIComponent(slug)}`;

  const vendor = await prisma.vendor.findUnique({
    where: { slug },
    select: {
      companyName: true,
      description: true,
      logoUrl: true,
      isBlocked: true,
      status: true,
      isPrivate: true,
    },
  });

  // Tienda no encontrada/bloqueada/privada: sin datos reales que mostrar,
  // se manda igual al link real (Store.jsx ya sabe mostrar su propio
  // "tienda no encontrada") — nunca un preview con datos inventados.
  if (!vendor || vendor.isBlocked || vendor.status !== "ACTIVE" || vendor.isPrivate) {
    return res.redirect(302, realUrl);
  }

  const title = `${vendor.companyName} — ${brand.siteName}`;
  const description = vendor.description?.trim() || `Mira los productos de ${vendor.companyName} en ${brand.siteName}.`;
  const image = absoluteUrl(vendor.logoUrl) || brand.logoUrl;

  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="es-CU">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:url" content="${escapeHtml(realUrl)}" />
${image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : ""}
<meta http-equiv="refresh" content="0;url=${escapeHtml(realUrl)}" />
<link rel="canonical" href="${escapeHtml(realUrl)}" />
</head>
<body>
<script>location.replace(${JSON.stringify(realUrl)});</script>
<p>Redirigiendo a <a href="${escapeHtml(realUrl)}">${escapeHtml(title)}</a>...</p>
</body>
</html>`);
}
