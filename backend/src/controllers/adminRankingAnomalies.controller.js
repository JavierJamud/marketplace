import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

// Bloque 229 (Fase 2 del blindaje del ranking — pedido explícito:
// "visibilidad para el admin... solo levanta bandera, no decide, encaja con
// tu máquina de estados de Report"): mismo criterio de 3 acciones que
// adminReports.controller.js (PENDING -> DISMISSED/ACTIONED), pero sin
// aplicar ninguna consecuencia automática — a diferencia de un Report
// confirmado, acá "ACTIONED" solo documenta que el admin YA actuó a mano en
// otro lado (Tiendas/Productos/Comentarios), esta tabla nunca lo hace ella
// sola.

const ANOMALY_INCLUDE = {
  product: { select: { id: true, name: true, slug: true, vendor: { select: { id: true, companyName: true, slug: true } } } },
  vendor: { select: { id: true, companyName: true, slug: true } },
  reviewedBy: { select: { id: true, fullName: true } },
};

export async function listRankingAnomalies(req, res) {
  const { status, kind } = req.query;
  const anomalies = await prisma.rankingAnomaly.findMany({
    where: {
      ...(status ? { status: String(status) } : undefined),
      ...(kind ? { kind: String(kind) } : undefined),
    },
    include: ANOMALY_INCLUDE,
    orderBy: { detectedAt: "desc" },
  });
  res.json({ anomalies });
}

// Mismo criterio que getFraudReportsPendingCount — badge de la campanita.
export async function getRankingAnomaliesPendingCount(_req, res) {
  const count = await prisma.rankingAnomaly.count({ where: { status: "PENDING" } });
  res.json({ count });
}

const reviewSchema = z.object({ reviewNote: z.string().trim().max(500).optional() });

export async function dismissRankingAnomaly(req, res) {
  const { id } = req.params;
  const { reviewNote } = reviewSchema.parse(req.body ?? {});
  const anomaly = await prisma.rankingAnomaly.findUnique({ where: { id } });
  if (!anomaly) throw new AppError("Anomalía no encontrada.", 404);
  if (anomaly.status !== "PENDING") throw new AppError("Esta anomalía ya fue revisada.", 400);

  const updated = await prisma.rankingAnomaly.update({
    where: { id },
    data: { status: "DISMISSED", reviewedById: req.user.id, reviewedAt: new Date(), reviewNote: reviewNote || null },
    include: ANOMALY_INCLUDE,
  });
  res.json({ anomaly: updated });
}

export async function actionRankingAnomaly(req, res) {
  const { id } = req.params;
  const { reviewNote } = reviewSchema.parse(req.body ?? {});
  const anomaly = await prisma.rankingAnomaly.findUnique({ where: { id } });
  if (!anomaly) throw new AppError("Anomalía no encontrada.", 404);
  if (anomaly.status !== "PENDING") throw new AppError("Esta anomalía ya fue revisada.", 400);

  const updated = await prisma.rankingAnomaly.update({
    where: { id },
    data: { status: "ACTIONED", reviewedById: req.user.id, reviewedAt: new Date(), reviewNote: reviewNote || null },
    include: ANOMALY_INCLUDE,
  });
  res.json({ anomaly: updated });
}
