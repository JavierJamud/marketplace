import { prisma } from "./prisma.js";

// Bloque 33: registro centralizado de errores técnicos reales — nunca
// reemplaza el try/catch/AppError que ya existe en cada punto de falla, es
// un registro ADICIONAL para que el admin tenga un solo lugar donde ver qué
// está fallando de verdad (ver AdminErrors.jsx), sin depender de revisar
// logs de servidor a mano. Nunca debe romper el flujo que lo llama: si
// ESCRIBIR el log de error falla (ej. la base cayó justo en ese momento),
// se traga en silencio — perder un registro de auditoría es aceptable,
// romper la respuesta real al cliente por un problema del logging no lo es.
export async function logError({ origin, message, context }) {
  try {
    await prisma.errorLog.create({
      data: {
        origin,
        message: String(message ?? "Error desconocido").slice(0, 4000),
        context: context ?? undefined,
      },
    });
  } catch (err) {
    console.error("[errorLog] no se pudo registrar el error en ErrorLog:", err.message);
    return;
  }
  void notifyAdminsOfError(origin, message, context).catch(() => {});
}

// Aviso al admin de cada error nuevo: en vivo si tiene el panel abierto y por push a la app instalada aunque el teléfono
// esté bloqueado (antes solo quedaba guardado y nadie se enteraba hasta abrir Errores). El mismo error (origen + mensaje +
// ruta) avisa como mucho una vez cada 10 minutos para no saturar si se repite. Los reportes manuales y el chequeo diario de
// la IA ya avisan por su cuenta (correo y aviso propio), así que aquí no se repiten.
const NOTIFY_WINDOW_MS = 10 * 60 * 1000;
const SKIP_NOTIFY = new Set(["REPORTE_USUARIO", "AI_HEALTH_CHECK"]);
const ORIGIN_LABEL = {
  BOT_TIENDA: "el chat de una tienda",
  BOT_GENERAL: "el asistente del sitio",
  EMAIL_RESEND: "el envío de correos",
  STRIPE: "los pagos con tarjeta",
  TRANSCRIPCION_AUDIO: "la voz a texto",
  PAGINA: "una pantalla",
  OTRO: "el servidor",
};
const recentNotices = new Map();

async function notifyAdminsOfError(origin, message, context) {
  if (SKIP_NOTIFY.has(origin)) return;
  const path = String(context?.page ?? context?.path ?? "").split("?")[0];
  const key = `${origin}|${path}|${String(message).slice(0, 120)}`;
  const now = Date.now();
  if (now - (recentNotices.get(key) ?? 0) < NOTIFY_WINDOW_MS) return;
  if (recentNotices.size > 500) recentNotices.clear();
  recentNotices.set(key, now);

  // Si le pasó a alguien con sesión, se dice de qué tienda.
  let who = "";
  if (context?.userId) {
    const vendor = await prisma.vendor.findFirst({
      where: { OR: [{ userId: context.userId }, { staff: { some: { userId: context.userId } } }] },
      select: { companyName: true },
    });
    if (vendor) who = `${vendor.companyName}: `;
  }
  // Import tardío: notify.js importa la base con su propio gancho y no debe cargarse en cada uso de este registro.
  const { notifyAdmins } = await import("./notify.js");
  await notifyAdmins({
    category: "errors",
    title: `Error en ${ORIGIN_LABEL[origin] ?? "la plataforma"}${path ? ` (${path})` : ""}`.slice(0, 100),
    body: `${who}${String(message ?? "").replace(/\s+/g, " ")}`.slice(0, 200),
    url: "/admin/errores",
    tag: `error-${origin}-${path}`.slice(0, 60),
    // Con el teléfono apagado el aviso espera hasta 24 h a que vuelva a conectarse.
    ttl: 24 * 3600,
    urgency: "high",
  });
}
