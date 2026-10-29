import crypto from "node:crypto";
import { env } from "../config/env.js";
import { prisma } from "./prisma.js";

// Enlace para dejar de recibir recordatorios (carrito, puntos, ofertas) sin iniciar sesión. La firma ata el enlace a la cuenta:
// nadie puede apagar los correos de otra persona cambiando el id en la URL.
function sign(userId) {
  return crypto.createHmac("sha256", env.jwtSecret).update(`marketing-unsubscribe:${userId}`).digest("hex").slice(0, 32);
}

export function unsubscribeUrl(userId) {
  return `${env.frontendUrl}/correos/baja?u=${encodeURIComponent(userId)}&t=${sign(userId)}`;
}

export function verifyUnsubscribe(userId, token) {
  if (typeof userId !== "string" || typeof token !== "string" || token.length !== 32) return false;
  const expected = Buffer.from(sign(userId));
  const given = Buffer.from(token);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// Correos automáticos de tiendas al cliente (recordatorios de carrito y puntos, re-enganche): nunca más de uno cada 3 días
// por persona, sea de la tienda que sea. Viven aquí y no en cada job para que todos cuenten contra el mismo plazo.
const DAY = 24 * 60 * 60 * 1000;
export const MIN_GAP_BETWEEN_MARKETING_EMAILS = 3 * DAY;

export function canSendMarketingEmail(user, now = Date.now()) {
  return !user.lastMarketingEmailAt || now - user.lastMarketingEmailAt.getTime() >= MIN_GAP_BETWEEN_MARKETING_EMAILS;
}

export async function markMarketingEmailSent(userId, at = new Date()) {
  await prisma.user.update({ where: { id: userId }, data: { lastMarketingEmailAt: at } });
}
