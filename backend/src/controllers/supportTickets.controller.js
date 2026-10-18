import { z } from "zod";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { notifyAdmins } from "../lib/notify.js";
import { sendSupportTicketAdminEmail, sendSupportTicketReceiptEmail, sendSupportTicketUpdateEmail } from "../lib/email.js";

// Tickets de errores visuales (ver SupportTicket en schema.prisma). La tienda los crea desde el botón "Reportar un problema"
// de su panel; el admin los atiende desde Errores. Todo lo que manda el navegador se valida y se recorta: la consola y el
// registro de actividad son texto del cliente y se muestran al admin como dato, nunca se interpretan.

const __dirname = dirname(fileURLToPath(import.meta.url));
export const TICKET_UPLOAD_DIR = join(__dirname, "..", "..", "uploads", "tickets");
export const TICKET_RETENTION_DAYS = 90;

export const TICKET_STATUS_LABEL = {
  NEW: "Nuevo",
  IN_REVIEW: "En revisión",
  WAITING_REPORTER: "Esperando tu respuesta",
  RESOLVED: "Solucionado",
  CLOSED_NO_EVIDENCE: "Cerrado sin evidencia",
  CLOSED_NOT_A_BUG: "Cerrado: no es un error",
};
const CLOSED = new Set(["RESOLVED", "CLOSED_NO_EVIDENCE", "CLOSED_NOT_A_BUG"]);

export const ticketCode = (n) => `T-${String(n).padStart(5, "0")}`;

const text = (max) => z.string().max(max);
const consoleEntry = z.object({ level: z.enum(["log", "info", "warn", "error", "debug"]), text: text(600), at: text(40) });
const trailEntry = z.object({ kind: z.enum(["nav", "click", "api", "input"]), text: text(300), at: text(40) });
const deviceSchema = z
  .object({
    viewport: text(20).optional(),
    screen: text(20).optional(),
    pixelRatio: z.number().min(0).max(10).optional(),
    language: text(20).optional(),
    online: z.boolean().optional(),
    version: text(40).optional(),
    standalone: z.boolean().optional(),
  })
  .partial();

const createSchema = z.object({
  description: z.string().trim().min(10, "Cuenta el problema con más detalle (al menos 10 caracteres).").max(4000),
  pagePath: z.string().trim().min(1).max(300),
  section: z.string().trim().max(80).optional(),
  consoleLog: z.array(consoleEntry).max(200).optional(),
  activityTrail: z.array(trailEntry).max(80).optional(),
  device: deviceSchema.optional(),
});

// Los campos estructurados llegan como texto JSON dentro del formulario (la captura va en el mismo envío).
function parseJsonField(value) {
  if (value == null || value === "") return undefined;
  try {
    return JSON.parse(String(value));
  } catch {
    throw new AppError("Los datos del reporte llegaron incompletos. Prueba de nuevo.", 400);
  }
}

async function reporterContext(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true, role: true } });
  if (!user) throw new AppError("Sesión no válida.", 401);
  const vendor = await prisma.vendor.findFirst({
    where: { OR: [{ userId: user.id }, { staff: { some: { userId: user.id, isActive: true } } }] },
    select: { id: true, companyName: true },
  });
  if (!vendor) throw new AppError("Solo las tiendas pueden enviar estos reportes.", 403);
  return { user, vendor };
}

