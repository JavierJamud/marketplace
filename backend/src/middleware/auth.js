import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { prisma } from "../lib/prisma.js";
import { isSessionIdle, revokeSession, touchSession, IDLE_MESSAGE } from "../lib/sessionPolicy.js";

// Bloque 60: además de verificar firma/expiración del JWT, ahora valida el
// claim `sid` (id de la Session, ver auth.controller.js/createSession)
// contra la DB — antes un access token seguía siendo válido hasta su
// vencimiento natural (hasta 1h) sin importar que la sesión ya se hubiera
// cerrado/revocado ("cerrar sesión", "cerrar en todos los dispositivos",
// expiración por inactividad). Con este chequeo, una revocación tiene
// efecto inmediato en el próximo request, no solo cuando el token expira
// solo. Es un lookup por primary key por request (barato) — trade-off
// correcto dado que "limpiar bien la sesión" fue un pedido explícito.
export async function authenticate(req, _res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new AppError("No autenticado.", 401);

  let payload;
  try {
    // `algorithms` fijo a propósito (auditoría de seguridad): sin esto,
    // jwt.verify() confía en el campo "alg" que venga DENTRO del token para
    // decidir cómo validarlo — acá la app firma todo con HS256 nada más,
    // así que cualquier token que declare un algoritmo distinto (incluido
    // "none") se rechaza de entrada, sin intentar validarlo siquiera.
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
  } catch {
    throw new AppError("Sesión inválida o expirada.", 401);
  }

  if (!payload.sid) throw new AppError("Sesión inválida o expirada.", 401);
  const session = await prisma.session.findUnique({ where: { id: payload.sid }, select: { id: true, revokedAt: true, expiresAt: true, lastUsedAt: true } });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
    throw new AppError("Sesión inválida o expirada.", 401);
  }
  if (isSessionIdle(session)) {
    await revokeSession(session.id);
    throw new AppError(IDLE_MESSAGE, 401, { reason: "idle" });
  }
  touchSession(session, payload.sub);

  // sid: la sesión de este inicio de sesión (sirve, por ejemplo, para que el asistente abra una conversación nueva en cada una).
  req.user = { id: payload.sub, role: payload.role, sid: payload.sid };
  next();
}

// Devuelve { id, role } si la petición trae un token de acceso de una sesión viva, o null (visitante).
// Mismo chequeo que `authenticate`: firma HS256, claim sid y sesión no revocada, no vencida, no inactiva y de
// esa misma cuenta. Los controladores con identidad opcional DEBEN usar esto y no jwt.verify directo: el token
// de reto 2FA y el de una sesión ya cerrada están firmados con el mismo secreto y no son una sesión.
export async function resolveSessionUser(req) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return null;
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
    if (!payload.sid || payload.purpose) return null;
    const session = await prisma.session.findUnique({ where: { id: payload.sid }, select: { id: true, userId: true, revokedAt: true, expiresAt: true, lastUsedAt: true } });
    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt.getTime() <= Date.now() || isSessionIdle(session)) return null;
    touchSession(session, payload.sub);
    return { id: payload.sub, role: payload.role };
  } catch {
    return null; // token inválido o vencido: se trata como visitante
  }
}

// Identifica a la persona SI trae una sesión válida, y sigue sin ella (visitante). Nunca responde 401.
export async function optionalAuth(req, _res, next) {
  const user = await resolveSessionUser(req);
  if (user) req.user = user;
  next();
}
