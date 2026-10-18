import { prisma } from "./prisma.js";
import { sendAdminDirectEmail } from "./email.js";
import { notifyAdmins } from "./notify.js";

// Bloque 66: "el admin será notificado inmediatamente vía correo electrónico
// cuando haya que aprobar algo en el sistema" — mismo criterio de "un solo
// admin implícito" que /contacto (Bloque 48). Best-effort a propósito: nunca
// debe bloquear la respuesta al usuario que disparó la acción si Resend
// falla. Extraído a un lib compartido en Bloque 69 (antes vivía solo,
// duplicado en potencia, dentro de verification.controller.js — reviews.
// controller.js es el segundo consumidor real).
// `url`: a dónde lleva el aviso push al tocarlo (por defecto, verificaciones o el panel).
export async function notifyAdminActionNeeded(subject, message, vendorId, { url } = {}) {
  // Además del correo, aviso en vivo y push al equipo (ver lib/notify.js).
  const category = /verific|pago|tienda|suscrip/i.test(String(subject)) ? "vendors" : "approvals";
  void notifyAdmins({ category, title: String(subject).replace(/^[^\p{L}\p{N}]+/u, "").slice(0, 100), body: String(message ?? "").replace(/\s+/g, " ").slice(0, 200), url: url ?? (/verific|pago/i.test(String(subject)) ? "/admin/verificaciones" : "/admin"), tag: `admin-${String(subject).slice(0, 40)}` }).catch(() => {});
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  if (!admin?.email) return;
  // Saludo neutro: el nombre del admin es privado y nunca va en correos.
  await sendAdminDirectEmail({ to: admin.email, subject, message, recipientName: "Administrador", vendorId }).catch(() => {});
}
