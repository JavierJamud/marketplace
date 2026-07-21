// Bloque 23: preview correcto al compartir el link de una tienda/producto
// (WhatsApp, Facebook, etc.). Los crawlers de esas plataformas NO ejecutan
// JS — un <title>/meta seteado del lado del cliente (React) nunca llega a
// verse, así que esto tiene que estar resuelto en el HTML que devuelve el
// SERVIDOR antes de que React siquiera arranque. En dev, el servidor que
// sirve el HTML es Vite — este plugin usa su hook `transformIndexHtml` para
// inspeccionar la URL pedida, resolver los datos reales de la tienda o el
// producto contra el backend, e inyectar las meta tags ya resueltas.
//
// Nota: esto cubre el dev server (`npm run dev`). El día que exista un
// deploy de producción con build estático, la misma función `resolveMeta`
// de abajo es reutilizable tal cual desde un middleware Express que haga lo
// mismo contra el `dist/index.html` ya buildeado.

const DEFAULT_TITLE = "ZeuDin — Marketplace multivendedor de Cuba";
const DEFAULT_DESCRIPTION =
  "Comprá y vendé en toda Cuba: tiendas verificadas, productos y restaurantes con pedido directo por WhatsApp.";

const STORE_RE = /^\/tienda\/([^/?#]+)\/?$/;
const PRODUCT_RE = /^\/producto\/([^/?#]+)\/([^/?#]+)\/?$/;

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Recorta a un largo razonable para una descripción de link preview — una
// descripción de producto/tienda larga desborda la tarjeta en WhatsApp igual.
function truncate(str, max) {
  const clean = String(str ?? "").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function buildMetaHtml(meta) {
  return [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<meta property="og:type" content="${esc(meta.type)}" />`,
    `<meta property="og:site_name" content="ZeuDin" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:image" content="${esc(meta.image)}" />`,
    `<meta property="og:url" content="${esc(meta.url)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${esc(meta.image)}" />`,
  ].join("\n    ");
}

function absoluteImage(apiUrl, path) {
  if (!path) return null;
  return /^https?:\/\//i.test(path) ? path : `${apiUrl}${path}`;
}

// `env` = resultado de loadEnv() en vite.config.js — vite.config.js corre en
// Node puro, `process.env` NO trae lo que hay en .env/.env.development salvo
// que se cargue a mano con loadEnv (así es como React ya lee VITE_API_URL en
// runtime vía import.meta.env, pero acá estamos del lado del servidor de
// dev, no del bundle del cliente).
export function ogMetaPlugin(env = {}) {
  const apiUrl = env.VITE_API_URL ?? "http://localhost:4000";
  const siteUrl = env.FRONTEND_URL ?? "http://localhost:5173";
  const defaultImage = `${siteUrl}/og-placeholder.png`;

  async function resolveMeta(rawUrl) {
    const path = (rawUrl ?? "/").split("?")[0].split("#")[0];
    const fallback = { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, image: defaultImage, url: `${siteUrl}${path}`, type: "website" };

    const storeMatch = path.match(STORE_RE);
    if (storeMatch) {
      try {
        const res = await fetch(`${apiUrl}/vendors/${storeMatch[1]}`);
        if (res.ok) {
          const { vendor } = await res.json();
          return {
            title: `${vendor.companyName} — ZeuDin`,
            description: truncate(vendor.description, 200) || `Mirá los productos de ${vendor.companyName} en ZeuDin.`,
            // Bloque 23: Store.jsx todavía no tiene un banner-imagen real
            // (el header de la tienda es un color sólido + inicial, ver
            // Store.jsx) — coverUrl existe en el modelo para el día que lo
            // tenga. Hasta entonces cae al placeholder de marca.
            image: absoluteImage(apiUrl, vendor.coverUrl) ?? defaultImage,
            url: `${siteUrl}${path}`,
            type: "website",
          };
        }
      } catch {
        // Backend no disponible en este momento: se sirve el default más
        // abajo — nunca se rompe la carga de la página por esto.
      }
      return fallback;
    }

    const productMatch = path.match(PRODUCT_RE);
    if (productMatch) {
      try {
        const res = await fetch(`${apiUrl}/products/${productMatch[1]}/${productMatch[2]}`);
        if (res.ok) {
          const { product } = await res.json();
          return {
            title: `${product.name} — ZeuDin`,
            description: truncate(product.description, 200) || `${product.name}, disponible en ZeuDin.`,
            image: absoluteImage(apiUrl, product.images?.[0]) ?? defaultImage,
            url: `${siteUrl}${path}`,
            type: "product",
          };
        }
      } catch {
        // idem arriba
      }
      return fallback;
    }

    return fallback;
  }

  return {
    name: "zeudin-og-meta",
    transformIndexHtml: {
      order: "pre",
      handler: async (html, ctx) => {
        const meta = await resolveMeta(ctx.originalUrl ?? ctx.path);
        return html.replace("</head>", `    ${buildMetaHtml(meta)}\n  </head>`);
      },
    },
  };
}
