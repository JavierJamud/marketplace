import Stripe from "stripe";
import { AppError } from "../utils/AppError.js";
import { env } from "../config/env.js";
import { getStripeConfig } from "../controllers/integrations.controller.js";
import { getBrandSettings } from "../controllers/settings.controller.js";
import { prisma } from "./prisma.js";
import { getPlanConfig, buildPlanIncludes } from "./planConfig.js";

// Bloque 25: reemplaza el checkout simulado (PaymentLink.jsx) por un
// Checkout Session real de Stripe. CUP no es una moneda soportada por
// Stripe (no es convertible internacionalmente) — el cobro real es en USD.
// Bloque 150: el precio ya NO es una constante — es editable desde el admin
// (SiteSettings.cardSubscriptionPriceUsd, ver getSubscriptionPricing en
// settings.controller.js). Este valor queda solo como FALLBACK de último
// recurso (si por lo que sea la consulta a settings fallara en algún punto
// que todavía no se migró a leerlo de ahí).
export const SUBSCRIPTION_PRICE_USD = 25;

export async function getStripeClient() {
  const config = await getStripeConfig();
  if (!config?.secretKey) return null;
  return new Stripe(config.secretKey);
}

export async function isStripeConfigured() {
  return (await getStripeClient()) !== null;
}

