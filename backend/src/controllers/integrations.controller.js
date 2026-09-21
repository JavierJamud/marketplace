import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { listNvidiaModels, generateWithNvidia, DEFAULT_MODEL as NVIDIA_DEFAULT_MODEL } from "../lib/nvidia.js";
import { listGroqModels, generateWithGroq, DEFAULT_MODEL as GROQ_DEFAULT_MODEL } from "../lib/groq.js";
import { listGeminiModels, generateWithGemini, DEFAULT_MODEL as GEMINI_DEFAULT_MODEL } from "../lib/gemini.js";
import { sendAdminDirectEmail } from "../lib/email.js";
import { getAiModelOverrides } from "./settings.controller.js";

// Bloque 25: mismo patrón para CUALQUIER integración con key (Gemini, Groq,
// Stripe, lo que se agregue después) — primeros 4 + últimos 4 caracteres a
// la vista, el resto puntos suspensivos. Antes solo mostraba los últimos 4;
// mostrar también el prefijo ayuda a distinguir de un vistazo pk_/sk_/whsec_
// sin arriesgar nada del secreto real (4 caracteres al principio de una key
// tipo pk_live_... no alcanzan para reconstruirla).
function maskSecret(plaintext) {
  if (!plaintext) return "";
  if (plaintext.length <= 8) return "•".repeat(plaintext.length);
  const head = plaintext.slice(0, 4);
  const tail = plaintext.slice(-4);
  return `${head}${"·".repeat(Math.max(3, plaintext.length - 8))}${tail}`;
}

function decryptIntegration(i) {
  if (!i.credentialsCiphertext) return null;
  return decryptSecret({ ciphertext: i.credentialsCiphertext, iv: i.credentialsIv, authTag: i.credentialsAuthTag });
}

// Stripe guarda sus 3 credenciales como un único JSON cifrado en la misma
// columna credentialsCiphertext que el resto de las integraciones usa para
// un string plano — así se reutiliza 100% el mecanismo de cifrado/isActive
// ya existente en vez de armar una tabla aparte solo para esta integración.
function parseStripeBlob(decrypted) {
  if (!decrypted) return {};
  try {
    return JSON.parse(decrypted);
  } catch {
    return {};
  }
}

// La clave NUNCA se devuelve completa al frontend — se descifra en memoria
// solo para mostrar una versión enmascarada.
export async function listIntegrations(_req, res) {
  const integrations = await prisma.integration.findMany({ orderBy: { name: "asc" } });
  res.json({
    integrations: integrations.map((i) => {
      if (i.name === "stripe") {
        const { publishableKey, secretKey, webhookSecret } = parseStripeBlob(decryptIntegration(i));
        return {
          id: i.id,
          name: i.name,
          isActive: i.isActive,
          updatedAt: i.updatedAt,
          publishableKeyMask: maskSecret(publishableKey),
          secretKeyMask: maskSecret(secretKey),
          webhookSecretMask: maskSecret(webhookSecret),
        };
      }
      return {
        id: i.id,
        name: i.name,
        isActive: i.isActive,
        keyMask: maskSecret(decryptIntegration(i)),
        fromEmail: i.fromEmail,
        updatedAt: i.updatedAt,
      };
    }),
  });
}

