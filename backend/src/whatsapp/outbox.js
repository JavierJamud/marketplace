import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { digitsOf, normalizePhone, samePhone } from "./phone.js";
import {
  adminNewVendorText, adminNoticeText, adminWeeklyText, broadcastText, customerNoticeText, vendorNoticeText, weeklySummaryText,
} from "./templates.js";

// Cola de mensajes de WhatsApp. La API solo deja filas aquí; el proceso de WhatsApp (worker.js) las envía.

export const SESSION_ID = "main";
// Prioridad: los códigos salen antes que los avisos.
export const PRIORITY_CODE = 1;
export const PRIORITY_NOTICE = 5;
// Mensajes masivos del admin: salen al final, despacio y solo en horario de día (ver worker.js).
export const PRIORITY_BULK = 8;
// Un aviso viejo ya no sirve: si no pudo salir en este tiempo, se descarta.
const NOTICE_TTL_MS = 6 * 60 * 60 * 1000;
// El mismo aviso al mismo número dentro de esta ventana cuenta como uno solo.
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
// Tope por número: nadie recibe más avisos que estos en una hora ni en un día. Que una persona reciba ráfagas de mensajes
// es lo que la lleva a reportar el número, y los reportes son lo que hace que WhatsApp lo bloquee.
const PER_PHONE_HOURLY = 30;
const PER_PHONE_DAILY = 80;
// Algunos tipos tienen un tope propio más bajo por número y por hora: un error que se repite no puede llenar el teléfono.
const KIND_HOURLY = { "ADMIN:errors": 6 };
// El proceso marca su latido cada 15 s; un minuto sin latido es un proceso caído.
const WORKER_ALIVE_MS = 60_000;

// Tipos de mensaje que el admin puede encender o apagar (Admin → WhatsApp).
export const WHATSAPP_KINDS = [
  { key: "verify", label: "Códigos de confirmación", hint: "El código que confirma que un número tiene WhatsApp." },
  { key: "VENDOR:orders", label: "Tiendas: pedidos", hint: "Pedido nuevo, atrasado, cambiado o cancelado por el cliente." },
  { key: "VENDOR:stock", label: "Tiendas: stock bajo", hint: "Productos que se están agotando." },
  { key: "VENDOR:customers", label: "Tiendas: clientes nuevos", hint: "Cuando alguien le compra por primera vez." },
  { key: "VENDOR:messages", label: "Tiendas: mensajes", hint: "Mensajes nuevos en el chat del panel." },
  { key: "VENDOR:reviews", label: "Tiendas: reseñas", hint: "Reseñas nuevas de sus productos y de la tienda." },
  { key: "VENDOR:account", label: "Tiendas: avisos de la plataforma", hint: "Verificación, suscripción y respuestas del equipo." },
  { key: "VENDOR:weekly", label: "Tiendas: resumen semanal", hint: "Los números de su semana, lo pendiente y el consejo, el mismo día que el correo." },
  { key: "CLIENT:order_status", label: "Clientes: sus pedidos", hint: "Pedido recibido, confirmado, listo, entregado, cancelado y puntos." },
  { key: "ADMIN:vendors", label: "Admin: tiendas y verificaciones", hint: "Tiendas nuevas, verificaciones, pagos y suscripciones por revisar." },
  { key: "ADMIN:approvals", label: "Admin: solicitudes y reportes", hint: "Reseñas por aprobar, reportes, sugerencias, socios y casos de soporte." },
  { key: "ADMIN:messages", label: "Admin: mensajes de tiendas", hint: "Cuando una tienda te escribe por el chat del panel." },
  { key: "ADMIN:errors", label: "Admin: errores y revisión de la IA", hint: "Errores nuevos y fallos de la IA. Como mucho 6 por hora." },
  { key: "ADMIN:weekly", label: "Admin: resumen semanal", hint: "Los números de la semana de la plataforma, el mismo día que el correo." },
  { key: "BROADCAST:vendors", label: "Mensajes masivos a tiendas", hint: "Lo que envías desde \"Mensaje a tiendas\". Sale despacio y solo de día." },
];
const KIND_KEYS = new Set(WHATSAPP_KINDS.map((k) => k.key));

export async function getSession() {
  const row = await prisma.whatsappSession.findUnique({ where: { id: SESSION_ID } });
  return row ?? prisma.whatsappSession.upsert({ where: { id: SESSION_ID }, create: { id: SESSION_ID }, update: {} });
}

// La sesión se consulta en cada aviso: se guarda unos segundos para no ir a la base de datos cada vez.
let cached = { at: 0, row: null };
async function cachedSession() {
  if (!cached.row || Date.now() - cached.at > 10_000) cached = { at: Date.now(), row: await getSession() };
  return cached.row;
}
export function forgetSessionCache() {
  cached = { at: 0, row: null };
}

export function kindEnabled(session, kind) {
  return session?.enabledKinds?.[kind] !== false;
}

