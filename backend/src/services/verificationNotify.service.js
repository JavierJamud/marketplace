import { prisma } from "../lib/prisma.js";
import { sendVerificationUpdateEmail } from "../lib/email.js";
import { env } from "../config/env.js";

// Textos de los 4 eventos del ciclo de verificación/cobro (Bloque 16) — un
// solo lugar para los dos canales (email + campanita), así ninguno de los
// puntos de avance del ciclo (aprobar docs, rechazar, generar link, callback
// de tarjeta, confirmar CUP) se olvida de avisar por alguno de los 2 medios.
const EVENTS = {
  VERIFICATION_DOCS_APPROVED: {
    title: "Documentos aprobados",
    body: () => "Tus documentos de verificación fueron aprobados. Elegí cómo pagar tu suscripción para activar el badge y el Plan Business.",
  },
  VERIFICATION_DOCS_REJECTED: {
    title: "Documentos rechazados",
    body: (notes) => `Tus documentos fueron rechazados. Motivo: ${notes?.trim() || "sin especificar"}. Podés volver a enviarlos desde tu panel.`,
  },
  VERIFICATION_PAYMENT_LINK_SENT: {
    title: "Link de pago enviado",
    body: () => "Te enviamos por correo un link de pago para activar la suscripción del Plan Business.",
  },
  VERIFICATION_VERIFIED: {
    title: "¡Tu tienda está verificada!",
    body: () => "Ya tenés el badge de verificación y el Plan Business activo.",
  },
};

export async function notifyVerificationEvent(vendor, type, { notes, ctaHref } = {}) {
  const meta = EVENTS[type];
  const body = meta.body(notes);

  await Promise.all([
    prisma.vendorNotification.create({ data: { vendorId: vendor.id, type, title: meta.title, body } }),
    sendVerificationUpdateEmail({
      vendor,
      type,
      title: meta.title,
      message: body,
      ctaHref: ctaHref ?? `${env.frontendUrl}/vendedor/verificacion`,
    }),
  ]);
}
