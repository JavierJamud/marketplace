import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, RefreshCw, Plus } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { timeSince } from "../../lib/relativeTime.js";
import ToggleSwitch from "./ToggleSwitch.jsx";

// Bloque 245 (pedido explícito): cada proveedor de IA puede tener uno o varios
// modelos activos, con respaldo entre ellos. Este panel va dentro de la tarjeta
// de cada proveedor en Admin → Integraciones. La política de qué pasa cuando un
// modelo falla (aviso, reparación automática) vive en el backend
// (lib/aiModelRepair.js); acá solo se muestra el estado y se administra la lista.

const MODEL_NOTE_BY_PROVIDER = { nvidia: "Si falla, revisa build.nvidia.com: el Free Endpoint puede cambiar de nombre sin aviso." };

const BTN_ICON =
  "flex h-11 w-11 items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container disabled:opacity-40 md:h-9 md:w-9 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent";

// Estado de salud de un modelo en una línea. El texto verde usa un tono más
// oscuro que el del interruptor para llegar a contraste AA sobre fondo claro.
function ModelHealth({ model }) {
  const h = model.health;
  if (!model.isActive) return <span className="text-[12px] text-outline">Apagado</span>;
  if (!h) return <span className="text-[12px] text-outline">Sin medir todavía</span>;
  if (h.status === "healthy") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[#087A38]">
        <span className="h-2 w-2 rounded-full bg-[#0CAE53]" aria-hidden="true" />
        Responde bien{h.lastLatencyMs ? ` (${(h.lastLatencyMs / 1000).toFixed(1)} s)` : ""}
      </span>
    );
  }
  return (
    <span className="flex items-start gap-1.5 text-[12px] font-semibold text-error" title={h.lastError ?? undefined}>
      <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-error" aria-hidden="true" />
      <span>Caído {timeSince(h.downSince ?? h.lastCheckedAt)}. Se avisó por correo.</span>
    </span>
  );
}