export function workerAlive(session) {
  return Boolean(session?.lastSeenAt) && Date.now() - new Date(session.lastSeenAt).getTime() < WORKER_ALIVE_MS;
}

// ¿Puede salir un mensaje ahora mismo? Sesión vinculada, conectada y con el proceso vivo.
export function canSendNow(session) {
  return session?.desired === "ON" && session.status === "CONNECTED" && workerAlive(session);
}

function dedupeKey(phone, kind, body) {
  const bucket = Math.floor(Date.now() / DEDUPE_WINDOW_MS);
  return crypto.createHash("sha256").update(`${digitsOf(phone)}|${kind}|${body}|${bucket}`).digest("hex");
}

// Referencia corta al pie del mensaje: con ella se encuentra el mensaje en el historial del admin.
export function refOf(key) {
  return key.slice(0, 6).toUpperCase();
}

export async function isOptedOut(phone) {
  return Boolean(await prisma.whatsappOptOut.findUnique({ where: { phone } }));
}

// Deja un aviso en la cola. `render(ref)` devuelve el texto.
async function enqueueNotice({ phone: raw, kind, audience, userId, vendorId, refCode, render, ttlMs = NOTICE_TTL_MS, priority = PRIORITY_NOTICE }) {
  const phone = normalizePhone(raw);
  if (!phone || !KIND_KEYS.has(kind)) return null;
  const session = await cachedSession();
  if (session.desired !== "ON" || session.paused || !kindEnabled(session, kind)) return null;
  if (await isOptedOut(phone)) return null;
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [hour, day, sameKind] = await Promise.all([
    prisma.whatsappMessage.count({ where: { phone, priority: { gte: PRIORITY_NOTICE }, createdAt: { gt: hourAgo } } }),
    prisma.whatsappMessage.count({ where: { phone, priority: { gte: PRIORITY_NOTICE }, createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    KIND_HOURLY[kind] ? prisma.whatsappMessage.count({ where: { phone, kind, createdAt: { gt: hourAgo } } }) : 0,
  ]);
  if (hour >= PER_PHONE_HOURLY || day >= PER_PHONE_DAILY || (KIND_HOURLY[kind] && sameKind >= KIND_HOURLY[kind])) return null;
  // La llave sale del texto sin referencia; la referencia sale de la llave.
  const key = dedupeKey(phone, kind, render(""));
  await prisma.whatsappMessage.createMany({
    data: [{
      dedupeKey: key, kind, audience, phone, userId: userId ?? null, vendorId: vendorId ?? null, refCode: refCode ?? null,
      body: render(refOf(key)), priority, expiresAt: new Date(Date.now() + ttlMs),
    }],
    skipDuplicates: true,
  });
  return key;
}

// Aviso a la tienda: un solo mensaje al WhatsApp que el dueño confirmó (no uno por cada persona del equipo).
export async function enqueueVendorNotice(vendorId, payload) {
  if (!vendorId || !payload?.title) return;
  const kind = `VENDOR:${payload.category}`;
  if (!KIND_KEYS.has(kind)) return;
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { whatsapp: true, whatsappVerifiedPhone: true } });
  if (!vendor?.whatsappVerifiedPhone || !samePhone(vendor.whatsappVerifiedPhone, vendor.whatsapp)) return;
  await enqueueNotice({
    phone: vendor.whatsapp, kind, audience: "VENDOR", vendorId, refCode: payload.detail?.code ?? null,
    render: (ref) => vendorNoticeText(payload, ref),
  });
}

// Resumen semanal de la tienda. Todas las tiendas lo reciben el mismo día y la cola respeta los topes por hora y por día:
// por eso puede esperar hasta un día en la cola en vez de las 6 horas de un aviso normal. Devuelve la llave o null.
export async function enqueueVendorWeekly(vendorId, summary) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { whatsapp: true, whatsappVerifiedPhone: true } });
  if (!vendor?.whatsappVerifiedPhone || !samePhone(vendor.whatsappVerifiedPhone, vendor.whatsapp)) return null;
  return enqueueNotice({
    phone: vendor.whatsapp, kind: "VENDOR:weekly", audience: "VENDOR", vendorId,
    render: (ref) => weeklySummaryText(summary, ref), ttlMs: 24 * 60 * 60 * 1000,
  });
}

// Aviso a clientes: a cada uno, al WhatsApp que confirmó en su cuenta.
export async function enqueueCustomerNotice(userIds, payload) {
  if (!userIds?.length || !payload?.title) return;
  const kind = `CLIENT:${payload.category}`;
  if (!KIND_KEYS.has(kind)) return;
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, deletedAt: null, whatsappVerifiedPhone: { not: null } },
    select: { id: true, phone: true, whatsappVerifiedPhone: true },
  });
  for (const user of users) {
    if (!samePhone(user.whatsappVerifiedPhone, user.phone)) continue;
    await enqueueNotice({
      phone: user.phone, kind, audience: "CLIENT", userId: user.id, refCode: payload.detail?.code ?? null,
      render: (ref) => customerNoticeText(payload, ref),
    });
  }
}

