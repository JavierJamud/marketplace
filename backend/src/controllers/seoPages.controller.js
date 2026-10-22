import { prisma } from "../lib/prisma.js";
import { resolveVendorSlug } from "../lib/vendorSlug.js";
import { env } from "../config/env.js";
import { getBrandSettings } from "./settings.controller.js";

// SEO del servidor. Dos piezas:
//  1) /sitemap.xml: lista de todo lo público para que Google lo descubra (páginas fijas, tiendas y productos visibles).
//  2) Páginas de tienda y de producto para los rastreadores (Google, Bing, WhatsApp, Facebook...). Nginx las entrega a
//     esos bots en lugar de la aplicación de React: llevan título, descripción, imagen, datos estructurados (JSON-LD) y el
//     texto y los enlaces principales de la página, para que se indexe todo sin depender de ejecutar JavaScript.
//     Las personas nunca reciben esta página (Nginx solo se la manda a los bots); si alguien entra directo a /api/og/...,
//     se le lleva a la página real.

const ORIGIN = env.frontendUrl.replace(/\/$/, "");
const SITE_IMAGE = `${ORIGIN}/og-baznova-3.png`;

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

const abs = (path) => (!path ? null : /^https?:\/\//i.test(path) ? path : `${env.backendUrl}${path}`);

// Un producto o tienda solo se publica si la tienda está activa, no bloqueada y no es privada.
const publicVendorWhere = { isBlocked: false, status: "ACTIVE", isPrivate: false };
const visibleProductWhere = { isActive: true, hiddenFromStore: false, overQuota: false };

// ---------------------------------------------------------------- sitemap

const STATIC_PAGES = [
  ["/", 1.0, "daily"],
  ["/tiendas", 0.9, "daily"],
  ["/catalogo", 0.9, "daily"],
  ["/ventas-rapidas", 0.6, "daily"],
  ["/faq", 0.7, "weekly"],
  ["/ayuda", 0.6, "monthly"],
  ["/contacto", 0.5, "monthly"],
  ["/api-socios", 0.5, "monthly"],
  ["/socios/solicitar", 0.4, "monthly"],
  ["/terminos", 0.3, "yearly"],
  ["/privacidad", 0.3, "yearly"],
];

const SITEMAP_TTL_MS = 10 * 60 * 1000;
let sitemapCache = { xml: null, expires: 0 };

export async function sitemapXml(_req, res) {
  if (!sitemapCache.xml || sitemapCache.expires < Date.now()) {
    const [vendors, products] = await Promise.all([
      prisma.vendor.findMany({
        where: { ...publicVendorWhere, products: { some: visibleProductWhere } },
        select: { slug: true },
        take: 20000,
      }),
      prisma.product.findMany({
        where: { ...visibleProductWhere, vendor: publicVendorWhere },
        select: { slug: true, createdAt: true, vendor: { select: { slug: true } } },
        orderBy: { createdAt: "desc" },
        take: 30000,
      }),
    ]);

    const url = (loc, priority, changefreq, lastmod) =>
      `  <url><loc>${esc(`${ORIGIN}${loc}`)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}<changefreq>${changefreq}</changefreq><priority>${priority.toFixed(1)}</priority></url>`;

    const lines = [
      ...STATIC_PAGES.map(([p, pr, cf]) => url(p, pr, cf)),
      ...vendors.map((v) => url(`/tienda/${encodeURIComponent(v.slug)}`, 0.8, "weekly")),
      ...products.map((p) => url(`/producto/${encodeURIComponent(p.vendor.slug)}/${encodeURIComponent(p.slug)}`, 0.7, "weekly", p.createdAt)),
    ];
    sitemapCache = {
      xml: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join("\n")}\n</urlset>\n`,
      expires: Date.now() + SITEMAP_TTL_MS,
    };
  }
  res.set({ "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=600" });
  res.send(sitemapCache.xml);
}

// ---------------------------------------------------------------- páginas para rastreadores

function shell({ title, description, canonical, image, ogType, keywords, jsonLd, body, siteName }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
${keywords?.length ? `<meta name="keywords" content="${esc(keywords.join(", "))}" />` : ""}
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
<link rel="canonical" href="${esc(canonical)}" />
<meta property="og:type" content="${ogType}" />
<meta property="og:site_name" content="${esc(siteName)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:image" content="${esc(image)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(image)}" />
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>
</head>
<body>
<header><a href="${esc(ORIGIN)}/">${esc(siteName)}</a> · <a href="${esc(ORIGIN)}/tiendas">Tiendas</a> · <a href="${esc(ORIGIN)}/catalogo">Catálogo</a></header>
<main>
${body}
</main>
<script>if (/^\\/(api\\/)?og\\//.test(location.pathname)) location.replace(${JSON.stringify(canonical)});</script>
</body>
</html>`;
}

function notFound(res, siteName) {
  res
    .status(404)
    .set({ "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" })
    .send(`<!doctype html><html lang="es"><head><meta charset="UTF-8" /><title>No encontrado | ${esc(siteName)}</title><meta name="robots" content="noindex" /></head><body><h1>No encontrado</h1><p><a href="${esc(ORIGIN)}/">Ir a ${esc(siteName)}</a></p></body></html>`);
}

const money = (n, cur) => `${Number(n).toLocaleString("es-CU")} ${cur}`;

export async function renderStorePage(req, res) {
  // Enlace anterior de la tienda: redirección permanente al actual (es otra dirección, no hay bucle).
  const slug = await resolveVendorSlug(req.params.slug);
  if (slug !== req.params.slug) return res.redirect(301, `${ORIGIN}/tienda/${encodeURIComponent(slug)}`);
  const brand = await getBrandSettings();
  const siteName = brand.siteName || "Baznova";
  const canonical = `${ORIGIN}/tienda/${encodeURIComponent(slug)}`;

  const vendor = await prisma.vendor.findUnique({
    where: { slug },
    select: {
      id: true,
      companyName: true,
      description: true,
      logoUrl: true,
      isRestaurant: true,
      isBlocked: true,
      status: true,
      isPrivate: true,
      businessCategory: { select: { name: true } },
      locations: { take: 1, select: { stateOther: true, province: { select: { name: true } }, municipality: { select: { name: true } } } },
      products: { where: visibleProductWhere, take: 24, orderBy: { createdAt: "desc" }, select: { name: true, slug: true, price: true, currency: true } },
    },
  });
  // Sin datos reales que mostrar: 404 de verdad (Google deja de listar la dirección). Nunca una redirección a la misma URL,
  // que Nginx volvería a entregar al bot en bucle.
  if (!vendor || vendor.isBlocked || vendor.status !== "ACTIVE" || vendor.isPrivate) return notFound(res, siteName);

  const loc = vendor.locations[0];
  const province = loc?.province?.name ?? loc?.stateOther ?? null;
  const place = loc?.municipality?.name ?? province;
  const category = vendor.businessCategory?.name ?? (vendor.isRestaurant ? "Restaurante" : "Tienda");
  const agg = await prisma.review.aggregate({ where: { vendorId: vendor.id, rating: { not: null }, isHidden: false }, _avg: { rating: true }, _count: { rating: true } });

  const title = `${vendor.companyName}${place ? ` en ${place}` : ""} | ${siteName}`;
  const description =
    clip(vendor.description, 200) ||
    `${vendor.companyName}${place ? ` en ${place}, Cuba` : " en Cuba"}: ${category.toLowerCase()} en ${siteName}. Mira sus productos y precios y haz tu pedido por WhatsApp o pago contra entrega.`;
  const image = `${env.backendUrl}/og/tienda/${encodeURIComponent(slug)}/imagen.png`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": vendor.isRestaurant ? "Restaurant" : "Store",
    name: vendor.companyName,
    url: canonical,
    image,
    description,
    address: { "@type": "PostalAddress", ...(place ? { addressLocality: place } : {}), ...(province ? { addressRegion: province } : {}), addressCountry: "CU" },
    ...(agg._count.rating > 0 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Math.round(agg._avg.rating * 10) / 10, reviewCount: agg._count.rating } } : {}),
  };

  const items = vendor.products
    .map((p) => `<li><a href="${esc(`${ORIGIN}/producto/${encodeURIComponent(slug)}/${encodeURIComponent(p.slug)}`)}">${esc(p.name)}</a> · ${esc(money(p.price, p.currency))}</li>`)
    .join("\n");
  const body = `<h1>${esc(vendor.companyName)}</h1>
<p>${esc(category)}${place ? ` en ${esc(place)}, Cuba` : ""}</p>
<p>${esc(description)}</p>
${items ? `<h2>Productos de ${esc(vendor.companyName)}</h2>\n<ul>\n${items}\n</ul>` : ""}`;

  res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" });
  res.send(
    shell({
      title,
      description,
      canonical,
      image,
      ogType: "website",
      siteName,
      body,
      jsonLd,
      keywords: [vendor.companyName, category, place && `${category} en ${place}`, "tienda en Cuba", "comprar en Cuba", "pago contra entrega"].filter(Boolean),
    })
  );
}

