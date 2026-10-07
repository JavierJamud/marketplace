import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { getDecryptedCredential } from "./integrations.controller.js";
import { AI_PROVIDER_NAMES, DEFAULT_MODELS, getAllEffectiveModels, getEffectiveActiveModels } from "../lib/aiModels.js";
import { AI_PRIORITY, getProviderQuotaOverview, getFreeLimitOverrides, setFreeLimitOverrides } from "../lib/aiQuota.js";
import { TRANSCRIBE_MODEL as GROQ_TRANSCRIBE_MODEL } from "../lib/groq.js";
import { PROVIDERS, probeModel, errorDetailOf, classifyFailure } from "../lib/aiModelRepair.js";
import { friendlyModelError, markModelUnavailable, clearModelUnavailable } from "../lib/aiModelCatalog.js";
import { getModelHealthRows, deleteModelHealth, isChatbotHealthy } from "../lib/aiProviderHealth.js";

// Bloque 245 (pedido explícito): cada proveedor de IA puede tener uno o varios
// modelos activos. Estas rutas son el CRUD que usa Admin → Integraciones. La
// política de qué hacer cuando un modelo falla NO vive acá sino en
// lib/aiModelRepair.js.

const providerSchema = z.enum(AI_PROVIDER_NAMES);

function serialize(config, healthByKey) {
  const health = healthByKey.get(`${config.provider}::${config.model}`);
  return {
    id: config.id, // null = modelo por defecto del código (el proveedor todavía no tiene filas)
    provider: config.provider,
    model: config.model,
    isActive: config.isActive,
    priority: config.priority,
    source: config.source, // "MANUAL" | "AUTO" | "DEFAULT"
    health: health
      ? { status: health.status, lastError: health.lastError, lastLatencyMs: health.lastLatencyMs, downSince: health.downSince, lastCheckedAt: health.lastCheckedAt }
      : null,
  };
}

export async function listAiModels(_req, res) {
  const [byProvider, healthRows] = await Promise.all([getAllEffectiveModels(), getModelHealthRows()]);
  const healthByKey = new Map(healthRows.map((h) => [`${h.provider}::${h.model}`, h]));
  const providers = AI_PROVIDER_NAMES.map((provider) => ({
    provider,
    label: PROVIDERS[provider].label,
    defaultModel: DEFAULT_MODELS[provider],
    models: byProvider[provider].map((m) => serialize({ ...m, provider }, healthByKey)),
  }));
  res.json({ providers });
}

const addSchema = z.object({
  provider: providerSchema,
  model: z.string().trim().min(1, "Escribe el nombre del modelo.").max(200),
});

// Agrega un modelo VERIFICADO: se le hace una consulta real antes de guardarlo,
// así un nombre mal escrito (que ya tumbó a Groq con un 404 una vez) se
// rechaza acá con el motivo exacto en vez de aparecer más tarde como "caído".
export async function addAiModel(req, res) {
  const { provider, model } = addSchema.parse(req.body);

  const existing = await prisma.aiModelConfig.findUnique({ where: { provider_model: { provider, model } } });
  if (existing) throw new AppError("Ese modelo ya está en la lista de este proveedor.", 409);

  const apiKey = await getDecryptedCredential(provider);
  if (!apiKey) throw new AppError(`Guarda y activa la clave de ${PROVIDERS[provider].label} primero.`, 400);

  let ms;
  try {
    ms = await probeModel(provider, apiKey, model);
  } catch (err) {
    const detail = errorDetailOf(err);
    const kind = classifyFailure(detail).kind;
    // Bloque 263: el cuerpo crudo del proveedor (un JSON largo) no le dice nada al
    // admin; se explica en una frase, y si el modelo no existe para esta cuenta
    // se marca en la lista para no volver a intentarlo.
    if (kind === "gone") markModelUnavailable(provider, model, detail);
    throw new AppError(friendlyModelError(PROVIDERS[provider].label, model, kind), 502, { detail });
  }
  clearModelUnavailable(provider, model);

  const created = await prisma.$transaction(async (tx) => {
    const rows = await tx.aiModelConfig.findMany({ where: { provider }, orderBy: { priority: "asc" } });
    // El proveedor todavía usaba su modelo por defecto (sin filas): al agregar
    // el primero se materializa ese default como fila, para que agregar
    // SUME un modelo y no reemplace al que ya estaba funcionando.
    if (rows.length === 0) {
      await tx.aiModelConfig.create({ data: { provider, model: DEFAULT_MODELS[provider], priority: 0, source: "MANUAL" } });
    }
    const nextPriority = rows.length === 0 ? 1 : Math.max(...rows.map((r) => r.priority)) + 1;
    return tx.aiModelConfig.create({ data: { provider, model, priority: nextPriority, source: "MANUAL" } });
  });

  // Ya se verificó que responde: queda sano desde el primer momento.
  await prisma.aiModelHealth.upsert({
    where: { provider_model: { provider, model } },
    create: { provider, model, status: "healthy", lastLatencyMs: ms },
    update: { status: "healthy", lastError: null, lastLatencyMs: ms, downSince: null },
  });
  res.status(201).json({ model: created, ms });
}

const updateSchema = z.object({ isActive: z.boolean() });

