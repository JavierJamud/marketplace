import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { prisma } from "../lib/prisma.js";

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
  const session = await prisma.session.findUnique({ where: { id: payload.sid }, select: { revokedAt: true, expiresAt: true } });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
    throw new AppError("Sesión inválida o expirada.", 401);
  }

  req.user = { id: payload.sub, role: payload.role };
  next();
}
