import { Resend } from "resend";
import { prisma } from "./prisma.js";
import { getIntegrationConfig } from "../controllers/integrations.controller.js";
import { logError } from "./errorLog.js";
import { orderConfirmationEmail } from "../templates/orderConfirmation.js";
import { statusUpdateEmail } from "../templates/statusUpdate.js";
import { vendorMessageEmail } from "../templates/vendorMessage.js";
import { passwordResetEmail } from "../templates/passwordReset.js";
import { verificationUpdateEmail } from "../templates/verificationUpdate.js";
import { tableOrderStatusEmail } from "../templates/tableOrderStatus.js";
import { twoFactorCodeEmail } from "../templates/twoFactorCode.js";
import { adminDirectEmail } from "../templates/adminDirectEmail.js";

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
  const displayName = fromName ? `${fromName} vía ZeuDin` : "ZeuDin";

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
  const { subject, html } = orderConfirmationEmail(order);
  const result = await sendViaResend({ to: order.customerEmail, subject, html, fromName: order.vendor.companyName });
  await logEmail({ vendorId: order.vendorId, orderId: order.id, type: "ORDER_CONFIRMATION", to: order.customerEmail, subject, result });
  return result;
}

// Best-effort: disparado inmediatamente al cambiar el estado (no batch/cron).
export async function sendOrderStatusEmail(order) {
  if (!order.customerEmail) return;
  const { subject, html } = statusUpdateEmail(order);
  const result = await sendViaResend({ to: order.customerEmail, subject, html, fromName: order.vendor.companyName });
  await logEmail({ vendorId: order.vendorId, orderId: order.id, type: "STATUS_UPDATE", to: order.customerEmail, subject, result });
  return result;
}

// Envío manual: acá SÍ importa el resultado — el caller (controller) decide
// si contarlo contra el límite mensual y qué responder al vendedor.
export async function sendManualOrderEmail({ order, vendorName, subject, message }) {
  const { html } = vendorMessageEmail({ order, subject, message });
  const result = await sendViaResend({ to: order.customerEmail, subject, html, fromName: vendorName });
  await logEmail({ vendorId: order.vendorId, orderId: order.id, type: "MANUAL", to: order.customerEmail, subject, result });
  return result;
}

// El resultado SÍ importa acá: forgot-password no debe fingir éxito si el
// código nunca pudo salir (el usuario quedaría trabado sin poder resetear).
export async function sendPasswordResetEmail(user, code) {
  const { subject, html } = passwordResetEmail({ fullName: user.fullName, code });
  const result = await sendViaResend({ to: user.email, subject, html });
  await logEmail({ vendorId: null, orderId: null, type: "PASSWORD_RESET", to: user.email, subject, result });
  return result;
}

// Best-effort (Bloque 16) — un evento del ciclo de verificación/cobro nunca
// debe bloquear la acción del admin que lo disparó (aprobar, generar link,
// confirmar pago) si Resend falla; el estado en DB ya cambió igual.
export async function sendVerificationUpdateEmail({ vendor, type, title, message, ctaHref }) {
  if (!vendor.email) return;
  const { subject, html } = verificationUpdateEmail({ type, vendorName: vendor.companyName, title, message, ctaHref });
  const result = await sendViaResend({ to: vendor.email, subject, html });
  await logEmail({ vendorId: vendor.id, orderId: null, type: "VERIFICATION_UPDATE", to: vendor.email, subject, result });
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
  const { subject, html } = tableOrderStatusEmail({ vendorName, tableNumber, kitchenStatus });
  const result = await sendViaResend({ to, subject, html, fromName: vendorName });
  await logEmail({ vendorId, orderId: null, type: "TABLE_ORDER_STATUS", to, subject, result });
  return result;
}

// El resultado SÍ importa (mismo criterio que sendPasswordResetEmail): sin
// el código en el correo, el segundo paso del login queda trabado.
export async function sendTwoFactorCodeEmail(user, code) {
  const { subject, html } = twoFactorCodeEmail({ fullName: user.fullName, code });
  const result = await sendViaResend({ to: user.email, subject, html });
  await logEmail({ vendorId: null, orderId: null, type: "TWO_FACTOR_CODE", to: user.email, subject, result });
  return result;
}

// Bloque 47: correo puntual admin -> cliente/tienda (AdminChat.jsx, pestaña
// "Correo directo") — vendorId solo si el destinatario es una tienda, mismo
// EmailLog type MANUAL que sendManualOrderEmail (pedido explícito del bloque).
export async function sendAdminDirectEmail({ to, subject, message, recipientName, vendorId }) {
  const { html } = adminDirectEmail({ subject, message, recipientName });
  const result = await sendViaResend({ to, subject, html });
  await logEmail({ vendorId: vendorId ?? null, orderId: null, type: "MANUAL", to, subject, result });
  return result;
}
