import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Copy, RefreshCw, Plug } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { copyToClipboard } from "../../lib/clipboard.js";

// Bloque 45: Cerebras salió del sistema (su cuenta gratuita devolvía 402
// Payment Required, no sirve para uso gratuito) — NVIDIA NIM lo reemplaza
// como tercer proveedor. Orden de fallback fijo: Gemini (principal) →
// Groq → NVIDIA NIM, cada uno solo entra si el anterior está inactivo o
// falla una consulta puntual (ver lib/ai.js). Un proveedor desactivado
// nunca se usa, ni siquiera como respaldo.
// Bloque 83 (pedido explícito, medido en vivo): el orden fijo pasó de
// Gemini→Groq→NVIDIA a Groq→Gemini→NVIDIA — Groq medido consistentemente
// más rápido (~400-1500ms) que Gemini (~1-2.5s) y muchísimo más que NVIDIA
// NIM (109s medidos una vez en vivo, el motivo real de por qué NVIDIA
// sigue de último recurso).
const SERVICE_META = {
  gemini: { name: "Google AI Studio (Gemini)", desc: "Primer respaldo de IA — entra si Groq está inactivo o falla", emoji: "✨", iconBg: "rgba(42,111,219,0.1)" },
  groq: { name: "Groq", desc: "Proveedor PRINCIPAL de IA (el más rápido medido) — chatbot de tienda y 'Mejorar con IA'. También transcribe audio (Whisper)", emoji: "⚡", iconBg: "rgba(138,81,0,0.1)" },
  nvidia: { name: "NVIDIA NIM", desc: "Último recurso de IA — entra si Groq y Gemini están inactivos o fallan (mucho más lento que los otros dos)", emoji: "🟩", iconBg: "rgba(118,185,0,0.12)" },
  resend: { name: "Resend", desc: "Correos: verificación, avisos de plan, campañas", emoji: "✉️", iconBg: "rgba(51,116,117,0.1)" },
  stripe: { name: "Stripe", desc: "Cobro de suscripción Business de la plataforma", emoji: "💳", iconBg: "rgba(97,160,161,0.15)" },
};
const ORDER = ["groq", "gemini", "nvidia", "resend", "stripe"];
// Bloque 43/45: estos tres tienen modelo editable (campo nuevo) — Resend/Stripe no.
const AI_PROVIDERS = ["gemini", "groq", "nvidia"];
const DEFAULT_MODEL_BY_PROVIDER = { gemini: "gemini-flash-latest", groq: "llama-3.3-70b-versatile", nvidia: "meta/llama-3.3-70b-instruct" };
// Bloque 45 (pedido explícito): nota extra bajo el campo de modelo de
// NVIDIA — su Free Endpoint puede cambiar de nombre sin aviso previo.
const MODEL_NOTE_BY_PROVIDER = { nvidia: "Verificar en build.nvidia.com si falla — el Free Endpoint puede cambiar de nombre." };

// Bloque 25: URL que el admin tiene que pegar en el dashboard de Stripe
// (Developers → Webhooks → Add endpoint). api.defaults.baseURL ya apunta al
// backend real (no al frontend) — en dev es localhost, en producción va a
// ser el dominio público donde corra la API.
const WEBHOOK_URL = `${api.defaults.baseURL}/stripe/webhook`;

function ToggleSwitch({ isActive, disabled, onToggle }) {
  return (
    <button
      disabled={disabled}
      onClick={onToggle}
      className="relative h-[26px] w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-40"
      style={{ background: isActive ? "#0CAE53" : "#c5c6cc" }}
    >
      <span className="absolute top-[3px] h-5 w-5 rounded-full bg-white transition-all" style={{ left: isActive ? "21px" : "3px" }} />
    </button>
  );
}

function CardHeader({ meta, hasIntegration, isActive, saving, onToggle }) {
  return (
    <div className="mb-3.5 flex items-center gap-3.5">
      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[11px] text-xl" style={{ background: meta.iconBg }}>
        {meta.emoji}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-bold text-on-surface">{meta.name}</span>
          <span
            className="rounded-full px-2.5 py-0.5 text-[10.5px] font-bold"
            style={isActive ? { background: "rgba(12,174,83,0.12)", color: "#0A8F42" } : { background: "#f0edee", color: "#75777c" }}
          >
            {isActive ? "Activo" : "Inactivo"}
          </span>
          {!hasIntegration && <span className="rounded-full bg-surface-container px-2.5 py-0.5 text-[10.5px] font-bold text-outline">Sin configurar</span>}
        </div>
        <div className="mt-0.5 text-[12.5px] text-outline">{meta.desc}</div>
      </div>
      <ToggleSwitch isActive={isActive} disabled={!hasIntegration || saving} onToggle={onToggle} />
    </div>
  );
}

