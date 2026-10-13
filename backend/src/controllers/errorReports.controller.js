import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logError } from "../lib/errorLog.js";
import { notifyAdminActionNeeded } from "../lib/adminNotify.js";
import { esc } from "../templates/_shared.js";

// Reporte manual de un error: cuando algo no funciona, la persona (cliente, vendedor, socio o visitante) puede contar qué
// estaba haciendo. Se junta con lo que el sitio sabe del fallo (pantalla, petición que falló, navegador) y llega al
// panel del admin (Errores, origen "Reportes de usuarios") y a su correo.

const short = (max) => z.string().trim().max(max);

const reportBody = z
  .object({
    description: short(2000).min(5, "Cuéntanos qué estabas haciendo o qué pasó."),
    contactEmail: short(120).email("Escribe un correo válido.").optional().or(z.literal("")),
    context: z
      .object({
        page: short(300).optional(),
        referrer: short(300).optional(),
        viewport: short(20).optional(),
        language: short(20).optional(),
        online: z.boolean().optional(),
        request: z
          .object({
            method: short(10).optional(),
            path: short(200).optional(),
            status: z.number().int().min(0).max(599).nullable().optional(),
            message: short(300).optional(),
            at: short(40).optional(),
          })
          .partial()
          .optional(),
      })
      .partial()
      .optional(),
  })
  .strict();

export async function createErrorReport(req, res) {
  const data = reportBody.parse(req.body);
  const ctx = data.context ?? {};

  // Quién es: solo si trae una sesión válida (la ruta usa optionalAuth). Un visitante queda como anónimo.
  let who = { kind: "visitante" };
  if (req.user) {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, email: true, role: true, fullName: true } });
    if (user) {
      const vendor = ["VENDOR", "VENDOR_STAFF"].includes(user.role)
        ? await prisma.vendor.findFirst({ where: { OR: [{ userId: user.id }, { staff: { some: { userId: user.id } } }] }, select: { id: true, companyName: true } })
        : null;
      who = { kind: "cuenta", userId: user.id, role: user.role, email: user.email, name: user.fullName, vendor: vendor ? { id: vendor.id, name: vendor.companyName } : null };
    }
  }

  const context = {
    description: data.description,
    contactEmail: data.contactEmail || null,
    who,
    page: ctx.page ?? null,
    referrer: ctx.referrer ?? null,
    viewport: ctx.viewport ?? null,
    language: ctx.language ?? null,
    online: ctx.online ?? null,
    request: ctx.request ?? null,
    userAgent: String(req.get("user-agent") ?? "").slice(0, 300),
    ip: req.ip ?? null,
    reportedAt: new Date().toISOString(),
  };
  await logError({ origin: "REPORTE_USUARIO", message: `Reporte de usuario: ${data.description.slice(0, 300)}`, context });

  // Correo al admin (best-effort). Todo lo que escribió la persona va escapado.
  const lines = [
    `<strong>Qué contó la persona:</strong> ${esc(data.description)}`,
    `<strong>Quién:</strong> ${esc(who.kind === "cuenta" ? `${who.name ?? who.email} (${who.role}${who.vendor ? `, tienda ${who.vendor.name}` : ""})` : "visitante sin sesión")}`,
    data.contactEmail ? `<strong>Correo de contacto:</strong> ${esc(data.contactEmail)}` : null,
    ctx.page ? `<strong>Pantalla:</strong> ${esc(ctx.page)}` : null,
    ctx.request?.path ? `<strong>Lo que falló:</strong> ${esc(`${ctx.request.method ?? ""} ${ctx.request.path} ${ctx.request.status ?? "sin respuesta"} ${ctx.request.message ?? ""}`.trim())}` : null,
    `<strong>Navegador:</strong> ${esc(context.userAgent)}`,
  ].filter(Boolean);
  await notifyAdminActionNeeded("Reporte de un error en el sitio", lines.join("\n"));

  res.status(201).json({ ok: true });
}

// --- Avisos automáticos de la pantalla ---------------------------------------------------------------------------------------
// Cuando a un visitante se le rompe la pantalla (o la página tuvo que recargarse sola) el sitio avisa aquí, sin que la persona
// haga nada. Así los fallos intermitentes dejan rastro en Admin > Errores (antes solo se veían en el navegador de quien los sufría).
// Es público, así que todo se valida, se acorta y se agrupa: el mismo fallo se anota una vez cada 10 minutos con cuántas veces pasó.
const clientBody = z
  .object({
    kind: z.enum(["render", "chunk", "script", "promise", "boot"]),
    message: short(300),
    stack: short(1500).optional(),
    page: short(300).optional(),
    version: short(40).optional(),
    recovered: z.boolean().optional(),
    online: z.boolean().optional(),
    viewport: short(20).optional(),
    language: short(20).optional(),
    storage: z.boolean().optional(),
  })
  .strict();

const recentClientErrors = new Map(); // huella -> { at, count }
const CLIENT_ERROR_WINDOW_MS = 10 * 60 * 1000;

export async function reportClientCrash(req, res) {
  const data = clientBody.parse(req.body);
  const path = String(data.page ?? "").split("?")[0];
  const key = `${data.kind}|${path}|${data.message.slice(0, 120)}`;
  const now = Date.now();
  const seen = recentClientErrors.get(key);
  if (seen && now - seen.at < CLIENT_ERROR_WINDOW_MS) {
    seen.count += 1;
    return res.status(204).end();
  }
  if (recentClientErrors.size > 500) recentClientErrors.clear();
  recentClientErrors.set(key, { at: now, count: 1 });
  await logError({
    origin: "PAGINA",
    message: `Pantalla con error (${data.kind}${data.recovered ? ", se recargó sola" : ""}) en ${path || "?"}: ${data.message}`,
    context: { ...data, userAgent: String(req.get("user-agent") ?? "").slice(0, 300), reportedAt: new Date().toISOString() },
  });
  res.status(204).end();
}
