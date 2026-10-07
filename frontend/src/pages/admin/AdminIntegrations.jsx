import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Copy, RefreshCw, Plug } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { copyToClipboard } from "../../lib/clipboard.js";
import ToggleSwitch from "../../components/admin/ToggleSwitch.jsx";
import AiModelsPanel from "../../components/admin/AiModelsPanel.jsx";
import AiQuotaPanel from "../../components/admin/AiQuotaPanel.jsx";

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
const ORDER = ["groq", "nvidia", "gemini", "resend", "stripe"];
// Bloque 43/45/245: estos tres tienen modelos administrables — Resend/Stripe no.
const AI_PROVIDERS = ["groq", "nvidia", "gemini"];

// Bloque 25: URL que el admin tiene que pegar en el dashboard de Stripe
// (Developers → Webhooks → Add endpoint). api.defaults.baseURL ya apunta al
// backend real (no al frontend) — en dev es localhost, en producción va a
// ser el dominio público donde corra la API.
const WEBHOOK_URL = `${api.defaults.baseURL}/stripe/webhook`;

// Bloque 238/245: resumen de salud del proveedor a partir de sus modelos
// (cada uno se mide aparte, ver AiModelsPanel). Complementa el badge
// "Activo/Inactivo", que solo dice si HAY una clave, no si responde. El verde
// del texto es más oscuro que el del interruptor para llegar a contraste AA.
function HealthLine({ models }) {
  const active = (models ?? []).filter((m) => m.isActive);
  const measured = active.filter((m) => m.health && m.health.status !== "inactive");
  if (measured.length === 0) return null;
  const down = measured.filter((m) => m.health.status === "down");
  if (down.length === 0) {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-[#087A38]">
        <span className="h-2 w-2 rounded-full bg-[#0CAE53]" aria-hidden="true" />
        {active.length === 1 ? "Respondiendo bien" : `Respondiendo bien (${active.length} modelos activos)`}
      </div>
    );
  }
  const allDown = down.length === measured.length;
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-error">
      <span className="h-2 w-2 rounded-full bg-error" aria-hidden="true" />
      {allDown ? "Ningún modelo responde" : `${down.length} de ${measured.length} modelos caídos`}
    </div>
  );
}

function CardHeader({ meta, hasIntegration, isActive, saving, onToggle, models }) {
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
        <HealthLine models={models} />
      </div>
      <ToggleSwitch isActive={isActive} disabled={!hasIntegration || saving} onToggle={onToggle} label={`${isActive ? "Desactivar" : "Activar"} ${meta.name}`} />
    </div>
  );
}

