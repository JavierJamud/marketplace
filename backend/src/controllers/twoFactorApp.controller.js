import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { generateTotpSecret, verifyTotp, otpauthUrl } from "../lib/totp.js";
import { getBrandSettings } from "./settings.controller.js";

// Bloque 273 (pedido explícito): activar, confirmar y desactivar la verificación en dos pasos
// con una app autenticadora. Es genérico por rol (cliente, vendedor y admin usan la misma
// tabla User). El segundo paso del LOGIN vive en auth.controller.js.

export const encryptTotp = (secret) => JSON.stringify(encryptSecret(secret));
export const decryptTotp = (stored) => decryptSecret(JSON.parse(stored));

// Tope de intentos fallidos por cuenta (en memoria): 5 cada 10 minutos. Un código de 6 dígitos
// tiene 1 millón de combinaciones; sin tope se podría adivinar a fuerza bruta. El bloqueo solo
// deja de ACEPTAR códigos de la app: nunca impide entrar con el código del correo ni desactivar
// con la contraseña, así un tercero que conozca el correo de alguien no puede dejarlo afuera
// fallando a propósito.
const MAX_FAILS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const fails = new Map();
export function isLocked(userId) {
  const f = fails.get(userId);
  return !!f && f.resetAt > Date.now() && f.count >= MAX_FAILS;
}
export function registerFail(userId) {
  const f = fails.get(userId);
  if (!f || f.resetAt <= Date.now()) fails.set(userId, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else f.count += 1;
}
export function clearFails(userId) {
  fails.delete(userId);
}

// Verifica un código TOTP de esta cuenta y, si es válido, registra el paso usado (anti-repetición).
export async function consumeTotpCode(user, code) {
  if (!user.totpSecretEnc || !user.totpEnabledAt || isLocked(user.id)) return false;
  const step = verifyTotp(decryptTotp(user.totpSecretEnc), code, user.totpLastStep);
  if (step == null) {
    registerFail(user.id);
    return false;
  }
  clearFails(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
  return true;
}

export async function status(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { totpEnabledAt: true } });
  res.json({ enabled: !!user?.totpEnabledAt, enabledAt: user?.totpEnabledAt ?? null });
}

// Paso 1: genera un secreto nuevo (todavía sin activar) y lo devuelve para armar el QR.
export async function setup(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new AppError("Usuario no encontrado.", 404);
  if (user.totpEnabledAt) throw new AppError("La verificación en dos pasos ya está activada.", 409);
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpPendingSecretEnc: encryptTotp(secret) } });
  const { siteName } = await getBrandSettings();
  res.json({ secret, otpauthUrl: otpauthUrl({ secret, account: user.email, issuer: siteName || "Baznova" }) });
}

const codeSchema = z.object({ code: z.string().trim().min(6).max(8) });

// Paso 2: la persona escribe el código que muestra su app; si coincide, queda activada.
export async function enable(req, res) {
  const { code } = codeSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user?.totpPendingSecretEnc) throw new AppError("Primero genera el código QR.", 400);
  if (isLocked(user.id)) throw new AppError("Demasiados intentos. Espera unos minutos e inténtalo de nuevo.", 429);
  const step = verifyTotp(decryptTotp(user.totpPendingSecretEnc), code, null);
  if (step == null) {
    registerFail(user.id);
    throw new AppError("El código no coincide. Revisa que la hora de tu teléfono sea automática e inténtalo de nuevo.", 400);
  }
  clearFails(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecretEnc: user.totpPendingSecretEnc, totpPendingSecretEnc: null, totpEnabledAt: new Date(), totpLastStep: step },
  });
  res.json({ enabled: true });
}

const disableSchema = z.object({ password: z.string().min(1, "Escribe tu contraseña."), code: z.string().trim().min(6).max(8) });

// Desactivar pide la contraseña Y un código: el de la app o, si se perdió el teléfono, el que se
// envía al correo (POST /auth/2fa/send-code).
export async function disable(req, res) {
  const { password, code } = disableSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user?.totpEnabledAt) throw new AppError("La verificación en dos pasos no está activada.", 400);
  if (!(await bcrypt.compare(password, user.passwordHash))) throw new AppError("La contraseña es incorrecta.", 401);
  const viaApp = await consumeTotpCode(user, code);
  const viaEmail =
    !viaApp && user.twoFactorCodeHash && user.twoFactorCodeExpiresAt && user.twoFactorCodeExpiresAt.getTime() > Date.now()
      ? await bcrypt.compare(String(code).trim(), user.twoFactorCodeHash)
      : false;
  if (!viaApp && !viaEmail) {
    registerFail(user.id);
    throw new AppError("El código es incorrecto o venció.", 400);
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecretEnc: null, totpPendingSecretEnc: null, totpEnabledAt: null, totpLastStep: null, twoFactorCodeHash: null, twoFactorCodeExpiresAt: null },
  });
  res.json({ enabled: false });
}