// metadata.verificationId es lo que el webhook usa para saber qué
// solicitud activar — nunca se confía en "el vendedor dice que pagó" del
// lado del cliente (ver stripeWebhook.controller.js).
// Bloque 150 (pedido explícito — "el cliente podrá seleccionar cuántos
// meses desea pagar... se generará un enlace directamente para que el
// cliente pague esa cantidad de meses"): pasa de `mode:"subscription"`
// (cobro recurrente automático mes a mes, Bloque 64) a `mode:"payment"` —
// un cobro ÚNICO por el monto total de los `months` elegidos (precio
// mensual × months, ya calculado por quien llama). Stripe ya NO crea una
// Subscription ni vuelve a cobrar solo cuando ese bloque de meses se
// termina — renovar es elegir método de pago de nuevo (mismo flujo que ya
// usa CUP_TRANSFER, ver chooseMyPaymentMethod). Además, confirmar el cobro
// (checkout.session.completed) ya NO activa la verificación por sí solo —
// deja la marca `stripePaidAt` y el vendedor sube su comprobante igual que
// con CUP, un admin finaliza a mano (ver confirmSubscriptionPayment).
// Bloque 153: extraído a una base compartida — el ciclo INICIAL
// (verificationId en metadata) y una RENOVACIÓN mientras ya está VERIFIED
// (subscriptionPaymentId en metadata, ver SubscriptionPayment) arman un
// Checkout Session idéntico salvo la metadata/redirect, así que comparten
// esta función en vez de duplicar la llamada al SDK dos veces.
async function createSubscriptionCheckoutSession({ vendor, months, amountUsd, metadata, description, successParam }) {
  const stripe = await getStripeClient();
  const { siteName } = await getBrandSettings();
  if (!stripe) throw new AppError(`El pago con tarjeta no está disponible en este momento — contacta al equipo de ${siteName}.`, 503);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Suscripción ${siteName} — Plan Business (${months} ${months === 1 ? "mes" : "meses"})`,
              description,
            },
            unit_amount: Math.round(amountUsd * 100),
          },
          quantity: 1,
        },
      ],
      metadata: { ...metadata, vendorId: vendor.id, months: String(months) },
      success_url: `${env.frontendUrl}/vendedor/verificacion?stripe=${successParam}`,
      cancel_url: `${env.frontendUrl}/vendedor/verificacion?stripe=cancel`,
    });

    return { url: session.url, sessionId: session.id, expiresAt: new Date(session.expires_at * 1000) };
  } catch (err) {
    // Nunca dejar que un error crudo del SDK de Stripe (ej. secret key
    // inválida/rotada, cuenta suspendida) se cuele como 500 genérico —
    // se traduce a un error claro para el vendedor, y el detalle real queda
    // solo en el log del servidor para que el admin lo pueda diagnosticar.
    console.error("Error creando Checkout Session de Stripe:", err.message);
    throw new AppError("No se pudo generar el link de pago con Stripe. Prueba de nuevo en un momento.", 502, { detail: err.message });
  }
}

// metadata.verificationId es lo que el webhook usa para saber qué
// solicitud activar — nunca se confía en "el vendedor dice que pagó" del
// lado del cliente (ver stripeWebhook.controller.js).
// Bloque 150 (pedido explícito — "el cliente podrá seleccionar cuántos
// meses desea pagar... se generará un enlace directamente para que el
// cliente pague esa cantidad de meses"): pasa de `mode:"subscription"`
// (cobro recurrente automático mes a mes, Bloque 64) a `mode:"payment"` —
// un cobro ÚNICO por el monto total de los `months` elegidos (precio
// mensual × months, ya calculado por quien llama). Stripe ya NO crea una
// Subscription ni vuelve a cobrar solo cuando ese bloque de meses se
// termina — renovar es elegir método de pago de nuevo (mismo flujo que ya
// usa CUP_TRANSFER, ver chooseMyPaymentMethod). Además, confirmar el cobro
// (checkout.session.completed) ya NO activa la verificación por sí solo —
// deja la marca `stripePaidAt` y el vendedor sube su comprobante igual que
// con CUP, un admin finaliza a mano (ver confirmSubscriptionPayment).
export async function createVerificationCheckoutSession({ verification, vendor, months, amountUsd }) {
  return createSubscriptionCheckoutSession({
    vendor,
    months,
    amountUsd,
    metadata: { verificationId: verification.id },
    description: `Verificación y Plan Business para ${vendor.companyName} — ${months} ${months === 1 ? "mes" : "meses"}`,
    successParam: "success",
  });
}

// Bloque 153 (pedido explícito — "en la sección de suscripción... podrá
// activar un nuevo mes o varios... el proceso será casi igual"): mismo
// Checkout Session de un pago único, pero para una RENOVACIÓN mientras la
// tienda YA está VERIFIED — metadata.subscriptionPaymentId (no
// verificationId) es lo que el webhook usa para saber qué fila de
// SubscriptionPayment marcar como pagada (ver handleCheckoutCompleted).
export async function createRenewalCheckoutSession({ subscriptionPayment, vendor, months, amountUsd }) {
  return createSubscriptionCheckoutSession({
    vendor,
    months,
    amountUsd,
    metadata: { subscriptionPaymentId: subscriptionPayment.id },
    description: `Renovación del Plan Business para ${vendor.companyName} — ${months} ${months === 1 ? "mes" : "meses"}`,
    successParam: "renew-success",
  });
}

// Bloque 64: cuando un admin revoca el Plan Business a mano (revokeBusinessPlan
// en admin.controller.js), si la tienda pagaba por Stripe hay que cancelar la
// suscripción DE VERDAD ahí también — sin esto, Stripe seguiría cobrándole al
// vendedor cada mes por un plan que ya no tiene acá. Best-effort: si Stripe
// falla (secret key rotada, suscripción ya cancelada del otro lado, etc.) no
// bloquea la revocación local, solo se loguea.
export async function cancelStripeSubscription(subscriptionId) {
  if (!subscriptionId) return;
  try {
    const stripe = await getStripeClient();
    if (!stripe) return;
    await stripe.subscriptions.cancel(subscriptionId);
  } catch (err) {
    console.error("Error cancelando suscripción de Stripe:", err.message);
  }
}

// Bloque 66 (pedido explícito): cancelar desde el panel del vendedor
// (updateMyVendor) NO revoca el acceso de inmediato — a diferencia de
// cancelStripeSubscription (cancelación INMEDIATA, usada cuando un admin
// revoca el plan a mano), esto usa el flag nativo de Stripe
// `cancel_at_period_end`: la suscripción sigue facturando/vigente hasta el
// final del ciclo YA pagado, y Stripe dispara `customer.subscription.deleted`
// recién en ese momento (ver handleSubscriptionDeleted en
// verification.controller.js) — ahí es cuando de verdad se revoca el badge.
export async function scheduleStripeSubscriptionCancellation(subscriptionId) {
  if (!subscriptionId) return;
  try {
    const stripe = await getStripeClient();
    if (!stripe) return;
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  } catch (err) {
    console.error("Error agendando la cancelación de Stripe:", err.message);
  }
}

// Verifica la firma contra el webhook secret cargado en AdminIntegrations —
// esto ES el control de autenticidad de este endpoint público (Stripe lo
// llama sin JWT, la firma es lo único que prueba que el evento viene de
// Stripe de verdad y no de cualquiera pegándole a la URL).
export async function constructStripeEvent(rawBody, signature) {
  const config = await getStripeConfig();
  if (!config?.secretKey || !config?.webhookSecret) {
    throw new AppError("Stripe no está configurado del todo (falta la secret key o el webhook secret).", 503);
  }
  const stripe = new Stripe(config.secretKey);
  return stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret);
}


// --- Suscripción con cobro automático (tarjeta) ------------------------------------------------------------------------
// La tienda paga con tarjeta una suscripción real de Stripe: se cobra el plazo elegido (1, 3, 6 o 12 meses) y Stripe la
// renueva sola por el mismo plazo hasta que la tienda la cancele. El pago confirmado por Stripe (webhook) activa la tienda
// sin revisión manual ni comprobante. La prueba gratis con tarjeta es la misma suscripción con 30 días de prueba: Stripe
// guarda la tarjeta, hoy cobra 0 y el día 31 cobra el primer mes.
export const CARD_INTERVAL_MONTHS = [1, 3, 6, 12];

async function stripeOrThrow() {
  const stripe = await getStripeClient();
  if (!stripe) {
    const { siteName } = await getBrandSettings();
    throw new AppError(`El pago con tarjeta no está disponible en este momento. Contacta al equipo de ${siteName}.`, 503);
  }
  return stripe;
}

function stripeError(err, fallback) {
  console.error("[stripe]", err.message);
  return new AppError(fallback, 502, { detail: err.message });
}

// Cliente de Stripe de la tienda (uno por tienda, se reutiliza): así guarda su tarjeta y su historial de facturas.
export async function ensureStripeCustomer(vendor, stripe) {
  if (vendor.stripeCustomerId) return vendor.stripeCustomerId;
  const owner = vendor.user ?? (await prisma.user.findUnique({ where: { id: vendor.userId }, select: { email: true, fullName: true } }));
  const customer = await stripe.customers.create({
    email: owner?.email ?? vendor.email ?? undefined,
    name: vendor.companyName,
    metadata: { vendorId: vendor.id },
  });
  await prisma.vendor.update({ where: { id: vendor.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

// Lo que ve la tienda en la página de pago de Stripe: nombre del plan, qué incluye, cada cuánto se cobra y cómo cancelar.
async function planProductData(months, { trialDays = 0 } = {}) {
  const [{ siteName, logoUrl }, plan] = await Promise.all([getBrandSettings(), getPlanConfig("BUSINESS")]);
  const planName = plan?.displayName ?? "Premium";
  const every = months === 1 ? "cada mes" : `cada ${months} meses`;
  const features = buildPlanIncludes(plan).slice(0, 6).join(" · ");
  const description = [
    trialDays ? `${trialDays} días gratis; después se cobra ${every}.` : `Se renueva sola ${every}.`,
    features,
    `Cancela cuando quieras desde tu panel de ${siteName}.`,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
  return {
    name: `Plan ${planName} de ${siteName}`,
    description,
    images: /^https:/.test(logoUrl ?? "") ? [logoUrl] : undefined,
    siteName,
    every,
  };
}

// Página de pago de Stripe para una suscripción con cobro automático. purpose: "subscribe" (pagar ya) o "trial" (registrar
// la tarjeta, 0 USD hoy, prueba de trialDays). trialEnd: si la tienda ya tiene tiempo pagado (por ejemplo, venía pagando en
// CUP), el primer cobro se corre hasta esa fecha para no cobrarle dos veces el mismo periodo.
export async function createCardSubscriptionCheckout({ vendor, months, priceUsd, purpose, trialDays = 0, trialEnd = null }) {
  if (!CARD_INTERVAL_MONTHS.includes(months)) throw new AppError("Elige 1, 3, 6 o 12 meses.", 400);
  const stripe = await stripeOrThrow();
  try {
    const customer = await ensureStripeCustomer(vendor, stripe);
    const product = await planProductData(months, { trialDays });
    const total = priceUsd * months;
    const metadata = { vendorId: vendor.id, months: String(months), purpose };
    // Stripe exige que un fin de prueba fijo esté al menos 2 días en el futuro.
    const useTrialEnd = trialEnd && trialEnd.getTime() - Date.now() > 2 * 24 * 60 * 60 * 1000;
    const firstCharge = trialDays ? new Date(Date.now() + trialDays * 86400000) : useTrialEnd ? trialEnd : null;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      locale: "es",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(total * 100),
            recurring: { interval: "month", interval_count: months },
            product_data: { name: product.name, description: product.description, ...(product.images ? { images: product.images } : {}) },
          },
        },
      ],
      subscription_data: {
        metadata,
        description: `${product.name} · ${vendor.companyName}`,
        ...(trialDays ? { trial_period_days: trialDays } : useTrialEnd ? { trial_end: Math.floor(trialEnd.getTime() / 1000) } : {}),
      },
      // Con prueba también se pide la tarjeta: es la que se cobra al terminar.
      payment_method_collection: "always",
      metadata,
      custom_text: {
        submit: {
          message: firstCharge
            ? `Hoy no se cobra nada. El ${firstCharge.toLocaleDateString("es-CU")} se cobran ${total} USD y luego ${product.every}. Puedes cancelar antes desde tu panel.`
            : `Se cobran ${total} USD ahora y ${product.every} hasta que canceles. Puedes cancelar cuando quieras desde tu panel de ${product.siteName}.`,
        },
      },
      success_url: `${env.frontendUrl}/vendedor/verificacion?stripe=${purpose === "trial" ? "trial-success" : "success"}`,
      cancel_url: `${env.frontendUrl}/vendedor/verificacion?stripe=cancel`,
    });
    return { url: session.url, sessionId: session.id };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw stripeError(err, "No se pudo abrir el pago con Stripe. Prueba de nuevo en un momento.");
  }
}

// Página de Stripe para poner otra tarjeta (la anterior fue rechazada o venció). Al guardarla, el webhook la deja como
// tarjeta de la suscripción y cobra la factura pendiente si la había.
export async function createCardUpdateCheckout({ vendor }) {
  const stripe = await stripeOrThrow();
  try {
    const customer = await ensureStripeCustomer(vendor, stripe);
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer,
      currency: "usd",
      locale: "es",
      metadata: { vendorId: vendor.id, purpose: "update_card" },
      setup_intent_data: { metadata: { vendorId: vendor.id, purpose: "update_card" } },
      success_url: `${env.frontendUrl}/vendedor/verificacion?stripe=card-updated`,
      cancel_url: `${env.frontendUrl}/vendedor/verificacion?stripe=cancel`,
    });
    return { url: session.url };
  } catch (err) {
    throw stripeError(err, "No se pudo abrir la página para cambiar la tarjeta. Prueba de nuevo en un momento.");
  }
}

function toDate(seconds) {
  return seconds ? new Date(seconds * 1000) : null;
}

// Periodo de un objeto de suscripción (desde la versión "basil" de la API vive en el ítem, no en la suscripción).
export function subscriptionPeriod(sub) {
  const item = sub?.items?.data?.[0];
  return { start: toDate(item?.current_period_start ?? sub?.current_period_start), end: toDate(item?.current_period_end ?? sub?.current_period_end) };
}

// Suscripción a la que pertenece una factura (desde "basil" está en invoice.parent; antes en invoice.subscription).
export function invoiceSubscriptionId(invoice) {
  const id = invoice?.parent?.subscription_details?.subscription ?? invoice?.subscription ?? null;
  return typeof id === "object" && id ? id.id : id;
}

export function invoiceSubscriptionMetadata(invoice) {
  return invoice?.parent?.subscription_details?.metadata ?? invoice?.subscription_details?.metadata ?? {};
}

// Datos de la suscripción en Stripe para mostrarlos en el panel: estado, tarjeta, próximo cobro y cancelación programada.
export async function getCardSubscriptionInfo(vendor) {
  if (!vendor.stripeSubscriptionId && !vendor.stripeCustomerId) return null;
  const stripe = await getStripeClient();
  if (!stripe) return null;
  try {
    let sub = null;
    if (vendor.stripeSubscriptionId) {
      sub = await stripe.subscriptions.retrieve(vendor.stripeSubscriptionId, { expand: ["default_payment_method", "latest_invoice"] });
    }
    let pm = sub?.default_payment_method ?? null;
    if (!pm && vendor.stripeCustomerId) {
      const customer = await stripe.customers.retrieve(vendor.stripeCustomerId, { expand: ["invoice_settings.default_payment_method"] });
      pm = customer?.invoice_settings?.default_payment_method ?? null;
      if (!pm) {
        const list = await stripe.paymentMethods.list({ customer: vendor.stripeCustomerId, type: "card", limit: 1 });
        pm = list.data[0] ?? null;
      }
    }
    const price = sub?.items?.data?.[0]?.price;
    const period = subscriptionPeriod(sub);
    return {
      status: sub?.status ?? null,
      cancelAtPeriodEnd: !!(sub?.cancel_at_period_end || sub?.cancel_at),
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      trialEnd: toDate(sub?.trial_end),
      startedAt: toDate(sub?.start_date),
      amountUsd: price?.unit_amount != null ? price.unit_amount / 100 : null,
      intervalMonths: price?.recurring?.interval === "year" ? 12 * (price.recurring.interval_count ?? 1) : price?.recurring?.interval_count ?? null,
      card: pm?.card ? { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year } : null,
    };
  } catch (err) {
    console.error("[stripe] no se pudo leer la suscripción:", err.message);
    return null;
  }
}

export async function setCardSubscriptionCancelAtPeriodEnd(subscriptionId, cancel) {
  const stripe = await stripeOrThrow();
  try {
    return await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: cancel });
  } catch (err) {
    throw stripeError(err, cancel ? "No se pudo programar la cancelación. Prueba de nuevo." : "No se pudo reactivar la suscripción. Prueba de nuevo.");
  }
}

// Reactivar una suscripción que ya terminó: se crea otra con la tarjeta guardada y se cobra en el momento. Si Stripe rechaza
// la tarjeta (o no hay ninguna), devuelve { declined: true } y la tienda va a Stripe a poner otra y pagar.
export async function chargeSavedCardSubscription({ vendor, months, priceUsd }) {
  const stripe = await stripeOrThrow();
  const customerId = await ensureStripeCustomer(vendor, stripe);
  const customer = await stripe.customers.retrieve(customerId);
  let paymentMethod = customer?.invoice_settings?.default_payment_method ?? null;
  if (!paymentMethod) {
    const list = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
    paymentMethod = list.data[0]?.id ?? null;
  }
  if (!paymentMethod) return { declined: true, reason: "no_card" };
  const product = await planProductData(months);
  try {
    const price = await stripe.prices.create({
      currency: "usd",
      unit_amount: Math.round(priceUsd * months * 100),
      recurring: { interval: "month", interval_count: months },
      product_data: { name: product.name },
    });
    const sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: price.id }],
      default_payment_method: typeof paymentMethod === "string" ? paymentMethod : paymentMethod.id,
      off_session: true,
      payment_behavior: "error_if_incomplete",
      metadata: { vendorId: vendor.id, months: String(months), purpose: "reactivate" },
      description: `${product.name} · ${vendor.companyName}`,
    });
    return { subscription: sub };
  } catch (err) {
    if (err.type === "StripeCardError" || ["card_declined", "expired_card", "incorrect_cvc", "insufficient_funds"].includes(err.code)) {
      return { declined: true, reason: err.code ?? "card_declined" };
    }
    throw stripeError(err, "No se pudo cobrar la reactivación. Prueba de nuevo en un momento.");
  }
}

export async function retrieveSubscription(subscriptionId) {
  const stripe = await stripeOrThrow();
  return stripe.subscriptions.retrieve(subscriptionId);
}

// Deja la tarjeta nueva como la de la suscripción y del cliente, y cobra la factura que había quedado pendiente.
export async function applyNewCardAndPay({ customerId, subscriptionId, setupIntentId }) {
  const stripe = await stripeOrThrow();
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  const pm = typeof setupIntent.payment_method === "string" ? setupIntent.payment_method : setupIntent.payment_method?.id;
  if (!pm) return { paid: false };
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm } });
  if (!subscriptionId) return { paid: false, paymentMethod: pm };
  const sub = await stripe.subscriptions.update(subscriptionId, { default_payment_method: pm, expand: ["latest_invoice"] });
  const invoice = sub.latest_invoice;
  if (invoice && typeof invoice === "object" && invoice.status === "open") {
    try {
      await stripe.invoices.pay(invoice.id, { payment_method: pm });
      return { paid: true, paymentMethod: pm };
    } catch (err) {
      console.error("[stripe] la tarjeta nueva tampoco pasó:", err.message);
      return { paid: false, declined: true, paymentMethod: pm };
    }
  }
  return { paid: false, paymentMethod: pm };
}
