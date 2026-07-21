import { constructStripeEvent } from "../lib/stripe.js";
import { handleStripeWebhookEvent } from "./verification.controller.js";
import { logError } from "../lib/errorLog.js";

// Bloque 25: única ruta de todo el backend montada ANTES de express.json()
// en app.js (con express.raw en vez de express.json) — Stripe firma el
// cuerpo crudo de la request, no el JSON ya parseado, así que verificar la
// firma necesita los bytes originales tal cual llegaron.
export async function receiveStripeWebhook(req, res) {
  const signature = req.headers["stripe-signature"];

  let event;
  try {
    event = await constructStripeEvent(req.body, signature);
  } catch (err) {
    // Firma inválida, webhook secret sin configurar, etc. — 400, nunca 500:
    // un 5xx hace que Stripe reintente agresivamente algo que nunca va a
    // poder verificar solo reintentando.
    await logError({ origin: "STRIPE", message: err.message, context: { step: "constructStripeEvent" } });
    return res.status(400).json({ error: `Webhook inválido: ${err.message}` });
  }

  try {
    await handleStripeWebhookEvent(event);
  } catch (err) {
    // Acá sí un error de nuestro lado (DB caída, etc.) — 500 real para que
    // Stripe reintente el evento más tarde.
    console.error("Error procesando webhook de Stripe:", err);
    await logError({ origin: "STRIPE", message: err.message, context: { step: "handleStripeWebhookEvent", eventType: event?.type } });
    return res.status(500).json({ error: "Error interno procesando el evento." });
  }

  res.json({ received: true });
}
