import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { logActivity } from "../lib/activityLog.js";
import { notifyAdminActionNeeded } from "../lib/adminNotify.js";
import { sendPartnerNoticeEmail } from "../lib/email.js";
import { normalizeDomain, normalizeIp, hostFromOrigin } from "../lib/partnerKeys.js";
import { DEFAULT_PARTNER_SCOPES, PARTNER_SCOPE_IDS, DEFAULT_RATE_PER_MINUTE, DEFAULT_DAILY_LIMIT } from "../lib/partnerScopes.js";
import { paginationQuerySchema, pageArgs, pageMeta } from "../lib/pagination.js";
import { codeFromName, issueKey, emailPartnerKey } from "./partners.controller.js";
import { assertNotBlacklisted, findBlacklisted } from "../lib/blacklist.js";
import { assertPhoneFree, findPhoneOwner } from "../lib/phoneUniqueness.js";

// Solicitudes para usar la API de socios. Cualquiera puede enviar una (sin cuenta); solo el administrador la
// aprueba o la rechaza. Al aprobarla se crean, juntos, el socio, su usuario del panel (rol PARTNER, con la
// contraseña que la persona eligió) y su credencial, y el socio recibe por correo la aprobación con la credencial.

const E164 = /^\+\d{7,15}$/;

// Hasta dos sitios desde los que usará la API: el suyo y, por ejemplo, un localhost para trabajar en su computadora.
// Cada uno debe ser una dirección http(s) con un dominio válido; no se repiten.
const websiteUrl = z
  .string()
  .trim()
  .max(200)
  .refine((v) => /^https?:\/\//i.test(v), "Cada sitio debe empezar con http:// o https://")
  .refine((v) => !!normalizeDomain(hostFromOrigin(v)), "Ese sitio no tiene un dominio válido (ejemplo: https://mitienda.com o http://localhost:3000).");
const websitesField = z
  .array(websiteUrl)
  .min(1, "Indica el sitio web desde el que usarás la API.")
  .max(2, "Puedes indicar hasta dos sitios.")
  .refine((arr) => new Set(arr.map((u) => normalizeDomain(hostFromOrigin(u)))).size === arr.length, "Los dos sitios no pueden tener el mismo dominio.");

// Dominios que se autorizan en la credencial a partir de los sitios de la solicitud.
export const domainsFromWebsites = (websites = []) => [...new Set(websites.map((u) => normalizeDomain(hostFromOrigin(u))).filter(Boolean))];

const applicationBody = z
  .object({
    firstName: z.string().trim().min(2, "Escribe tu nombre.").max(60),
    lastName: z.string().trim().min(2, "Escribe tu apellido.").max(60),
    phone: z.string().trim().regex(E164, "El teléfono debe llevar el código de país, por ejemplo +5355512345."),
    email: z.string().trim().toLowerCase().email("Escribe un correo válido.").max(120),
    companyName: z.string().trim().min(2, "Escribe el nombre de tu negocio o sitio.").max(80),
    websites: websitesField,
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

// Del lado del admin (editar o aprobar) se le dice qué dato choca: él ve la lista negra y las cuentas. A quien envía la
// solicitud no se le revela (assertNotBlacklisted da el mismo mensaje genérico que el registro).
async function assertApplicationDataUsable({ email, phone }) {
  if (await findBlacklisted({ email, phone })) {
    throw new AppError("El correo o el teléfono de esta solicitud está en la lista negra. Sácalo de la lista negra o rechaza la solicitud.", 409);
  }
  if (await findPhoneOwner(phone)) {
    throw new AppError(`El teléfono ${phone} ya lo usa otra cuenta. Corrígelo en la solicitud o recházala.`, 409);
  }
}

// POST /partner-applications (público)
export async function submitApplication(req, res) {
  const data = applicationBody.parse(req.body);
  // Las mismas reglas que el registro (auth.controller.js): nada de la lista negra y un teléfono por persona. El usuario
  // PARTNER que se crea al aprobar es una cuenta más; antes este flujo quedaba fuera de las dos comprobaciones.
  await assertNotBlacklisted({ email: data.email, phone: data.phone });
  await assertPhoneFree(data.phone);
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
      website: data.websites[0],
      websites: data.websites,
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
  // Servicios de la API a los que tendrá acceso. Por defecto, todos.
  scopes: z.array(z.enum(PARTNER_SCOPE_IDS)).min(1, "Elige al menos un servicio.").default(DEFAULT_PARTNER_SCOPES),
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
  // Si el admin no puso nada, se autorizan los dominios de los sitios que indicó la persona en su solicitud.
  if (domains.length === 0 && ips.length === 0) domains = domainsFromWebsites(app.websites.length ? app.websites : [app.website].filter(Boolean));
  if (domains.length === 0 && ips.length === 0) {
    throw new AppError("Indica al menos un dominio o una dirección IP autorizados para la credencial.", 400);
  }
  if (await prisma.user.findUnique({ where: { email: app.email }, select: { id: true } })) {
    throw new AppError(`Ya existe una cuenta con el correo ${app.email}. Pídele que use otro.`, 409);
  }
  // Se repite al aprobar: mientras la solicitud esperaba, el correo o el teléfono pudo entrar a la lista negra o el teléfono
  // pudo pasar a otra cuenta (por ejemplo, otra solicitud aprobada antes con el mismo número).
  await assertApplicationDataUsable({ email: app.email, phone: app.phone });
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
        website: app.websites[0] ?? app.website,
        listInMarketplace: body.listInMarketplace,
        notes: `Solicitud aprobada. ${app.description}`.slice(0, 1000),
        userId: user.id,
      },
    });
    const issued = await issueKey(
      partner.id,
      { name: `Credencial de ${app.companyName}`.slice(0, 60), scopes: body.scopes, rateLimitPerMinute: DEFAULT_RATE_PER_MINUTE, dailyLimit: DEFAULT_DAILY_LIMIT, allowedDomains: domains, allowedIps: ips },
      tx
    );
    await tx.partnerApplication.update({ where: { id: app.id }, data: { status: "APPROVED", partnerId: partner.id, reviewedAt: new Date(), reviewedById: req.user.id } });
    return { partner, key: issued.key, raw: issued.raw };
  });

  logActivity({ actorId: req.user.id, actorRole: "ADMIN", action: "partner_application_approved", description: `Aprobó la solicitud de "${app.companyName}" (${app.email})`, meta: { partnerId: partner.id, applicationId: app.id } });
  const emailed = await emailPartnerKey({ ...partner, contactName: app.firstName }, raw, key, "approved");
  res.status(201).json({ partner: { id: partner.id, name: partner.name, code: partner.code }, emailed: !!emailed?.ok });
}

