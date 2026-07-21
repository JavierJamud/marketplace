import { prisma } from "../lib/prisma.js";

// Bloque 33: panel de Admin > Errores — único lugar donde se ve el detalle
// técnico real de una falla (mensaje de excepción, código de estado,
// contexto). "origin" llega como lista separada por coma (ej.
// "BOT_TIENDA,BOT_GENERAL" para el filtro "Solo bots" del frontend) — el
// backend no necesita saber nada de los grupos de filtro de la UI, solo
// filtra por los valores de ErrorOrigin que le llegan.
export async function listErrorLogs(req, res) {
  const origins = typeof req.query.origin === "string" && req.query.origin.length ? req.query.origin.split(",") : undefined;
  const resolvedParam = req.query.resolved;

  const errors = await prisma.errorLog.findMany({
    where: {
      origin: origins ? { in: origins } : undefined,
      resolved: resolvedParam === "true" ? true : resolvedParam === "false" ? false : undefined,
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  res.json({ errors });
}

// Badge de la barra lateral de Admin (AdminLayout.jsx) — endpoint liviano
// aparte de listErrorLogs para no traer 300 mensajes/contextos completos
// solo para mostrar un número.
export async function getUnresolvedErrorCount(_req, res) {
  const count = await prisma.errorLog.count({ where: { resolved: false } });
  res.json({ count });
}

// Nunca se borra un error — solo se marca, mantiene el historial completo
// (mismo criterio que AdminSuggestions "Marcar como revisada").
export async function resolveErrorLog(req, res) {
  const { id } = req.params;
  const error = await prisma.errorLog.update({ where: { id }, data: { resolved: true } });
  res.json({ error });
}
