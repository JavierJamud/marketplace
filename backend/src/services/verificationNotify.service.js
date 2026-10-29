import { prisma } from "../lib/prisma.js";
import { sendVerificationUpdateEmail } from "../lib/email.js";
import { env } from "../config/env.js";
import { planDisplayName, getDefaultPlanKey, getTrialPlanKey } from "../lib/planConfig.js";

// Textos de los 4 eventos del ciclo de verificación/cobro (Bloque 16) — un
// solo lugar para los dos canales (email + campanita), así ninguno de los
// puntos de avance del ciclo (aprobar docs, rechazar, generar link, callback
// de tarjeta, confirmar CUP) se olvida de avisar por alguno de los 2 medios.
// Los nombres de los planes NO van escritos aquí: hay varios planes de pago y el admin los crea y renombra. Cada `body` (y
// `title` cuando es una función) recibe `plans` con los nombres de la base, armados en notifyVerificationEvent:
//   plans.current  = el plan de la tienda en el momento del aviso (ya con el cambio hecho),
//   plans.default  = el plan por defecto (isDefault, al que vuelve una tienda que deja de pagar),
//   plans.trial    = el plan de la prueba gratis (isTrialPlan).
const EVENTS = {
  // Bloque 145 (pedido explícito): el cuerpo ahora avisa el plazo real de 24h
  // — antes no decía nada sobre un vencimiento, así que el vendedor no tenía
  // forma de saber que la aprobación caduca si no elige un método de pago a
  // tiempo (ver expireStalePendingPaymentApprovals, verificationPayment.job.js).
  VERIFICATION_DOCS_APPROVED: {
    title: "Documentos aprobados",
    body: () =>
      "Tus documentos de verificación fueron aprobados. Elige cómo pagar tu suscripción para activar la insignia y tu plan. Tienes 24 horas desde ahora para elegir el método y confirmar el pago, o vas a tener que volver a enviar tus documentos.",
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
    title: "Enlace de pago enviado",
    body: () => "Te enviamos por correo un enlace de pago para activar la suscripción de tu plan.",
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
      `El equipo restableció el método de pago de tu suscripción${notes ? ` (${notes})` : ""}. Entra a tu panel y elige de nuevo cómo vas a pagar.`,
  },
  VERIFICATION_VERIFIED: {
    title: "¡Tu tienda está verificada!",
    body: (_notes, _vendor, plans) => `Ya tienes la insignia de verificación y el plan ${plans.current} activo.`,
  },
  // Bloque 46: el admin revoca el plan de pago desde Suscripciones — nunca
  // es un vencimiento automático (ver nota de "Opción A" del bloque), así
  // que siempre hay un motivo humano detrás de este evento.
  VERIFICATION_BUSINESS_REVOKED: {
    title: "Plan de pago retirado",
    body: (notes, _vendor, plans) =>
      `Tu tienda volvió al plan ${plans.default}: perdiste la insignia de verificación y las funciones de tu plan de pago. Motivo: ${notes?.trim() || "sin especificar"}. Puedes volver a verificarte cuando quieras desde tu panel.`,
  },
  // Bloque 52 (pedido explícito — "podemos activar la suscripción
  // manualmente desde el panel de administrador... se debe justificar y
  // poner el motivo"): activación manual, sin pasar por el ciclo normal de
  // documentos/pago — siempre tiene un motivo humano detrás, igual que la
  // revocación de arriba.
  VERIFICATION_BUSINESS_GRANTED: {
    title: (plans) => `¡Tu tienda pasó al plan ${plans.current}!`,
    body: (notes, _vendor, plans) =>
      `El equipo activó el plan ${plans.current} y la insignia de verificación de tu tienda. Motivo: ${notes?.trim() || "sin especificar"}.`,
  },
  // Bloque 235: a diferencia de VERIFICATION_BUSINESS_GRANTED de arriba, acá nunca hay un admin detrás: lo disparó el propio
  // vendedor al completar el checklist de la prueba (ver trialEligibility.service.js). Los días y la fecha de fin salen de la
  // propia tienda (la duración la configura el admin). Al terminar la prueba vuelve al plan por defecto (isDefault) y pierde
  // también la insignia si ese plan no la da (grantsBadge).
  TRIAL_ACTIVATED: {
    title: (plans) => `¡Tu tienda pasó al plan ${plans.current} con la prueba gratis!`,
    body: (_notes, vendor, plans) => {
      const end = vendor?.trialEndsAt ? new Date(vendor.trialEndsAt).toLocaleDateString("es-CU", { day: "numeric", month: "long", timeZone: "America/Havana" }) : null;
      return `Completaste todo lo necesario y tu tienda ya tiene la insignia de verificación y el plan ${plans.current} activo, sin costo${end ? `, hasta el ${end}` : ""}. Cuando falten pocos días te avisamos para que decidas si quieres seguir.`;
    },
  },
  // Al vencer, la tienda ya está en el plan por defecto: el plan de la prueba sale del cambio de plan recién anotado (ver
  // planNamesFor), con la bandera isTrialPlan de respaldo.
  TRIAL_EXPIRED: {
    title: (plans) => `Tu prueba gratis del plan ${plans.trial} terminó`,
    body: (_notes, _vendor, plans) =>
      `Tu tienda vuelve al plan ${plans.default}: pierde la insignia de verificación y las funciones del plan ${plans.trial}. Tus documentos siguen aprobados, así que puedes volver al plan ${plans.trial} cuando quieras pagando desde tu panel, sin repetir la verificación.`,
  },
  // Bloque 64: cobro recurrente — PAYMENT_FAILED es recuperable (pagar de
  // nuevo reactiva sin rehacer documentos); SUSPENDED implica que la
  // suscripción de Stripe ya no existe (necesita una nueva desde cero).
  VERIFICATION_PAYMENT_FAILED: {
    title: "No pudimos cobrar tu suscripción",
    body: (_notes, _vendor, plans) =>
      `No pudimos cobrar tu plan y tu tienda pasó al plan ${plans.default} por ahora. Si pagas con tarjeta, entra a Suscripción en tu panel y pon otra tarjeta: se cobra en el momento y recuperas todo. Si pagas en CUP, completa la transferencia desde el mismo lugar. No hace falta volver a subir tus documentos.`,
  },
  VERIFICATION_SUSPENDED: {
    title: "Tu suscripción fue suspendida",
    body: (_notes, _vendor, plans) =>
      `Tu suscripción ya no está activa y tu tienda pasó al plan ${plans.default}, sin la insignia de verificación. Puedes iniciar una suscripción nueva desde tu panel cuando quieras (tus documentos ya aprobados siguen valiendo).`,
  },
  // Bloque 153 (pedido explícito — "el admin debe aprobar los demás meses
  // pagos"): confirma una RENOVACIÓN (meses extra pagados mientras la
  // tienda ya estaba verificada) — distinto de VERIFICATION_VERIFIED, que
  // es la primera activación.
  SUBSCRIPTION_RENEWAL_CONFIRMED: {
    title: "Renovación confirmada",
    body: (notes, _vendor, plans) => `Confirmamos tu renovación: tu plan ${plans.current} sigue activo${notes ? ` ${notes}` : ""}.`,
  },
  // Bloque 153 (pedido explícito — "todos los datos de la tienda no se
  // pueden modificar después de estar verificadas sin aprobación del
  // admin"): desenlace de una solicitud de cambio de identidad.
  VENDOR_CHANGE_REQUEST_APPROVED: {
    title: "Solicitud de cambio aprobada",
    body: () => "El equipo aprobó tu solicitud de cambio de datos y ya se aplicó a tu tienda.",
  },
  VENDOR_CHANGE_REQUEST_REJECTED: {
    title: "Solicitud de cambio rechazada",
    body: (notes) => `Tu solicitud de cambio de datos fue rechazada. Motivo: ${notes?.trim() || "sin especificar"}.`,
  },
};

