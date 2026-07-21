import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Copy } from "lucide-react";
import { api } from "../../lib/api.js";

// Bloque 27: Groq es el proveedor PRINCIPAL de IA cuando está activo (chat
// + "Mejorar con IA") — Gemini pasa a ser el respaldo: solo responde si
// Groq está desactivado/sin key, o automático si Groq falla una consulta
// puntual y Gemini también está activo (con uno solo activo no hay a quién
// más recurrir, ver lib/ai.js).
const SERVICE_META = {
  gemini: { name: "Google AI Studio (Gemini)", desc: "Respaldo de IA — entra si Groq está inactivo o falla", emoji: "✨", iconBg: "rgba(42,111,219,0.1)" },
  groq: { name: "Groq", desc: "Proveedor principal de IA (chatbot de tienda y 'Mejorar con IA')", emoji: "⚡", iconBg: "rgba(138,81,0,0.1)" },
  resend: { name: "Resend", desc: "Correos: verificación, avisos de plan, campañas", emoji: "✉️", iconBg: "rgba(51,116,117,0.1)" },
  stripe: { name: "Stripe", desc: "Cobro de suscripción Business a ZeuDin", emoji: "💳", iconBg: "rgba(97,160,161,0.15)" },
};
const ORDER = ["gemini", "groq", "resend", "stripe"];

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

function ServiceCard({ name, meta, integration, onToggle, onSave, saving }) {
  const [draft, setDraft] = useState("");
  const [fromDraft, setFromDraft] = useState(integration?.fromEmail ?? "");

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
      <CardHeader meta={meta} hasIntegration={!!integration} isActive={isActive} saving={saving} onToggle={() => onToggle(integration)} />
      <div className="flex gap-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          type="password"
          placeholder={integration ? integration.keyMask : "Pegá la clave aquí..."}
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
    navigator.clipboard?.writeText(WEBHOOK_URL).then(() => toast.success("URL copiada."));
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
            {WEBHOOK_URL.includes("localhost") && " En desarrollo local usá Stripe CLI (stripe listen) para reenviar los eventos hasta acá."}
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
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["admin-integrations"],
    queryFn: async () => (await api.get("/admin/integrations")).data.integrations,
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

  const byName = Object.fromEntries((data ?? []).map((i) => [i.name, i]));

  return (
    <div className="max-w-[820px]">
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Integraciones</h1>
      <p className="mb-2 text-[13.5px] text-outline">Configurá las claves de servicios. Se guardan cifradas (AES-256-GCM), nunca en texto plano.</p>
      <div className="mb-[22px] rounded-[10px] bg-tertiary-accent/[0.08] px-3.5 py-2.5 text-[12px] text-tertiary-accent">
        🔐 Podés activar, desactivar o rotar cada clave sin tocar el servidor. Con Groq activo, es siempre el proveedor
        principal; Gemini responde en su lugar solo si Groq está desactivado, o como respaldo automático cuando Groq
        falla una consulta puntual y Gemini también está activo. Un proveedor desactivado nunca se usa, ni siquiera
        como respaldo.
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
              saving={save.isPending || toggle.isPending}
              onToggle={(integration) => toggle.mutate({ id: integration.id, isActive: !integration.isActive })}
              onSave={(n, credential, currentActive, fromEmail) =>
                save.mutate({ name: n, credential, isActive: byName[n] ? currentActive : true, fromEmail })
              }
            />
          )
        )}
      </div>
      <p className="mt-[18px] text-[12px] text-outline">
        Nota: Stripe se usa <strong>solo</strong> para cobrar la suscripción Business a ZeuDin — nunca en las ventas entre vendedor y cliente.
      </p>
    </div>
  );
}
