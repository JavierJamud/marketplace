import { Resend } from "resend";
import { prisma } from "./prisma.js";
import { env } from "../config/env.js";
import { getIntegrationConfig } from "../controllers/integrations.controller.js";
import { getBrandSettings } from "../controllers/settings.controller.js";
import { logError } from "./errorLog.js";
import { orderConfirmationEmail } from "../templates/orderConfirmation.js";
import { statusUpdateEmail } from "../templates/statusUpdate.js";
import { vendorMessageEmail } from "../templates/vendorMessage.js";
import { passwordResetEmail } from "../templates/passwordReset.js";
import { verificationUpdateEmail } from "../templates/verificationUpdate.js";
import { tableOrderStatusEmail } from "../templates/tableOrderStatus.js";
import { twoFactorCodeEmail } from "../templates/twoFactorCode.js";
import { emailChangeCodeEmail } from "../templates/emailChangeCode.js";
import { registrationCodeEmail } from "../templates/registrationCode.js";
import { adminDirectEmail } from "../templates/adminDirectEmail.js";
import { contactMessageEmail } from "../templates/contactMessage.js";
import { vendorInactivityReminderEmail } from "../templates/vendorInactivityReminder.js";
import { vendorSuspendedEmail } from "../templates/vendorSuspended.js";
import { vendorReactivatedEmail } from "../templates/vendorReactivated.js";
import { vendorWinbackEmail } from "../templates/vendorWinback.js";
import { fraudReportEvidenceRequestedEmail } from "../templates/fraudReportEvidenceRequested.js";
import { fraudReportDismissedEmail } from "../templates/fraudReportDismissed.js";
import { fraudReportSuspendedEmail } from "../templates/fraudReportSuspended.js";

// Dirección de fallback de Resend que funciona sin dominio propio verificado
// — así el sistema manda correos de verdad desde el día 1, y pasa a usar el
// dominio real en cuanto AdminIntegrations tenga un fromEmail cargado y
// verificado en el dashboard de Resend (sin tocar código).
const RESEND_SANDBOX_FROM = "onboarding@resend.dev";

