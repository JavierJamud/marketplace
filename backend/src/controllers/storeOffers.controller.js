import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { logActivity, actorRoleForVendorAction } from "../lib/activityLog.js";
import { getStoreOfferPolicy } from "./settings.controller.js";
import { adminNoticeToVendor } from "../lib/notify.js";
import { assertCanPublishStoreOffers, recalcVendorStoreOffers } from "../lib/storeOfferVisibility.js";

// Bloque 232 (bug real encontrado de paso, probando el límite nuevo con un
// scratch script — "active" nunca se desactivaba de verdad): FormData manda
// todo como string, así que z.coerce.boolean() coacciona CUALQUIER string no
// vacío (incluido el literal "false") a true — este archivo ya tenía este
// bug preexistente en isLimitedTime/discountCodeExclusive (nunca se podía
// destildar "por tiempo limitado" una vez tildado, ver StoreOfferFormModal
// en VendorStoreOffers.jsx, que manda `String(isLimitedTime)` siempre, no
// solo cuando es true). Mismo helper que ya usan announcements.controller.js/
// targetedOffers.controller.js/verification.controller.js para este caso.
const boolish = z.preprocess((v) => (typeof v === "string" ? v === "true" : v), z.boolean());

export const storeOfferSummarySelect = {
  id: true,
  title: true,
  description: true,
  isLimitedTime: true,
  startsAt: true,
  expiresAt: true,
  discountCodeExclusive: true,
  active: true,
  createdAt: true,
  discountCode: {
    select: { id: true, code: true, type: true, value: true, currency: true, active: true },
  },
};

// Lo que ven la tienda y el admin: lo mismo más la suspensión del admin. Va aparte porque storeOfferSummarySelect también
// arma la respuesta pública de la tienda, y el motivo de una suspensión no es para clientes.
export const storeOfferPanelSelect = {
  ...storeOfferSummarySelect,
  suspendedAt: true,
  suspendedReason: true,
  discountCode: { select: { ...storeOfferSummarySelect.discountCode.select, suspendedAt: true } },
};

// Una oferta no se publica con un código que el admin suspendió: el cliente vería un código que el carrito rechaza.
function assertCodeNotSuspended(discountCode) {
  if (discountCode.suspendedAt) {
    throw new AppError("El equipo de la plataforma suspendió ese código de descuento. Elige otro para publicar la oferta.", 403);
  }
}

