import webpush from "web-push";
import { prisma } from "./prisma.js";
import { encryptSecret, decryptSecret } from "./crypto.js";
import { env } from "../config/env.js";

// Avisos push (Web Push, estándar VAPID). Las claves se generan solas la primera vez y se guardan en la base de datos, con la
// clave privada cifrada. Si la PWA está apagada desde el admin (SiteSettings.pwaEnabled) no se envía nada.

const SUBJECT = "mailto:soporte@zeudin.com";
let keys = null;
let enabledCache = { value: true, at: 0 };

async function getKeys() {
  if (keys) return keys;
  let row = await prisma.webPushKey.findUnique({ where: { id: "main" } });
  if (!row) {
    const generated = webpush.generateVAPIDKeys();
    try {
      row = await prisma.webPushKey.create({ data: { id: "main", publicKey: generated.publicKey, privateKey: JSON.stringify(encryptSecret(generated.privateKey)) } });
    } catch {
      // Otro proceso la creó justo antes.
      row = await prisma.webPushKey.findUnique({ where: { id: "main" } });
    }
  }
  keys = { publicKey: row.publicKey, privateKey: decryptSecret(JSON.parse(row.privateKey)) };
  return keys;
}

export async function getPublicKey() {
  return (await getKeys()).publicKey;
}

export async function pwaEnabled() {
  if (Date.now() - enabledCache.at < 30_000) return enabledCache.value;
  const s = await prisma.siteSettings.findFirst({ select: { pwaEnabled: true } });
  enabledCache = { value: s?.pwaEnabled ?? true, at: Date.now() };
  return enabledCache.value;
}

export function forgetPwaEnabled() {
  enabledCache.at = 0;
}

// La foto del aviso tiene que ser una dirección completa (el teléfono la descarga por su cuenta).
const PUBLIC_URL = String(env.frontendUrl ?? "").replace(/\/$/, "");
const absoluteImage = (src) => (!src ? undefined : /^https?:\/\//.test(src) ? src : PUBLIC_URL ? `${PUBLIC_URL}/api${src.startsWith("/") ? "" : "/"}${src}` : undefined);

// Si la persona tiene varias apps instaladas en el mismo teléfono (por ejemplo Admin y Tienda), cada aviso va solo a la app que
// le corresponde: así iOS lo muestra con el nombre correcto ("de Baznova Tienda" y no "de Baznova Admin"). Si no tiene esa
// app, se manda a las que tenga.
function pickSubscriptions(subs, app) {
  if (!app) return subs;
  const byUser = new Map();
  for (const s of subs) {
    if (!byUser.has(s.userId)) byUser.set(s.userId, []);
    byUser.get(s.userId).push(s);
  }
  return [...byUser.values()].flatMap((list) => {
    const matching = list.filter((s) => s.app === app);
    return matching.length ? matching : list;
  });
}

// Envía el aviso a los dispositivos de esas personas (menos a quien silenció esa categoría). Nunca lanza.
export async function pushToUsers(userIds, payload) {
  try {
    if (!userIds.length || !(await pwaEnabled())) return { sent: 0 };
    const { publicKey, privateKey } = await getKeys();
    const all = await prisma.pushSubscription.findMany({
      where: { userId: { in: userIds }, user: payload.category ? { NOT: { pushMuted: { has: payload.category } } } : undefined },
    });
    const subs = pickSubscriptions(all, payload.app);
    if (!subs.length) return { sent: 0 };
    const body = JSON.stringify({
      title: String(payload.title ?? "").slice(0, 120),
      body: String(payload.body ?? "").slice(0, 300),
      url: payload.url ?? "/",
      tag: payload.tag ?? undefined,
      category: payload.category ?? undefined,
      image: absoluteImage(payload.image),
    });
    const options = { TTL: payload.ttl ?? 6 * 3600, urgency: payload.urgency ?? "high", vapidDetails: { subject: SUBJECT, publicKey, privateKey } };
    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, options);
          sent++;
          void prisma.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
        } catch (err) {
          // 404/410: el dispositivo ya no existe (desinstaló la app o revocó el permiso).
          if (err?.statusCode === 404 || err?.statusCode === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          else console.error("[push]", err?.statusCode ?? "", String(err?.body ?? err?.message ?? err).slice(0, 160));
        }
      })
    );
    return { sent };
  } catch (err) {
    console.error("[push]", err?.message);
    return { sent: 0 };
  }
}