// POST /support-tickets (panel de la tienda): crea el ticket con la captura y avisa al admin al instante.
export async function createTicket(req, res) {
  const { user, vendor } = await reporterContext(req.user.id);
  const data = createSchema.parse({
    description: req.body.description,
    pagePath: req.body.pagePath,
    section: req.body.section || undefined,
    consoleLog: parseJsonField(req.body.consoleLog),
    activityTrail: parseJsonField(req.body.activityTrail),
    device: parseJsonField(req.body.device),
  });

  const ticket = await prisma.supportTicket.create({
    data: {
      vendorId: vendor.id,
      reporterId: user.id,
      reporterName: user.fullName,
      reporterEmail: user.email,
      reporterRole: user.role,
      pagePath: data.pagePath,
      section: data.section ?? null,
      description: data.description,
      screenshotFile: req.file?.filename ?? null,
      consoleLog: data.consoleLog ?? [],
      activityTrail: data.activityTrail ?? [],
      device: { ...(data.device ?? {}), userAgent: String(req.get("user-agent") ?? "").slice(0, 300) },
    },
  });
  const code = ticketCode(ticket.number);

  // Aviso en vivo y push al admin, y correo con la captura adjunta. Nada de esto frena la respuesta a la tienda.
  void notifyAdmins({
    category: "errors",
    title: `Ticket ${code}: problema en ${data.section ?? data.pagePath}`,
    body: `${vendor.companyName}: ${data.description.slice(0, 140)}`,
    url: `/admin/errores?tab=tickets&ticket=${ticket.id}`,
    tag: `ticket-${ticket.id}`,
  }).catch(() => {});
  void (async () => {
    const screenshot = ticket.screenshotFile ? await readFile(join(TICKET_UPLOAD_DIR, ticket.screenshotFile)).catch(() => null) : null;
    await sendSupportTicketAdminEmail({ ticket, code, vendorName: vendor.companyName, screenshot }).catch(() => {});
    await sendSupportTicketReceiptEmail({ ticket, code, vendorName: vendor.companyName }).catch(() => {});
  })();

  res.status(201).json({ ticket: { id: ticket.id, number: ticket.number, code, status: ticket.status, createdAt: ticket.createdAt } });
}

// GET /support-tickets/mine: los reportes de esta tienda con las respuestas del admin.
export async function listMyTickets(req, res) {
  const { vendor } = await reporterContext(req.user.id);
  const tickets = await prisma.supportTicket.findMany({
    where: { vendorId: vendor.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, number: true, section: true, pagePath: true, description: true, status: true, resolution: true, createdAt: true, closedAt: true, reporterName: true, messages: { orderBy: { createdAt: "asc" }, select: { id: true, body: true, statusChange: true, createdAt: true } } },
  });
  res.json({ tickets: tickets.map((t) => ({ ...t, code: ticketCode(t.number) })) });
}

// --- Admin ----------------------------------------------------------------------------------------------------------------

const listQuery = z.object({
  status: z.enum(["open", "closed", "all", ...Object.keys(TICKET_STATUS_LABEL)]).default("open"),
  vendorId: z.string().max(64).optional(),
  q: z.string().trim().max(80).optional(),
});

export async function adminListTickets(req, res) {
  const { status, vendorId, q } = listQuery.parse(req.query);
  const where = {
    ...(status === "open" ? { status: { notIn: [...CLOSED] } } : status === "closed" ? { status: { in: [...CLOSED] } } : status === "all" ? {} : { status }),
    ...(vendorId ? { vendorId } : {}),
    ...(q
      ? {
          OR: [
            ...(/^\s*t?-?0*\d+\s*$/i.test(q) ? [{ number: Number(q.replace(/\D/g, "")) }] : []),
            { description: { contains: q, mode: "insensitive" } },
            { reporterEmail: { contains: q, mode: "insensitive" } },
            { vendor: { companyName: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [tickets, openCount] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, number: true, section: true, pagePath: true, description: true, status: true, createdAt: true, reporterName: true, reporterEmail: true, screenshotFile: true, vendor: { select: { id: true, companyName: true } }, _count: { select: { messages: true } } },
    }),
    prisma.supportTicket.count({ where: { status: { notIn: [...CLOSED] } } }),
  ]);
  res.json({ tickets: tickets.map(({ screenshotFile, ...t }) => ({ ...t, code: ticketCode(t.number), hasScreenshot: !!screenshotFile })), openCount });
}

export async function adminGetTicket(req, res) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: req.params.id },
    include: {
      vendor: { select: { id: true, companyName: true, slug: true, planType: true, whatsapp: true } },
      reporter: { select: { id: true, fullName: true, email: true, phone: true, role: true, lastLoginAt: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!ticket) throw new AppError("Ticket no encontrado.", 404);
  const { screenshotFile, ...rest } = ticket;
  const expiresAt = new Date(ticket.createdAt.getTime() + TICKET_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  res.json({ ticket: { ...rest, code: ticketCode(ticket.number), hasScreenshot: !!screenshotFile, expiresAt } });
}

// La captura solo se sirve por aquí (ruta del admin): la carpeta uploads/tickets no es pública.
export async function adminTicketScreenshot(req, res) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id }, select: { screenshotFile: true } });
  if (!ticket?.screenshotFile) throw new AppError("Este ticket no tiene captura.", 404);
  const file = join(TICKET_UPLOAD_DIR, basename(ticket.screenshotFile));
  if (!existsSync(file)) throw new AppError("La captura ya no está en el servidor.", 404);
  res.set("Cache-Control", "private, no-store");
  res.sendFile(file);
}

