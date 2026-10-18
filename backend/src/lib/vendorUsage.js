import { prisma } from "./prisma.js";

// Uso del panel de cada tienda por sección y por día (ver VendorSectionUsage en schema.prisma). Dos fuentes:
//  - El panel avisa al entrar a una sección y cuánto tiempo estuvo con la pantalla activa (POST /vendors/me/usage).
//  - Cada acción que guarda algo (crear, editar, cambiar un estado) suma una acción en su sección (trackVendorActions).
// Todo es de mejor esfuerzo: si falla, nunca frena lo que la tienda estaba haciendo.

export const USAGE_SECTIONS = [
  { key: "resumen", label: "Dashboard" },
  { key: "productos", label: "Productos" },
  { key: "pedidos", label: "Pedidos" },
  { key: "caja", label: "Caja" },
  { key: "mesas", label: "Mesas / QR" },
  { key: "clientes", label: "Clientes" },
  { key: "puntos", label: "Programa de fidelidad" },
  { key: "ofertas", label: "Ofertas y códigos de descuento" },
  { key: "ofertas-tienda", label: "Ofertas de tienda" },
  { key: "mensajes", label: "Mensajes con el equipo" },
  { key: "resenas", label: "Reseñas" },
  { key: "reportes", label: "Reportes" },
  { key: "ventas-manuales", label: "Productos asignados" },
  { key: "usuarios", label: "Usuarios del sistema" },
  { key: "asistente", label: "Asistente de negocio" },
  { key: "configuracion", label: "Configuración" },
  { key: "suscripcion", label: "Suscripción" },
  { key: "completar", label: "Completa tu tienda" },
  { key: "perfil", label: "Mi perfil" },
];
export const USAGE_SECTION_KEYS = new Set(USAGE_SECTIONS.map((s) => s.key));
export const usageSectionLabel = (key) => USAGE_SECTIONS.find((s) => s.key === key)?.label ?? key;

// A qué sección pertenece una llamada a la API que guardó algo.
const API_SECTION = [
  [/^\/(orders|vendor-orders)/, "pedidos"],
  [/^\/products/, "productos"],
  [/^\/pos/, "caja"],
  [/^\/tables/, "mesas"],
  [/^\/(offers|discount-codes)/, "ofertas"],
  [/^\/store-offers/, "ofertas-tienda"],
  [/^\/loyalty/, "puntos"],
  [/^\/reviews/, "resenas"],
  [/^\/reports/, "reportes"],
  [/^\/support-tickets/, "reportes"],
  [/^\/(vendor-staff|vendors\/me\/staff)/, "usuarios"],
  [/^\/vendors\/me\/assistant/, "asistente"],
  [/^\/vendors\/me\/(messages|chat)/, "mensajes"],
  [/^\/vendors\/me\/customers/, "clientes"],
  [/^\/(manual-sales|staff-sales|allocations)/, "ventas-manuales"],
  [/^\/verification/, "suscripcion"],
  [/^\/vendors\/me/, "configuracion"],
];
// Llamadas que no son una acción de la tienda (las hace la app sola o son de este mismo registro).
const IGNORE = /^\/(vendors\/me\/usage|push|cart|auth|settings|errors|client-errors|ai\/|chat\/)/;

function today() {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export async function recordUsage(vendorId, section, { views = 0, activeMs = 0, actions = 0 }) {
  if (!vendorId || !USAGE_SECTION_KEYS.has(section)) return;
  const day = today();
  await prisma.vendorSectionUsage.upsert({
    where: { vendorId_section_day: { vendorId, section, day } },
    create: { vendorId, section, day, views, activeMs, actions },
    update: { views: { increment: views }, activeMs: { increment: activeMs }, actions: { increment: actions } },
  });
}

// Tienda a la que pertenece una cuenta (dueño o usuario del equipo), con caché corta para no consultar en cada acción.
const vendorCache = new Map();
export async function vendorIdForUser(userId) {
  const hit = vendorCache.get(userId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.id;
  const v = await prisma.vendor.findFirst({
    where: { deletedAt: null, OR: [{ userId }, { staff: { some: { userId, isActive: true } } }] },
    select: { id: true },
  });
  if (vendorCache.size > 5000) vendorCache.clear();
  vendorCache.set(userId, { at: Date.now(), id: v?.id ?? null });
  return v?.id ?? null;
}

// Middleware global: al terminar una petición que guardó algo con éxito, hecha por una tienda, suma una acción en su sección.
export function trackVendorActions(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  res.on("finish", () => {
    const role = req.user?.role;
    if ((role !== "VENDOR" && role !== "VENDOR_STAFF") || res.statusCode >= 400) return;
    const path = (req.originalUrl || "").split("?")[0].replace(/^\/api/, "");
    if (IGNORE.test(path)) return;
    const section = API_SECTION.find(([re]) => re.test(path))?.[1];
    if (!section) return;
    vendorIdForUser(req.user.id)
      .then((vendorId) => recordUsage(vendorId, section, { actions: 1 }))
      .catch(() => {});
  });
  next();
}
