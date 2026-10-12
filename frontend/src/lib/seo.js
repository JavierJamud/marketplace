import { useEffect } from "react";

// SEO del lado del navegador. Google ejecuta JavaScript al indexar, así que cada pantalla fija su título, descripción,
// dirección canónica, etiquetas para redes y datos estructurados (JSON-LD) cuando carga. Las pantallas privadas
// (cuenta, paneles, carrito, pago) se marcan "noindex" para que no aparezcan en Google.

export const SITE_ORIGIN = (import.meta.env.VITE_SITE_URL || "https://baznova.com").replace(/\/$/, "");
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-baznova-3.png`;

function upsertMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (content == null || content === "") {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!href) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function setJsonLd(data) {
  const id = "seo-jsonld";
  document.getElementById(id)?.remove();
  if (!data) return;
  const el = document.createElement("script");
  el.id = id;
  el.type = "application/ld+json";
  el.textContent = JSON.stringify(data);
  document.head.appendChild(el);
}

const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

// config: { title, description, path, image, noindex, keywords, type, jsonLd }
export function applySeo(config) {
  const { title, description, path, image, noindex, keywords, type = "website", jsonLd } = config;
  const desc = clip(description, 300);
  const url = path != null ? `${SITE_ORIGIN}${path}` : null;

  if (title) document.title = title;
  upsertMeta("name", "description", desc);
  upsertMeta("name", "keywords", Array.isArray(keywords) ? keywords.join(", ") : keywords);
  upsertMeta("name", "robots", noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large, max-snippet:-1");
  upsertLink("canonical", noindex ? null : url);

  upsertMeta("property", "og:type", type);
  upsertMeta("property", "og:title", title);
  upsertMeta("property", "og:description", desc);
  upsertMeta("property", "og:url", url);
  upsertMeta("property", "og:image", image || DEFAULT_OG_IMAGE);
  upsertMeta("name", "twitter:card", "summary_large_image");
  upsertMeta("name", "twitter:title", title);
  upsertMeta("name", "twitter:description", desc);
  upsertMeta("name", "twitter:image", image || DEFAULT_OG_IMAGE);

  setJsonLd(jsonLd);
}

// Fija el SEO mientras la pantalla está montada. `deps` indica cuándo recalcularlo (por ejemplo, al cargar los datos).
export function useSeo(config, deps = []) {
  useEffect(() => {
    if (!config) return;
    applySeo(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export { clip as seoClip };