// Bloque 232 (pedido explícito — "solo se podrá mantener una oferta activa
// por tienda"... "se podrá cambiar desde el panel de admin si los
// vendedores pueden tener una oferta activa o pueden tener más de una"):
// límite configurable por PLAN (ver getStoreOfferPolicy, settings.controller.js
// — Bloque 52), nunca hardcodeado en 1. `excludeId` se usa al REACTIVAR una
// oferta que ya existía — no debe contarse a sí misma contra su propio límite.
async function assertActiveOfferLimit(vendor, excludeId) {
  const policy = await getStoreOfferPolicy(vendor.planType);
  if (policy.maxActive === null) return;
  const activeCount = await prisma.storeOffer.count({
    where: { vendorId: vendor.id, active: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (activeCount >= policy.maxActive) {
    throw new AppError(
      // Tope 0 (el plan trae ofertas pero ninguna encendida): antes decía "Ya tienes 0 de 0 ofertas activas permitidas".
      // Al reactivar (excludeId) la oferta ya está guardada y apagada, así que "guardarla apagada" solo se sugiere al crear.
      policy.maxActive === 0
        ? excludeId
          ? "Tu plan no permite tener ofertas activas. Mejora tu plan para publicarla."
          : "Tu plan no permite tener ofertas activas. Puedes guardarla apagada o mejorar tu plan."
        : policy.maxActive === 1
        ? "Ya tienes una oferta activa. Desactívala antes de activar otra."
        : `Ya tienes ${activeCount} de ${policy.maxActive} ofertas activas permitidas. Desactiva una antes de activar otra.`,
      400
    );
  }
}

// Bloque 52: sin cron aparte, mismo criterio que expireStaleOffers en
// offers.controller.js — cualquier lectura (pública o del panel) vence en
// caliente las que ya pasaron su expiresAt. Si el código fue creado
// EXCLUSIVO para la oferta, se desactiva junto con ella (ver
// discountCodeExclusive en schema.prisma); uno reusado nunca se toca acá.
export async function expireStaleStoreOffers() {
  const toExpire = await prisma.storeOffer.findMany({
    where: { active: true, isLimitedTime: true, expiresAt: { not: null, lt: new Date() } },
    select: { id: true, discountCodeId: true, discountCodeExclusive: true },
  });
  if (toExpire.length === 0) return;

  await prisma.storeOffer.updateMany({ where: { id: { in: toExpire.map((o) => o.id) } }, data: { active: false } });

  const exclusiveCodeIds = toExpire.filter((o) => o.discountCodeExclusive).map((o) => o.discountCodeId);
  if (exclusiveCodeIds.length > 0) {
    await prisma.discountCode.updateMany({ where: { id: { in: exclusiveCodeIds } }, data: { active: false } });
  }
}

export async function listMyStoreOffers(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  await expireStaleStoreOffers();
  // Si la tienda cambió de plan por un camino que no recalcula las ofertas, se ajustan aquí antes de mostrarlas, así el
  // contador "activas" del panel coincide con lo que de verdad se publica.
  await recalcVendorStoreOffers(vendor.id);
  const storeOffers = await prisma.storeOffer.findMany({
    where: { vendorId: vendor.id },
    orderBy: { createdAt: "desc" },
    select: storeOfferPanelSelect,
  });
  res.json({ storeOffers });
}

const createStoreOfferSchema = z.object({
  title: z.string().trim().min(2, "El título es obligatorio."),
  description: z.string().trim().max(500).optional().nullable(),
  discountCodeId: z.string().min(1, "Elige o crea un código de descuento."),
  isLimitedTime: boolish.default(false),
  // Bloque 232: ambas opcionales, solo tienen efecto real con isLimitedTime.
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  // true si discountCodeId se creó desde "Crear código nuevo para esta
  // oferta" — informativo para el auto-apagado al vencer (ver
  // expireStaleStoreOffers). Nunca se fuerza server-side, es una elección
  // del vendedor reflejada tal cual la mandó el frontend.
  discountCodeExclusive: boolish.default(false),
  // Bloque 232 (pedido explícito — "se podrán crear una oferta o varias...
  // pero solo se podrá mantener una oferta activa"): antes toda oferta
  // nacía activa sin excepción — ahora el vendedor puede crearla como
  // borrador (active:false) para dejarla lista sin que cuente contra su
  // límite todavía.
  active: boolish.default(true),
});

export async function createStoreOffer(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  // Bloque 66 (pedido explícito): ofertas de tienda solo para tiendas
  // verificadas — mismo gate que ya usa createOffer (offers.controller.js).
  // Junto con el plan vive en assertCanPublishStoreOffers, que también usa
  // updateStoreOffer al reactivar: antes solo se miraba aquí.
  await assertCanPublishStoreOffers(vendor);
  const data = createStoreOfferSchema.parse(req.body);

  if (data.isLimitedTime && !data.expiresAt) {
    throw new AppError("Una oferta por tiempo limitado necesita fecha/hora de vencimiento.", 400);
  }
  if (data.isLimitedTime && data.startsAt && data.expiresAt && new Date(data.startsAt) >= new Date(data.expiresAt)) {
    throw new AppError("La fecha de inicio debe ser anterior a la de vencimiento.", 400);
  }
  if (data.active) await assertActiveOfferLimit(vendor);

  const discountCode = await prisma.discountCode.findUnique({ where: { id: data.discountCodeId } });
  if (!discountCode || discountCode.vendorId !== vendor.id) throw new AppError("Código de descuento no encontrado.", 404);
  if (data.active) assertCodeNotSuspended(discountCode);

  const storeOffer = await prisma.storeOffer.create({
    data: {
      vendorId: vendor.id,
      title: data.title,
      description: data.description || null,
      discountCodeId: data.discountCodeId,
      isLimitedTime: data.isLimitedTime,
      startsAt: data.isLimitedTime && data.startsAt ? new Date(data.startsAt) : null,
      expiresAt: data.isLimitedTime ? new Date(data.expiresAt) : null,
      discountCodeExclusive: data.isLimitedTime ? data.discountCodeExclusive : false,
      active: data.active,
    },
    select: storeOfferPanelSelect,
  });
  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "store_offer_created",
    description: `Creó la oferta de tienda "${storeOffer.title}"`,
    meta: { storeOfferId: storeOffer.id },
  });
  res.status(201).json({ storeOffer });
}

const updateStoreOfferSchema = z.object({
  title: z.string().trim().min(2).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  discountCodeId: z.string().optional(),
  isLimitedTime: boolish.optional(),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  discountCodeExclusive: boolish.optional(),
  // Retirar/reactivar manualmente — independiente del auto-vencimiento.
  active: boolish.optional(),
});

export async function updateStoreOffer(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;
  const data = updateStoreOfferSchema.parse(req.body);

  const existing = await prisma.storeOffer.findUnique({ where: { id } });
  if (!existing || existing.vendorId !== vendor.id) throw new AppError("Oferta no encontrada.", 404);

  const patch = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.description !== undefined) patch.description = data.description || null;
  const turningOn = data.active === true && !existing.active;
  if (data.active !== undefined) {
    if (turningOn) {
      // Lo que el admin suspendió solo lo reactiva el admin: antes la tienda
      // lo volvía a encender desde aquí y la moderación no duraba.
      if (existing.suspendedAt) throw new AppError("El equipo de la plataforma suspendió esta oferta, así que no puedes reactivarla. Si crees que es un error, escríbenos.", 403);
      // Las mismas puertas que al crear (verificación y plan): sin esto, una
      // tienda que bajó de plan reactivaba las ofertas que ya tenía.
      await assertCanPublishStoreOffers(vendor);
      // Bloque 232: el límite solo aplica al ENCENDER — apagar siempre está
      // permitido, y volver a prender la MISMA oferta no debe contarse a sí
      // misma contra su propio cupo (excludeId).
      await assertActiveOfferLimit(vendor, id);
    }
    patch.active = data.active;
  }

  if (data.discountCodeId !== undefined || turningOn) {
    const discountCode = await prisma.discountCode.findUnique({ where: { id: data.discountCodeId ?? existing.discountCodeId } });
    if (!discountCode || discountCode.vendorId !== vendor.id) throw new AppError("Código de descuento no encontrado.", 404);
    // Encendida (o por encenderse) no puede quedar con un código suspendido.
    if (patch.active ?? existing.active) assertCodeNotSuspended(discountCode);
    if (data.discountCodeId !== undefined) patch.discountCodeId = data.discountCodeId;
  }

  const isLimitedTime = data.isLimitedTime !== undefined ? data.isLimitedTime : existing.isLimitedTime;
  if (data.isLimitedTime !== undefined) patch.isLimitedTime = data.isLimitedTime;
  if (isLimitedTime) {
    const expiresAtInput = data.expiresAt ?? (existing.expiresAt ? existing.expiresAt.toISOString() : undefined);
    if (!expiresAtInput) throw new AppError("Una oferta por tiempo limitado necesita fecha/hora de vencimiento.", 400);
    const startsAtInput = data.startsAt ?? (existing.startsAt ? existing.startsAt.toISOString() : undefined);
    if (startsAtInput && new Date(startsAtInput) >= new Date(expiresAtInput)) {
      throw new AppError("La fecha de inicio debe ser anterior a la de vencimiento.", 400);
    }
    if (data.startsAt !== undefined) patch.startsAt = data.startsAt ? new Date(data.startsAt) : null;
    if (data.expiresAt !== undefined) patch.expiresAt = new Date(data.expiresAt);
    if (data.discountCodeExclusive !== undefined) patch.discountCodeExclusive = data.discountCodeExclusive;
  } else if (data.isLimitedTime !== undefined) {
    patch.startsAt = null;
    patch.expiresAt = null;
    patch.discountCodeExclusive = false;
  }

  const storeOffer = await prisma.storeOffer.update({ where: { id }, data: patch, select: storeOfferPanelSelect });
  res.json({ storeOffer });
}