// Envío real vía Resend — nunca simulado, nunca marcado como enviado si
// Resend devuelve error (el SDK resuelve {data,error} sin lanzar excepción
// por errores de API; ver el bug encontrado y corregido en Bloque 5).
// Lee la integración fresca de la DB en cada llamada — sin caché en memoria,
// así que guardar una key/fromEmail nuevo en AdminIntegrations se usa en el
// próximo envío sin reiniciar el backend.
async function sendViaResend({ to, subject, html, fromName, attachments }) {
  const config = await getIntegrationConfig("resend");
  if (!config) return { ok: false, error: "No hay una integración de Resend activa." };

  const fromAddress = config.fromEmail || RESEND_SANDBOX_FROM;
  const { siteName } = await getBrandSettings();
  const displayName = fromName ? `${fromName} vía ${siteName}` : siteName;

  try {
    const resend = new Resend(config.apiKey);
    const result = await resend.emails.send({
      from: `${displayName} <${fromAddress}>`,
      to,
      subject,
      html,
      // Bloque 29: factura/garantía en PDF — Resend acepta el contenido
      // como Buffer directo, sin re-codificar a base64 a mano.
      ...(attachments?.length ? { attachments } : {}),
    });
    if (result.error) return { ok: false, error: result.error.message ?? "Resend rechazó el envío." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function logEmail({ vendorId, orderId, type, to, subject, result }) {
  await prisma.emailLog.create({
    data: {
      vendorId: vendorId ?? null,
      orderId: orderId ?? null,
      type,
      to,
      subject,
      status: result.ok ? "SENT" : "FAILED",
      error: result.ok ? null : result.error,
    },
  });
  // Bloque 33: sendViaResend atrapa sus propios errores y nunca lanza (ver
  // arriba) — así que un fallo de envío NUNCA llega al errorHandler
  // central, ya se registraba en EmailLog (auditoría propia de correos, sin
  // cambios) pero no en el panel unificado de Admin > Errores. Se agrega
  // acá, sin tocar el flujo de EmailLog existente.
  if (!result.ok) {
    await logError({ origin: "EMAIL_RESEND", message: result.error, context: { vendorId, orderId, type, to, subject } });
  }
}

// Best-effort: se llama después de crear el pedido, nunca bloquea la
// respuesta al cliente ni revierte el pedido si el email falla.
export async function sendOrderConfirmationEmail(order) {
  if (!order.customerEmail) return;
  const { subject, html } = await orderConfirmationEmail(order);
  const result = await sendViaResend({ to: order.customerEmail, subject, html, fromName: order.vendor.companyName });
  await logEmail({ vendorId: order.vendorId, orderId: order.id, type: "ORDER_CONFIRMATION", to: order.customerEmail, subject, result });
  return result;
}

// Best-effort: disparado inmediatamente al cambiar el estado (no batch/cron).
export async function sendOrderStatusEmail(order) {
  if (!order.customerEmail) return;
  const { subject, html } = await statusUpdateEmail(order);
  const result = await sendViaResend({ to: order.customerEmail, subject, html, fromName: order.vendor.companyName });
  await logEmail({ vendorId: order.vendorId, orderId: order.id, type: "STATUS_UPDATE", to: order.customerEmail, subject, result });
  return result;
}

// Envío manual: acá SÍ importa el resultado — el caller (controller) decide
// si contarlo contra el límite mensual y qué responder al vendedor.
export async function sendManualOrderEmail({ order, vendorName, subject, message }) {
  const { subject: finalSubject, html } = await vendorMessageEmail({ order, subject, message });
  const result = await sendViaResend({ to: order.customerEmail, subject: finalSubject, html, fromName: vendorName });
  await logEmail({ vendorId: order.vendorId, orderId: order.id, type: "MANUAL", to: order.customerEmail, subject: finalSubject, result });
  return result;
}

// El resultado SÍ importa acá: forgot-password no debe fingir éxito si el
// código nunca pudo salir (el usuario quedaría trabado sin poder resetear).
export async function sendPasswordResetEmail(user, code) {
  const { subject, html } = await passwordResetEmail({ fullName: user.fullName, code });
  const result = await sendViaResend({ to: user.email, subject, html });
  await logEmail({ vendorId: null, orderId: null, type: "PASSWORD_RESET", to: user.email, subject, result });
  return result;
}

// Best-effort (Bloque 16) — un evento del ciclo de verificación/cobro nunca
// debe bloquear la acción del admin que lo disparó (aprobar, generar link,
// confirmar pago) si Resend falla; el estado en DB ya cambió igual.
// Bloque 64 (bug real encontrado al extender esto): mandaba a `vendor.email`
// (contacto público OPCIONAL de la tienda, nunca cargado en esta base —
// confirmado en vivo que las 12 tiendas lo tienen null) en vez de
// `vendor.user.email` (el correo de LOGIN de la cuenta, mismo criterio que ya
// usa todo el ciclo de vida del vendedor en Bloque 62) — ningún correo de
// este ciclo se entregó nunca de verdad, silenciosamente. Los callers ahora
// incluyen `user` al pedir el vendor.
export async function sendVerificationUpdateEmail({ vendor, type, title, message, ctaHref }) {
  if (!vendor.user?.email) return;
  const { subject, html } = await verificationUpdateEmail({ type, vendorName: vendor.companyName, title, message, ctaHref });
  const result = await sendViaResend({ to: vendor.user.email, subject, html });
  await logEmail({ vendorId: vendor.id, orderId: null, type: "VERIFICATION_UPDATE", to: vendor.user.email, subject, result });
  return result;
}

// Bloque 64: aviso proactivo (no es un cambio de estado, por eso no pasa por
// notifyVerificationEvent ni deja rastro en la campanita) — mismo criterio
// que sendVendorInactivityReminderEmail (Bloque 62): email-only, best-effort,
// se re-envía siempre desde verificationPayment.job.js cuando corresponda.
export async function sendVerificationPaymentReminderEmail(vendor, daysUntilDue) {
  if (!vendor.user?.email) return { ok: false, error: "Sin correo de cuenta" };
  const { subject, html } = await verificationUpdateEmail({
    type: "VERIFICATION_PAYMENT_REMINDER",
    vendorName: vendor.companyName,
    title: "Tu pago de suscripción vence pronto",
    message: `Tu transferencia CUP del Plan Business vence en ${daysUntilDue} días. Súbela desde tu panel para no perder el badge de verificación.`,
    ctaHref: `${env.frontendUrl}/vendedor/pago-manual`,
  });
  const result = await sendViaResend({ to: vendor.user.email, subject, html });
  await logEmail({ vendorId: vendor.id, orderId: null, type: "VERIFICATION_PAYMENT_REMINDER", to: vendor.user.email, subject, result });
  return result;
}

// Bloque 29: factura/garantía en PDF — el resultado SÍ importa (el
// controller responde 502 al vendedor si Resend falla, mismo criterio que
// sendManualOrderEmail). Tipo DOCUMENT propio: no cuenta contra el límite
// mensual de emails manuales del Plan Regular, es una necesidad operativa
// básica (mandar el comprobante de una venta ya confirmada), no un extra.
export async function sendDocumentEmail({ to, vendorId, orderId, vendorName, subject, html, filename, pdfBuffer }) {
  const result = await sendViaResend({ to, subject, html, fromName: vendorName, attachments: [{ filename, content: pdfBuffer }] });
  await logEmail({ vendorId, orderId, type: "DOCUMENT", to, subject, result });
  return result;
}

// Best-effort — igual que sendOrderStatusEmail, disparado inmediatamente al
// cambiar kitchenStatus (ver tables.controller.js), nunca bloquea la
// respuesta al mesero/cocina si el email falla.
export async function sendTableOrderStatusEmail({ to, vendorId, vendorName, tableNumber, kitchenStatus }) {
  if (!to) return;
  const { subject, html } = await tableOrderStatusEmail({ vendorName, tableNumber, kitchenStatus });
  const result = await sendViaResend({ to, subject, html, fromName: vendorName });
  await logEmail({ vendorId, orderId: null, type: "TABLE_ORDER_STATUS", to, subject, result });
  return result;
}

// El resultado SÍ importa (mismo criterio que sendPasswordResetEmail): sin
// el código en el correo, el segundo paso del login queda trabado.
export async function sendTwoFactorCodeEmail(user, code) {
  const { subject, html } = await twoFactorCodeEmail({ fullName: user.fullName, code });
  const result = await sendViaResend({ to: user.email, subject, html });
  await logEmail({ vendorId: null, orderId: null, type: "TWO_FACTOR_CODE", to: user.email, subject, result });
  return result;
}

// El resultado SÍ importa (mismo criterio que sendPasswordResetEmail/
// sendTwoFactorCodeEmail): sin el código en el correo, el cambio de correo
// queda trabado. Va SIEMPRE a `user.email` (el correo VIEJO, ya en la
// cuenta) — nunca a `newEmail`, ver la nota en emailChangeCode.js.
export async function sendEmailChangeCodeEmail(user, code, newEmail) {
  const { subject, html } = await emailChangeCodeEmail({ fullName: user.fullName, code, newEmail });
  const result = await sendViaResend({ to: user.email, subject, html });
  await logEmail({ vendorId: null, orderId: null, type: "EMAIL_CHANGE_CODE", to: user.email, subject, result });
  return result;
}

// El resultado SÍ importa (mismo criterio que sendPasswordResetEmail/
// sendTwoFactorCodeEmail): sin el código en el correo, el registro queda
// trabado — `user` acá es un objeto plano { fullName, email }, no
// necesariamente un User real (ver PendingRegistration, todavía no existe
// ninguno cuando se manda este correo).
export async function sendRegistrationCodeEmail(user, code) {
  const { subject, html } = await registrationCodeEmail({ fullName: user.fullName, code });
  const result = await sendViaResend({ to: user.email, subject, html });
  await logEmail({ vendorId: null, orderId: null, type: "REGISTRATION_CODE", to: user.email, subject, result });
  return result;
}

// Bloque 47: correo puntual admin -> cliente/tienda (AdminChat.jsx, pestaña
// "Correo directo") — vendorId solo si el destinatario es una tienda, mismo
// EmailLog type MANUAL que sendManualOrderEmail (pedido explícito del bloque).
export async function sendAdminDirectEmail({ to, subject, message, recipientName, vendorId }) {
  const { subject: finalSubject, html } = await adminDirectEmail({ subject, message, recipientName });
  const result = await sendViaResend({ to, subject: finalSubject, html });
  await logEmail({ vendorId: vendorId ?? null, orderId: null, type: "MANUAL", to, subject: finalSubject, result });
  return result;
}

// Bloque 48: formulario público de /contacto — el resultado SÍ importa (el
// controller responde error al visitante si Resend falla, mismo criterio
// que sendManualOrderEmail), porque a diferencia de un email best-effort
// disparado después de una acción ya completada, acá el envío ES la acción
// completa: si falla, el mensaje del visitante se pierde sin que nadie del
// equipo se entere.
export async function sendContactMessageEmail({ to, name, email, message }) {
  const { subject, html } = await contactMessageEmail({ name, email, message });
  const result = await sendViaResend({ to, subject, html });
  await logEmail({ vendorId: null, orderId: null, type: "CONTACT_MESSAGE", to, subject, result });
  return result;
}

// --- Bloque 62: ciclo de vida de inactividad de tienda + re-enganche de
// clientes (vendorLifecycle.job.js) — best-effort en los 4, ninguno bloquea
// el job si Resend falla (ya se logueó en EmailLog para verlo en Admin >
// Errores). `vendor` acá siempre viene con `user` incluido (ver el job) —
// el destinatario es el correo de LOGIN de la cuenta (User.email), no
// Vendor.email (contacto público de la tienda): lo que importa es avisarle
// a quien de verdad entra al panel.
export async function sendVendorInactivityReminderEmail(vendor, daysInactive) {
  if (!vendor.user?.email) return { ok: false, error: "Sin correo de cuenta" };
  const { subject, html } = await vendorInactivityReminderEmail({ vendor, daysInactive });
  const result = await sendViaResend({ to: vendor.user.email, subject, html });
  await logEmail({ vendorId: vendor.id, orderId: null, type: "VENDOR_INACTIVITY_REMINDER", to: vendor.user.email, subject, result });
  return result;
}

export async function sendVendorSuspendedEmail(vendor, reason) {
  if (!vendor.user?.email) return { ok: false, error: "Sin correo de cuenta" };
  const { subject, html } = await vendorSuspendedEmail({ vendor, reason });
  const result = await sendViaResend({ to: vendor.user.email, subject, html });
  await logEmail({ vendorId: vendor.id, orderId: null, type: "VENDOR_SUSPENDED", to: vendor.user.email, subject, result });
  return result;
}

// Feature B — a diferencia del resto de sendVendorXEmail de arriba, estas 3
// no reciben un Vendor (el objetivo puede ser un dueño de venta rápida sin
// tienda) — reciben el User real (vendor.user o CustomerListing.owner) y
// vendorId aparte, solo para el log (null si no hay tienda de por medio).
// Ver fraudReportNotify.service.js para quién llama a cuál.
export async function sendFraudReportEvidenceRequestedEmail(user, vendorId, { targetLabel, message, deadlineDays, ctaUrl }) {
  const { subject, html } = await fraudReportEvidenceRequestedEmail({ fullName: user.fullName, targetLabel, message, deadlineDays, ctaUrl });
  const result = await sendViaResend({ to: user.email, subject, html });
  await logEmail({ vendorId, orderId: null, type: "FRAUD_REPORT_EVIDENCE_REQUESTED", to: user.email, subject, result });
  return result;
}

export async function sendFraudReportDismissedEmail(user, vendorId, { targetLabel, ctaUrl }) {
  const { subject, html } = await fraudReportDismissedEmail({ fullName: user.fullName, targetLabel, ctaUrl });
  const result = await sendViaResend({ to: user.email, subject, html });
  await logEmail({ vendorId, orderId: null, type: "FRAUD_REPORT_DISMISSED", to: user.email, subject, result });
  return result;
}

export async function sendFraudReportSuspendedEmail(user, vendorId, { targetLabel, reason }) {
  const { subject, html } = await fraudReportSuspendedEmail({ fullName: user.fullName, targetLabel, reason });
  const result = await sendViaResend({ to: user.email, subject, html });
  await logEmail({ vendorId, orderId: null, type: "FRAUD_REPORT_SUSPENDED", to: user.email, subject, result });
  return result;
}

export async function sendVendorReactivatedEmail(vendor, reason) {
  if (!vendor.user?.email) return { ok: false, error: "Sin correo de cuenta" };
  const { subject, html } = await vendorReactivatedEmail({ vendor, reason });
  const result = await sendViaResend({ to: vendor.user.email, subject, html });
  await logEmail({ vendorId: vendor.id, orderId: null, type: "VENDOR_REACTIVATED", to: vendor.user.email, subject, result });
  return result;
}

// A diferencia de los 3 de arriba, el destinatario es el CLIENTE (no el
// vendedor) — `fromName` firma el correo como la tienda, mismo criterio que
// sendOrderConfirmationEmail/sendManualOrderEmail.
export async function sendVendorWinbackEmail({ customer, vendor, offers }) {
  if (!customer.email) return { ok: false, error: "Cliente sin correo" };
  const { subject, html } = await vendorWinbackEmail({ customer, vendor, offers });
  const result = await sendViaResend({ to: customer.email, subject, html, fromName: vendor.companyName });
  await logEmail({ vendorId: vendor.id, orderId: null, type: "VENDOR_WINBACK", to: customer.email, subject, result });
  return result;
}
