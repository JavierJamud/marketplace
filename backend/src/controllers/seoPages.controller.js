import { currencyLabel } from "../lib/catalog.js";
import crypto from "node:crypto";
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
  ["/rastrear-pedido", 0.4, "monthly"],
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

const money = (n, cur) => `${Number(n).toLocaleString("es-CU")} ${currencyLabel(cur)}`;

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
      // Lo que se dibuja en la imagen de vista previa: sirve para su versión (ver `image` más abajo).
      color: true,
      verificationStatus: true,
      socialLinks: true,
      rating: true,
      reviewCount: true,
      acceptedPaymentMethods: true,
      storeShippingMode: true,
      storeShippingLocal: true,
      storeShippingOther: true,
      storeShippingCurrency: true,
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
  // `v`: cambia cuando cambia algo de lo que se ve en la imagen, para que WhatsApp y Facebook (que guardan la vista previa
  // mucho tiempo) pidan la nueva. Se calcula con esos mismos datos (la tienda no guarda una fecha de última edición).
  const visible = [vendor.companyName, vendor.description, vendor.logoUrl, vendor.color, vendor.verificationStatus, vendor.businessCategory?.name, JSON.stringify(vendor.socialLinks), String(vendor.rating), vendor.reviewCount, (vendor.acceptedPaymentMethods ?? []).join(","), vendor.storeShippingMode, String(vendor.storeShippingLocal), String(vendor.storeShippingOther), vendor.storeShippingCurrency, vendor.products.length];
  const version = crypto.createHash("sha1").update(visible.join("|")).digest("hex").slice(0, 10);
  const image = `${env.backendUrl}/og/tienda/${encodeURIComponent(slug)}/imagen.png?v=${version}`;

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
      oldPrice: true,
      currency: true,
      images: true,
      stock: true,
      unlimitedStock: true,
      sizeStock: true,
      // Lo que se dibuja en la imagen de vista previa: sirve para su versión (ver `image` más abajo).
      rating: true,
      reviewCount: true,
      shippingMode: true,
      shippingLocal: true,
      shippingOther: true,
      shippingCurrency: true,
      category: { select: { name: true } },
      vendor: { select: { companyName: true, color: true, logoUrl: true, verificationStatus: true, storeShippingMode: true, storeShippingLocal: true, storeShippingOther: true, storeShippingCurrency: true, locations: { take: 1, select: { stateOther: true, province: { select: { name: true } }, municipality: { select: { name: true } } } } } },
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
  // Al compartir, WhatsApp muestra el título y esta línea debajo: precio y disponibilidad primero, luego la descripción.
  const priceLine = `${money(product.price, product.currency)}${inStock ? "" : " · Agotado"}`;
  const description = `${priceLine}. ${
    clip(product.description, 170) ||
    `${product.name} en ${product.vendor.companyName}${place ? `, ${place}` : ""}. Pídelo con pago contra entrega o por WhatsApp en ${siteName}.`
  }`;
  // Imagen diseñada del producto (og.controller.js). `v` cambia cuando cambia algo de lo que se dibuja, para que WhatsApp y
  // Facebook pidan la nueva en vez de la que guardaron.
  const p = product;
  const visible = [p.name, p.description, String(p.price), String(p.oldPrice), p.currency, p.images?.[0], inStock, String(p.rating), p.reviewCount, p.shippingMode, String(p.shippingLocal), String(p.shippingOther), p.shippingCurrency, p.category?.name, p.vendor.companyName, p.vendor.color, p.vendor.logoUrl, p.vendor.verificationStatus, p.vendor.storeShippingMode, String(p.vendor.storeShippingLocal), String(p.vendor.storeShippingOther), p.vendor.storeShippingCurrency, place];
  const version = crypto.createHash("sha1").update(visible.join("|")).digest("hex").slice(0, 10);
  const image = `${env.backendUrl}/og/producto/${encodeURIComponent(vendorSlug)}/${encodeURIComponent(productSlug)}/imagen.jpg?v=${version}`;

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

// ---------------------------------------------------------------- contenido de la portada

// Texto real de la portada dentro del HTML inicial. Nginx lo inserta (SSI, ver index.html) dentro de <div id="root">, así
// Google, su resumen con IA y los asistentes que no ejecutan JavaScript leen qué es Baznova, qué tiendas y productos hay y
// cómo se compra, en vez de una página casi vacía. React lo reemplaza al montar; mientras tanto lo tapa el preloader.
// Todo sale de la base: cifras, tiendas, productos y preguntas frecuentes. Nada inventado.
const SEO_HOME_TTL_MS = 10 * 60 * 1000;
let seoHomeCache = { html: null, expires: 0 };

