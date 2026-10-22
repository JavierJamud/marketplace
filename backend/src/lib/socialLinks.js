import { AppError } from "../utils/AppError.js";

// Redes de la tienda (Vendor.socialLinks): se muestran como íconos en su página solo si están puestas. Cada una acepta el
// enlace completo de SU dominio o el nombre de usuario ("@mitienda"), y se guarda siempre como enlace https. Así un ícono
// de Instagram nunca lleva a otro sitio.
export const SOCIAL_NETWORKS = {
  facebook: { label: "Facebook", hosts: ["facebook.com", "fb.com", "fb.me"], base: "https://facebook.com/" },
  instagram: { label: "Instagram", hosts: ["instagram.com", "instagr.am"], base: "https://instagram.com/" },
  tiktok: { label: "TikTok", hosts: ["tiktok.com"], base: "https://www.tiktok.com/@" },
  youtube: { label: "YouTube", hosts: ["youtube.com", "youtu.be"], base: "https://youtube.com/@" },
  telegram: { label: "Telegram", hosts: ["t.me", "telegram.me"], base: "https://t.me/" },
  x: { label: "X (Twitter)", hosts: ["x.com", "twitter.com"], base: "https://x.com/" },
  website: { label: "Sitio web", hosts: null, base: null },
};

const HANDLE = /^@?[A-Za-z0-9._-]{1,60}$/;

function normalizeOne(key, raw) {
  const net = SOCIAL_NETWORKS[key];
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (net.base && HANDLE.test(value) && !value.includes(".")) return net.base + value.replace(/^@/, "");
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new AppError(`El enlace de ${net.label} no es válido.`, 400);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new AppError(`El enlace de ${net.label} no es válido.`, 400);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (net.hosts && !net.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new AppError(`El enlace de ${net.label} tiene que ser de ${net.hosts[0]}.`, 400);
  }
  if (!net.hosts && !host.includes(".")) throw new AppError("El enlace del sitio web no es válido.", 400);
  url.protocol = "https:";
  const out = url.toString();
  if (out.length > 300) throw new AppError(`El enlace de ${net.label} es demasiado largo.`, 400);
  return out;
}

// Recibe { facebook: "...", instagram: "@..." } y devuelve solo las redes puestas, ya normalizadas (o null si ninguna).
export function normalizeSocialLinks(input) {
  const out = {};
  for (const key of Object.keys(SOCIAL_NETWORKS)) {
    const v = normalizeOne(key, input?.[key]);
    if (v) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}
