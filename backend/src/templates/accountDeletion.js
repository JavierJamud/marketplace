import { env } from "../config/env.js";
import { emailShell, ctaButton, paragraph, smallNote } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

function fmtDate(d) {
  return new Date(d).toLocaleDateString("es-CU", { day: "2-digit", month: "long", year: "numeric" });
}

// Bloque 211 (pedido explícito — auto-eliminación de cuenta con 30 días de
// gracia): un solo template con 4 variantes por `type`, mismo criterio ya
// usado por verificationUpdate.js para no repetir el shell 4 veces. Todas
// llevan `accountUrl` (a dónde volver a entrar) salvo COMPLETED, que ya no
// tiene a dónde volver.
export async function accountDeletionEmail({ type, fullName, scheduledFor, accountUrl }) {
  const { siteName } = await getBrandSettings();
  const greeting = fullName ? `Hola ${fullName}` : "Hola";
  const dateLabel = scheduledFor ? fmtDate(scheduledFor) : null;

  if (type === "REQUESTED") {
    return {
      subject: "Pediste eliminar tu cuenta — así funciona el proceso",
      html: await emailShell({
        preview: `Tu cuenta queda suspendida 30 días — se elimina para siempre el ${dateLabel}`,
        title: "Confirmamos tu pedido de eliminación",
        badge: { label: "Cuenta suspendida", color: "#ba1a1a" },
        storeName: siteName,
        bodyMjml: `
          ${paragraph(`${greeting}, recibimos tu pedido de eliminar tu cuenta de ${siteName}.`)}
          ${paragraph(`Tu cuenta queda <strong>suspendida ahora mismo</strong> — no es visible ni se puede usar mientras dure este proceso.`)}
          ${paragraph(`Si no haces nada, el <strong>${dateLabel}</strong> se elimina de forma <strong>permanente e irrecuperable</strong>: se borran tus datos personales y no hay forma de volver atrás pasada esa fecha.`)}
          ${smallNote("¿Te arrepentiste? Puedes reactivarla vos mismo en cualquier momento antes de esa fecha — solo entra a tu cuenta con tu contraseña de siempre y vas a ver un botón para reactivarla.")}
          ${ctaButton("Entrar a mi cuenta", accountUrl)}
        `,
      }),
    };
  }

  if (type === "REMINDER_7_DAYS") {
    return {
      subject: `Te quedan 7 días antes de que tu cuenta se elimine para siempre`,
      html: await emailShell({
        preview: `El ${dateLabel} tu cuenta se elimina de forma permanente — todavía puedes reactivarla`,
        title: "Últimos 7 días para reactivar tu cuenta",
        badge: { label: "Recordatorio", color: "#8A5100" },
        storeName: siteName,
        bodyMjml: `
          ${paragraph(`${greeting}, hace unas semanas pediste eliminar tu cuenta de ${siteName}.`)}
          ${paragraph(`El <strong>${dateLabel}</strong> se cumplen los 30 días de gracia y tu cuenta se elimina de forma <strong>permanente</strong> — a partir de ahí no hay ninguna forma de recuperarla.`)}
          ${paragraph("Si cambiaste de opinión, todavía estás a tiempo.")}
          ${smallNote("Entra a tu cuenta con tu contraseña de siempre y vas a ver un botón para reactivarla — no hace falta nada más.")}
          ${ctaButton("Reactivar mi cuenta", accountUrl)}
        `,
      }),
    };
  }

  if (type === "REACTIVATED") {
    return {
      subject: "Tu cuenta fue reactivada",
      html: await emailShell({
        preview: "Cancelamos la eliminación — tu cuenta sigue funcionando con normalidad",
        title: "Tu cuenta está activa de nuevo",
        badge: { label: "Reactivada", color: "#0CAE53" },
        storeName: siteName,
        bodyMjml: `
          ${paragraph(`${greeting}, cancelamos el pedido de eliminación — tu cuenta y tus datos siguen exactamente como los dejaste.`)}
          ${ctaButton("Ir a mi cuenta", accountUrl)}
        `,
      }),
    };
  }

  // COMPLETED — se manda a la dirección real, ANTES de que se reescriba por
  // la anonimizada (ver finalizeUserDeletion en lib/accountDeletion.js).
  return {
    subject: "Tu cuenta fue eliminada de forma permanente",
    html: await emailShell({
      preview: "Se completó la eliminación de tu cuenta — este proceso no se puede deshacer",
      title: "Tu cuenta fue eliminada",
      badge: { label: "Eliminada", color: "#ba1a1a" },
      storeName: siteName,
      bodyMjml: `
        ${paragraph(`${greeting}, se cumplieron los 30 días de gracia y tu cuenta de ${siteName} fue eliminada de forma permanente, tal como te avisamos.`)}
        ${paragraph("Tus datos personales fueron borrados y esta acción no se puede deshacer.")}
        ${smallNote(`Si en algún momento quieres volver, siempre puedes crear una cuenta nueva en ${env.frontendUrl}.`)}
      `,
    }),
  };
}
