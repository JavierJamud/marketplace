import { api } from "./api.js";
import { SITE_ORIGIN, DEFAULT_OG_IMAGE, seoClip } from "./seo.js";

// Arma el SEO de una tienda y de un producto con sus datos reales: título con el nombre y el lugar, descripción, palabras
// clave y datos estructurados (JSON-LD) para que Google muestre precio, disponibilidad y valoración.

function absolute(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = String(api.defaults.baseURL ?? "");
  return `${/^https?:\/\//i.test(base) ? base : `${SITE_ORIGIN}${base}`}${path}`;
}

function placeOf(vendor) {
  const loc = vendor?.locations?.[0];
  return loc?.municipality?.name ?? loc?.province?.name ?? loc?.stateOther ?? null;
}

export function storeSeo(vendor, siteName) {
  if (!vendor) return null;
  const n = siteName || "Baznova";
  const place = placeOf(vendor);
  const province = vendor.locations?.[0]?.province?.name ?? vendor.locations?.[0]?.stateOther ?? null;
  const category = vendor.businessCategory?.name ?? (vendor.isRestaurant ? "Restaurante" : "Tienda");
  const path = `/tienda/${vendor.slug}`;
  const image = absolute(vendor.logoUrl) ?? DEFAULT_OG_IMAGE;
  const description =
    seoClip(vendor.description, 200) ||
    `${vendor.companyName}${place ? ` en ${place}, Cuba` : " en Cuba"}: ${category.toLowerCase()} en ${n}. Mira sus productos y precios y haz tu pedido por WhatsApp o pago contra entrega.`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": vendor.isRestaurant ? "Restaurant" : "Store",
    name: vendor.companyName,
    url: `${SITE_ORIGIN}${path}`,
    image,
    description,
    address: { "@type": "PostalAddress", ...(place ? { addressLocality: place } : {}), ...(province ? { addressRegion: province } : {}), addressCountry: "CU" },
    ...(vendor.reviewStats?.total > 0 && vendor.rating ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Number(vendor.rating), reviewCount: vendor.reviewStats.total } } : {}),
  };

  return {
    title: `${vendor.companyName}${place ? ` en ${place}` : ""} | ${n}`,
    description,
    path,
    image,
    type: "website",
    keywords: [vendor.companyName, category, place && `${category} en ${place}`, "tienda en Cuba", "comprar en Cuba", "pago contra entrega", "pedido por WhatsApp"].filter(Boolean),
    jsonLd,
  };
}

export function productSeo(product, siteName) {
  if (!product) return null;
  const n = siteName || "Baznova";
  const vendor = product.vendor;
  const place = placeOf(vendor);
  const path = `/producto/${vendor?.slug}/${product.slug}`;
  const images = (product.images ?? []).map(absolute).filter(Boolean);
  const inStock = product.unlimitedStock || Number(product.stock) > 0 || Object.values(product.sizeStock ?? {}).some((v) => Number(v) > 0);
  const description =
    seoClip(product.description, 200) ||
    `${product.name} en ${vendor?.companyName ?? n}${place ? `, ${place}` : ""}. Precio, fotos y disponibilidad. Pídelo con pago contra entrega o por WhatsApp en ${n}.`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description,
    ...(images.length ? { image: images } : {}),
    ...(product.category?.name ? { category: product.category.name } : {}),
    brand: vendor?.companyName ? { "@type": "Brand", name: vendor.companyName } : undefined,
    offers: {
      "@type": "Offer",
      url: `${SITE_ORIGIN}${path}`,
      price: Number(product.price),
      priceCurrency: product.currency || "CUP",
      availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: vendor?.companyName ? { "@type": "Organization", name: vendor.companyName } : undefined,
    },
    ...(product.reviewCount > 0 && product.rating ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Number(product.rating), reviewCount: product.reviewCount } } : {}),
  };

  return {
    title: `${product.name}${vendor?.companyName ? ` | ${vendor.companyName}` : ""} | ${n}`,
    description,
    path,
    image: images[0] ?? DEFAULT_OG_IMAGE,
    type: "product",
    keywords: [product.name, product.category?.name, vendor?.companyName, place && `comprar en ${place}`, "comprar en Cuba", "pago contra entrega"].filter(Boolean),
    jsonLd,
  };
}

// Preguntas frecuentes: Google puede mostrarlas como desplegables en los resultados.
export function faqJsonLd(items) {
  const plain = (html) => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const entities = (items ?? []).slice(0, 50).map((f) => ({
    "@type": "Question",
    name: f.question,
    acceptedAnswer: { "@type": "Answer", text: plain(f.answer) },
  }));
  return entities.length ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: entities } : null;
}
