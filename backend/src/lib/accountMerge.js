import { prisma } from "./prisma.js";
import { AppError } from "../utils/AppError.js";
import { finalizeUserDeletion } from "./accountDeletion.js";
import { logActivity } from "./activityLog.js";

// "Unir con su tienda" (admin > Clientes). Cliente y tienda son la misma cuenta desde 2026-10-29, pero quien se registró
// antes pudo quedar con dos: una de cliente y otra de tienda. Esto pasa lo de comprador de la cuenta de cliente (pedidos,
// direcciones, favoritos, puntos, reseñas, anuncios, reportes, mensajes, carrito) a la cuenta de la tienda y después elimina
// la de cliente con el registro de siempre (accountDeletion.js): el admin la sigue viendo con su correo real, y ese correo
// queda libre. Todo en una transacción: si algo falla no se mueve nada.
//
// No se mueve el historial de actividad de la cuenta vieja: queda en ella, que es lo que muestra "Ver historial".

const digits = (v) => String(v ?? "").replace(/\D/g, "");

// Cuentas de tienda que probablemente sean de la misma persona: mismo teléfono (WhatsApp de la tienda o de la cuenta),
// mismo nombre o la misma parte del correo antes de la @ (como cuando el admin cambió unos dígitos para liberarlo).
export async function findMergeCandidates(sourceId) {
  const source = await prisma.user.findUnique({ where: { id: sourceId }, select: { id: true, fullName: true, email: true, phone: true } });
  if (!source) return [];
  const d = digits(source.phone);
  const local = String(source.email ?? "").split("@")[0].replace(/\d+$/, "");
  const OR = [];
  if (d.length >= 7) OR.push({ phone: { in: [`+${d}`, d] } }, { vendor: { is: { whatsapp: { in: [`+${d}`, d] } } } });
  if (source.fullName?.trim()) OR.push({ fullName: { equals: source.fullName.trim(), mode: "insensitive" } });
  if (local.length >= 4) OR.push({ email: { startsWith: local, mode: "insensitive" } });
  if (!OR.length) return [];
  return prisma.user.findMany({
    where: { id: { not: source.id }, role: "VENDOR", deletedAt: null, vendor: { is: { deletedAt: null } }, OR },
    select: { id: true, fullName: true, email: true, phone: true, vendor: { select: { id: true, companyName: true, slug: true, whatsapp: true } } },
    take: 5,
  });
}

// Lo que se va a mover, para mostrarlo antes de confirmar.
export async function mergeSummary(sourceId) {
  const [orders, addresses, favorites, reviews, listings, loyalty] = await Promise.all([
    prisma.order.count({ where: { customerId: sourceId } }),
    prisma.address.count({ where: { userId: sourceId } }),
    prisma.favorite.count({ where: { userId: sourceId } }),
    prisma.review.count({ where: { userId: sourceId } }),
    prisma.customerListing.count({ where: { ownerId: sourceId } }),
    prisma.loyaltyAccount.aggregate({ where: { userId: sourceId }, _sum: { balance: true }, _count: true }),
  ]);
  return { orders, addresses, favorites, reviews, listings, loyaltyStores: loyalty._count, loyaltyPoints: loyalty._sum.balance ?? 0 };
}

async function assertMergeable(sourceId, targetId) {
  if (sourceId === targetId) throw new AppError("Elige una cuenta de tienda distinta.", 400);
  const [source, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: sourceId }, include: { vendor: true, vendorStaffProfile: true, partnerAccount: true } }),
    prisma.user.findUnique({ where: { id: targetId }, include: { vendor: true } }),
  ]);
  if (!source || source.deletedAt || source.role !== "CUSTOMER") throw new AppError("Cliente no encontrado.", 404);
  if (source.vendor || source.vendorStaffProfile || source.partnerAccount) throw new AppError("Esta cuenta tiene una tienda, es personal de una tienda o es socio: no se puede unir.", 409);
  if (!target || target.deletedAt || target.role !== "VENDOR" || !target.vendor || target.vendor.deletedAt) {
    throw new AppError("La cuenta elegida no es de una tienda activa.", 409);
  }
  // Un cliente en la lista negra no pasa sus datos a otra cuenta: primero se revisa esa sanción.
  if (await prisma.blacklistEntry.findFirst({ where: { userId: sourceId }, select: { id: true } })) {
    throw new AppError("Este cliente está en la lista negra. Quítalo de la lista negra antes de unirlo.", 409);
  }
  return { source, target };
}

