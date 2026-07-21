import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { sendPasswordResetEmail } from "../lib/email.js";

function signTokens(user) {
  const accessToken = jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, { expiresIn: "1h" });
  const refreshToken = jwt.sign({ sub: user.id }, env.jwtRefreshSecret, { expiresIn: "30d" });
  return { accessToken, refreshToken };
}

function publicUser(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

// E.164 laxo (+5355512345) — el frontend siempre arma el string completo con
// PhoneInput/toE164(), esto es solo una validación de forma del lado servidor.
const E164_REGEX = /^\+\d{7,15}$/;

// Bloque 11: todos los campos de creación de cuenta son obligatorios (antes
// phone/country quedaban opcionales) — validado acá y en el frontend.
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  phone: z.string().regex(E164_REGEX, "El teléfono debe incluir código de país (ej. +5355512345)."),
  country: z.string().length(2),
});

export async function register(req, res) {
  const data = registerSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new AppError("Ya existe una cuenta con ese correo.", 409);

  const passwordHash = await bcrypt.hash(data.password, 10);
  const user = await prisma.user.create({
    data: { email: data.email, passwordHash, fullName: data.fullName, phone: data.phone, country: data.country },
  });

  const tokens = signTokens(user);
  res.status(201).json({ user: publicUser(user), ...tokens });
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function login(req, res) {
  const data = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user) throw new AppError("Correo o contraseña incorrectos.", 401);

  const valid = await bcrypt.compare(data.password, user.passwordHash);
  if (!valid) throw new AppError("Correo o contraseña incorrectos.", 401);

  // isSuspended ya existía (Bloque 4, "Suspender" en AdminCustomers.jsx) pero
  // nunca se chequeaba acá — el botón no bloqueaba nada de verdad. Bloque 12
  // reusa este mismo flag para el soft-delete (deletedAt + isSuspended
  // juntos), así que este chequeo ahora es la pieza que realmente lo hace.
  if (user.isSuspended) throw new AppError("Esta cuenta no está disponible.", 403);

  const tokens = signTokens(user);
  res.json({ user: publicUser(user), ...tokens });
}

export async function me(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new AppError("Usuario no encontrado.", 404);
  res.json({ user: publicUser(user) });
}

const refreshSchema = z.object({ refreshToken: z.string() });

export async function refresh(req, res) {
  const { refreshToken } = refreshSchema.parse(req.body);
  let payload;
  try {
    payload = jwt.verify(refreshToken, env.jwtRefreshSecret);
  } catch {
    throw new AppError("Refresh token inválido o expirado.", 401);
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) throw new AppError("Usuario no encontrado.", 404);

  const accessToken = jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, { expiresIn: "1h" });
  res.json({ accessToken });
}

// --- Reset de contraseña por código (cliente, vendedor y admin comparten la
// misma tabla User/flujo — no hay un sistema paralelo por rol) -------------

const RESET_CODE_LENGTH = 6;
const RESET_CODE_TTL_MINUTES = 15;

function generateResetCode() {
  return String(Math.floor(Math.random() * 10 ** RESET_CODE_LENGTH)).padStart(RESET_CODE_LENGTH, "0");
}

async function isResetCodeValid(user, code) {
  if (!user || !user.resetCodeHash || !user.resetCodeExpiresAt) return false;
  if (user.resetCodeExpiresAt.getTime() < Date.now()) return false;
  return bcrypt.compare(code, user.resetCodeHash);
}

const forgotPasswordSchema = z.object({ email: z.string().email() });

// Respuesta siempre genérica — nunca revela si el correo existe (evita
// enumeración de cuentas). El código real solo se genera/envía si sí existe.
export async function forgotPassword(req, res) {
  const { email } = forgotPasswordSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    const code = generateResetCode();
    const resetCodeHash = await bcrypt.hash(code, 10);
    const resetCodeExpiresAt = new Date(Date.now() + RESET_CODE_TTL_MINUTES * 60 * 1000);
    await prisma.user.update({ where: { id: user.id }, data: { resetCodeHash, resetCodeExpiresAt } });
    await sendPasswordResetEmail(user, code);
  }

  res.json({ ok: true, message: "Si ese correo tiene una cuenta, enviamos un código de verificación." });
}

const verifyResetCodeSchema = z.object({ email: z.string().email(), code: z.string().length(RESET_CODE_LENGTH) });

// Chequeo previo (no consume el código) para dar feedback inmediato en el
// paso 2 del flujo antes de mostrarle al usuario los campos de contraseña
// nueva — la validación real y definitiva se repite en resetPassword.
export async function verifyResetCode(req, res) {
  const { email, code } = verifyResetCodeSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await isResetCodeValid(user, code);
  if (!valid) throw new AppError("Código inválido o vencido.", 400);
  res.json({ valid: true });
}

const resetPasswordSchema = z
  .object({
    email: z.string().email(),
    code: z.string().length(RESET_CODE_LENGTH),
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { message: "Las contraseñas no coinciden.", path: ["confirmPassword"] });

export async function resetPassword(req, res) {
  const data = resetPasswordSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email: data.email } });
  const valid = await isResetCodeValid(user, data.code);
  if (!valid) throw new AppError("Código inválido o vencido.", 400);

  const passwordHash = await bcrypt.hash(data.newPassword, 10);
  // El código se invalida al usarlo — no se puede reutilizar para un segundo reset.
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, resetCodeHash: null, resetCodeExpiresAt: null } });

  res.json({ ok: true });
}