// Las respuestas de la FAQ pueden traer HTML: aquí van como texto plano (luego se escapan).
const plainText = (html) =>
  String(html ?? "")
    .replace(/<\/?(p|br|li|ul|ol|div|h[1-6])\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/ ([,.;:!?])/g, "$1")
    .trim();

const plural = (n, one, many) => `${n.toLocaleString("es-CU")} ${n === 1 ? one : many}`;

async function buildSeoHome() {
  const brand = await getBrandSettings();
  const siteName = brand.siteName || "Baznova";
  const listedVendorWhere = { ...publicVendorWhere, products: { some: visibleProductWhere } };

  const [storeCount, productCount, restaurantCount, vendors, products, categories, provinceRows, faqs, settings] = await Promise.all([
    prisma.vendor.count({ where: listedVendorWhere }),
    prisma.product.count({ where: { ...visibleProductWhere, vendor: publicVendorWhere } }),
    prisma.vendor.count({ where: { ...listedVendorWhere, isRestaurant: true } }),
    prisma.vendor.findMany({
      where: listedVendorWhere,
      orderBy: [{ salesCount: "desc" }, { reviewCount: "desc" }, { createdAt: "asc" }],
      take: 12,
      select: {
        slug: true,
        companyName: true,
        isRestaurant: true,
        verificationStatus: true,
        businessCategory: { select: { name: true } },
        locations: { take: 1, select: { stateOther: true, province: { select: { name: true } }, municipality: { select: { name: true } } } },
      },
    }),
    prisma.product.findMany({
      where: { ...visibleProductWhere, vendor: publicVendorWhere },
      orderBy: [{ salesCount: "desc" }, { createdAt: "desc" }],
      take: 12,
      select: { name: true, slug: true, price: true, currency: true, vendor: { select: { slug: true, companyName: true } } },
    }),
    prisma.businessCategory.findMany({
      where: { active: true, vendors: { some: listedVendorWhere } },
      orderBy: { sortOrder: "asc" },
      select: { name: true },
    }),
    prisma.province.findMany({
      where: { vendorLocations: { some: { vendor: listedVendorWhere } } },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
    prisma.faqItem.findMany({ where: { audience: "CUSTOMER" }, orderBy: { createdAt: "asc" }, take: 6, select: { question: true, answer: true } }),
    prisma.siteSettings.findFirst({ select: { facebookUrl: true, instagramUrl: true } }),
  ]);

  const provinces = provinceRows.map((p) => p.name);
  const placeOf = (v) => {
    const loc = v.locations[0];
    return loc?.municipality?.name ?? loc?.province?.name ?? loc?.stateOther ?? null;
  };

  // Resumen con cifras reales. Si todavía no hay datos de algo, esa parte no se dice.
  const facts = [
    storeCount > 0 && plural(storeCount, "tienda activa", "tiendas activas"),
    restaurantCount > 0 && plural(restaurantCount, "restaurante", "restaurantes"),
    productCount > 0 && plural(productCount, "producto publicado", "productos publicados"),
    provinces.length > 0 && `negocios en ${plural(provinces.length, "provincia", "provincias")}`,
  ].filter(Boolean);

  const faqItems = faqs.map((f) => ({ q: plainText(f.question), a: clip(plainText(f.answer), 400) })).filter((f) => f.q && f.a);

  const storeLinks = vendors
    .map((v) => {
      const kind = v.businessCategory?.name ?? (v.isRestaurant ? "Restaurante" : "Tienda");
      const place = placeOf(v);
      const verified = v.verificationStatus === "VERIFIED" ? ", verificada" : "";
      return `<li><a href="${esc(`${ORIGIN}/tienda/${encodeURIComponent(v.slug)}`)}">${esc(v.companyName)}</a> · ${esc(kind)}${place ? ` en ${esc(place)}` : ""}${verified}</li>`;
    })
    .join("\n");
  const productLinks = products
    .map((p) => `<li><a href="${esc(`${ORIGIN}/producto/${encodeURIComponent(p.vendor.slug)}/${encodeURIComponent(p.slug)}`)}">${esc(p.name)}</a> · ${esc(money(p.price, p.currency))} en ${esc(p.vendor.companyName)}</li>`)
    .join("\n");

  const sameAs = [settings?.facebookUrl, settings?.instagramUrl].filter((u) => typeof u === "string" && /^https:\/\//i.test(u));
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${ORIGIN}/#organization`,
        name: siteName,
        url: `${ORIGIN}/`,
        ...(sameAs.length ? { sameAs } : {}),
      },
      ...(vendors.length
        ? [
            {
              "@type": "ItemList",
              name: `Tiendas y restaurantes en ${siteName}`,
              itemListElement: vendors.map((v, i) => ({ "@type": "ListItem", position: i + 1, url: `${ORIGIN}/tienda/${encodeURIComponent(v.slug)}`, name: v.companyName })),
            },
          ]
        : []),
      ...(faqItems.length
        ? [{ "@type": "FAQPage", mainEntity: faqItems.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }]
        : []),
    ],
  };

  const name = esc(siteName);
  return `<div id="seo-portada">
<style>#seo-portada{max-width:960px;margin:0 auto;padding:24px 16px;background:#0e1a28;color:#f4f6f8;font:16px/1.6 Inter,system-ui,sans-serif}#seo-portada a{color:#fe9800}#seo-portada h1{font-size:28px;line-height:1.25;margin:0 0 12px}#seo-portada h2{font-size:20px;margin:28px 0 8px}#seo-portada li{margin:4px 0}</style>
<h1>${name}: marketplace de tiendas y restaurantes en Cuba</h1>
<p>${name} reúne tiendas locales y restaurantes de Cuba en un solo sitio. Busca productos, comida y servicios cerca de ti, haz tu pedido a la tienda y coordina con ella el pago y la entrega: efectivo, pago contra entrega, transferencia o por WhatsApp.</p>
${facts.length ? `<p>Hoy en ${name}: ${esc(facts.join(", "))}.</p>` : ""}
${provinces.length ? `<p>Provincias con tiendas: ${esc(provinces.join(", "))}.</p>` : ""}
${categories.length ? `<h2>Tipos de negocio</h2>\n<p>${esc(categories.map((c) => c.name).join(", "))}.</p>` : ""}
${storeLinks ? `<h2>Tiendas y restaurantes en ${name}</h2>\n<ul>\n${storeLinks}\n</ul>\n<p><a href="${esc(ORIGIN)}/tiendas">Ver todas las tiendas</a></p>` : ""}
${productLinks ? `<h2>Productos más pedidos</h2>\n<ul>\n${productLinks}\n</ul>\n<p><a href="${esc(ORIGIN)}/catalogo">Ver el catálogo completo</a></p>` : ""}
<h2>Cómo comprar en ${name}</h2>
<ol>
<li>Busca en el catálogo o entra a una tienda de tu provincia.</li>
<li>Agrega lo que quieres al carrito. Cada pedido va a una sola tienda.</li>
<li>Envía el pedido y acuerda con la tienda el pago y la entrega, también por WhatsApp.</li>
<li>Sigue el estado de tu pedido en <a href="${esc(ORIGIN)}/rastrear-pedido">Rastrear pedido</a>.</li>
</ol>
<h2>Vende en ${name}</h2>
<p>Abre tu tienda gratis, publica tu catálogo con fotos y precios y recibe los pedidos en tu panel. Los restaurantes pueden usar un menú con código QR para pedir desde la mesa. <a href="${esc(ORIGIN)}/vendedor/ingresar?tab=registro">Registrar mi negocio</a>.</p>
${faqItems.length ? `<h2>Preguntas frecuentes</h2>\n${faqItems.map((f) => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`).join("\n")}\n<p><a href="${esc(ORIGIN)}/faq">Más preguntas frecuentes</a></p>` : ""}
<p><a href="${esc(ORIGIN)}/ayuda">Centro de ayuda</a> · <a href="${esc(ORIGIN)}/contacto">Contacto</a> · <a href="${esc(ORIGIN)}/terminos">Términos</a> · <a href="${esc(ORIGIN)}/privacidad">Privacidad</a></p>
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>
</div>`;
}

export async function seoHome(_req, res) {
  if (!seoHomeCache.html || seoHomeCache.expires < Date.now()) {
    seoHomeCache = { html: await buildSeoHome(), expires: Date.now() + SEO_HOME_TTL_MS };
  }
  res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.send(seoHomeCache.html);
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