export async function renderProductPage(req, res) {
  const { productSlug } = req.params;
  const vendorSlug = await resolveVendorSlug(req.params.vendorSlug);
  if (vendorSlug !== req.params.vendorSlug) return res.redirect(301, `${ORIGIN}/producto/${encodeURIComponent(vendorSlug)}/${encodeURIComponent(productSlug)}`);
  const brand = await getBrandSettings();
  const siteName = brand.siteName || "Baznova";
  const canonical = `${ORIGIN}/producto/${encodeURIComponent(vendorSlug)}/${encodeURIComponent(productSlug)}`;

  const product = await prisma.product.findFirst({
    where: { slug: productSlug, ...visibleProductWhere, vendor: { slug: vendorSlug, ...publicVendorWhere } },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      currency: true,
      images: true,
      stock: true,
      unlimitedStock: true,
      sizeStock: true,
      category: { select: { name: true } },
      vendor: { select: { companyName: true, locations: { take: 1, select: { stateOther: true, province: { select: { name: true } }, municipality: { select: { name: true } } } } } },
    },
  });
  if (!product) return notFound(res, siteName);

  const loc = product.vendor.locations[0];
  const place = loc?.municipality?.name ?? loc?.province?.name ?? loc?.stateOther ?? null;
  const agg = await prisma.review.aggregate({ where: { productId: product.id, rating: { not: null }, isHidden: false }, _avg: { rating: true }, _count: { rating: true } });
  const images = (product.images ?? []).map(abs).filter(Boolean);
  const sizeStockTotal = product.sizeStock && typeof product.sizeStock === "object" ? Object.values(product.sizeStock).reduce((a, v) => a + Number(v || 0), 0) : 0;
  const inStock = product.unlimitedStock || product.stock > 0 || sizeStockTotal > 0;

  const title = `${product.name} | ${product.vendor.companyName} | ${siteName}`;
  const description =
    clip(product.description, 200) ||
    `${product.name} en ${product.vendor.companyName}${place ? `, ${place}` : ""}. Precio, fotos y disponibilidad. Pídelo con pago contra entrega o por WhatsApp en ${siteName}.`;
  const image = images[0] ?? SITE_IMAGE;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description,
    ...(images.length ? { image: images } : {}),
    ...(product.category?.name ? { category: product.category.name } : {}),
    brand: { "@type": "Brand", name: product.vendor.companyName },
    offers: {
      "@type": "Offer",
      url: canonical,
      price: Number(product.price),
      priceCurrency: product.currency,
      availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: product.vendor.companyName },
    },
    ...(agg._count.rating > 0 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Math.round(agg._avg.rating * 10) / 10, reviewCount: agg._count.rating } } : {}),
  };

  const body = `<h1>${esc(product.name)}</h1>
<p>${esc(money(product.price, product.currency))} · ${inStock ? "Disponible" : "Agotado"}</p>
<p>${esc(description)}</p>
<p>Vendido por <a href="${esc(`${ORIGIN}/tienda/${encodeURIComponent(vendorSlug)}`)}">${esc(product.vendor.companyName)}</a>${place ? ` en ${esc(place)}, Cuba` : ""}.</p>
${images.map((i) => `<img src="${esc(i)}" alt="${esc(product.name)}" width="400" />`).join("\n")}`;

  res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" });
  res.send(
    shell({
      title,
      description,
      canonical,
      image,
      ogType: "product",
      siteName,
      body,
      jsonLd,
      keywords: [product.name, product.category?.name, product.vendor.companyName, place && `comprar en ${place}`, "comprar en Cuba", "pago contra entrega"].filter(Boolean),
    })
  );
}

// Precarga de la primera imagen del encabezado. Nginx la inserta en el HTML de la portada (SSI, ver index.html) para que
// el navegador empiece a bajarla desde el primer momento, sin esperar a la aplicación ni a /settings.
export async function heroPreload(_req, res) {
  const settings = await prisma.siteSettings.findFirst({ select: { heroImages: true } });
  const first = settings?.heroImages?.[0];
  res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  if (!first) return res.send("");
  const full = `${env.backendUrl}${first}`;
  const small = full.replace(/\.(webp|png|jpe?g)$/i, ".w720.webp");
  res.send(`<link rel="preload" as="image" href="${esc(full)}" imagesrcset="${esc(small)} 720w, ${esc(full)} 1200w" imagesizes="(min-width: 1024px) 600px, 92vw" fetchpriority="high" />`);
}