export async function mergeCustomerIntoVendorAccount(sourceId, targetId, { byId }) {
  const { source, target } = await assertMergeable(sourceId, targetId);
  const summary = await mergeSummary(sourceId);
  const from = { userId: sourceId };
  const to = { userId: targetId };

  await prisma.$transaction(async (tx) => {
    // Filas con clave única por cuenta: si la tienda ya tiene la misma, se queda la suya y la vieja se descarta (o se suma).
    const favs = await tx.favorite.findMany({ where: to, select: { productId: true, vendorId: true } });
    const favProducts = favs.map((f) => f.productId).filter(Boolean);
    const favVendors = favs.map((f) => f.vendorId).filter(Boolean);
    await tx.favorite.deleteMany({ where: { userId: sourceId, OR: [{ productId: { in: favProducts } }, { vendorId: { in: favVendors } }] } });
    await tx.favorite.updateMany({ where: from, data: to });

    // Puntos: en la misma tienda se suman en una sola cuenta de puntos, con todos sus movimientos.
    const oldAccounts = await tx.loyaltyAccount.findMany({ where: from });
    for (const acc of oldAccounts) {
      const existing = await tx.loyaltyAccount.findUnique({ where: { vendorId_userId: { vendorId: acc.vendorId, userId: targetId } } });
      if (!existing) {
        await tx.loyaltyAccount.update({ where: { id: acc.id }, data: to });
        continue;
      }
      await tx.loyaltyTransaction.updateMany({ where: { accountId: acc.id }, data: { accountId: existing.id } });
      await tx.loyaltyAccount.update({
        where: { id: existing.id },
        data: {
          balance: { increment: acc.balance },
          lifetimeEarned: { increment: acc.lifetimeEarned },
          lifetimeRedeemed: { increment: acc.lifetimeRedeemed },
        },
      });
      await tx.loyaltyAccount.delete({ where: { id: acc.id } });
    }

    // Visitas a tiendas: en la misma tienda se suman.
    const visits = await tx.storeVisit.findMany({ where: from });
    for (const v of visits) {
      const existing = await tx.storeVisit.findUnique({ where: { userId_vendorId: { userId: targetId, vendorId: v.vendorId } } });
      if (existing) {
        await tx.storeVisit.update({
          where: { userId_vendorId: { userId: targetId, vendorId: v.vendorId } },
          data: { visits: { increment: v.visits }, firstAt: v.firstAt < existing.firstAt ? v.firstAt : existing.firstAt, lastAt: v.lastAt > existing.lastAt ? v.lastAt : existing.lastAt },
        });
        await tx.storeVisit.delete({ where: { userId_vendorId: { userId: sourceId, vendorId: v.vendorId } } });
      } else {
        await tx.storeVisit.update({ where: { userId_vendorId: { userId: sourceId, vendorId: v.vendorId } }, data: to });
      }
    }

    // Ofertas vistas y correos de "vuelve" ya enviados: si los dos los tienen, basta con el de la tienda.
    const seen = (await tx.targetedOfferView.findMany({ where: to, select: { targetedOfferId: true } })).map((r) => r.targetedOfferId);
    await tx.targetedOfferView.deleteMany({ where: { userId: sourceId, targetedOfferId: { in: seen } } });
    await tx.targetedOfferView.updateMany({ where: from, data: to });
    const winback = await tx.winbackEmailLog.findMany({ where: { customerId: targetId }, select: { vendorId: true, offerId: true } });
    for (const w of winback) await tx.winbackEmailLog.deleteMany({ where: { customerId: sourceId, vendorId: w.vendorId, offerId: w.offerId } });
    await tx.winbackEmailLog.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });

    // Carrito guardado: uno por cuenta. Se queda el de la tienda si ya tiene uno.
    const targetCart = await tx.cartSnapshot.findUnique({ where: { userId: targetId }, select: { userId: true } });
    if (targetCart) await tx.cartSnapshot.deleteMany({ where: from });
    else await tx.cartSnapshot.updateMany({ where: from, data: to });

    // El resto no tiene clave única por cuenta: pasa tal cual.
    await tx.order.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
    await tx.address.updateMany({ where: from, data: to });
    await tx.review.updateMany({ where: from, data: to });
    await tx.customerListing.updateMany({ where: { ownerId: sourceId }, data: { ownerId: targetId } });
    await tx.report.updateMany({ where: { reporterId: sourceId }, data: { reporterId: targetId } });
    await tx.report.updateMany({ where: { targetOwnerId: sourceId }, data: { targetOwnerId: targetId } });
    await tx.vendorMessage.updateMany({ where: { senderId: sourceId }, data: { senderId: targetId } });
    await tx.vendorEngagement.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
    await tx.productRequest.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
    await tx.marketplaceChatMessage.updateMany({ where: from, data: to });
    await tx.chatQuestionLog.updateMany({ where: from, data: to });
    await tx.supportTicket.updateMany({ where: { reporterId: sourceId }, data: { reporterId: targetId } });
    await tx.supportTicketMessage.updateMany({ where: { authorId: sourceId }, data: { authorId: targetId } });
    await tx.suggestion.updateMany({ where: { authorId: sourceId }, data: { authorId: targetId } });
    await tx.targetedOffer.updateMany({ where: { targetUserId: sourceId }, data: { targetUserId: targetId } });
    await tx.pushSubscription.updateMany({ where: from, data: to });
    await tx.appInstall.updateMany({ where: from, data: to });

    // Datos de contacto y ubicación: solo se completan los que la cuenta de la tienda no tiene.
    const fill = {};
    for (const f of ["phone", "address", "provinceId", "municipalityId", "municipalityOther", "stateOther", "registrationCountryId", "registrationCountryOther"]) {
      if (!target[f] && source[f]) fill[f] = source[f];
    }
    if (Object.keys(fill).length) await tx.user.update({ where: { id: targetId }, data: fill });
    // El teléfono pasa a la cuenta de la tienda: se quita de la vieja para que no quede repetido entre dos cuentas.
    await tx.user.update({ where: { id: sourceId }, data: { phone: null } });
  });

  // La cuenta vieja se elimina con el registro de siempre (sesiones cortadas, correo real guardado para el admin).
  const reason = `Unida con la cuenta de su tienda ${target.vendor.companyName} (${target.email}).`;
  await finalizeUserDeletion(sourceId, { source: "ADMIN_MERGE", byId, reason });
  await logActivity({
    actorId: byId,
    actorRole: "ADMIN",
    vendorId: target.vendor.id,
    action: "CUSTOMER_MERGED",
    description: `Cuenta de cliente ${source.email} unida con la cuenta de la tienda ${target.vendor.companyName}.`,
    meta: { sourceId, sourceEmail: source.email, targetId, ...summary },
  });
  return { summary, target: { id: target.id, email: target.email, companyName: target.vendor.companyName } };
}
