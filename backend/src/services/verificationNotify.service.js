import { prisma } from "../lib/prisma.js";
import { sendVerificationUpdateEmail } from "../lib/email.js";
import { env } from "../config/env.js";

// Textos de los 4 eventos del ciclo de verificación/cobro (Bloque 16) — un
// solo lugar para los dos canales (email + campanita), así ninguno de los
// puntos de avance del ciclo (aprobar docs, rechazar, generar link, callback
// de tarjeta, confirmar CUP) se olvida de avisar por alguno de los 2 medios.
const EVENTS = {
  // Bloque 145 (pedido explícito): el cuerpo ahora avisa el plazo real de 24h
  // — antes no decía nada sobre un vencimiento, así que el vendedor no tenía
  // forma de saber que la aprobación caduca si no elige un método de pago a
  // tiempo (ver expireStalePendingPaymentApprovals, verificationPayment.job.js).
  VERIFICATION_DOCS_APPROVED: {
    title: "Documentos aprobados",
    body: () =>
      "Tus documentos de verificación fueron aprobados. Elige cómo pagar tu suscripción para activar el badge y el Plan Business — tienes 24 horas desde ahora para elegir el método y confirmar el pago, o vas a tener que volver a enviar tus documentos.",
  },
  VERIFICATION_DOCS_REJECTED: {
    title: "Documentos rechazados",
    body: (notes) => `Tus documentos fueron rechazados. Motivo: ${notes?.trim() || "sin especificar"}. Puedes volver a enviarlos desde tu panel.`,
  },
  // Bloque 145: distinto de VERIFICATION_DOCS_REJECTED a propósito — acá no
  // hubo ningún problema con los documentos (ya estaban aprobados), lo que
  // pasó es que se venció el plazo de 24h para el pago sin que se
  // completara. El mensaje tiene que ser claro sobre eso, no sonar a un
  // rechazo de la solicitud original.
  VERIFICATION_APPROVAL_EXPIRED: {
    title: "Venció el plazo para completar el pago",
    body: () =>
      "Tus documentos habían sido aprobados, pero pasaron más de 24 horas sin elegir un método de pago ni confirmar el pago de la suscripción. Tienes que volver a enviar tus documentos para verificarte.",
  },
  VERIFICATION_PAYMENT_LINK_SENT: {
    title: "Link de pago enviado",
    body: () => "Te enviamos por correo un link de pago para activar la suscripción del Plan Business.",
  },
  // Bloque 150 (pedido explícito): Stripe ya confirmó el cobro, pero eso ya
  // no alcanza para activar solo — falta que el vendedor suba su captura
  // del pago (o marque que no pudo) para que un admin finalice, igual que
  // ya pasaba con la transferencia CUP.
  VERIFICATION_STRIPE_PAID: {
    title: "Recibimos tu pago",
    body: () =>
      "Stripe confirmó tu pago. Sube la captura de pantalla del pago (o indica que no pudiste hacerla) desde tu panel para que el equipo confirme y active tu verificación.",
  },
  // Bloque 151 (pedido explícito): el admin restableció el método de pago
  // que habías elegido — cualquier comprobante/dato que hayas mandado para
  // ese método quedó descartado, hay que elegir de nuevo.
  VERIFICATION_PAYMENT_METHOD_RESET: {
    title: "Tienes que elegir de nuevo cómo pagar",
    body: (notes) =>
      `El equipo restableció el método de pago de tu suscripción${notes ? ` (${notes})` : ""} — entra a tu panel y elige de nuevo cómo vas a pagar.`,
  },
  VERIFICATION_VERIFIED: {
    title: "¡Tu tienda está verificada!",
    body: () => "Ya tienes el badge de verificación y el Plan Business activo.",
  },
  // Bloque 46: el admin revoca el Plan Business desde Suscripciones — nunca
  // es un vencimiento automático (ver nota de "Opción A" del bloque), así
  // que siempre hay un motivo humano detrás de este evento.
  VERIFICATION_BUSINESS_REVOKED: {
    title: "Plan Business revocado",
    body: (notes) =>
      `Tu tienda volvió al Plan Regular — perdiste el badge de verificación y las funciones Premium. Motivo: ${notes?.trim() || "sin especificar"}. Puedes volver a verificarte cuando quieras desde tu panel.`,
  },
  // Bloque 52 (pedido explícito — "podemos activar la suscripción
  // manualmente desde el panel de administrador... se debe justificar y
  // poner el motivo"): activación manual, sin pasar por el ciclo normal de
  // documentos/pago — siempre tiene un motivo humano detrás, igual que la
  // revocación de arriba.
  VERIFICATION_BUSINESS_GRANTED: {
    title: "¡Tu tienda pasó a Plan Premium!",
    body: (notes) =>
      `El equipo activó el Plan Premium y el badge de verificación de tu tienda. Motivo: ${notes?.trim() || "sin especificar"}.`,
  },
  // Bloque 235: a diferencia de VERIFICATION_BUSINESS_GRANTED de arriba, acá nunca hay un admin detrás: lo disparó el propio
  // vendedor al completar el checklist de la prueba (ver trialEligibility.service.js). Los días y la fecha de fin salen de la
  // propia tienda (la duración la configura el admin). Al terminar la prueba vuelve al Regular y pierde también la insignia:
  // el plan Regular no la lleva (pedido explícito).
  TRIAL_ACTIVATED: {
    title: "¡Tu tienda pasó a Plan Premium con la prueba gratis!",
    body: (_notes, vendor) => {
      const end = vendor?.trialEndsAt ? new Date(vendor.trialEndsAt).toLocaleDateString("es-CU", { day: "numeric", month: "long", timeZone: "America/Havana" }) : null;
      return `Completaste todo lo necesario y tu tienda ya tiene la insignia de verificación y el Plan Premium activo, sin costo${end ? `, hasta el ${end}` : ""}. Cuando falten pocos días te avisamos para que decidas si quieres seguir.`;
    },
  },
  TRIAL_EXPIRED: {
    title: "Tu prueba gratis del Plan Premium terminó",
    body: () =>
      "Tu tienda vuelve al Plan Regular: pierde la insignia de verificación y las funciones Premium (asistente con IA, destacado en la página principal, etc.). Tus documentos siguen aprobados, así que puedes volver a Premium cuando quieras pagando desde tu panel, sin repetir la verificación.",
  },
  // Bloque 64: cobro recurrente — PAYMENT_FAILED es recuperable (pagar de
  // nuevo reactiva sin rehacer documentos); SUSPENDED implica que la
  // suscripción de Stripe ya no existe (necesita una nueva desde cero).
  VERIFICATION_PAYMENT_FAILED: {
    title: "No pudimos cobrar tu suscripción",
    body: () =>
      "No pudimos cobrar tu plan y tu tienda pasó al Plan Regular por ahora. Si pagas con tarjeta, entra a Suscripción en tu panel y pon otra tarjeta: se cobra en el momento y recuperas todo. Si pagas en CUP, completa la transferencia desde el mismo lugar. No hace falta volver a subir tus documentos.",
  },
  VERIFICATION_SUSPENDED: {
    title: "Tu suscripción fue suspendida",
    body: () =>
      "Tu suscripción del Plan Premium ya no está activa y tu tienda pasó al Plan Regular, sin la insignia de verificación. Puedes iniciar una suscripción nueva desde tu panel cuando quieras (tus documentos ya aprobados siguen valiendo).",
  },
  // Bloque 153 (pedido explícito — "el admin debe aprobar los demás meses
  // pagos"): confirma una RENOVACIÓN (meses extra pagados mientras la
  // tienda ya estaba verificada) — distinto de VERIFICATION_VERIFIED, que
  // es la primera activación.
  SUBSCRIPTION_RENEWAL_CONFIRMED: {
    title: "Renovación confirmada",
    body: (notes) => `Confirmamos tu renovación: tu Plan Premium sigue activo${notes ? ` ${notes}` : ""}.`,
  },
  // Bloque 153 (pedido explícito — "todos los datos de la tienda no se
  // pueden modificar después de estar verificadas sin aprobación del
  // admin"): desenlace de una solicitud de cambio de identidad.
  VENDOR_CHANGE_REQUEST_APPROVED: {
    title: "Solicitud de cambio aprobada",
    body: () => "El equipo aprobó tu solicitud de cambio de datos — ya se aplicó a tu tienda.",
  },
  VENDOR_CHANGE_REQUEST_REJECTED: {
    title: "Solicitud de cambio rechazada",
    body: (notes) => `Tu solicitud de cambio de datos fue rechazada. Motivo: ${notes?.trim() || "sin especificar"}.`,
  },
};

export async function notifyVerificationEvent(vendor, type, { notes, ctaHref } = {}) {
  const meta = EVENTS[type];
  const body = meta.body(notes, vendor);

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
