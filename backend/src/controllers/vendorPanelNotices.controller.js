import DOMPurify from "isomorphic-dompurify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { samePhone } from "../whatsapp/phone.js";

// Avisos del admin dentro del panel de las tiendas: un pop-up con HTML que sale al entrar, entre dos fechas y como mucho
// N veces por tienda. Lo ve el dueño de la tienda (no el equipo). Si el aviso va solo a las tiendas sin WhatsApp activo,
// deja de salir en cuanto la tienda lo activa.

// HTML que escribe el admin: sin scripts ni formularios, y sin <style>, que cambiaría todo el panel.
const SANITIZE = { FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed"], FORBID_ATTR: ["id"] };
const clean = (html) => DOMPurify.sanitize(String(html ?? ""), SANITIZE).trim();

// El botón del aviso lleva a una página del sitio ("/vendedor/perfil") o a una dirección https.
const ctaUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => /^\/(?!\/)/.test(v) || /^https:\/\//.test(v), "El enlace del botón debe empezar por / o por https://");

const noticeSchema = z.object({
  title: z.string().trim().min(3, "El título necesita al menos 3 caracteres.").max(120),
  html: z.string().max(20000),
  ctaLabel: z.string().trim().max(40).optional().nullable(),
  ctaUrl: ctaUrl.optional().nullable().or(z.literal("")),
  audience: z.enum(["ALL", "WHATSAPP_OFF", "SELECTED"]),
  vendorIds: z.array(z.string().min(1).max(40)).max(500).optional().default([]),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  maxViews: z.number().int().min(1, "Mínimo 1 vez.").max(50, "Máximo 50 veces."),
  isActive: z.boolean().optional(),
});

function toData(input) {
  const html = clean(input.html);
  if (!html) throw new AppError("Escribe el contenido del aviso.", 400);
  if (input.endAt <= input.startAt) throw new AppError("La fecha de fin debe ser posterior a la de inicio.", 400);
  const label = input.ctaLabel?.trim() || null;
  const url = input.ctaUrl?.trim() || null;
  if (Boolean(label) !== Boolean(url)) throw new AppError("El botón necesita texto y enlace, o ninguno de los dos.", 400);
  const vendorIds = input.audience === "SELECTED" ? [...new Set(input.vendorIds)] : [];
  if (input.audience === "SELECTED" && !vendorIds.length) throw new AppError("Elige al menos una tienda.", 400);
  return {
    title: input.title, html, ctaLabel: label, ctaUrl: url, audience: input.audience, vendorIds,
    startAt: input.startAt, endAt: input.endAt, maxViews: input.maxViews, ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };
}

// ── Admin ──

export async function listNotices(req, res) {
  const notices = await prisma.vendorPanelNotice.findMany({ orderBy: { createdAt: "desc" } });
  const stats = await prisma.vendorPanelNoticeView.groupBy({
    by: ["noticeId"],
    _count: { _all: true },
    _sum: { views: true },
  });
  const done = await prisma.vendorPanelNoticeView.groupBy({ by: ["noticeId"], where: { doneAt: { not: null } }, _count: { _all: true } });
  const statOf = new Map(stats.map((s) => [s.noticeId, s]));
  const doneOf = new Map(done.map((d) => [d.noticeId, d._count._all]));
  // Nombres de las tiendas elegidas, para mostrarlas en la lista y al editar.
  const ids = [...new Set(notices.flatMap((n) => n.vendorIds))];
  const names = new Map(
    (ids.length ? await prisma.vendor.findMany({ where: { id: { in: ids } }, select: { id: true, companyName: true } }) : []).map((v) => [v.id, v.companyName]),
  );
  res.json({
    notices: notices.map((n) => ({
      ...n,
      selectedStores: n.vendorIds.filter((id) => names.has(id)).map((id) => ({ id, companyName: names.get(id) })),
      stores: statOf.get(n.id)?._count._all ?? 0,
      shown: statOf.get(n.id)?._sum.views ?? 0,
      clicked: doneOf.get(n.id) ?? 0,
    })),
  });
}

export async function createNotice(req, res) {
  const notice = await prisma.vendorPanelNotice.create({ data: toData(noticeSchema.parse(req.body)) });
  res.status(201).json({ notice });
}

export async function updateNotice(req, res) {
  const existing = await prisma.vendorPanelNotice.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError("Ese aviso ya no existe.", 404);
  const notice = await prisma.vendorPanelNotice.update({ where: { id: existing.id }, data: toData(noticeSchema.parse(req.body)) });
  res.json({ notice });
}

export async function deleteNotice(req, res) {
  await prisma.vendorPanelNotice.deleteMany({ where: { id: req.params.id } });
  res.json({ ok: true });
}

// ── Tienda ──

async function ownStore(req) {
  if (req.user.role !== "VENDOR") return null;
  return prisma.vendor.findFirst({
    where: { userId: req.user.id, deletedAt: null },
    select: { id: true, whatsapp: true, whatsappVerifiedPhone: true },
  });
}

const whatsappActive = (vendor) => Boolean(vendor.whatsappVerifiedPhone && samePhone(vendor.whatsappVerifiedPhone, vendor.whatsapp));

async function eligibleNotices(vendor) {
  const now = new Date();
  const notices = await prisma.vendorPanelNotice.findMany({
    where: { isActive: true, startAt: { lte: now }, endAt: { gt: now } },
    orderBy: { startAt: "asc" },
    include: { views: { where: { vendorId: vendor.id }, select: { views: true, doneAt: true } } },
  });
  const waOn = whatsappActive(vendor);
  return notices.filter((n) => {
    if (n.audience === "WHATSAPP_OFF" && waOn) return false;
    if (n.audience === "SELECTED" && !n.vendorIds.includes(vendor.id)) return false;
    const seen = n.views[0];
    return !seen || (!seen.doneAt && seen.views < n.maxViews);
  });
}

// El aviso que le toca ver ahora (uno a la vez: el más antiguo primero).
export async function activeNotice(req, res) {
  const vendor = await ownStore(req);
  if (!vendor) return res.json({ notice: null });
  const [notice] = await eligibleNotices(vendor);
  if (!notice) return res.json({ notice: null });
  const { views, ...rest } = notice;
  res.json({ notice: { id: rest.id, title: rest.title, html: rest.html, ctaLabel: rest.ctaLabel, ctaUrl: rest.ctaUrl } });
}

// El panel avisa que lo mostró (una vez por sesión del navegador).
export async function markShown(req, res) {
  const vendor = await ownStore(req);
  if (!vendor) throw new AppError("Solo para el dueño de la tienda.", 403);
  const notice = (await eligibleNotices(vendor)).find((n) => n.id === req.params.id);
  if (!notice) return res.json({ ok: true });
  await prisma.vendorPanelNoticeView.upsert({
    where: { noticeId_vendorId: { noticeId: notice.id, vendorId: vendor.id } },
    create: { noticeId: notice.id, vendorId: vendor.id, views: 1, lastShownAt: new Date() },
    update: { views: { increment: 1 }, lastShownAt: new Date() },
  });
  res.json({ ok: true });
}

// Tocó el botón del aviso o "No volver a mostrar": ya no sale más a esa tienda.
export async function markDone(req, res) {
  const vendor = await ownStore(req);
  if (!vendor) throw new AppError("Solo para el dueño de la tienda.", 403);
  const exists = await prisma.vendorPanelNotice.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!exists) return res.json({ ok: true });
  await prisma.vendorPanelNoticeView.upsert({
    where: { noticeId_vendorId: { noticeId: exists.id, vendorId: vendor.id } },
    create: { noticeId: exists.id, vendorId: vendor.id, views: 1, lastShownAt: new Date(), doneAt: new Date() },
    update: { doneAt: new Date() },
  });
  res.json({ ok: true });
}