// --- Admin (auditoría de seguridad) -----------------------------------------
// Antes no existía ninguna supervisión de admin sobre las ofertas de tienda
// (distinto de Offer/Home, que sí tiene adminOffers.controller.js) — un
// admin no tenía forma de suspender una oferta abusiva de un vendedor sin
// entrar a Prisma Studio. Suspender apaga `active` y además marca
// suspendedAt: antes solo apagaba `active`, el mismo campo que la tienda
// enciende al reactivar, y la oferta volvía a la tienda al minuto.

export async function listAllStoreOffersAdmin(_req, res) {
  await expireStaleStoreOffers();
  const storeOffers = await prisma.storeOffer.findMany({
    orderBy: { createdAt: "desc" },
    select: { ...storeOfferPanelSelect, vendor: { select: { id: true, companyName: true, slug: true } } },
  });
  res.json({ storeOffers });
}

// active:false suspende (con un motivo opcional que ve la tienda); active:true
// quita la suspensión. Quitarla no vuelve a publicar la oferta: queda apagada
// y la tienda decide si la reactiva, pasando por su plan y su tope como
// cualquier otra (el admin no publica ofertas en nombre de la tienda).
const adminSetActiveSchema = z.object({ active: z.boolean(), reason: z.string().trim().max(300).optional().nullable() });