// Cifras abreviadas (8000 -> 8K, 1000000 -> 1M) para que la línea de datos quepa en móvil.
function compact(n) {
  if (n == null) return null;
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}K`;
  return String(n);
}

// Lo que la API informa de cada modelo. Todo viene de la API o de sus respuestas; lo que
// todavía no se ha medido simplemente no se muestra.
function ModelStats({ model }) {
  const l = model.limits ?? {};
  const parts = [
    model.contextWindow ? `Contexto ${compact(model.contextWindow)}` : null,
    l.tokensPerMinute ? `${compact(l.tokensPerMinute.limit)} tokens/min` : null,
    l.tokensPerDay ? `${compact(l.tokensPerDay.limit)} tokens/día` : null,
    l.requestsPerMinute ? `${compact(l.requestsPerMinute.limit)} pedidos/min` : null,
    l.requestsPerDay ? `${compact(l.requestsPerDay.limit)} pedidos/día` : null,
  ].filter(Boolean);
  if (!model.isActive || (parts.length === 0 && !model.resting)) return null;
  const used = Math.min(100, Math.round((model.usageRatio ?? 0) * 100));
  return (
    <p className="mt-1 text-[11.5px] text-on-surface-variant">
      {parts.join(" · ")}
      {parts.length > 0 && ` · usado ${used}%`}
      {model.resting && <span className="font-semibold text-error">{parts.length > 0 ? " · " : ""}Descansando: {model.resting.reason}</span>}
    </p>
  );
}

function SourceBadge({ source }) {
  if (source === "AUTO") {
    return <span className="rounded-full bg-tertiary-accent/10 px-2 py-0.5 text-[10.5px] font-bold text-tertiary-accent">Automático</span>;
  }
  if (source === "DEFAULT") {
    return <span className="rounded-full bg-surface-container px-2 py-0.5 text-[10.5px] font-bold text-on-surface-variant">Por defecto</span>;
  }
  return null;
}

export default function AiModelsPanel({ provider, integration, data, onTest, testingModel }) {
  const queryClient = useQueryClient();
  const [pick, setPick] = useState("");
  const [typed, setTyped] = useState("");

  const models = data?.models ?? [];
  const configured = new Set(models.map((m) => m.model));
  const activeCount = models.filter((m) => m.isActive).length;

  // Lista REAL de modelos que esa clave puede usar (consultada en vivo a la
  // API del proveedor): se elige de acá en vez de tipear a mano, porque un
  // nombre mal escrito ya tumbó a Groq con un 404 una vez.
  const listQuery = useQuery({
    queryKey: ["provider-models", provider],
    queryFn: async () => (await api.get(`/admin/integrations/${provider}/models`)).data,
    enabled: !!integration,
    retry: false,
    // Bloque 263 (pedido explícito — modelos "actualizados en tiempo real"): la lista
    // se vuelve a pedir a la API al abrir el panel, al volver a la pestaña y cada
    // 5 minutos, nunca se muestra una lista vieja de hace horas.
    staleTime: 0,
    refetchOnWindowFocus: true,
    // Mientras el servidor comprueba qué modelos responden con esta clave, se vuelve a
    // pedir cada 3 segundos para ir mostrando los resultados.
    refetchInterval: (query) => (query.state.data?.probing?.running ? 3000 : 5 * 60 * 1000),
  });
  const probing = listQuery.data?.probing ?? { running: false, done: 0, total: 0 };
  const catalog = listQuery.data?.catalog ?? [];
  const categories = listQuery.data?.categories ?? [];
  const catalogById = new Map(catalog.map((m) => [m.id, m]));
  const options = catalog.filter((m) => !configured.has(m.id));
  const pickedInfo = catalogById.get(pick) ?? null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-ai-models"] });
  const onError = (fallback) => (err) => toast.error(err.response?.data?.error ?? fallback, { duration: 8000 });

  const add = useMutation({
    mutationFn: async (model) => (await api.post("/admin/ai-models", { provider, model })).data,
    onSuccess: (result) => {
      refresh();
      setPick("");
      setTyped("");
      toast.success(`Modelo agregado y verificado (respondió en ${result.ms} ms).`);
    },
    onError: onError("No se pudo agregar el modelo."),
  });
  const toggle = useMutation({
    mutationFn: async ({ id, isActive }) => (await api.patch(`/admin/ai-models/${id}`, { isActive })).data,
    onSuccess: refresh,
    onError: onError("No se pudo cambiar el modelo."),
  });
  const remove = useMutation({
    mutationFn: async (id) => (await api.delete(`/admin/ai-models/${id}`)).data,
    onSuccess: () => {
      refresh();
      toast.success("Modelo quitado.");
    },
    onError: onError("No se pudo quitar el modelo."),
  });

  const busy = add.isPending || toggle.isPending || remove.isPending;
  const candidate = (listQuery.isSuccess ? pick : typed).trim();

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-[12.5px] font-bold text-on-surface">Modelos de este proveedor</h3>
        {!!integration && (
          <button
            type="button"
            onClick={() => listQuery.refetch()}
            disabled={listQuery.isFetching}
            title="Actualizar la lista de modelos disponibles"
            className="flex min-h-11 items-center gap-1 px-1 text-[11.5px] font-semibold text-tertiary-accent disabled:opacity-50 md:min-h-0"
          >
            <RefreshCw className={`h-3 w-3 ${listQuery.isFetching ? "animate-spin" : ""}`} aria-hidden="true" /> Actualizar lista
          </button>
        )}
      </div>
      <p className="mb-2.5 text-[11.5px] text-outline">
        Arriba van los que menos cupo han gastado. Cada consulta usa el primero disponible y, si ese modelo se agota o falla, pasa al siguiente de este mismo proveedor. Si un modelo desaparece de la lista de la API, el sistema busca uno nuevo, lo verifica y te avisa por correo.
      </p>

      <ul className="flex flex-col gap-2">
        {models.map((m) => {
          const virtual = m.id === null;
          const isTesting = testingModel === m.model;
          return (
            <li key={m.model} className="rounded-xl border border-surface-container-high bg-surface-container-lowest p-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="break-all font-mono text-[12.5px] font-semibold text-on-surface">{m.model}</span>
                    <SourceBadge source={m.source} />
                    {listQuery.isSuccess && !catalogById.has(m.model) && (
                      <span className="rounded-full bg-error/10 px-2 py-0.5 text-[10.5px] font-bold text-error">Ya no aparece en la API</span>
                    )}
                  </div>
                  {catalogById.get(m.model) && (
                    <p className="mt-0.5 text-[11.5px] text-on-surface-variant">
                      <span className="font-semibold">{catalogById.get(m.model).label}.</span> {catalogById.get(m.model).description ?? catalogById.get(m.model).purpose}
                    </p>
                  )}
                  <div className="mt-1">
                    <ModelHealth model={m} />
                  </div>
                  <ModelStats model={m} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onTest(provider, m.model)}
                    disabled={!integration || isTesting}
                    className="flex h-11 items-center gap-1.5 rounded-lg border border-outline-variant px-3 text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50 md:h-9 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isTesting ? "animate-spin" : ""}`} aria-hidden="true" />
                    {isTesting ? "Probando..." : "Probar"}
                  </button>
                  {!virtual && (
                    <>
                      <ToggleSwitch
                        isActive={m.isActive}
                        disabled={busy || (m.isActive && activeCount <= 1)}
                        label={`${m.isActive ? "Apagar" : "Activar"} ${m.model}`}
                        onToggle={() => toggle.mutate({ id: m.id, isActive: !m.isActive })}
                      />
                      <button
                        type="button"
                        className={`${BTN_ICON} hover:text-error`}
                        aria-label={`Quitar ${m.model}`}
                        disabled={busy || (m.isActive && activeCount <= 1 && models.length > 1)}
                        onClick={() => remove.mutate(m.id)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {models.length === 1 && models[0].id === null && (
        <p className="mt-2 text-[11.5px] text-outline">
          Este proveedor usa su modelo por defecto. Agrega otro para tener respaldo si este falla.
        </p>
      )}

      <div className="mt-3">
        <label htmlFor={`add-model-${provider}`} className="mb-1 block text-[11.5px] font-semibold text-on-surface-variant">
          Agregar un modelo
        </label>
        <div className="flex gap-2.5">
          {listQuery.isSuccess ? (
            <select
              id={`add-model-${provider}`}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="h-11 min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-mono text-[12.5px] outline-none md:h-[38px]"
            >
              <option value="">Elige un modelo de la lista real</option>
              {categories.map((cat) => {
                const inCat = options.filter((m) => m.category === cat.id);
                if (inCat.length === 0) return null;
                const working = inCat.filter((m) => m.verified).length;
                const label = cat.id === "text" || cat.id === "vision" ? `${cat.label}: sirve para el chat (${working} funcionan con tu cuenta de ${inCat.length})` : `${cat.label}: no va al chat (${inCat.length})`;
                return (
                  <optgroup key={cat.id} label={label}>
                    {inCat.map((m) => {
                      const unknown = !m.verified && !m.unavailable;
                      const blocked = !m.addable || m.unavailable || (unknown && probing.running);
                      return (
                        <option key={m.id} value={m.id} disabled={blocked}>
                          {m.verified ? "✓ " : ""}
                          {m.id}
                          {m.unavailable ? "  (no disponible en tu cuenta)" : !m.addable ? "  (no sirve para el chat)" : m.verified ? "  (funciona con tu cuenta)" : probing.running ? "  (comprobando...)" : "  (sin comprobar)"}
                        </option>
                      );
                    })}
                  </optgroup>
                );
              })}
            </select>
          ) : (
            <input
              id={`add-model-${provider}`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              type="text"
              disabled={!integration}
              placeholder={integration ? "Escribe el nombre exacto del modelo" : "Guarda la clave primero"}
              className="h-11 min-w-0 flex-1 rounded-lg border border-outline-variant px-3 font-mono text-[12.5px] outline-none disabled:opacity-60 md:h-[38px]"
            />
          )}
          <button
            type="button"
            disabled={!integration || !candidate || busy}
            onClick={() => add.mutate(candidate)}
            className="flex h-11 flex-shrink-0 items-center gap-1.5 rounded-lg bg-surface-container px-4 text-[13px] font-semibold text-on-surface-variant disabled:opacity-50 md:h-[38px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {add.isPending ? "Verificando..." : "Agregar"}
          </button>
        </div>
        {pickedInfo && (
          <p className="mt-1.5 rounded-lg bg-surface-container px-3 py-2 text-[12px] text-on-surface-variant">
            <span className="font-semibold text-on-surface">{pickedInfo.label}.</span> {pickedInfo.description ?? pickedInfo.purpose}
            {pickedInfo.owner ? ` Publicado por ${pickedInfo.owner}.` : ""}
            {pickedInfo.contextWindow ? ` Memoria de ${Number(pickedInfo.contextWindow).toLocaleString("es-CU")} tokens.` : ""}
          </p>
        )}
        {probing.running && (
          <p className="mt-1.5 text-[12px] font-semibold text-tertiary-accent" role="status">
            Comprobando qué modelos responden con tu cuenta: {probing.done} de {probing.total}. Los que ya funcionan aparecen con ✓.
          </p>
        )}
        {listQuery.isSuccess && (
          <p className="mt-1.5 text-[11.5px] text-outline">
            La plataforma usa hoy modelos de <span className="font-semibold">Texto</span> (chat, asistentes, descripciones) y <span className="font-semibold">Audio</span> (voz a texto con Whisper de Groq). Los de <span className="font-semibold">Texto + imagen</span> servirán para analizar tiendas y páginas. Imagen, video, embeddings y moderación aparecen para que sepas qué ofrece la API, pero no se agregan al chat. Elige solo los marcados con ✓: la API lista modelos que tu cuenta no puede usar. Lista consultada a la API hace un momento ({catalog.length} modelos).
          </p>
        )}
        {!integration && <p className="mt-1 text-[11.5px] text-outline">Guarda la clave primero para elegir de la lista real de modelos.</p>}
        {integration && listQuery.isError && <p className="mt-1 text-[11.5px] text-error">No se pudo consultar la lista de modelos. Escribe el nombre a mano.</p>}
        <p className="mt-1 text-[11.5px] text-outline">Antes de guardarlo se le hace una consulta real: si no responde, no se agrega.</p>
        {MODEL_NOTE_BY_PROVIDER[provider] && <p className="mt-1 text-[11.5px] text-outline">{MODEL_NOTE_BY_PROVIDER[provider]}</p>}
      </div>
    </div>
  );
}