// PATCH /admin/partner-applications/:id: el admin corrige los datos de una solicitud en revisión antes de resolverla.
// La contraseña no se edita desde aquí: es de la persona.
const editBody = z
  .object({
    firstName: applicationBody.shape.firstName,
    lastName: applicationBody.shape.lastName,
    phone: applicationBody.shape.phone,
    email: applicationBody.shape.email,
    companyName: applicationBody.shape.companyName,
    websites: websitesField,
    description: applicationBody.shape.description,
  })
  .partial()
  .strict();

export async function editApplication(req, res) {
  const app = await prisma.partnerApplication.findUnique({ where: { id: req.params.id } });
  if (!app) throw new AppError("Solicitud no encontrada.", 404);
  if (app.status !== "PENDING") throw new AppError("Solo se puede editar una solicitud en revisión.", 409);
  const data = editBody.parse(req.body ?? {});
  if (data.email && data.email !== app.email) {
    if (await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } })) throw new AppError("Ya existe una cuenta con ese correo.", 409);
    if (await prisma.partnerApplication.findFirst({ where: { email: data.email, status: "PENDING", id: { not: app.id } }, select: { id: true } })) throw new AppError("Ya hay otra solicitud en revisión con ese correo.", 409);
  }
  // Un correo o teléfono nuevo pasa por la lista negra y la regla de teléfono único, igual que al enviar la solicitud.
  const emailChanged = data.email && data.email !== app.email;
  const phoneChanged = data.phone && data.phone !== app.phone;
  if (emailChanged || phoneChanged) {
    if (await findBlacklisted({ email: emailChanged ? data.email : null, phone: phoneChanged ? data.phone : null })) {
      throw new AppError(`${emailChanged && phoneChanged ? "El correo o el teléfono nuevo" : emailChanged ? "El correo nuevo" : "El teléfono nuevo"} está en la lista negra.`, 409);
    }
    if (phoneChanged && (await findPhoneOwner(data.phone))) throw new AppError("Ese teléfono ya lo usa otra cuenta.", 409);
  }
  const updated = await prisma.partnerApplication.update({ where: { id: app.id }, data: { ...data, ...(data.websites ? { website: data.websites[0] } : {}) } });
  logActivity({ actorId: req.user.id, actorRole: "ADMIN", action: "partner_application_edited", description: `Editó la solicitud de "${updated.companyName}"`, meta: { applicationId: app.id, fields: Object.keys(data) } });
  res.json({ application: publicApp(updated) });
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
