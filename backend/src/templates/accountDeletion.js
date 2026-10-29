import { env } from "../config/env.js";
import { emailShell, ctaButton, paragraph, smallNote, esc } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Con la hora de Cuba, igual que el resto de las plantillas: el servidor corre en UTC y una fecha guardada de noche en Cuba
// salía con un día más.
function fmtDate(d) {
  return new Date(d).toLocaleDateString("es-CU", { day: "2-digit", month: "long", year: "numeric", timeZone: "America/Havana" });
}

// Bloque 211 (pedido explícito — auto-eliminación de cuenta con 30 días de
// gracia): un solo template con 4 variantes por `type`, mismo criterio ya
// usado por verificationUpdate.js para no repetir el shell 4 veces. Todas
// llevan `accountUrl` (a dónde volver a entrar) salvo COMPLETED, que ya no
// tiene a dónde volver.
export async function accountDeletionEmail({ type, fullName, scheduledFor, accountUrl }) {
  const { siteName } = await getBrandSettings();
  // El nombre lo escribe la persona al registrarse: va escapado dentro del cuerpo (title y preview los escapa emailShell).
  const greeting = fullName ? `Hola ${esc(fullName)}` : "Hola";
  const dateLabel = scheduledFor ? fmtDate(scheduledFor) : null;

  if (type === "REQUESTED") {
    return {
      subject: "Pediste eliminar tu cuenta. Así funciona el proceso",
      html: await emailShell({
        preview: `Tu cuenta queda suspendida 30 días y se elimina para siempre el ${dateLabel}`,
        title: "Confirmamos tu pedido de eliminación",
        badge: { label: "Cuenta suspendida", color: "#ba1a1a" },
        storeName: siteName,
        bodyMjml: `
          ${paragraph(`${greeting}, recibimos tu pedido de eliminar tu cuenta de ${esc(siteName)}.`)}
          ${paragraph(`Tu cuenta queda <strong>suspendida ahora mismo</strong>: no es visible ni se puede usar mientras dure este proceso.`)}
          ${paragraph(`Si no haces nada, el <strong>${dateLabel}</strong> se elimina de forma <strong>permanente e irrecuperable</strong>: se borran tus datos personales y no hay forma de volver atrás pasada esa fecha.`)}
          ${smallNote("¿Te arrepentiste? Puedes reactivarla tú mismo en cualquier momento antes de esa fecha. Solo entra a tu cuenta con tu contraseña de siempre y vas a ver un botón para reactivarla.")}
          ${ctaButton("Entrar a mi cuenta", accountUrl)}
        `,
      }),
    };
  }

  if (type === "REMINDER_7_DAYS") {
    return {
      subject: `Te quedan 7 días antes de que tu cuenta se elimine para siempre`,
      html: await emailShell({
        preview: `El ${dateLabel} tu cuenta se elimina de forma permanente. Todavía puedes reactivarla`,
        title: "Últimos 7 días para reactivar tu cuenta",
        badge: { label: "Recordatorio", color: "#8A5100" },
        storeName: siteName,
        bodyMjml: `
          ${paragraph(`${greeting}, hace unas semanas pediste eliminar tu cuenta de ${esc(siteName)}.`)}
          ${paragraph(`El <strong>${dateLabel}</strong> se cumplen los 30 días de gracia y tu cuenta se elimina de forma <strong>permanente</strong>. A partir de ahí no hay ninguna forma de recuperarla.`)}
          ${paragraph("Si cambiaste de opinión, todavía estás a tiempo.")}
          ${smallNote("Entra a tu cuenta con tu contraseña de siempre y vas a ver un botón para reactivarla. No hace falta nada más.")}
          ${ctaButton("Reactivar mi cuenta", accountUrl)}
        `,
      }),
    };
  }

  if (type === "REACTIVATED") {
    return {
      subject: "Tu cuenta fue reactivada",
      html: await emailShell({
        preview: "Cancelamos la eliminación: tu cuenta sigue funcionando con normalidad",
        title: "Tu cuenta está activa de nuevo",
        badge: { label: "Reactivada", color: "#0CAE53" },
        storeName: siteName,
        bodyMjml: `
          ${paragraph(`${greeting}, cancelamos el pedido de eliminación. Tu cuenta y tus datos siguen exactamente como los dejaste.`)}
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
      preview: "Se completó la eliminación de tu cuenta. Este proceso no se puede deshacer",
      title: "Tu cuenta fue eliminada",
      badge: { label: "Eliminada", color: "#ba1a1a" },
      storeName: siteName,
      bodyMjml: `
        ${paragraph(`${greeting}, se cumplieron los 30 días de gracia y tu cuenta de ${esc(siteName)} fue eliminada de forma permanente, tal como te avisamos.`)}
        ${paragraph("Tus datos personales fueron borrados y esta acción no se puede deshacer.")}
        ${smallNote(`Si en algún momento quieres volver, siempre puedes crear una cuenta nueva en ${env.frontendUrl}.`)}
      `,
    }),
  };
}
