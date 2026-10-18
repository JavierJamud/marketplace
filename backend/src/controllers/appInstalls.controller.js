import { z } from "zod";
import { prisma } from "../lib/prisma.js";

// Instalaciones de las aplicaciones (ver AppInstall en schema.prisma).
//  - La app instalada (modo standalone) llama a pingInstall cada vez que se abre, con el identificador que guarda en el
//    dispositivo. Con sesión, la instalación queda asociada a la persona.
//  - El navegador llama a installStatus antes de ofrecer instalar. En iPhone, Safari y la app instalada no comparten datos,
//    así que esta es la única forma de saber que la persona ya la tiene en ese tipo de dispositivo.
//  - Una instalación que no se abre hace INSTALL_FRESH_DAYS días se considera borrada: se vuelve a ofrecer instalar.
// IDENTITY_VERSION sube cuando cambian el nombre o los íconos de las apps; la app instalada compara la suya y avisa la novedad.
export const IDENTITY_VERSION = 2;
const INSTALL_FRESH_DAYS = 30;
const APPS = ["CLIENT", "VENDOR", "ADMIN"];
const PLATFORMS = ["android", "ios", "desktop"];

const pingSchema = z.object({
  installId: z.string().uuid(),
  app: z.enum(APPS),
  platform: z.enum(PLATFORMS),
  identityVersion: z.number().int().min(0).max(1000),
});

export async function pingInstall(req, res) {
  const data = pingSchema.parse(req.body);
  const userAgent = String(req.headers["user-agent"] ?? "").slice(0, 300) || null;
  const now = new Date();
  const userId = req.user?.id ?? null;
  await prisma.appInstall.upsert({
    where: { installId_app: { installId: data.installId, app: data.app } },
    create: { installId: data.installId, app: data.app, platform: data.platform, userId, userAgent, identityVersion: data.identityVersion, lastSeenAt: now },
    // Sin sesión no se borra el dueño que ya tenía (abrir la app antes de iniciar sesión no la desvincula).
    update: { platform: data.platform, userAgent, identityVersion: data.identityVersion, lastSeenAt: now, ...(userId ? { userId } : {}) },
  });
  res.json({ ok: true, identityVersion: IDENTITY_VERSION });
}

const statusSchema = z.object({ app: z.enum(APPS), platform: z.enum(PLATFORMS) });

export async function installStatus(req, res) {
  const { app, platform } = statusSchema.parse(req.query);
  const since = new Date(Date.now() - INSTALL_FRESH_DAYS * 24 * 60 * 60 * 1000);
  const install = await prisma.appInstall.findFirst({
    where: { userId: req.user.id, app, platform, lastSeenAt: { gte: since } },
    orderBy: { lastSeenAt: "desc" },
    select: { lastSeenAt: true, identityVersion: true },
  });
  res.json({ installed: !!install, lastSeenAt: install?.lastSeenAt ?? null, identityVersion: IDENTITY_VERSION, installedIdentityVersion: install?.identityVersion ?? null });
}