const replySchema = z
  .object({
    body: z.string().trim().max(4000).optional(),
    status: z.enum(Object.keys(TICKET_STATUS_LABEL)).optional(),
    resolution: z.string().trim().max(2000).optional(),
    notify: z.boolean().default(true),
  })
  .refine((d) => (d.body && d.body.length >= 2) || d.status, "Escribe una respuesta o elige un estado.")
  .refine((d) => d.status !== "RESOLVED" || (d.resolution && d.resolution.length >= 5), { message: "Para marcarlo como solucionado, explica cómo se solucionó.", path: ["resolution"] });

// POST /admin/support-tickets/:id/reply: respuesta del admin y/o cambio de estado. Cada respuesta llega por correo a quien
// reportó, con el número del ticket.
export async function adminReplyTicket(req, res) {
  const data = replySchema.parse(req.body);
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id }, include: { vendor: { select: { companyName: true } } } });
  if (!ticket) throw new AppError("Ticket no encontrado.", 404);

  const statusChanged = data.status && data.status !== ticket.status;
  const updated = await prisma.$transaction(async (tx) => {
    const message =
      data.body || statusChanged
        ? await tx.supportTicketMessage.create({
            data: { ticketId: ticket.id, authorId: req.user.id, body: data.body ?? "", statusChange: statusChanged ? data.status : null },
          })
        : null;
    const t = await tx.supportTicket.update({
      where: { id: ticket.id },
      data: {
        ...(statusChanged ? { status: data.status, closedAt: CLOSED.has(data.status) ? new Date() : null } : {}),
        ...(data.resolution !== undefined ? { resolution: data.resolution || null } : {}),
        // Pasar de "Nuevo" a "En revisión" al primer movimiento del admin, si no eligió otro estado.
        ...(!statusChanged && ticket.status === "NEW" ? { status: "IN_REVIEW" } : {}),
      },
    });
    return { ticket: t, message };
  });

  if (data.notify && updated.message) {
    const result = await sendSupportTicketUpdateEmail({
      ticket: updated.ticket,
      code: ticketCode(ticket.number),
      vendorName: ticket.vendor?.companyName ?? null,
      body: data.body ?? "",
      statusLabel: TICKET_STATUS_LABEL[updated.ticket.status],
      resolution: updated.ticket.resolution,
      closed: CLOSED.has(updated.ticket.status),
    }).catch(() => ({ ok: false }));
    if (result?.ok) await prisma.supportTicketMessage.update({ where: { id: updated.message.id }, data: { emailedAt: new Date() } });
  }
  res.json({ ok: true });
}

// Usado por la ficha de la tienda en el admin.
export async function ticketsForVendor(vendorId, take = 10) {
  const tickets = await prisma.supportTicket.findMany({
    where: { vendorId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, number: true, section: true, description: true, status: true, createdAt: true, reporterName: true },
  });
  return tickets.map((t) => ({ ...t, code: ticketCode(t.number) }));
}
