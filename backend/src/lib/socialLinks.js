import { AppError } from "../utils/AppError.js";

// Redes de la tienda (Vendor.socialLinks = { red: { url, enabled } }). Decisión del dueño: solo estas seis; Facebook y
// Messenger son el mismo botón. Un ícono se muestra en la tienda solo si tiene enlace guardado y su interruptor está
// encendido; al guardar un enlace nuevo se enciende solo, y el vendedor puede apagarlo cuando quiera.
// Cada red acepta su enlace completo (de SU dominio) o el usuario ("@mitienda"); se guarda como enlace https, así un
// ícono de Instagram nunca lleva a otro sitio. WhatsApp acepta el número o un enlace de WhatsApp y queda como wa.me.
export const SOCIAL_NETWORKS = {
  whatsapp: { label: "WhatsApp", hosts: ["wa.me", "whatsapp.com", "api.whatsapp.com"], base: null },
  facebook: { label: "Facebook / Messenger", hosts: ["facebook.com", "fb.com", "fb.me", "m.me", "messenger.com"], base: "https://facebook.com/" },
  instagram: { label: "Instagram", hosts: ["instagram.com", "instagr.am"], base: "https://instagram.com/" },
  tiktok: { label: "TikTok", hosts: ["tiktok.com"], base: "https://www.tiktok.com/@" },
  youtube: { label: "YouTube", hosts: ["youtube.com", "youtu.be"], base: "https://youtube.com/@" },
  telegram: { label: "Telegram", hosts: ["t.me", "telegram.me"], base: "https://t.me/" },
};

const HANDLE = /^@?[A-Za-z0-9._-]{1,60}$/;

function whatsappUrl(value) {
  const digits = value.replace(/\D/g, "");
  if (/^\+?[\d\s().-]{7,20}$/.test(value)) {
    if (digits.length < 7 || digits.length > 15) throw new AppError("El número de WhatsApp no es válido. Escríbelo con el código del país, por ejemplo +5351234567.", 400);
    return `https://wa.me/${digits}`;
  }
  return null;
}

function normalizeUrl(key, raw) {
  const net = SOCIAL_NETWORKS[key];
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (key === "whatsapp") {
    const fromNumber = whatsappUrl(value);
    if (fromNumber) return fromNumber;
  } else if (HANDLE.test(value) && !value.includes(".")) {
    return net.base + value.replace(/^@/, "");
  }
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new AppError(`El enlace de ${net.label} no es válido.`, 400);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new AppError(`El enlace de ${net.label} no es válido.`, 400);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!net.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new AppError(`El enlace de ${net.label} tiene que ser de ${net.hosts[0]}.`, 400);
  }
  if (key === "whatsapp") {
    // wa.me/<número> o api.whatsapp.com/send?phone=<número>: se deja siempre como wa.me/<número>.
    const phone = host === "wa.me" ? url.pathname.replace(/\D/g, "") : (url.searchParams.get("phone") ?? "").replace(/\D/g, "");
    if (phone.length < 7) throw new AppError("El enlace de WhatsApp tiene que llevar el número (por ejemplo wa.me/5351234567).", 400);
    return `https://wa.me/${phone}`;
  }
  url.protocol = "https:";
  const out = url.toString();
  if (out.length > 300) throw new AppError(`El enlace de ${net.label} es demasiado largo.`, 400);
  return out;
}

// input: { red: { url, enabled } }; previous: lo guardado. Un enlace nuevo o cambiado se enciende solo. Devuelve solo las
// redes con enlace, o null si no queda ninguna.
export function normalizeSocialLinks(input, previous) {
  const out = {};
  for (const key of Object.keys(SOCIAL_NETWORKS)) {
    const entry = input?.[key];
    const url = normalizeUrl(key, typeof entry === "string" ? entry : entry?.url);
    if (!url) continue;
    const changed = previous?.[key]?.url !== url;
    out[key] = { url, enabled: changed ? true : entry?.enabled !== false };
  }
  return Object.keys(out).length ? out : null;
}

// Lo que ve el público: solo las redes encendidas, como { red: url }.
export function publicSocialLinks(stored) {
  if (!stored || typeof stored !== "object") return null;
  const out = {};
  for (const key of Object.keys(SOCIAL_NETWORKS)) {
    const e = stored[key];
    if (e?.url && e.enabled !== false) out[key] = e.url;
  }
  return Object.keys(out).length ? out : null;
}