const saveSchema = z.object({
  name: z.string().min(1),
  // Opcional en el update: permite guardar solo un fromEmail nuevo sin tener
  // que volver a pegar la clave si ya existe una integración cargada.
  credential: z.string().min(1).optional(),
  fromEmail: z.string().email().optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

// Genérico — Gemini/Groq/Resend, cualquier integración de UNA sola key.
// Stripe usa upsertStripeIntegration (abajo), nunca este endpoint.
export async function upsertIntegration(req, res) {
  const { name, credential, fromEmail, isActive } = saveSchema.parse(req.body);
  if (name === "stripe") throw new AppError("Stripe se guarda desde su propio formulario (3 campos).", 400);

  const existing = await prisma.integration.findUnique({ where: { name } });
  if (!credential && !existing) throw new AppError("Falta la clave.", 400);

  const credentialFields = credential ? encryptSecret(credential) : null;
  const encData = credentialFields
    ? { credentialsCiphertext: credentialFields.ciphertext, credentialsIv: credentialFields.iv, credentialsAuthTag: credentialFields.authTag }
    : {};

  // Bug real reportado en vivo: "upsert()" valida SIEMPRE los dos ramales
  // (update Y create) aunque en runtime solo corra uno — al guardar solo
  // fromEmail/isActive de una integración YA existente (sin key nueva),
  // "encData" queda {} y el ramal "create" (que Prisma valida igual, nunca
  // se iba a ejecutar) queda sin credentialsCiphertext/Iv/AuthTag
  // (obligatorios en el schema) y tira un PrismaClientValidationError antes
  // de tocar la base — 500 aunque el update en sí era perfectamente válido.
  // Se separa en update()/create() explícitos: el guard de arriba
  // ("!credential && !existing" -> error) ya garantiza que si "existing" es
  // falso, "credential" es verdadero, así que el create() siempre tiene sus
  // campos obligatorios.
  const integration = existing
    ? await prisma.integration.update({
        where: { name },
        data: { ...encData, ...(fromEmail !== undefined ? { fromEmail: fromEmail || null } : {}), isActive },
      })
    : await prisma.integration.create({
        data: { name, ...encData, fromEmail: fromEmail || null, isActive },
      });

  res.status(201).json({ integration: { id: integration.id, name: integration.name, isActive: integration.isActive, fromEmail: integration.fromEmail } });
}

// Bloque 25: Stripe necesita 3 credenciales (pública/secreta/webhook) en vez
// de 1 — formulario y validación de formato propios. Cada campo es
// opcional en el body para poder actualizar uno solo sin tener que
// reenviar los otros dos (mismo criterio que "credential" opcional del
// endpoint genérico de arriba); se combina con lo que ya había guardado
// antes de re-encriptar el blob entero.
const stripeSaveSchema = z.object({
  publishableKey: z.string().regex(/^pk_/, "La API pública de Stripe empieza con pk_.").optional().or(z.literal("")),
  secretKey: z.string().regex(/^sk_/, "La API secreta de Stripe empieza con sk_.").optional().or(z.literal("")),
  webhookSecret: z.string().regex(/^whsec_/, "El webhook secret de Stripe empieza con whsec_.").optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

export async function upsertStripeIntegration(req, res) {
  const data = stripeSaveSchema.parse(req.body);

  const existing = await prisma.integration.findUnique({ where: { name: "stripe" } });
  const current = existing ? parseStripeBlob(decryptIntegration(existing)) : {};

  const merged = {
    publishableKey: data.publishableKey || current.publishableKey,
    secretKey: data.secretKey || current.secretKey,
    webhookSecret: data.webhookSecret || current.webhookSecret,
  };

  if (!merged.publishableKey && !merged.secretKey && !merged.webhookSecret) {
    throw new AppError("Carga al menos una credencial de Stripe.", 400);
  }

  const { ciphertext, iv, authTag } = encryptSecret(JSON.stringify(merged));

  const integration = await prisma.integration.upsert({
    where: { name: "stripe" },
    update: { credentialsCiphertext: ciphertext, credentialsIv: iv, credentialsAuthTag: authTag, isActive: data.isActive },
    create: { name: "stripe", credentialsCiphertext: ciphertext, credentialsIv: iv, credentialsAuthTag: authTag, isActive: data.isActive },
  });

  res.status(201).json({ integration: { id: integration.id, name: integration.name, isActive: integration.isActive } });
}

export async function toggleIntegration(req, res) {
  const { id } = req.params;
  const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);

  const integration = await prisma.integration.findUnique({ where: { id } });
  if (!integration) throw new AppError("Integración no encontrada.", 404);

  const updated = await prisma.integration.update({ where: { id }, data: { isActive } });
  res.json({ integration: { id: updated.id, name: updated.name, isActive: updated.isActive } });
}

// Bloque 44 (pedido explícito — bug real que esto hubiera evitado: un
// typo en el nombre de modelo tipeado a mano tumbó Groq con 404): en vez
// de que el admin escriba el nombre del modelo a mano, se listan los
// modelos REALES que la key ya guardada puede usar — AdminIntegrations.jsx
// los muestra como <select>. Lee la key aunque el proveedor esté
// "Inactivo" (a diferencia de getDecryptedCredential): el admin puede
// querer ver qué modelos hay ANTES de activarlo.
const MODEL_LISTERS = { nvidia: listNvidiaModels, groq: listGroqModels, gemini: listGeminiModels };

export async function listProviderModels(req, res) {
  const { name } = req.params;
  const lister = MODEL_LISTERS[name];
  if (!lister) throw new AppError("Este proveedor no tiene modelos listables.", 400);

  const integration = await prisma.integration.findUnique({ where: { name } });
  const apiKey = integration ? decryptIntegration(integration) : null;
  if (!apiKey) throw new AppError("Guarda la clave de este proveedor primero.", 400);

  const models = await lister({ apiKey });
  res.json({ models });
}

// Bloque 86 (pedido explícito, con reporte real en vivo de "el correo no
// salió aunque la key es correcta"): mismo criterio que "Actualizar lista"
// de arriba para los proveedores de IA (ejercita la API real, no un chequeo
// de formato) — pero para Resend no hay "listar modelos", así que la prueba
// real es mandar un correo de verdad. Va SIEMPRE al correo del propio
// admin (nunca a un cliente/vendedor real ni a una dirección escrita a
// mano) — mismo destinatario "seguro" que ya usa notifyAdminActionNeeded, y
// reusa sendAdminDirectEmail tal cual (mismo template, mismo registro en
// EmailLog) en vez de armar un envío aparte. El resultado real de Resend
// (nunca un "enviado" optimista) es lo que decide si esto responde 200 o
// error — mismo criterio anti-falso-positivo del Bloque 5.
export async function testResendIntegration(_req, res) {
  const integration = await prisma.integration.findUnique({ where: { name: "resend" } });
  if (!integration || !decryptIntegration(integration)) throw new AppError("Guarda la clave de Resend primero.", 400);

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  if (!admin?.email) throw new AppError("No hay ninguna cuenta de administrador para mandar el correo de prueba.", 400);

  const result = await sendAdminDirectEmail({
    to: admin.email,
    subject: "✅ Correo de prueba — Resend conectado",
    message:
      "Este es un correo de prueba enviado a mano desde Admin → Integraciones para confirmar que la clave de Resend guardada funciona de verdad.\n\n" +
      "Si estás leyendo esto, la integración está funcionando correctamente.",
    recipientName: admin.fullName,
  });

  if (!result.ok) throw new AppError(`Resend rechazó el envío: ${result.error}`, 502, { detail: result.error });
  res.json({ ok: true, to: admin.email });
}

// Bloque 90 (pedido explícito, tras 2 correos reales de "la integración de
// X no responde" en la misma noche): mismo criterio anti-falso-positivo que
// testResendIntegration de arriba, pero para Gemini/Groq/NVIDIA — ejercita
// la MISMA función generateWithX y el MISMO modelo configurado (o su
// default) que ya usa aiHealthCheck.job.js y el chat/generador reales, así
// que "Probar" le da al admin la misma verdad que el cron nocturno sin
// tener que esperar a las 3am ni leer el correo del día siguiente.
const AI_TEST_PROVIDERS = {
  gemini: { generate: generateWithGemini, defaultModel: GEMINI_DEFAULT_MODEL, settingsField: "aiModelGemini" },
  groq: { generate: generateWithGroq, defaultModel: GROQ_DEFAULT_MODEL, settingsField: "aiModelGroq" },
  nvidia: { generate: generateWithNvidia, defaultModel: NVIDIA_DEFAULT_MODEL, settingsField: "aiModelNvidia" },
};
const AI_TEST_PROMPT = "Responde solo con la palabra: listo";

export async function testAiProviderIntegration(req, res) {
  const { name } = req.params;
  const provider = AI_TEST_PROVIDERS[name];
  if (!provider) throw new AppError("Este proveedor no es de IA.", 400);

  const integration = await prisma.integration.findUnique({ where: { name } });
  const apiKey = integration ? decryptIntegration(integration) : null;
  if (!apiKey) throw new AppError(`Guarda la clave de ${name} primero.`, 400);

  const overrides = await getAiModelOverrides();
  const model = overrides[name] || provider.defaultModel;

  const start = Date.now();
  try {
    await provider.generate({ apiKey, prompt: AI_TEST_PROMPT, model });
  } catch (err) {
    const detail = err?.details?.detail || err?.message || "Error desconocido";
    throw new AppError(`${name} no respondió con el modelo "${model}": ${detail}`, 502, { detail });
  }
  res.json({ ok: true, model, ms: Date.now() - start });
}

// Uso interno (otros servicios, ej. campaigns.controller.js) — nunca expuesto
// por una ruta HTTP directa. Lee la DB en cada llamada (sin caché en
// memoria), así que guardar una key nueva en AdminIntegrations la usa el
// próximo request sin reiniciar el backend.
export async function getDecryptedCredential(name) {
  const integration = await prisma.integration.findUnique({ where: { name } });
  if (!integration || !integration.isActive) return null;
  return decryptIntegration(integration);
}

// Igual que arriba pero también trae el fromEmail configurado (usado por
// email.js/campaigns.controller.js para armar el header "From").
export async function getIntegrationConfig(name) {
  const integration = await prisma.integration.findUnique({ where: { name } });
  if (!integration || !integration.isActive) return null;
  return {
    apiKey: decryptIntegration(integration),
    fromEmail: integration.fromEmail || null,
  };
}

// Bloque 25: usado por lib/stripe.js (checkout session + verificación de
// webhook) — nunca expuesto por una ruta HTTP directa, igual que las
// funciones de arriba.
export async function getStripeConfig() {
  const integration = await prisma.integration.findUnique({ where: { name: "stripe" } });
  if (!integration || !integration.isActive) return null;
  const { publishableKey, secretKey, webhookSecret } = parseStripeBlob(decryptIntegration(integration));
  if (!secretKey) return null;
  return { publishableKey, secretKey, webhookSecret };
}
