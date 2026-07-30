import { prisma } from "./prisma.js";
import { sendAdminDirectEmail } from "./email.js";

// Bloque 66: "el admin será notificado inmediatamente vía correo electrónico
// cuando haya que aprobar algo en el sistema" — mismo criterio de "un solo
// admin implícito" que /contacto (Bloque 48). Best-effort a propósito: nunca
// debe bloquear la respuesta al usuario que disparó la acción si Resend
// falla. Extraído a un lib compartido en Bloque 69 (antes vivía solo,
// duplicado en potencia, dentro de verification.controller.js — reviews.
// controller.js es el segundo consumidor real).
export async function notifyAdminActionNeeded(subject, message, vendorId) {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  if (!admin?.email) return;
  await sendAdminDirectEmail({ to: admin.email, subject, message, recipientName: admin.fullName, vendorId }).catch(() => {});
}