export async function setStoreOfferActiveAdmin(req, res) {
  const { id } = req.params;
  const { active, reason } = adminSetActiveSchema.parse(req.body);

  const existing = await prisma.storeOffer.findUnique({ where: { id } });
  if (!existing) throw new AppError("Oferta no encontrada.", 404);

  const data = active
    ? { suspendedAt: null, suspendedReason: null }
    : { active: false, suspendedAt: existing.suspendedAt ?? new Date(), suspendedReason: reason || null };
  const storeOffer = await prisma.storeOffer.update({ where: { id }, data, select: storeOfferPanelSelect });

  // Solo se registra y se avisa cuando cambia algo (suspender lo ya suspendido solo actualiza el motivo).
  if (active ? !!existing.suspendedAt : !existing.suspendedAt) {
    logActivity({
      actorId: req.user.id,
      actorRole: "ADMIN",
      vendorId: existing.vendorId,
      action: active ? "store_offer_unsuspended" : "store_offer_suspended",
      description: active ? `Quitó la suspensión de la oferta "${existing.title}"` : `Suspendió la oferta "${existing.title}"${reason ? `: ${reason}` : ""}`,
      meta: { storeOfferId: id },
    });
    await adminNoticeToVendor(
      existing.vendorId,
      active ? "Tu oferta ya no está suspendida" : "Suspendimos una oferta de tu tienda",
      active
        ? `Quitamos la suspensión de la oferta "${existing.title}". Sigue apagada: puedes volver a publicarla desde Ofertas y códigos.`
        : `La oferta "${existing.title}" ya no se muestra en tu tienda${reason ? `. Motivo: ${reason}` : ""}. Si crees que es un error, contacta al equipo de la plataforma.`
    );
  }
  res.json({ storeOffer });
}
