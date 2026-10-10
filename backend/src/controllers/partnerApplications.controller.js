import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { logActivity } from "../lib/activityLog.js";
import { notifyAdminActionNeeded } from "../lib/adminNotify.js";
import { sendPartnerNoticeEmail } from "../lib/email.js";
import { normalizeDomain, normalizeIp, hostFromOrigin } from "../lib/partnerKeys.js";
import { DEFAULT_PARTNER_SCOPES, DEFAULT_RATE_PER_MINUTE, DEFAULT_DAILY_LIMIT } from "../lib/partnerScopes.js";
import { paginationQuerySchema, pageArgs, pageMeta } from "../lib/pagination.js";
import { codeFromName, issueKey, emailPartnerKey } from "./partners.controller.js";

// Solicitudes para usar la API de socios. Cualquiera puede enviar una (sin cuenta); solo el administrador la
// aprueba o la rechaza. Al aprobarla se crean, juntos, el socio, su usuario del panel (rol PARTNER, con la
// contraseña que la persona eligió) y su credencial, y el socio recibe por correo la aprobación con la credencial.

const E164 = /^\+\d{7,15}$/;

const applicationBody = z
  .object({
    firstName: z.string().trim().min(2, "Escribe tu nombre.").max(60),
    lastName: z.string().trim().min(2, "Escribe tu apellido.").max(60),
    phone: z.string().trim().regex(E164, "El teléfono debe llevar el código de país, por ejemplo +5355512345."),
    email: z.string().trim().toLowerCase().email("Escribe un correo válido.").max(120),
    companyName: z.string().trim().min(2, "Escribe el nombre de tu negocio o sitio.").max(80),
    website: z.string().trim().url("El sitio web debe empezar con https://").max(200).optional().or(z.literal("")),
    description: z.string().trim().min(20, "Cuéntanos con más detalle cómo usarás la API (mínimo 20 caracteres).").max(1000),
    password: z
      .string()
      .min(8, "La contraseña debe tener al menos 8 caracteres.")
      .max(72)
      .regex(/[A-Za-z]/, "La contraseña debe incluir al menos una letra.")
      .regex(/\d/, "La contraseña debe incluir al menos un número."),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: "Debes aceptar los términos de uso de la API." }) }),
  })
  .strict();

// POST /partner-applications (público)
export async function submitApplication(req, res) {
  const data = applicationBody.parse(req.body);
  if (await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } })) {
    throw new AppError("Ya existe una cuenta con ese correo. Usa otro correo o entra a tu cuenta.", 409);
  }
  if (await prisma.partnerApplication.findFirst({ where: { email: data.email, status: "PENDING" }, select: { id: true } })) {
    throw new AppError("Ya tienes una solicitud en revisión con ese correo. Te escribiremos con la respuesta.", 409);
  }
  const app = await prisma.partnerApplication.create({
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      email: data.email,
      companyName: data.companyName,
      website: data.website || null,
      description: data.description,
      passwordHash: await bcrypt.hash(data.password, 10),
      ip: req.ip ?? null,
    },
  });
  await sendPartnerNoticeEmail("received", app.email, { firstName: app.firstName, companyName: app.companyName }).catch(() => {});
  await notifyAdminActionNeeded(
    "Nueva solicitud para usar la API de socios",
    `${app.firstName} ${app.lastName} (${app.email}) pidió usar la API para "${app.companyName}". Revísala en Admin, Socios de la API, Solicitudes.`
  );
  res.status(201).json({ ok: true, message: "Recibimos tu solicitud. Te escribiremos al correo que indicaste con la respuesta." });
}

const publicApp = ({ passwordHash, ...rest }) => rest;

// GET /admin/partner-applications
export async function listApplications(req, res) {
  const p = paginationQuerySchema.parse(req.query);
  const status = ["PENDING", "APPROVED", "REJECTED"].includes(req.query.status) ? req.query.status : undefined;
  const where = status ? { status } : {};
  const [total, rows, pending] = await Promise.all([
    prisma.partnerApplication.count({ where }),
    prisma.partnerApplication.findMany({ where, orderBy: { createdAt: "desc" }, ...pageArgs(p) }),
    prisma.partnerApplication.count({ where: { status: "PENDING" } }),
  ]);
  res.json({ applications: rows.map(publicApp), pending, ...pageMeta(p, total) });
}

const list = (arr, normalize, what) => {
  const out = [];
  for (const raw of arr) {
    const n = normalize(raw);
    if (!n) throw new AppError(`"${raw}" no es ${what} válido.`, 400);
    if (!out.includes(n)) out.push(n);
  }
  return out;
};