export async function updateAiModel(req, res) {
  const { isActive } = updateSchema.parse(req.body);
  const config = await prisma.aiModelConfig.findUnique({ where: { id: req.params.id } });
  if (!config) throw new AppError("Modelo no encontrado.", 404);

  if (!isActive && config.isActive) {
    const otherActive = await prisma.aiModelConfig.count({ where: { provider: config.provider, isActive: true, id: { not: config.id } } });
    if (otherActive === 0) {
      throw new AppError("Deja al menos un modelo activo en este proveedor, o desactiva el proveedor entero con su interruptor.", 400);
    }
  }
  const updated = await prisma.aiModelConfig.update({ where: { id: config.id }, data: { isActive } });
  // Un modelo apagado ya no cuenta para la salud; al volver a encenderlo el
  // chequeo de 2 minutos lo vuelve a medir.
  if (!isActive) await deleteModelHealth(config.provider, config.model);
  res.json({ model: updated });
}

const moveSchema = z.object({ direction: z.enum(["up", "down"]) });

export async function moveAiModel(req, res) {
  const { direction } = moveSchema.parse(req.body);
  const config = await prisma.aiModelConfig.findUnique({ where: { id: req.params.id } });
  if (!config) throw new AppError("Modelo no encontrado.", 404);

  const siblings = await prisma.aiModelConfig.findMany({ where: { provider: config.provider }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  const index = siblings.findIndex((s) => s.id === config.id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= siblings.length) return res.json({ ok: true });

  [siblings[index], siblings[swapWith]] = [siblings[swapWith], siblings[index]];
  // Se renumera todo el proveedor (0..n-1): evita prioridades repetidas que
  // dejarían el orden ambiguo.
  await prisma.$transaction(siblings.map((s, i) => prisma.aiModelConfig.update({ where: { id: s.id }, data: { priority: i } })));
  res.json({ ok: true });
}

export async function deleteAiModel(req, res) {
  const config = await prisma.aiModelConfig.findUnique({ where: { id: req.params.id } });
  if (!config) throw new AppError("Modelo no encontrado.", 404);

  if (config.isActive) {
    const siblings = await prisma.aiModelConfig.count({ where: { provider: config.provider, id: { not: config.id } } });
    const otherActive = await prisma.aiModelConfig.count({ where: { provider: config.provider, isActive: true, id: { not: config.id } } });
    // Borrar el único modelo vuelve al default del código (sin filas); borrar
    // el único ACTIVO dejando otros apagados dejaría al proveedor sin nada.
    if (siblings > 0 && otherActive === 0) {
      throw new AppError("Deja al menos un modelo activo en este proveedor antes de quitar este.", 400);
    }
  }
  await prisma.aiModelConfig.delete({ where: { id: config.id } });
  await deleteModelHealth(config.provider, config.model);
  res.json({ ok: true });
}

// Bloque 280 (pedido explícito — "mostrar en Integraciones cuánto consumió cada API,
// cuánto le queda en su plan gratis y cuánto falta para que se restablezca"): estado
// del cupo gratis de cada proveedor en el orden de rotación (Groq → NVIDIA → Gemini).
// Las cifras con source "api" vienen de la propia API; las "estimado" se cuentan aquí.
export async function getAiQuota(_req, res) {
  const providers = [];
  for (const provider of AI_PRIORITY) {
    const integration = await prisma.integration.findUnique({ where: { name: provider }, select: { isActive: true } });
    const active = (await getEffectiveActiveModels(provider)).map((m) => m.model);
    const models = provider === "groq" ? [...active, GROQ_TRANSCRIBE_MODEL] : active;
    const quotas = await getProviderQuotaOverview(provider, models);
    const textQuotas = quotas.filter((q) => q.model !== GROQ_TRANSCRIBE_MODEL);
    const enabled = !!integration?.isActive;
    providers.push({
      provider,
      label: PROVIDERS[provider].label,
      order: AI_PRIORITY.indexOf(provider) + 1,
      enabled,
      available: enabled && textQuotas.some((q) => q.available),
      resumesAt: enabled && !textQuotas.some((q) => q.available) ? textQuotas.map((q) => q.resumesAt).filter(Boolean).sort()[0] ?? null : null,
      limits: await getFreeLimitOverrides(provider),
      models: quotas.map((q) => ({ ...q, purpose: q.model === GROQ_TRANSCRIBE_MODEL ? "Voz a texto" : "Texto" })),
    });
  }
  const enabled = providers.filter((p) => p.enabled);
  const allExhausted = enabled.length > 0 && enabled.every((p) => !p.available);
  const nextResetAt = allExhausted ? enabled.map((p) => p.resumesAt).filter(Boolean).sort()[0] ?? null : null;
  res.json({ providers, allExhausted, nextResetAt, chatbotAvailable: await isChatbotHealthy() });
}

const limitsSchema = z.object({
  rpm: z.number().int().positive().nullable().optional(),
  rpd: z.number().int().positive().nullable().optional(),
  tpm: z.number().int().positive().nullable().optional(),
  tpd: z.number().int().positive().nullable().optional(),
});

export async function updateAiQuotaLimits(req, res) {
  const provider = providerSchema.parse(req.params.provider);
  const limits = await setFreeLimitOverrides(provider, limitsSchema.parse(req.body ?? {}));
  res.json({ provider, limits });
}
