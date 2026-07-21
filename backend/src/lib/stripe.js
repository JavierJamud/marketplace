import Stripe from "stripe";
import { AppError } from "../utils/AppError.js";
import { env } from "../config/env.js";
import { getStripeConfig } from "../controllers/integrations.controller.js";

// Bloque 25: reemplaza el checkout simulado (PaymentLink.jsx) por un
// Checkout Session real de Stripe. CUP no es una moneda soportada por
// Stripe (no es convertible internacionalmente) — el cobro real es en USD,
// mismo precio de referencia que ya se mostraba en la pantalla simulada
// anterior; el "2 500 CUP/mes" sigue siendo el precio informativo que ve el
// vendedor en VendorVerification.jsx.
const SUBSCRIPTION_PRICE_USD = 25;

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
export async function createVerificationCheckoutSession({ verification, vendor }) {
  const stripe = await getStripeClient();
  if (!stripe) throw new AppError("El pago con tarjeta no está disponible en este momento — contactá al equipo de ZeuDin.", 503);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Suscripción ZeuDin — Plan Business",
              description: `Verificación y Plan Business para ${vendor.companyName}`,
            },
            unit_amount: SUBSCRIPTION_PRICE_USD * 100,
          },
          quantity: 1,
        },
      ],
      metadata: { verificationId: verification.id, vendorId: vendor.id },
      success_url: `${env.frontendUrl}/vendedor/verificacion?stripe=success`,
      cancel_url: `${env.frontendUrl}/vendedor/verificacion?stripe=cancel`,
    });

    return { url: session.url, sessionId: session.id, expiresAt: new Date(session.expires_at * 1000) };
  } catch (err) {
    // Nunca dejar que un error crudo del SDK de Stripe (ej. secret key
    // inválida/rotada, cuenta suspendida) se cuele como 500 genérico —
    // se traduce a un error claro para el vendedor, y el detalle real queda
    // solo en el log del servidor para que el admin lo pueda diagnosticar.
    console.error("Error creando Checkout Session de Stripe:", err.message);
    throw new AppError("No se pudo generar el link de pago con Stripe. Probá de nuevo en un momento.", 502, { detail: err.message });
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