function ServiceCard({ name, meta, integration, currentModel, onToggle, onSave, onSaveModel, onTestResend, onTestAi, saving, savingModel, testingResend, testingAi }) {
  const [draft, setDraft] = useState("");
  const [fromDraft, setFromDraft] = useState(integration?.fromEmail ?? "");
  const showModelField = AI_PROVIDERS.includes(name);
  const [modelDraft, setModelDraft] = useState(currentModel ?? "");

  // Bloque 44 (pedido explícito — bug real que esto hubiera evitado: un
  // typo tipeado a mano en el nombre del modelo tumbó Groq con 404): con la
  // key ya guardada, se consultan los modelos REALES que esa key puede
  // usar — se muestra como <select> en vez de texto libre. Sin key
  // guardada (!integration) la consulta ni corre, y se cae al input de
  // texto de siempre (mismo criterio: nunca romper el flujo existente).
  const modelsQuery = useQuery({
    queryKey: ["provider-models", name],
    queryFn: async () => (await api.get(`/admin/integrations/${name}/models`)).data.models,
    enabled: showModelField && !!integration,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    setFromDraft(integration?.fromEmail ?? "");
  }, [integration?.fromEmail]);

  useEffect(() => {
    setModelDraft(currentModel ?? "");
  }, [currentModel]);

  const isActive = integration?.isActive ?? false;
  const showFromEmail = name === "resend";
  const fromChanged = showFromEmail && fromDraft !== (integration?.fromEmail ?? "");
  const canSave = draft || fromChanged;
  const modelChanged = showModelField && modelDraft !== (currentModel ?? "");
  // La key recién guardada puede no reflejar el modelo ELEGIDO todavía en
  // la lista (ej. currentModel vacío = usa el default) — se agrega siempre
  // como opción para no perderlo de vista, aunque la API no lo liste.
  const modelOptions = modelsQuery.data
    ? [...new Set([...(currentModel ? [currentModel] : []), ...modelsQuery.data])]
    : null;

  function handleSave() {
    onSave(name, draft || undefined, isActive, showFromEmail ? fromDraft : undefined);
    setDraft("");
  }

  function handleSaveModel() {
    onSaveModel(name, modelDraft.trim());
  }

  return (
    <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5">
      <CardHeader meta={meta} hasIntegration={!!integration} isActive={isActive} saving={saving} onToggle={() => onToggle(integration)} />
      <div className="flex gap-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          type="password"
          placeholder={integration ? integration.keyMask : "Pega la clave aquí..."}
          className="h-[42px] flex-1 rounded-lg border border-outline-variant px-3.5 font-mono text-[13px] outline-none"
        />
        <button
          disabled={!canSave || saving}
          onClick={handleSave}
          className="rounded-lg bg-surface-container px-[18px] text-[13px] font-semibold text-on-surface-variant disabled:opacity-50"
        >
          Guardar
        </button>
        <button
          disabled={!draft || saving}
          onClick={handleSave}
          className="rounded-lg border border-outline-variant px-4 text-[13px] font-semibold text-outline disabled:opacity-50"
        >
          Rotar
        </button>
      </div>
      {showFromEmail && (
        <div className="mt-3">
          <label className="mb-1 block text-[11.5px] font-semibold text-on-surface-variant">
            Correo verificado del dominio (remitente)
          </label>
          <input
            value={fromDraft}
            onChange={(e) => setFromDraft(e.target.value)}
            type="email"
            placeholder="notificaciones@tudominio.cu"
            className="h-[38px] w-full rounded-lg border border-outline-variant px-3.5 text-[13px] outline-none"
          />
          <p className="mt-1 text-[11px] text-outline">
            Mientras no cargues un dominio verificado en Resend, los correos salen igual desde{" "}
            <span className="font-mono">onboarding@resend.dev</span>.
          </p>
          {/* Bloque 86 (pedido explícito, con reporte real en vivo de "la
              key es correcta pero el correo no sale"): mismo criterio que
              "Actualizar lista" de los proveedores de IA — probar contra la
              API real en vez de solo guardar un texto y asumir que
              funciona. Manda un correo de prueba de verdad a la cuenta del
              propio admin; solo disponible con la clave ya guardada (mismo
              guard que el backend). */}
          {integration && (
            <button
              onClick={onTestResend}
              disabled={testingResend}
              className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-outline-variant px-3.5 py-2 text-[12.5px] font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${testingResend ? "animate-spin" : ""}`} />
              {testingResend ? "Mandando correo de prueba..." : "Probar — mandar correo de prueba"}
            </button>
          )}
        </div>
      )}
      {/* Bloque 43/44 (pedido explícito): modelo editable sin tocar código
          — si el proveedor deprecia/bloquea un modelo (ya pasó dos veces
          con Groq), el admin lo cambia acá y el próximo request ya lo usa.
          Con la key guardada, se elige de una lista de modelos REALES
          (consultados en vivo a la API) en vez de tipear el nombre a mano
          — evita typos como el que tumbó Groq con 404 model_not_found. */}
      {showModelField && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-[11.5px] font-semibold text-on-surface-variant">Modelo</label>
            {!!integration && (
              <button
                onClick={() => modelsQuery.refetch()}
                disabled={modelsQuery.isFetching}
                title="Actualizar lista de modelos"
                className="flex items-center gap-1 text-[11px] font-semibold text-tertiary-accent disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${modelsQuery.isFetching ? "animate-spin" : ""}`} /> Actualizar lista
              </button>
            )}
          </div>
          <div className="flex gap-2.5">
            {modelOptions ? (
              <select
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                className="h-[38px] flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 font-mono text-[12.5px] outline-none"
              >
                <option value="">(default: {DEFAULT_MODEL_BY_PROVIDER[name]})</option>
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                type="text"
                placeholder={DEFAULT_MODEL_BY_PROVIDER[name]}
                className="h-[38px] flex-1 rounded-lg border border-outline-variant px-3.5 font-mono text-[12.5px] outline-none"
              />
            )}
            <button
              disabled={!modelChanged || savingModel}
              onClick={handleSaveModel}
              className="rounded-lg bg-surface-container px-[18px] text-[13px] font-semibold text-on-surface-variant disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
          {!integration && <p className="mt-1 text-[11px] text-outline">Guarda la clave primero para elegir de la lista real de modelos.</p>}
          {integration && modelsQuery.isError && (
            <p className="mt-1 text-[11px] text-error">No se pudo consultar la lista de modelos — escribe el nombre a mano.</p>
          )}
          <p className="mt-1 text-[11px] text-outline">
            Vacío = usa el default (<span className="font-mono">{DEFAULT_MODEL_BY_PROVIDER[name]}</span>).
          </p>
          {MODEL_NOTE_BY_PROVIDER[name] && <p className="mt-1 text-[11px] text-outline">⚠ {MODEL_NOTE_BY_PROVIDER[name]}</p>}
          {/* Bloque 90 (pedido explícito, tras 2 correos reales de "la
              integración de X no responde" la misma noche): mismo criterio
              que "Probar" de Resend — ejercita la API real con el modelo
              configurado ahora mismo, en vez de esperar al chequeo de las
              3am para enterarse si la clave sigue viva. */}
          {integration && (
            <button
              onClick={() => onTestAi(name)}
              disabled={testingAi}
              className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-outline-variant px-3.5 py-2 text-[12.5px] font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${testingAi ? "animate-spin" : ""}`} />
              {testingAi ? "Probando conexión..." : "Probar conexión"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Bloque 25: Stripe necesita 3 credenciales (no 1 como el resto) — tarjeta
// propia en vez de forzarlas dentro de ServiceCard. Cada campo se guarda
// independiente (el backend combina con lo que ya había si se deja uno
// vacío, ver upsertStripeIntegration).
function StripeFieldRow({ label, placeholder, mask, value, onChange }) {
  return (
    <div>
      <label className="mb-1 block text-[11.5px] font-semibold text-on-surface-variant">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type="password"
        placeholder={mask || placeholder}
        className="h-[40px] w-full rounded-lg border border-outline-variant px-3.5 font-mono text-[12.5px] outline-none"
      />
    </div>
  );
}

function StripeCard({ integration, onToggle, onSave, saving }) {
  const [publishableKey, setPublishableKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const isActive = integration?.isActive ?? false;
  const canSave = publishableKey || secretKey || webhookSecret;

  function handleSave() {
    onSave({ publishableKey: publishableKey || undefined, secretKey: secretKey || undefined, webhookSecret: webhookSecret || undefined });
    setPublishableKey("");
    setSecretKey("");
    setWebhookSecret("");
  }

  function copyWebhookUrl() {
    copyToClipboard(WEBHOOK_URL)
      .then(() => toast.success("URL copiada."))
      .catch(() => toast.error("No se pudo copiar la URL."));
  }

  return (
    <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5">
      <CardHeader
        meta={SERVICE_META.stripe}
        hasIntegration={!!integration}
        isActive={isActive}
        saving={saving}
        onToggle={() => onToggle(integration)}
      />

      <div className="flex flex-col gap-3">
        <StripeFieldRow
          label="API pública (publishable key)"
          placeholder="pk_live_..."
          mask={integration?.publishableKeyMask}
          value={publishableKey}
          onChange={setPublishableKey}
        />
        <StripeFieldRow
          label="API secreta (secret key)"
          placeholder="sk_live_..."
          mask={integration?.secretKeyMask}
          value={secretKey}
          onChange={setSecretKey}
        />
        <StripeFieldRow
          label="Webhook signing secret"
          placeholder="whsec_..."
          mask={integration?.webhookSecretMask}
          value={webhookSecret}
          onChange={setWebhookSecret}
        />

        <div>
          <label className="mb-1 block text-[11.5px] font-semibold text-on-surface-variant">URL del webhook (pegar en Stripe)</label>
          <div className="flex gap-2.5">
            <input readOnly value={WEBHOOK_URL} className="h-[38px] flex-1 rounded-lg border border-outline-variant bg-surface-container px-3.5 font-mono text-[12px] text-on-surface-variant" />
            <button onClick={copyWebhookUrl} className="flex items-center gap-1.5 rounded-lg border border-outline-variant px-3.5 text-[12.5px] font-semibold text-on-surface-variant">
              <Copy className="h-3.5 w-3.5" /> Copiar
            </button>
          </div>
          <p className="mt-1 text-[11px] text-outline">
            Cargalo en Stripe → Developers → Webhooks → Add endpoint, escuchando el evento <span className="font-mono">checkout.session.completed</span>.
            {WEBHOOK_URL.includes("localhost") && " En desarrollo local usa Stripe CLI (stripe listen) para reenviar los eventos hasta acá."}
          </p>
        </div>

        <button
          disabled={!canSave || saving}
          onClick={handleSave}
          className="self-start rounded-lg bg-surface-container px-[18px] py-2.5 text-[13px] font-semibold text-on-surface-variant disabled:opacity-50"
        >
          Guardar credenciales de Stripe
        </button>
      </div>
    </div>
  );
}

export default function AdminIntegrations() {
  const { siteName } = usePlatformSettings();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["admin-integrations"],
    queryFn: async () => (await api.get("/admin/integrations")).data.integrations,
  });

  // Bloque 43: modelo por proveedor — vive aparte (SiteSettings), no en la
  // fila de Integration (esa es solo credencial + activo/inactivo).
  const { data: aiModels } = useQuery({
    queryKey: ["admin-ai-models"],
    queryFn: async () => (await api.get("/admin/settings/ai-models")).data.aiModels,
  });

  const save = useMutation({
    mutationFn: async ({ name, credential, isActive, fromEmail }) =>
      (await api.post("/admin/integrations", { name, credential, isActive, fromEmail })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-integrations"] });
      toast.success("Guardado.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  const saveStripe = useMutation({
    mutationFn: async (payload) => (await api.post("/admin/integrations/stripe", payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-integrations"] });
      toast.success("Credenciales de Stripe guardadas.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, isActive }) => (await api.patch(`/admin/integrations/${id}`, { isActive })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-integrations"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar la integración."),
  });

  // Bloque 43: un solo campo por vez (PATCH parcial — los otros dos quedan
  // como estaban, mismo criterio que /admin/integrations con "credential"
  // opcional).
  const saveModel = useMutation({
    mutationFn: async ({ name, value }) => {
      const field = { gemini: "aiModelGemini", groq: "aiModelGroq", nvidia: "aiModelNvidia" }[name];
      return (await api.patch("/admin/settings/ai-models", { [field]: value })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-ai-models"] });
      toast.success("Modelo guardado.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el modelo."),
  });

  // Bloque 86 (pedido explícito): prueba real contra la API de Resend — el
  // backend responde con el detalle EXACTO que devolvió Resend si rechaza
  // el envío (nunca un "no se pudo" genérico), para poder diagnosticar de
  // verdad por qué una key "correcta" igual no manda correos.
  const testResend = useMutation({
    mutationFn: async () => (await api.post("/admin/integrations/resend/test")).data,
    onSuccess: (result) => toast.success(`Correo de prueba enviado a ${result.to} — revisa esa bandeja.`),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo mandar el correo de prueba.", { duration: 8000 }),
  });

  // Bloque 90 (pedido explícito): mismo criterio que testResend de arriba,
  // pero para Gemini/Groq/NVIDIA — "Probar conexión" ejercita el modelo real
  // configurado ahora mismo. El mensaje de error trae el detalle exacto que
  // devolvió el proveedor (nunca un "no se pudo" genérico), para diagnosticar
  // en el momento en vez de esperar al correo del chequeo automático de 3am.
  const testAi = useMutation({
    mutationFn: async (name) => (await api.post(`/admin/integrations/${name}/test-ai`)).data,
    onSuccess: (result) => toast.success(`Respondió en ${result.ms}ms con el modelo "${result.model}".`),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo probar la conexión.", { duration: 8000 }),
  });

  const byName = Object.fromEntries((data ?? []).map((i) => [i.name, i]));

  return (
    <div className="max-w-[820px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Plug} tone="teal" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Integraciones</h1>
      </div>
      <p className="mb-2 text-[13.5px] text-outline">Configura las claves de servicios. Se guardan cifradas (AES-256-GCM), nunca en texto plano.</p>
      <div className="mb-[22px] rounded-[10px] bg-tertiary-accent/[0.08] px-3.5 py-2.5 text-[12px] text-tertiary-accent">
        🔐 Puedes activar, desactivar o rotar cada clave sin tocar el servidor. Orden de IA: Groq (principal, el más
        rápido) → Gemini → NVIDIA NIM — cada uno entra solo si el anterior está inactivo o falla una consulta puntual.
        Un proveedor desactivado nunca se usa, ni siquiera como respaldo. El modelo de cada uno también es editable
        acá, sin redesplegar.
      </div>
      {/* Bloque 85 (pedido explícito): transparencia sobre el chequeo
          automático — el admin ve acá POR QUÉ el modelo de un proveedor
          puede cambiar solo de un día para otro. */}
      <div className="mb-[22px] rounded-[10px] bg-surface-container px-3.5 py-2.5 text-[12px] text-on-surface-variant">
        🩺 Cada día, a las 3:00am (zona horaria configurada en "Marca de la plataforma"), el sistema verifica que el
        modelo configurado de cada proveedor ACTIVO siga respondiendo. Si un modelo fue dado de baja, cambia solo al
        modelo más rápido disponible que sí funcione — y si un proveedor entero no responde con ningún modelo, te
        llega un correo con el detalle.
      </div>

      <div className="flex flex-col gap-4">
        {ORDER.map((name) =>
          name === "stripe" ? (
            <StripeCard
              key={name}
              integration={byName[name]}
              saving={saveStripe.isPending || toggle.isPending}
              onToggle={(integration) => toggle.mutate({ id: integration.id, isActive: !integration.isActive })}
              onSave={(payload) => saveStripe.mutate({ ...payload, isActive: byName[name] ? byName[name].isActive : true })}
            />
          ) : (
            <ServiceCard
              key={name}
              name={name}
              meta={SERVICE_META[name]}
              integration={byName[name]}
              currentModel={aiModels?.[name]}
              saving={save.isPending || toggle.isPending}
              savingModel={saveModel.isPending}
              onToggle={(integration) => toggle.mutate({ id: integration.id, isActive: !integration.isActive })}
              onSave={(n, credential, currentActive, fromEmail) =>
                save.mutate({ name: n, credential, isActive: byName[n] ? currentActive : true, fromEmail })
              }
              onSaveModel={(n, value) => saveModel.mutate({ name: n, value })}
              onTestResend={() => testResend.mutate()}
              testingResend={testResend.isPending}
              onTestAi={(n) => testAi.mutate(n)}
              testingAi={testAi.isPending && testAi.variables === name}
            />
          )
        )}
      </div>
      <p className="mt-[18px] text-[12px] text-outline">
        Nota: Stripe se usa <strong>solo</strong> para cobrar la suscripción Business a {siteName} — nunca en las ventas entre vendedor y cliente.
      </p>
    </div>
  );
}
