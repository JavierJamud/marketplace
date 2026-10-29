import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import { AppError } from "../utils/AppError.js";
import { getIntegrationConfig } from "../controllers/integrations.controller.js";
import { getBrandSettings } from "../controllers/settings.controller.js";
import { htmlToText } from "./email.js";
import { logError } from "./errorLog.js";
import { unsubscribeUrl } from "./marketingEmail.js";

// Envío de un mismo correo a muchas personas (campañas y ofertas dirigidas del admin). Antes salía UN solo correo con
// todas las direcciones en "to": cada cliente veía el correo de los demás y, con más de 50 direcciones, Resend lo
// rechazaba entero. Aquí cada persona recibe su propio correo, con su enlace de baja, y se mandan en lotes de 100 con la
// API de lotes de Resend (el máximo que acepta por llamada).
const BATCH_SIZE = 100;
// Resend limita las llamadas por segundo de cada cuenta: una pausa corta entre lotes evita el error de límite, y si aun
// así llega, se reintenta el lote una vez.
const PAUSE_BETWEEN_BATCHES_MS = 600;
const RATE_LIMIT_RETRY_MS = 1500;
const RESEND_SANDBOX_FROM = "onboarding@resend.dev";

// El HTML se arma una sola vez (compilar MJML por persona sería lento con miles de destinatarios): la plantilla lleva
// esta marca donde va el enlace de baja y aquí se cambia por el enlace firmado de cada persona.
export const UNSUBSCRIBE_URL_MARK = "__ZD_UNSUBSCRIBE_URL__";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deja una sola fila por dirección (sin distinguir mayúsculas): una persona nunca recibe el mismo envío dos veces.
function uniqueRecipients(recipients) {
  const seen = new Set();
  const out = [];
  for (const r of recipients) {
    const key = r?.email?.trim().toLowerCase();
    if (!key || !r.id || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function sendBatch(resend, payload) {
  try {
    let result = await resend.batch.send(payload);
    if (result.error && /rate.?limit|too many/i.test(`${result.error.name ?? ""} ${result.error.message ?? ""}`)) {
      await sleep(RATE_LIMIT_RETRY_MS);
      result = await resend.batch.send(payload);
    }
    return result.error ? { ok: false, error: result.error.message ?? "Resend rechazó el lote." } : { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// recipients: [{ id, email }] (id = User.id, firma el enlace de baja). html: el correo ya armado con UNSUBSCRIBE_URL_MARK
// en el pie. Devuelve cuántos salieron y cuántos fallaron; nunca simula un envío: un lote que Resend rechaza cuenta
// entero como fallido y queda en Admin > Errores (origen EMAIL_RESEND, como cualquier correo que Resend rechaza) con su
// motivo. `source` dice qué envío era (campaña u oferta dirigida) para encontrarlo ahí.
export async function sendToEach({ recipients, subject, html, source }) {
  const config = await getIntegrationConfig("resend");
  if (!config) {
    throw new AppError("No hay una integración de Resend activa. Configúrala en Integraciones antes de enviar.", 400);
  }
  const list = uniqueRecipients(recipients);
  const { siteName } = await getBrandSettings();
  const from = `${siteName} <${config.fromEmail || RESEND_SANDBOX_FROM}>`;
  const text = htmlToText(html);
  const resend = new Resend(config.apiKey);

  let sent = 0;
  let failed = 0;
  let firstError = null;
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    if (i > 0) await sleep(PAUSE_BETWEEN_BATCHES_MS);
    const lot = list.slice(i, i + BATCH_SIZE);
    const payload = lot.map((r) => {
      const url = unsubscribeUrl(r.id);
      return {
        from,
        to: r.email,
        subject,
        html: html.replaceAll(UNSUBSCRIBE_URL_MARK, url),
        text: text.replaceAll(UNSUBSCRIBE_URL_MARK, url),
        // List-Unsubscribe: Gmail y otros muestran su propio botón de "cancelar suscripción" junto al remitente, que lleva
        // a la misma página de baja que el enlace del pie.
        headers: { "List-Unsubscribe": `<${url}>`, "X-Entity-Ref-ID": randomUUID() },
      };
    });
    const result = await sendBatch(resend, payload);
    if (result.ok) {
      sent += lot.length;
    } else {
      failed += lot.length;
      firstError ??= result.error;
      // Sin aviso por correo al admin: el resultado del envío ya se lo dice en pantalla, y una campaña grande con la
      // cuenta caída llenaría su bandeja con un aviso por lote.
      await logError({
        origin: "EMAIL_RESEND",
        message: `Lote de correos rechazado: ${result.error}`,
        context: { envio: source, subject, lote: i / BATCH_SIZE + 1, destinatarios: lot.length },
        notify: false,
      });
    }
  }
  return { sent, failed, total: list.length, firstError };
}