function ServiceCard({ name, meta, integration, modelsData, onToggle, onSave, onTestResend, onTestAi, saving, testingResend, testingModel }) {
  const [draft, setDraft] = useState("");
  const [fromDraft, setFromDraft] = useState(integration?.fromEmail ?? "");
  const showModelField = AI_PROVIDERS.includes(name);

  useEffect(() => {
    setFromDraft(integration?.fromEmail ?? "");
  }, [integration?.fromEmail]);

  const isActive = integration?.isActive ?? false;
  const showFromEmail = name === "resend";
  const fromChanged = showFromEmail && fromDraft !== (integration?.fromEmail ?? "");
  const canSave = draft || fromChanged;
  function handleSave() {
    onSave(name, draft || undefined, isActive, showFromEmail ? fromDraft : undefined);
    setDraft("");
  }

  return (
    <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5">
      <CardHeader meta={meta} hasIntegration={!!integration} isActive={isActive} saving={saving} onToggle={() => onToggle(integration)} models={modelsData?.models} />
      <div className="flex gap-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          type="password"
          placeholder={integration ? integration.keyMask : "Pega la clave aquí..."}
          className="h-11 min-w-0 flex-1 rounded-lg border border-outline-variant px-3.5 font-mono text-[13px] outline-none"
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
      {/* Bloque 43/44/245: modelos administrables sin tocar código. Con la
          clave guardada se elige de la lista REAL del proveedor; cada modelo
          tiene su propio estado, interruptor y orden de prueba. */}
      {showModelField && <AiModelsPanel provider={name} integration={integration} data={modelsData} onTest={onTestAi} testingModel={testingModel} />}
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
            Cárgalo en Stripe → Developers → Webhooks → Add endpoint, escuchando el evento <span className="font-mono">checkout.session.completed</span>.
            {WEBHOOK_URL.includes("localhost") && " En desarrollo local usa Stripe CLI (stripe listen) para reenviar los eventos hasta aquí."}
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

export default function AdminIntegrations({ embedded = false }) {
  const { siteName } = usePlatformSettings();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["admin-integrations"],
    queryFn: async () => (await api.get("/admin/integrations")).data.integrations,
  });

  // Bloque 245: modelos de cada proveedor con su estado de salud real (cada
  // modelo se mide aparte; refetchInterval para que el estado no se quede
  // viejo mientras el admin tiene la pantalla abierta).
  const { data: aiModels } = useQuery({
    queryKey: ["admin-ai-models"],
    queryFn: async () => (await api.get("/admin/ai-models")).data.providers,
    refetchInterval: 30_000,
  });
  const modelsByProvider = Object.fromEntries((aiModels ?? []).map((p) => [p.provider, p]));

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
    mutationFn: async ({ name, model }) => (await api.post(`/admin/integrations/${name}/test-ai`, { model })).data,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin-ai-models"] });
      toast.success(`Respondió en ${result.ms}ms con el modelo "${result.model}".`);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo probar la conexión.", { duration: 8000 }),
  });

  const byName = Object.fromEntries((data ?? []).map((i) => [i.name, i]));

  return (
    <div className="max-w-[820px]">
      {!embedded && (
        <>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Plug} tone="teal" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Integraciones</h1>
      </div>
      <p className="mb-2 text-[13.5px] text-outline">Configura las claves de servicios. Se guardan cifradas (AES-256-GCM), nunca en texto plano.</p>
        </>
      )}
      <div className="mb-[22px] rounded-[10px] bg-tertiary-accent/[0.08] px-3.5 py-2.5 text-[12px] text-tertiary-accent">
        Puedes activar, desactivar o rotar cada clave sin tocar el servidor. Orden de IA: Groq (principal), luego
        NVIDIA NIM y por último Gemini. Cada una se usa solo mientras le quede cupo en su plan gratis: cerca del límite
        se pasa a la siguiente y vuelve sola cuando se renueva. Un proveedor desactivado nunca se usa.
      </div>
      {/* Bloque 85/245: transparencia sobre la reparación automática. El admin
          ve acá POR QUÉ la lista de modelos de un proveedor puede cambiar sola. */}
      <div className="mb-[22px] rounded-[10px] bg-surface-container px-3.5 py-2.5 text-[12px] text-on-surface-variant">
        No hay pruebas automáticas que gasten tokens: si un modelo falla dos veces seguidas con clientes reales, queda
        marcado caído y la consulta pasa al siguiente. Una vez al día (3:00am) se revisa la lista de modelos de cada API
        y se reprueban solo los caídos. Tú puedes probar cualquier modelo a mano con "Probar". Si no queda ningún modelo
        disponible, el chatbot se oculta en todo el sitio.
      </div>

      <AiQuotaPanel />

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
              modelsData={modelsByProvider[name]}
              saving={save.isPending || toggle.isPending}
              onToggle={(integration) => toggle.mutate({ id: integration.id, isActive: !integration.isActive })}
              onSave={(n, credential, currentActive, fromEmail) =>
                save.mutate({ name: n, credential, isActive: byName[n] ? currentActive : true, fromEmail })
              }
              onTestResend={() => testResend.mutate()}
              testingResend={testResend.isPending}
              onTestAi={(n, model) => testAi.mutate({ name: n, model })}
              testingModel={testAi.isPending && testAi.variables?.name === name ? testAi.variables.model : null}
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