// Por qué un admin no recibe sus avisos por WhatsApp, o null si los recibe. Vincular el número de la plataforma no basta:
// cada admin confirma el suyo en Mi perfil. `platformPhone` es el número vinculado, el que envía.
export async function adminNoticeBlock(admin, platformPhone) {
  if (!normalizePhone(admin.phone)) return "NO_PHONE";
  if (!admin.whatsappVerifiedPhone) return "NOT_CONFIRMED";
  if (!samePhone(admin.whatsappVerifiedPhone, admin.phone)) return "PHONE_CHANGED";
  // Un mensaje del número a sí mismo cae en el chat propio y el teléfono no avisa.
  if (samePhone(admin.phone, platformPhone)) return "SAME_AS_PLATFORM";
  if (await isOptedOut(normalizePhone(admin.phone))) return "OPT_OUT";
  return null;
}

// ¿Hay algún admin que reciba avisos por WhatsApp? Lo usa el vigilante (jobs/whatsappWatch.job.js).
export async function anyAdminReceivesNotices(platformPhone) {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", deletedAt: null },
    select: { phone: true, whatsappVerifiedPhone: true },
  });
  for (const admin of admins) {
    if (!(await adminNoticeBlock(admin, platformPhone))) return true;
  }
  return false;
}

// Admins que confirmaron su número (Mi perfil → WhatsApp para avisos). El número es el de la cuenta del admin, distinto
// del número de la plataforma que envía los mensajes.
let warnedNoAdminAt = 0;
async function verifiedAdmins() {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", deletedAt: null, whatsappVerifiedPhone: { not: null } },
    select: { id: true, phone: true, whatsappVerifiedPhone: true },
  });
  const ready = admins.filter((a) => samePhone(a.whatsappVerifiedPhone, a.phone));
  // El aviso no sale y no queda fila en el historial: al menos queda una línea en el registro, una por hora como mucho.
  if (!ready.length && Date.now() - warnedNoAdminAt > 60 * 60 * 1000 && (await cachedSession()).desired === "ON") {
    warnedNoAdminAt = Date.now();
    console.warn("[whatsapp] aviso al admin sin destinatario: ningún admin tiene su número confirmado en Mi perfil.");
  }
  return ready;
}

// Aviso al admin: lo mismo que llega a su campanita y a su correo (lib/notify.js → notifyAdmins).
export async function enqueueAdminNotice(payload) {
  if (!payload?.title) return;
  const kind = `ADMIN:${payload.category}`;
  if (!KIND_KEYS.has(kind)) return;
  for (const admin of await verifiedAdmins()) {
    await enqueueNotice({ phone: admin.phone, kind, audience: "ADMIN", userId: admin.id, render: (ref) => adminNoticeText(payload, ref) });
  }
}

// Tienda nueva, con sus datos (services/adminReports.service.js → notifyAdminsNewVendor).
export async function enqueueAdminNewVendor(summary) {
  for (const admin of await verifiedAdmins()) {
    await enqueueNotice({
      phone: admin.phone, kind: "ADMIN:vendors", audience: "ADMIN", userId: admin.id, vendorId: summary.id,
      render: (ref) => adminNewVendorText(summary, ref),
    });
  }
}

// Resumen semanal de la plataforma. Devuelve cuántos admins lo van a recibir.
export async function enqueueAdminWeekly(report) {
  let queued = 0;
  for (const admin of await verifiedAdmins()) {
    const key = await enqueueNotice({
      phone: admin.phone, kind: "ADMIN:weekly", audience: "ADMIN", userId: admin.id,
      render: (ref) => adminWeeklyText(report, ref), ttlMs: 24 * 60 * 60 * 1000,
    });
    if (key) queued += 1;
  }
  return queued;
}

// Mensaje masivo a una tienda. `batch` agrupa los mensajes de un mismo envío en el historial (va en refCode).
export async function enqueueBroadcast({ vendor, message, url, batch }) {
  return enqueueNotice({
    phone: vendor.whatsapp, kind: "BROADCAST:vendors", audience: "VENDOR", vendorId: vendor.id, refCode: batch,
    render: (ref) => broadcastText({ companyName: vendor.companyName, message, url }, ref),
    ttlMs: 48 * 60 * 60 * 1000, priority: PRIORITY_BULK,
  });
}

// Mensaje suelto (código de confirmación, prueba del admin, respuesta a BAJA). Devuelve la fila creada.
// Con `secret`, `body` es solo la etiqueta que se ve en el historial y el texto real viaja cifrado.
export async function enqueueDirect({ phone: raw, kind, audience, userId, vendorId, body, secret, priority, ttlMs }) {
  const phone = normalizePhone(raw);
  if (!phone) return null;
  return prisma.whatsappMessage.create({
    data: {
      dedupeKey: crypto.randomUUID(), kind, audience, phone, userId: userId ?? null, vendorId: vendorId ?? null,
      body, secret: secret ?? undefined, priority, expiresAt: new Date(Date.now() + ttlMs),
    },
  });
}
