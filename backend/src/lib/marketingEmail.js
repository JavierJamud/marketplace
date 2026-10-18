import crypto from "node:crypto";
import { env } from "../config/env.js";

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
