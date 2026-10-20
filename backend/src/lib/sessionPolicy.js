import { prisma } from "./prisma.js";

// Sin actividad durante 30 minutos la sesión se cierra: clientes, tiendas y admin por igual. El navegador avisa y cierra a
// los 30 minutos sin tocar la pantalla (AuthContext.jsx); esto cubre lo que el navegador no ve, como una pestaña cerrada o
// un teléfono apagado: el primer pedido después de 30 minutos sin ninguno ya no es aceptado.
export const SESSION_IDLE_MS = 30 * 60 * 1000;

// El navegador donde la persona ya puso el código de verificación no lo vuelve a pedir: solo correo y contraseña. La
// confianza se renueva con cada uso de la cuenta y vence a los 15 días sin actividad; ahí se pide el código otra vez (por
// correo o por la app autenticadora, según lo que tenga activado).
export const TRUSTED_DEVICE_TTL_MS = 15 * 24 * 60 * 60 * 1000;

// Una escritura por minuto como mucho por sesión, no una por cada pedido.
const TOUCH_EVERY_MS = 60 * 1000;

export const IDLE_MESSAGE = "Tu sesión se cerró porque pasaron 30 minutos sin actividad. Vuelve a iniciar sesión.";

export function isSessionIdle(session) {
  return Date.now() - new Date(session.lastUsedAt).getTime() > SESSION_IDLE_MS;
}

export async function revokeSession(id) {
  await prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
}

// Marca actividad de la sesión y, de paso, renueva los 15 días de confianza del navegador de esa cuenta.
export function touchSession(session, userId) {
  if (Date.now() - new Date(session.lastUsedAt).getTime() < TOUCH_EVERY_MS) return;
  const now = new Date();
  prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: now } }).catch(() => {});
  prisma.trustedDevice
    .updateMany({ where: { userId, expiresAt: { gt: now } }, data: { lastUsedAt: now, expiresAt: new Date(now.getTime() + TRUSTED_DEVICE_TTL_MS) } })
    .catch(() => {});
}
