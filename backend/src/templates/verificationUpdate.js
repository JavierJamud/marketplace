import { emailShell, ctaButton, paragraph, esc } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Los mismos colores que el resto de las plantillas: statusBadge (_shared.js) es quien decide el tono final de la pastilla
// para cada uno de estos, así que aquí no se inventan otros.
const GREEN = "#0CAE53";
const DARK_GREEN = "#0A8F42";
const AMBER = "#8A5100";
const RED = "#ba1a1a";

// Un solo template genérico para todo el ciclo de verificación/cobro — mismo
// patrón que statusUpdate.js ya usa un label/color map en vez de un template
// por estado.
const META = {
  VERIFICATION_DOCS_APPROVED: { label: "Documentos aprobados", color: DARK_GREEN },
  VERIFICATION_DOCS_REJECTED: { label: "Documentos rechazados", color: RED },
  // Vence el plazo de 24 h para pagar tras aprobar los documentos: hay que volver a enviarlos, así que va en rojo.
  VERIFICATION_APPROVAL_EXPIRED: { label: "Plazo de pago vencido", color: RED },
  VERIFICATION_PAYMENT_LINK_SENT: { label: "Enlace de pago enviado", color: AMBER },
  VERIFICATION_STRIPE_PAID: { label: "Pago recibido", color: DARK_GREEN },
  // El admin restableció el método de pago: falta que la tienda elija de nuevo, no es un fallo.
  VERIFICATION_PAYMENT_METHOD_RESET: { label: "Elige de nuevo cómo pagar", color: AMBER },
  VERIFICATION_VERIFIED: { label: "Tienda verificada", color: GREEN },
  // Las etiquetas no nombran un plan: hay varios planes de pago y sus nombres los decide el admin. El nombre real va en el
  // título y el texto del correo (verificationNotify.service.js los arma con el nombre de la base).
  VERIFICATION_BUSINESS_REVOKED: { label: "Plan de pago retirado", color: RED },
  VERIFICATION_BUSINESS_GRANTED: { label: "Plan de pago activado", color: GREEN },
  // El plan asignado espera a que la tienda complete su verificación (no es un fallo: le falta un paso).
  PLAN_PENDING_COMPLETION: { label: "Completa tu cuenta", color: AMBER },
  PLAN_PAUSED_INCOMPLETE: { label: "Completa tu cuenta", color: AMBER },
  SUBSCRIPTION_RENEWAL_CONFIRMED: { label: "Renovación confirmada", color: DARK_GREEN },
  VENDOR_CHANGE_REQUEST_APPROVED: { label: "Cambio de datos aprobado", color: DARK_GREEN },
  VENDOR_CHANGE_REQUEST_REJECTED: { label: "Cambio de datos rechazado", color: RED },
  // Bloque 64: cobro recurrente — PAYMENT_FAILED es recuperable (pagar de
  // nuevo reactiva sin rehacer documentos), SUSPENDED implica que la
  // suscripción de Stripe ya no existe (hace falta una nueva).
  VERIFICATION_PAYMENT_FAILED: { label: "Pago fallido", color: RED },
  VERIFICATION_SUSPENDED: { label: "Suscripción suspendida", color: RED },
  VERIFICATION_PAYMENT_REMINDER: { label: "Recordatorio de pago", color: AMBER },
  // Bloque 235 (prueba gratis del Plan Premium): TRIAL_EXPIRED
  // a propósito NO es rojo como el resto de los "se acabó algo" de arriba
  // — el trial termina como se esperaba, no es un fallo ni una suspensión.
  TRIAL_ACTIVATED: { label: "Prueba gratis activada", color: GREEN },
  TRIAL_EXPIRING_SOON: { label: "Tu prueba gratis termina pronto", color: AMBER },
  TRIAL_EXPIRED: { label: "Tu prueba gratis terminó", color: "#337475" },
  PLAN_BILLING_NOTICE: { label: "Pago de tu plan", color: AMBER },
};

// Sello de cada paso del cobro de un plan (planBilling.service.js manda start, before, due, after y suspended). Con un solo
// sello ámbar para todos, en la bandeja no se distinguía un aviso de una tienda sin pedidos o suspendida: los dos últimos
// pasos van en rojo. Un paso desconocido cae en PLAN_BILLING_NOTICE.
export const PLAN_BILLING_BADGE = {
  start: { label: "Tu plan ahora es de pago", color: AMBER },
  before: { label: "Pago próximo", color: AMBER },
  due: { label: "Hoy vence el pago", color: AMBER },
  after: { label: "Sin pedidos nuevos", color: RED },
  suspended: { label: "Tienda suspendida", color: RED },
};

// subject, badge ({ label, color }) y ctaLabel son opcionales y tienen prioridad sobre META: los usan los avisos que
// necesitan un asunto y un sello por paso (el cobro del plan) en vez de uno por tipo.
// message es texto plano (el mismo de la campana) y puede traer datos escritos a mano, como las notas del admin en un
// rechazo: se escapa aquí, una sola vez, igual que el nombre de la tienda. title y preview los escapa emailShell.
export async function verificationUpdateEmail({ type, vendorName, title, message, ctaHref, subject: subjectOverride, badge, ctaLabel }) {
  const { siteName } = await getBrandSettings();
  const meta = badge ?? META[type] ?? { label: "Actualización", color: "#337475" };
  const subject = subjectOverride ?? `${meta.label}: ${vendorName}`;
  const html = await emailShell({
    preview: `${vendorName}: ${meta.label.toLowerCase()}`,
    title,
    // storeName acá es "quién firma el correo" (footer) — este es un email
    // de la plataforma al vendedor, no un mensaje de una tienda a su
    // cliente, así que firma la plataforma, no el propio vendedor.
    storeName: siteName,
    accentColor: meta.color,
    badge: { label: esc(meta.label), color: meta.color },
    bodyMjml: `
      ${paragraph(`Hola equipo de <strong>${esc(vendorName)}</strong>,`)}
      ${paragraph(esc(message))}
      ${ctaHref ? ctaButton(esc(ctaLabel ?? "Ver en mi panel"), ctaHref) : ""}
    `,
  });
  return { subject, html };
}
