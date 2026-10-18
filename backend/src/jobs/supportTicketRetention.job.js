import cron from "node-cron";
import { join, basename } from "node:path";
import { unlink } from "node:fs/promises";
import { prisma } from "../lib/prisma.js";
import { TICKET_UPLOAD_DIR, TICKET_RETENTION_DAYS } from "../controllers/supportTickets.controller.js";

// Los tickets de errores visuales (fila, respuestas y la captura en disco) se borran por completo a los 90 días de creados,
// estén abiertos o cerrados. Corre una vez al día.
export async function purgeOldSupportTickets() {
  const cutoff = new Date(Date.now() - TICKET_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const old = await prisma.supportTicket.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true, screenshotFile: true } });
  if (!old.length) return { tickets: 0, files: 0 };
  let files = 0;
  for (const t of old) {
    if (!t.screenshotFile) continue;
    // Primero el archivo: si falla el borrado de la fila, mañana se reintenta y el archivo ya no está (no queda huérfano al revés).
    await unlink(join(TICKET_UPLOAD_DIR, basename(t.screenshotFile)))
      .then(() => files++)
      .catch((err) => {
        if (err.code !== "ENOENT") throw err;
      });
  }
  // Las respuestas se borran con su ticket (onDelete: Cascade).
  const { count } = await prisma.supportTicket.deleteMany({ where: { id: { in: old.map((t) => t.id) } } });
  return { tickets: count, files };
}

export function startSupportTicketRetentionJob() {
  cron.schedule("43 3 * * *", () => {
    purgeOldSupportTickets()
      .then((r) => {
        if (r.tickets) console.log("[supportTicketRetention]", r);
      })
      .catch((err) => console.error("[supportTicketRetention]", err.message));
  });
}
