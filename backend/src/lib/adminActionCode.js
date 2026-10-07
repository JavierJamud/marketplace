import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";
import { sendAdminDirectEmail } from "./email.js";
import { AppError } from "../utils/AppError.js";

// Bloque 272 (pedido explícito): las acciones sensibles del admin (eliminar una tienda
// o un cliente de forma definitiva, cambiar claves de integraciones o ajustes de
// seguridad) piden un código de un solo uso enviado al correo del propio admin.
// El código es de UNA acción concreta: uno pedido para borrar una tienda no sirve para
// cambiar una clave. Dura 10 minutos, se guarda solo su hash y se bloquea tras 5 intentos.

export const ACTION_LABELS = {
  DELETE_VENDOR_PERMANENT: "eliminar una tienda de forma definitiva",
  DELETE_CUSTOMER: "eliminar un cliente",
  CHANGE_INTEGRATION_KEY: "cambiar una clave de integración",
  CHANGE_SECURITY_SETTINGS: "cambiar los ajustes de seguridad",
  DISABLE_ADMIN_2FA: "desactivar la verificación en dos pasos",
};

const CODE_LENGTH = 6;
const TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

export async function sendActionCode(user, action) {
  if (!ACTION_LABELS[action]) throw new AppError("Acción no reconocida.", 400);
  const last = await prisma.adminActionCode.findFirst({ where: { userId: user.id, action }, orderBy: { createdAt: "desc" } });
  if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new AppError("Espera unos segundos antes de pedir otro código.", 429);
  }
  const code = String(Math.floor(Math.random() * 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
  await prisma.adminActionCode.create({ data: { userId: user.id, action, codeHash: await bcrypt.hash(code, 10), expiresAt: new Date(Date.now() + TTL_MS) } });
  const result = await sendAdminDirectEmail({
    to: user.email,
    recipientName: user.fullName,
    subject: `Código de confirmación: ${ACTION_LABELS[action]}`,
    message:
      `Tu código para confirmar la acción "${ACTION_LABELS[action]}" es:\n\n${code}\n\n` +
      "Vence en 10 minutos y sirve una sola vez. Si no fuiste tú, ignora este mensaje y cambia tu contraseña.",
  });
  if (!result?.ok) {
    // Mismo criterio que el código de login: si el correo no pudo salir, el código queda
    // en el registro del servidor para que el dueño de la infraestructura pueda leerlo.
    console.warn(`[adminActionCode] No se pudo enviar el correo (${result?.error}) — código para ${user.email} (${action}): ${code}`);
  }
  return { expiresAt: new Date(Date.now() + TTL_MS) };
}

export async function verifyActionCode(userId, action, code) {
  const row = await prisma.adminActionCode.findFirst({ where: { userId, action, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!row || row.attempts >= MAX_ATTEMPTS) return false;
  const ok = await bcrypt.compare(String(code ?? "").trim(), row.codeHash);
  if (!ok) {
    await prisma.adminActionCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return false;
  }
  await prisma.adminActionCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return true;
}

// Middleware: exige el código (cabecera X-Action-Code) para ESTA acción. Sin código o con uno
// malo responde 403 con `code: "ACTION_CODE_REQUIRED"`, que el panel usa para pedirlo.
export function requireActionCode(action) {
  return async (req, res, next) => {
    const code = req.get("x-action-code");
    if (code && (await verifyActionCode(req.user.id, action, code))) return next();
    res.status(403).json({
      error: code ? "El código es incorrecto o venció." : `Confirma con el código enviado a tu correo para ${ACTION_LABELS[action]}.`,
      code: "ACTION_CODE_REQUIRED",
      action,
      label: ACTION_LABELS[action],
      wrong: !!code,
    });
  };
}