// Nombres de los planes para los textos, leídos de la base (caché de 5 s). El plan actual se lee SIEMPRE de la base cuando
// hay vendor.id, aunque quien llama traiga planType: varios llamadores pasan el vendor leído ANTES de cambiarle el plan
// (p. ej. confirmar una renovación que sube de plan) y el aviso nombraría el plan viejo. Todos avisan después de guardar el
// cambio, así que la lectura fresca da el plan nuevo. Sin id se usa el planType que venga.
async function planNamesFor(vendor, type) {
  const fresh = vendor?.id ? await prisma.vendor.findUnique({ where: { id: vendor.id }, select: { planType: true } }) : null;
  const currentKey = fresh?.planType ?? vendor?.planType ?? null;
  // Al terminar la prueba la tienda ya está en el plan por defecto, así que el plan de la prueba se toma del cambio de plan
  // que se acaba de anotar (reason "trial_end", los dos caminos que mandan TRIAL_EXPIRED lo usan). La bandera isTrialPlan
  // queda de respaldo: si el admin la movió a otro plan durante la prueba, nombraría un plan que la tienda nunca tuvo.
  // Solo cambios recientes, para no tomar el final de una prueba anterior.
  const trialChange =
    type === "TRIAL_EXPIRED" && vendor?.id
      ? await prisma.vendorPlanChange.findFirst({
          where: { vendorId: vendor.id, reason: "trial_end", createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
          orderBy: { createdAt: "desc" },
          select: { fromPlan: true },
        })
      : null;
  const [current, def, trial] = await Promise.all([
    currentKey ? planDisplayName(currentKey) : "",
    getDefaultPlanKey().then(planDisplayName),
    trialChange?.fromPlan ? planDisplayName(trialChange.fromPlan) : getTrialPlanKey().then(planDisplayName),
  ]);
  return { current: current || "de pago", default: def, trial };
}

export async function notifyVerificationEvent(vendor, type, { notes, ctaHref } = {}) {
  const meta = EVENTS[type];
  const plans = await planNamesFor(vendor, type);
  const body = meta.body(notes, vendor, plans);
  const title = typeof meta.title === "function" ? meta.title(plans) : meta.title;

  await Promise.all([
    prisma.vendorNotification.create({ data: { vendorId: vendor.id, type, title, body } }),
    sendVerificationUpdateEmail({
      vendor,
      type,
      title,
      message: body,
      ctaHref: ctaHref ?? `${env.frontendUrl}/vendedor/verificacion`,
    }),
  ]);
}
