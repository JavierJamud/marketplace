import { env } from "../config/env.js";

// Formas públicas y estables de la API de socios (/partner/v1). Solo se exponen campos que ya
// son visibles en el sitio de Baznova; nunca datos privados (dueño, documento, dirección legal).

const trim = (u) => u.replace(/\/+$/, "");
export const siteUrl = () => trim(env.frontendUrl);

export function absUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${trim(env.backendUrl)}${path.startsWith("/") ? "" : "/"}${path}`;
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

// Qué tiendas ve un socio: las públicas y activas, más las suyas aunque sean privadas.
export function visibleVendorWhere(partnerId) {
  return {
    isBlocked: false,
    status: "ACTIVE",
    OR: [{ isPrivate: false }, { partnerId }],
  };
}

export const PUBLIC_PRODUCT_FILTER = {
  isActive: true,
  hiddenFromStore: false,
  overQuota: false,
};

export function visibleProductWhere(partnerId) {
  return {
    ...PUBLIC_PRODUCT_FILTER,
    AND: [
      { OR: [{ unlimitedStock: true }, { stock: { gt: 0 } }] },
      // Menú de mesa oculto: esos productos no salen en la tienda pública.
      { NOT: { availableForTableMenu: true, vendor: { menuPublic: false } } },
    ],
    vendor: visibleVendorWhere(partnerId),
  };
}

export const productInclude = {
  vendor: { select: { slug: true, companyName: true, verificationStatus: true, logoUrl: true } },
  category: { select: { id: true, name: true, slug: true } },
  priceTiers: { orderBy: { minQty: "asc" } },
};

export function productDto(p) {
  const url = `${siteUrl()}/producto/${p.vendor.slug}/${p.slug}`;
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    price: num(p.price),
    oldPrice: num(p.oldPrice),
    currency: p.currency,
    priceTiers: (p.priceTiers ?? []).map((t) => ({ minQty: t.minQty, price: num(t.price) })),
    images: (p.images ?? []).map(absUrl),
    category: p.category ? { id: p.category.id, name: p.category.name, slug: p.category.slug } : null,
    tags: p.tags ?? [],
    sizes: p.sizes ?? [],
    badge: p.badge ?? null,
    inStock: p.unlimitedStock || p.stock > 0,
    rating: num(p.rating),
    reviewCount: p.reviewCount,
    isFeatured: p.isFeatured,
    createdAt: p.createdAt,
    url,
    store: {
      slug: p.vendor.slug,
      name: p.vendor.companyName,
      verified: p.vendor.verificationStatus === "VERIFIED",
      logoUrl: absUrl(p.vendor.logoUrl),
      url: `${siteUrl()}/tienda/${p.vendor.slug}`,
    },
  };
}

export const storeInclude = {
  locations: { include: { province: { select: { id: true, name: true } }, municipality: { select: { id: true, name: true } }, country: { select: { id: true, name: true } } } },
  businessCategory: { select: { id: true, name: true, slug: true } },
};

export function storeDto(v, extra = {}) {
  return {
    id: v.id,
    slug: v.slug,
    name: v.companyName,
    description: v.description,
    logoUrl: absUrl(v.logoUrl),
    color: v.color,
    verified: v.verificationStatus === "VERIFIED",
    rating: num(v.rating),
    isRestaurant: v.isRestaurant,
    currency: v.currency,
    businessCategory: v.businessCategory ?? null,
    locations: (v.locations ?? []).map((l) => ({
      country: l.country?.name ?? l.countryOther ?? null,
      province: l.province?.name ?? l.stateOther ?? null,
      provinceId: l.provinceId ?? null,
      municipality: l.municipality?.name ?? l.municipalityOther ?? null,
      municipalityId: l.municipalityId ?? null,
    })),
    url: `${siteUrl()}/tienda/${v.slug}`,
    createdAt: v.createdAt,
    ...extra,
  };
}

export function reviewDto(r) {
  return {
    id: r.id,
    author: r.authorName,
    rating: r.rating,
    comment: r.comment,
    images: (r.images ?? []).map(absUrl),
    verifiedPurchase: r.isVerifiedPurchase,
    storeReply: r.vendorReply ?? null,
    storeRepliedAt: r.vendorRepliedAt ?? null,
    createdAt: r.createdAt,
  };
}
