import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getPublicKey, pwaEnabled } from "../lib/push.js";
import { PUSH_CATEGORIES } from "../lib/notify.js";
import { openStream } from "../lib/realtime.js";
import { AppError } from "../utils/AppError.js";

// Canal en vivo (SSE) de la persona con sesión abierta.
// El canal en vivo funciona aunque el admin apague la app instalable: de él depende que las pantallas abiertas se
// actualicen solas cuando algo cambia (un pedido, una verificación, un ajuste de la tienda).
export async function realtimeStream(req, res) {
  openStream(req, res, req.user.id);
}

export async function publicKey(_req, res) {
  res.set("Cache-Control", "public, max-age=300");
  res.json({ enabled: await pwaEnabled(), key: await getPublicKey() });
}

const subscribeSchema = z.object({
  endpoint: z.string().url().max(1000).startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
  app: z.enum(["CLIENT", "VENDOR", "ADMIN"]).default("CLIENT"),
});

// Un dispositivo se suscribe. El mismo dispositivo siempre es de la última persona que inició sesión en él.
export async function subscribe(req, res) {
  const data = subscribeSchema.parse(req.body);
  const userAgent = String(req.headers["user-agent"] ?? "").slice(0, 200);
  await prisma.pushSubscription.upsert({
    where: { endpoint: data.endpoint },
    create: { userId: req.user.id, endpoint: data.endpoint, p256dh: data.keys.p256dh, auth: data.keys.auth, app: data.app, userAgent },
    update: { userId: req.user.id, p256dh: data.keys.p256dh, auth: data.keys.auth, app: data.app, userAgent },
  });
  res.status(201).json({ ok: true });
}

// El navegador puede cambiar la dirección de la suscripción por su cuenta (evento pushsubscriptionchange del service worker).
// Ahí no hay sesión (el service worker no ve el token), así que la prueba es la dirección vieja: una URL única e imposible de
// adivinar que solo conoce ese dispositivo. Se pasa la misma persona y la misma app a la dirección nueva; sin esto, la tienda
// dejaba de recibir avisos en silencio hasta volver a abrir la app.
const rotateSchema = z.object({
  oldEndpoint: z.string().url().max(1000).startsWith("https://"),
  endpoint: subscribeSchema.shape.endpoint,
  keys: subscribeSchema.shape.keys,
});

export async function rotate(req, res) {
  const data = rotateSchema.parse(req.body);
  const old = await prisma.pushSubscription.findUnique({ where: { endpoint: data.oldEndpoint } });
  if (!old) return res.status(404).json({ error: "Suscripción no encontrada." });
  await prisma.$transaction([
    prisma.pushSubscription.deleteMany({ where: { endpoint: data.endpoint, NOT: { id: old.id } } }),
    prisma.pushSubscription.update({ where: { id: old.id }, data: { endpoint: data.endpoint, p256dh: data.keys.p256dh, auth: data.keys.auth } }),
  ]);
  res.json({ ok: true });
}

export async function unsubscribe(req, res) {
  const { endpoint } = z.object({ endpoint: z.string().url().max(1000) }).parse(req.body);
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user.id } });
  res.json({ ok: true });
}

// Qué categorías se ofrecen a esta persona (según su rol) y cuáles silenció.
export async function getPreferences(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true, pushMuted: true } });
  if (!user) throw new AppError("No autenticado.", 401);
  const isVendor = user.role === "VENDOR" || (await prisma.vendorStaff.count({ where: { userId: req.user.id } })) > 0;
  const audiences = user.role === "ADMIN" ? ["ADMIN", "BOTH"] : isVendor ? ["VENDOR", "BOTH"] : ["CLIENT"];
  const categories = Object.entries(PUSH_CATEGORIES)
    .filter(([, c]) => audiences.includes(c.audience))
    .map(([id, c]) => ({ id, label: c.label, hint: c.hint, enabled: !user.pushMuted.includes(id) }));
  const devices = await prisma.pushSubscription.count({ where: { userId: req.user.id } });
  res.json({ categories, devices });
}

export async function updatePreferences(req, res) {
  const { muted } = z.object({ muted: z.array(z.string().max(30)).max(20) }).parse(req.body);
  const valid = muted.filter((m) => m in PUSH_CATEGORIES);
  await prisma.user.update({ where: { id: req.user.id }, data: { pushMuted: valid } });
  res.json({ ok: true });
}