const approveBody = z.object({
  allowedDomains: z.array(z.string().max(253)).max(20).default([]),
  allowedIps: z.array(z.string().max(45)).max(20).default([]),
  listInMarketplace: z.boolean().default(true),
});

async function uniqueCode(name) {
  const base = codeFromName(name).slice(0, 20) || "SOCIO";
  let code = base.length >= 3 ? base : `${base}${randomInt(100, 999)}`;
  while (await prisma.partner.findUnique({ where: { code }, select: { id: true } })) code = `${base.slice(0, 19)}${randomInt(10, 99)}`;
  return code;
}

// POST /admin/partner-applications/:id/approve (pide código de confirmación)
export async function approveApplication(req, res) {
  const app = await prisma.partnerApplication.findUnique({ where: { id: req.params.id } });
  if (!app) throw new AppError("Solicitud no encontrada.", 404);
  if (app.status !== "PENDING") throw new AppError("Esta solicitud ya fue resuelta.", 409);
  const body = approveBody.parse(req.body ?? {});
  let domains = list(body.allowedDomains, normalizeDomain, "un dominio");
  const ips = list(body.allowedIps, normalizeIp, "una dirección IP");
  // Si el admin no puso nada, se autoriza el dominio del sitio que indicó la persona.
  if (domains.length === 0 && ips.length === 0 && app.website) {
    const host = normalizeDomain(hostFromOrigin(app.website));
    if (host) domains = [host];
  }
  if (domains.length === 0 && ips.length === 0) {
    throw new AppError("Indica al menos un dominio o una dirección IP autorizados para la credencial.", 400);
  }
  if (await prisma.user.findUnique({ where: { email: app.email }, select: { id: true } })) {
    throw new AppError(`Ya existe una cuenta con el correo ${app.email}. Pídele que use otro.`, 409);
  }
  const code = await uniqueCode(app.companyName);

  const { partner, key, raw } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: app.email, passwordHash: app.passwordHash, role: "PARTNER", fullName: `${app.firstName} ${app.lastName}`, phone: app.phone, mustSetPassword: false },
    });
    const partner = await tx.partner.create({
      data: {
        name: app.companyName,
        code,
        contactEmail: app.email,
        contactName: `${app.firstName} ${app.lastName}`,
        website: app.website,
        listInMarketplace: body.listInMarketplace,
        notes: `Solicitud aprobada. ${app.description}`.slice(0, 1000),
        userId: user.id,
      },
    });
    const issued = await issueKey(
      partner.id,
      { name: `Credencial de ${app.companyName}`.slice(0, 60), scopes: DEFAULT_PARTNER_SCOPES, rateLimitPerMinute: DEFAULT_RATE_PER_MINUTE, dailyLimit: DEFAULT_DAILY_LIMIT, allowedDomains: domains, allowedIps: ips },
      tx
    );
    await tx.partnerApplication.update({ where: { id: app.id }, data: { status: "APPROVED", partnerId: partner.id, reviewedAt: new Date(), reviewedById: req.user.id } });
    return { partner, key: issued.key, raw: issued.raw };
  });

  logActivity({ actorId: req.user.id, actorRole: "ADMIN", action: "partner_application_approved", description: `Aprobó la solicitud de "${app.companyName}" (${app.email})`, meta: { partnerId: partner.id, applicationId: app.id } });
  const emailed = await emailPartnerKey({ ...partner, contactName: app.firstName }, raw, key, "approved");
  res.status(201).json({ partner: { id: partner.id, name: partner.name, code: partner.code }, emailed: !!emailed?.ok });
}

const rejectBody = z.object({ reason: z.string().trim().min(3, "Escribe el motivo.").max(500) });

// POST /admin/partner-applications/:id/reject
export async function rejectApplication(req, res) {
  const app = await prisma.partnerApplication.findUnique({ where: { id: req.params.id } });
  if (!app) throw new AppError("Solicitud no encontrada.", 404);
  if (app.status !== "PENDING") throw new AppError("Esta solicitud ya fue resuelta.", 409);
  const { reason } = rejectBody.parse(req.body ?? {});
  await prisma.partnerApplication.update({ where: { id: app.id }, data: { status: "REJECTED", rejectReason: reason, reviewedAt: new Date(), reviewedById: req.user.id } });
  logActivity({ actorId: req.user.id, actorRole: "ADMIN", action: "partner_application_rejected", description: `Rechazó la solicitud de "${app.companyName}" (${app.email})`, meta: { applicationId: app.id } });
  const emailed = await sendPartnerNoticeEmail("rejected", app.email, { firstName: app.firstName, companyName: app.companyName, reason }).catch(() => ({ ok: false }));
  res.json({ ok: true, emailed: !!emailed?.ok });
}
