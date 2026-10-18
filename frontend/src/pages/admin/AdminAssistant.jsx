import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { FileText, Trash2, Bot, ThumbsUp, ThumbsDown, GraduationCap, Power, Sparkles, RefreshCw, Search, X, ShieldCheck, ChevronLeft, ChevronRight, MessageSquareText, Pencil, ArrowUp, ArrowDown, Plus } from "lucide-react";
import { api } from "../../lib/api.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { ChatMarkdown } from "../../components/ChatMarkdown.jsx";

// Bloque 30: entrenar al bot general del marketplace (Home) — a diferencia
// del "Documento de IA" por tienda (VendorSettings.jsx, un solo archivo que
// se reemplaza), acá se permiten VARIOS documentos a la vez porque el bot
// general cubre dos audiencias distintas (clientes y vendedores) que suele
// convenir separar en archivos propios. Mismo mecanismo de extracción de
// texto que ya usa el chat por tienda (nunca se duplica esa lógica).
export default function AdminAssistant() {
  const { siteName } = usePlatformSettings();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState(null); // documento a eliminar

  const { data, isLoading } = useQuery({
    queryKey: ["assistant-documents"],
    queryFn: async () => (await api.get("/assistant/documents")).data.documents,
  });

  const upload = useMutation({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append("document", file);
      return (await api.post("/assistant/documents", formData, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success("Documento cargado — ya lo usa el asistente del marketplace.");
      queryClient.invalidateQueries({ queryKey: ["assistant-documents"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo subir el documento."),
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/assistant/documents/${id}`),
    onSuccess: () => {
      toast.success("Documento eliminado.");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["assistant-documents"] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo eliminar el documento.");
      setDeleteTarget(null);
    },
  });

  return (
    <div className="max-w-[900px]">
      <div className="mb-1 flex items-center gap-2.5">
        <Bot className="h-6 w-6 text-tertiary-accent" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Asistente del marketplace</h1>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        El bot general de {siteName} (botón flotante en el Home) usa estos documentos como fuente de verdad para preguntas institucionales —
        cómo comprar, cómo vender, verificación, planes, medios de pago, etc. — además del catálogo completo de productos. Sin documentos
        cargados, el asistente sigue funcionando solo con el catálogo.
      </p>

      <AutoLearningSection />

      <div className="mb-5 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-6">
        <div className="mb-1 text-[15px] font-bold text-on-surface">Subir documento</div>
        <p className="mb-3.5 text-[12.5px] text-outline">
          Sube uno para clientes (cómo comprar, políticas generales) y otro para vendedores (cómo vender, verificación, planes) — o los que
          necesites, todos se leen juntos.
        </p>
        <label className={`block rounded-md border-2 border-dashed border-outline-variant p-[22px] text-center ${upload.isPending ? "cursor-wait opacity-70" : "cursor-pointer"}`}>
          <span className="text-[13px] text-outline">
            {upload.isPending ? "Subiendo..." : "Arrastra un .pdf o .txt · o "}
            {!upload.isPending && <span className="font-semibold text-tertiary-accent">elige un archivo</span>}
          </span>
          <input
            type="file"
            accept=".pdf,.txt"
            className="hidden"
            disabled={upload.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) upload.mutate(file);
            }}
          />
        </label>
      </div>

      <div className="mb-5 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-6">
        <div className="mb-3.5 text-[15px] font-bold text-on-surface">Documentos cargados</div>
        {isLoading ? (
          <p className="text-[13px] text-outline">Cargando...</p>
        ) : data?.length > 0 ? (
          <div className="flex flex-col gap-2">
            {data.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 rounded-xl border border-outline-variant px-3.5 py-2.5">
                <FileText className="h-4 w-4 flex-shrink-0 text-tertiary-accent" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-on-surface">{doc.originalName}</div>
                  <div className="text-[11.5px] text-outline">{new Date(doc.createdAt).toLocaleDateString("es-CU")}</div>
                </div>
                <button
                  onClick={() => setDeleteTarget(doc)}
                  disabled={remove.isPending}
                  className="flex-shrink-0 text-error disabled:opacity-50"
                  title="Eliminar documento"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-outline">Todavía no subiste ningún documento — el asistente funciona igual solo con el catálogo.</p>
        )}
      </div>

      <ChatReviewSection />

      {deleteTarget && (
        <ConfirmDeleteModal
          title={`¿Eliminar "${deleteTarget.originalName}"?`}
          description="El asistente del marketplace deja de usar este documento como fuente."
          pending={remove.isPending}
          onConfirm={() => remove.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}


// Aprendizaje automático: una vez al día el sistema resume lo que preguntan y buscan los clientes y arma con eso las preguntas
// sugeridas que aparecen al abrir el chat. No usa IA ni gasta tokens: son conteos de conversaciones y búsquedas reales.
function AutoLearningSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["assistant-learning"], queryFn: async () => (await api.get("/assistant/learning")).data });
  const refresh = useMutation({
    mutationFn: async () => (await api.post("/assistant/learning/refresh")).data,
    onSuccess: (d) => {
      queryClient.setQueryData(["assistant-learning"], d);
      queryClient.invalidateQueries({ queryKey: ["assistant-suggestions"] });
      toast.success("Aprendizaje actualizado con los datos de hoy.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar."),
  });
  const toggle = useMutation({
    mutationFn: async (autoLearn) => (await api.patch("/assistant/learning", { autoLearn })).data,
    onSuccess: (d) => {
      queryClient.setQueryData(["assistant-learning"], d);
      queryClient.invalidateQueries({ queryKey: ["assistant-suggestions"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  const snap = data?.snapshot;
  const maxTheme = Math.max(1, ...(snap?.themes ?? []).map((t) => t.count));

  return (
    <div className="mb-5 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-5 w-5 text-tertiary-accent" aria-hidden="true" />
          <div className="text-[15px] font-bold text-on-surface">Aprendizaje automático</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!data?.autoLearn}
          disabled={isLoading || toggle.isPending}
          onClick={() => toggle.mutate(!data?.autoLearn)}
          className="flex min-h-11 items-center gap-2.5 rounded-full px-1 text-[12.5px] font-semibold text-on-surface-variant disabled:opacity-50"
        >
          <span className={`relative h-6 w-11 rounded-full transition-colors ${data?.autoLearn ? "bg-tertiary-accent" : "bg-outline-variant"}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${data?.autoLearn ? "left-[22px]" : "left-0.5"}`} />
          </span>
          {data?.autoLearn ? "Activado" : "Desactivado"}
        </button>
      </div>
      <p className="mb-4 text-[12.5px] text-outline">
        El asistente aprende solo de lo que los clientes preguntan y buscan en el sitio. Cada día se recalculan las preguntas que aparecen al abrir el chat
        (y los temas y rubros más pedidos). Con el aprendizaje desactivado se muestran siempre las preguntas base. Si escribes tus propias
        preguntas, el chat muestra las tuyas.
      </p>

      {!isLoading && data && <SuggestionsEditor data={data} />}

      {isLoading ? (
        <p className="text-[13px] text-outline">Cargando...</p>
      ) : !snap ? (
        <p className="text-[13px] text-outline">Todavía no hay un resumen calculado. Pulsa "Recalcular ahora".</p>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <div className="mb-2 text-[13px] font-bold text-on-surface">Rubros más buscados</div>
            {snap.topCategories?.length ? (
              <ol className="flex list-decimal flex-col gap-1 pl-5 text-[12.5px] text-on-surface-variant">
                {snap.topCategories.map((c) => <li key={c.name}>{c.name}</li>)}
              </ol>
            ) : (
              <p className="text-[12.5px] text-outline">Aún no hay búsquedas suficientes.</p>
            )}
          </div>
          <div>
            <div className="mb-2 text-[13px] font-bold text-on-surface">Temas más consultados (últimos {snap.periodDays} días)</div>
            <div className="flex flex-col gap-1.5">
              {snap.themes.map((t) => (
                <div key={t.key} className="flex items-center gap-2 text-[12.5px]">
                  <span className="w-36 flex-shrink-0 text-on-surface-variant">{t.label}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container">
                    <span className="block h-full rounded-full bg-tertiary-accent" style={{ width: `${(t.count / maxTheme) * 100}%` }} />
                  </span>
                  <span className="w-8 text-right font-semibold text-on-surface">{t.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <div className="mb-2 text-[13px] font-bold text-on-surface">Preguntas más repetidas</div>
            {snap.topQuestions?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-[12.5px]">
                  <thead>
                    <tr className="border-b border-outline-variant text-on-surface">
                      <th className="px-2 py-1.5 font-bold">Pregunta</th>
                      <th className="w-20 px-2 py-1.5 text-right font-bold">Veces</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.topQuestions.map((q) => (
                      <tr key={q.text} className="border-b border-surface-container-high text-on-surface-variant">
                        <td className="px-2 py-1.5">{q.text}</td>
                        <td className="px-2 py-1.5 text-right font-semibold text-on-surface">{q.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[12.5px] text-outline">Todavía no hay conversaciones en este periodo.</p>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-surface-container pt-3">
        <p className="text-[12px] text-outline">
          {snap ? `${snap.messagesAnalyzed} mensajes analizados · ` : ""}
          {data?.computedAt ? `Actualizado ${new Date(data.computedAt).toLocaleString("es-CU")} · ` : ""}
          {data ? `${data.lessons} criterios aprendidos de ${data.examples} correcciones` : ""}
        </p>
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="flex min-h-11 items-center gap-1.5 rounded-xl bg-primary-container px-4 text-[12.5px] font-bold text-white disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refresh.isPending ? "animate-spin" : ""}`} aria-hidden="true" /> {refresh.isPending ? "Actualizando..." : "Recalcular ahora"}
        </button>
      </div>
    </div>
  );
}

// Registro de lo que preguntan los clientes a los dos chatbots (asistente del sitio y chat de cada tienda), con filtros y un
// identificador por cliente: su cuenta si estaba logueado, o "Visitante XXXXX" (la misma etiqueta para la misma sesión). Las
// conversaciones se borran a las 24 h para que la IA no las vuelva a leer; este registro dura 90 días.
// Entrenar: "Buena" refuerza el estilo de esa respuesta y "Corregir" guarda cómo debió responder. El bot no copia el texto: de
// cada corrección se saca un criterio (tono, formato, qué datos consultar) que aplica con datos reales en charlas futuras.
const FILTER = "rounded-full px-3 py-1.5 text-[12px] font-semibold min-h-9";
const CARD = "rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-6";

function Segmented({ value, onChange, options, label }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`${FILTER} ${value === o.id ? "bg-primary-container text-white" : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ChatReviewSection() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ bot: "all", client: "all", vendorStatus: "all", vendorId: "", clientKey: "", clientLabel: "", q: "" });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [correctingId, setCorrectingId] = useState(null);
  const [draft, setDraft] = useState("");
  const [examplesBot, setExamplesBot] = useState("GENERAL");
  const [deleteExampleTarget, setDeleteExampleTarget] = useState(null);

  const set = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const params = new URLSearchParams({ bot: filters.bot, client: filters.client, vendorStatus: filters.vendorStatus, page: String(page), pageSize: "25" });
  if (filters.vendorId) params.set("vendorId", filters.vendorId);
  if (filters.clientKey) params.set("clientKey", filters.clientKey);
  if (filters.q) params.set("q", filters.q);

  const { data: log, isLoading: loadingLog, isError: logError } = useQuery({
    queryKey: ["chat-log", params.toString()],
    queryFn: async () => (await api.get(`/admin/chat-review/log?${params}`)).data,
    placeholderData: (prev) => prev,
  });

  const { data: examples, isLoading: loadingExamples } = useQuery({
    queryKey: ["chat-training-examples", examplesBot],
    queryFn: async () => (await api.get(`/admin/chat-review/examples?bot=${examplesBot}`)).data.examples,
  });

  const invalidateExamples = () => queryClient.invalidateQueries({ queryKey: ["chat-training-examples"] });

  const createExample = useMutation({
    mutationFn: async (payload) => (await api.post("/admin/chat-review/examples", payload)).data,
    onSuccess: () => {
      toast.success("Guardado. El bot aplica ese criterio desde la próxima respuesta.");
      setCorrectingId(null);
      setDraft("");
      invalidateExamples();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el ejemplo."),
  });

  const toggleExample = useMutation({
    mutationFn: async ({ id, activo }) => (await api.patch(`/admin/chat-review/examples/${id}`, { activo })).data,
    onSuccess: invalidateExamples,
    onError: () => toast.error("No se pudo actualizar el ejemplo."),
  });

  const deleteExample = useMutation({
    mutationFn: async (id) => api.delete(`/admin/chat-review/examples/${id}`),
    onSuccess: () => {
      toast.success("Ejemplo eliminado.");
      setDeleteExampleTarget(null);
      invalidateExamples();
    },
    onError: () => {
      toast.error("No se pudo eliminar el ejemplo.");
      setDeleteExampleTarget(null);
    },
  });

  const items = log?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((log?.total ?? 0) / (log?.pageSize ?? 25)));

  return (
    <>
      <div className={`${CARD} mb-5`}>
        <div className="mb-1 flex items-center gap-2.5">
          <MessageSquareText className="h-5 w-5 text-tertiary-accent" />
          <h2 className="text-[15px] font-bold text-on-surface">Preguntas de los clientes</h2>
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Todo lo que preguntan al asistente del sitio y a los chats de las tiendas, con la respuesta que dio el bot. Se guarda {log?.retentionDays ?? 90} días;
          las conversaciones en sí se borran a las 24 horas sin actividad.
        </p>

        <div className="mb-4 flex flex-col gap-3">
          <Segmented label="Chatbot" value={filters.bot} onChange={(bot) => set({ bot, ...(bot === "GENERAL" ? { vendorStatus: "all", vendorId: "" } : {}) })} options={[{ id: "all", label: "Todos los chats" }, { id: "GENERAL", label: "Asistente del sitio" }, { id: "TIENDA", label: "Chats de tiendas" }]} />
          <Segmented label="Clientes" value={filters.client} onChange={(client) => set({ client })} options={[{ id: "all", label: "Todos los clientes" }, { id: "logged", label: "Con cuenta" }, { id: "guest", label: "Sin cuenta" }]} />
          {filters.bot !== "GENERAL" && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Segmented label="Tiendas" value={filters.vendorStatus} onChange={(vendorStatus) => set({ vendorStatus })} options={[{ id: "all", label: "Todas las tiendas" }, { id: "verified", label: "Verificadas" }, { id: "unverified", label: "No verificadas" }]} />
              <select
                aria-label="Tienda"
                value={filters.vendorId}
                onChange={(e) => set({ vendorId: e.target.value })}
                className="min-h-9 max-w-full rounded-full border border-outline-variant bg-surface-container-lowest px-3 text-[12px] text-on-surface"
              >
                <option value="">Cualquier tienda</option>
                {(log?.vendors ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.verified ? " (verificada)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              set({ q: search.trim() });
            }}
            className="flex gap-2"
          >
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" aria-hidden="true" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar en preguntas y respuestas"
                aria-label="Buscar en preguntas y respuestas"
                className="min-h-10 w-full rounded-full border border-outline-variant bg-surface-container-lowest pl-9 pr-3 text-[13px] outline-none focus:border-tertiary-accent"
              />
            </div>
            <button type="submit" className="min-h-10 rounded-full bg-primary-container px-4 text-[12.5px] font-bold text-white">
              Buscar
            </button>
          </form>
          {(filters.clientKey || filters.q) && (
            <div className="flex flex-wrap gap-1.5">
              {filters.clientKey && (
                <button type="button" onClick={() => set({ clientKey: "", clientLabel: "" })} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-tertiary-accent/10 px-3 text-[12px] font-semibold text-tertiary-accent">
                  Cliente: {filters.clientLabel} <X className="h-3.5 w-3.5" aria-label="Quitar filtro de cliente" />
                </button>
              )}
              {filters.q && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    set({ q: "" });
                  }}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full bg-tertiary-accent/10 px-3 text-[12px] font-semibold text-tertiary-accent"
                >
                  Texto: “{filters.q}” <X className="h-3.5 w-3.5" aria-label="Quitar búsqueda" />
                </button>
              )}
            </div>
          )}
        </div>

        {log?.stats && (
          <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Preguntas", log.stats.total],
              ["Conversaciones", log.stats.conversations],
              ["De clientes con cuenta", log.stats.logged],
              ["De visitantes sin cuenta", log.stats.guests],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-surface-container px-3 py-2.5">
                <dt className="text-[11px] font-semibold text-on-surface-variant">{label}</dt>
                <dd className="text-[18px] font-extrabold text-on-surface">{Number(value).toLocaleString("es-CU")}</dd>
              </div>
            ))}
          </dl>
        )}

        {log?.topQuestions?.length > 0 && (
          <div className="mb-4 rounded-xl border border-outline-variant p-3.5">
            <div className="mb-2 text-[12.5px] font-bold text-on-surface">Lo que más se repite</div>
            <ol className="flex flex-col gap-1">
              {log.topQuestions.map((t) => (
                <li key={t.question} className="flex items-start justify-between gap-3 text-[12.5px] text-on-surface-variant">
                  <button type="button" onClick={() => { setSearch(t.question); set({ q: t.question }); }} className="text-left hover:text-on-surface hover:underline">
                    {t.question}
                  </button>
                  <span className="flex-shrink-0 rounded-full bg-surface-container px-2 text-[11px] font-bold text-on-surface">{t.count}×</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {loadingLog && !log ? (
          <p className="text-[13px] text-outline">Cargando...</p>
        ) : logError ? (
          <p className="text-[13px] text-error">No se pudo cargar el registro. Prueba de nuevo en un momento.</p>
        ) : items.length === 0 ? (
          <p className="text-[13px] text-outline">No hay preguntas con estos filtros.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((it) => (
              <article key={it.id} className="rounded-xl border border-outline-variant p-3.5">
                <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-outline">
                  <button
                    type="button"
                    onClick={() => set({ clientKey: it.client.key, clientLabel: it.client.label })}
                    title="Ver todas las preguntas de este cliente"
                    className={`inline-flex min-h-7 items-center rounded-full px-2.5 font-bold ${it.client.kind === "user" ? "bg-primary-container/10 text-primary-container" : "bg-surface-container text-on-surface-variant"}`}
                  >
                    {it.client.label}
                    {it.client.kind === "user" ? " · con cuenta" : ""}
                  </button>
                  <span>{it.bot === "GENERAL" ? "Asistente del sitio" : "Chat de tienda"}</span>
                  {it.vendor && (
                    <button type="button" onClick={() => set({ bot: "TIENDA", vendorId: it.vendor.id })} className="inline-flex items-center gap-1 font-semibold text-tertiary-accent hover:underline">
                      {it.vendor.name}
                      {it.vendor.verified && <ShieldCheck className="h-3.5 w-3.5 text-verified" aria-label="Tienda verificada" />}
                    </button>
                  )}
                  <span className="ml-auto">{new Date(it.createdAt).toLocaleString("es-CU", { dateStyle: "short", timeStyle: "short" })}</span>
                </div>
                <p className="mb-1.5 text-[13px] text-on-surface">
                  <span className="font-semibold">Cliente: </span>
                  {it.question}
                </p>
                <div className="mb-2.5 text-[12.5px] text-on-surface-variant">
                  <span className="font-semibold text-on-surface">Bot: </span>
                  <ChatMarkdown text={it.answer} className="mt-1 text-[12.5px]" />
                </div>

                {correctingId === it.id ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={3}
                      aria-label="Cómo debió responder"
                      placeholder="Explica cómo debió responder. El bot no copia este texto: aprende el criterio."
                      className="w-full rounded-lg border border-outline-variant p-2.5 text-[12.5px] text-on-surface"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => draft.trim() ? createExample.mutate({ botTipo: it.bot, entradaCliente: it.question.slice(0, 500), respuestaIdeal: draft.trim() }) : toast.error("Escribe cómo debió responder.")}
                        disabled={createExample.isPending}
                        className="min-h-9 rounded bg-primary-container px-3 text-[12px] font-bold text-white disabled:opacity-50"
                      >
                        Guardar corrección
                      </button>
                      <button type="button" onClick={() => { setCorrectingId(null); setDraft(""); }} className="min-h-9 rounded bg-surface-container px-3 text-[12px] font-semibold text-on-surface-variant">
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => createExample.mutate({ botTipo: it.bot, entradaCliente: it.question.slice(0, 500), respuestaIdeal: it.answer.slice(0, 800) })}
                      disabled={createExample.isPending}
                      className="flex min-h-9 items-center gap-1.5 rounded bg-verified/15 px-3 text-[12px] font-bold text-verified disabled:opacity-50"
                    >
                      <ThumbsUp className="h-3.5 w-3.5" /> Buena
                    </button>
                    <button type="button" onClick={() => { setCorrectingId(it.id); setDraft(""); }} className="flex min-h-9 items-center gap-1.5 rounded bg-error/10 px-3 text-[12px] font-bold text-error">
                      <ThumbsDown className="h-3.5 w-3.5" /> Corregir
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <nav aria-label="Páginas del registro" className="mt-4 flex items-center justify-between gap-2">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="inline-flex min-h-10 items-center gap-1 rounded-full bg-surface-container px-3 text-[12.5px] font-semibold text-on-surface disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" /> Anterior
            </button>
            <span className="text-[12.5px] text-on-surface-variant">
              Página {page} de {totalPages}
            </span>
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="inline-flex min-h-10 items-center gap-1 rounded-full bg-surface-container px-3 text-[12.5px] font-semibold text-on-surface disabled:opacity-40">
              Siguiente <ChevronRight className="h-4 w-4" />
            </button>
          </nav>
        )}
      </div>

      <div className={CARD}>
        <div className="mb-1 flex items-center gap-2.5">
          <GraduationCap className="h-5 w-5 text-tertiary-accent" />
          <h2 className="text-[15px] font-bold text-on-surface">Lo que aprendió el bot</h2>
        </div>
        <p className="mb-3.5 text-[12.5px] text-outline">
          Cada respuesta marcada como buena o corregida queda aquí con el criterio que se sacó de ella. El bot aplica esos criterios con datos reales y sus
          propias palabras; nunca repite el texto de la corrección. Desactiva un criterio si ya no aplica.
        </p>
        <div className="mb-3">
          <Segmented label="Chatbot de los criterios" value={examplesBot} onChange={setExamplesBot} options={[{ id: "GENERAL", label: "Asistente del sitio" }, { id: "TIENDA", label: "Chats de tiendas" }]} />
        </div>
        {loadingExamples ? (
          <p className="text-[13px] text-outline">Cargando...</p>
        ) : examples?.length > 0 ? (
          <div className="flex flex-col gap-2">
            {examples.map((ex) => (
              <div key={ex.id} className={`rounded-xl border border-outline-variant p-3 ${ex.activo ? "" : "opacity-50"}`}>
                <div className="mb-1 text-[12px] text-on-surface-variant">
                  <span className="font-semibold text-on-surface">Cliente:</span> {ex.entradaCliente}
                </div>
                <div className="mb-1 text-[12px] text-on-surface">
                  <span className="font-semibold">Respuesta de referencia:</span> {ex.respuestaIdeal}
                </div>
                <div className="mb-2 text-[12px] text-on-surface">
                  <span className="font-semibold text-tertiary-accent">Criterio aprendido:</span> {ex.leccion ?? <span className="italic text-outline">sin criterio todavía (se usa como pista de estilo)</span>}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-outline">
                    {ex.activo ? "Activo" : "Desactivado"} · {new Date(ex.createdAt).toLocaleDateString("es-CU")}
                    {ex.creadoPor?.fullName ? ` · ${ex.creadoPor.fullName}` : ""}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => toggleExample.mutate({ id: ex.id, activo: !ex.activo })}
                      className={`flex min-h-9 items-center gap-1 text-[11.5px] font-semibold ${ex.activo ? "text-on-surface-variant" : "text-verified"}`}
                    >
                      <Power className="h-3.5 w-3.5" /> {ex.activo ? "Desactivar" : "Activar"}
                    </button>
                    <button type="button" onClick={() => setDeleteExampleTarget(ex)} aria-label="Eliminar criterio" className="flex min-h-9 min-w-9 items-center justify-center text-error">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-outline">Todavía no marcaste ninguna respuesta como buena ni corregiste ninguna.</p>
        )}

        {deleteExampleTarget && (
          <ConfirmDeleteModal
            title="¿Eliminar este criterio?"
            description="El bot deja de tenerlo en cuenta en charlas futuras."
            pending={deleteExample.isPending}
            onConfirm={() => deleteExample.mutate(deleteExampleTarget.id)}
            onCancel={() => setDeleteExampleTarget(null)}
          />
        )}
      </div>
    </>
  );
}

// Preguntas que aparecen al abrir el chat del marketplace. Muestra las que el chat usa de verdad ahora mismo; el admin puede
// escribir las suyas (hasta el máximo del servidor), ordenarlas y volver a las automáticas cuando quiera.
function SuggestionsEditor({ data }) {
  const queryClient = useQueryClient();
  const custom = data.customSuggestions ?? [];
  const max = data.maxCustomSuggestions ?? 6;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);

  const save = useMutation({
    mutationFn: async (customSuggestions) => (await api.patch("/assistant/learning", { customSuggestions })).data,
    onSuccess: (d, list) => {
      queryClient.setQueryData(["assistant-learning"], d);
      queryClient.invalidateQueries({ queryKey: ["assistant-suggestions"] });
      setEditing(false);
      toast.success(list.length ? "Preguntas guardadas. El chat ya muestra las tuyas." : "Listo. El chat vuelve a usar las preguntas automáticas.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudieron guardar las preguntas."),
  });

  function startEditing() {
    // Se parte de las tuyas o, si aún no hay, de las que el chat muestra ahora, para no empezar de cero.
    setDraft((custom.length ? custom : data.currentSuggestions ?? []).slice(0, max));
    setEditing(true);
  }
  const setAt = (i, value) => setDraft((d) => d.map((q, j) => (j === i ? value : q)));
  const removeAt = (i) => setDraft((d) => d.filter((_, j) => j !== i));
  const move = (i, dir) =>
    setDraft((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const cleaned = draft.map((q) => q.trim()).filter(Boolean);
  const tooShort = cleaned.some((q) => q.length < 3);

  return (
    <div className="mb-5 rounded-xl border border-surface-container-high p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-bold text-on-surface">Preguntas sugeridas al abrir el chat</div>
          <div className="text-[12px] text-outline">{custom.length ? "Escritas por ti" : "Automáticas"}</div>
        </div>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            {custom.length > 0 && (
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate([])}
                className="flex min-h-11 items-center rounded-full border border-outline-variant px-4 text-[12.5px] font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
              >
                Volver a las automáticas
              </button>
            )}
            <button
              type="button"
              onClick={startEditing}
              className="flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-[12.5px] font-bold text-white hover:bg-primary/90"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Editar preguntas
            </button>
          </div>
        )}
      </div>

      {!editing ? (
        <div className="flex flex-wrap gap-1.5">
          {(data.currentSuggestions ?? []).map((s) => (
            <span key={s} className="rounded-full border border-outline-variant px-3 py-1.5 text-[12px] font-semibold text-on-surface-variant">{s}</span>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!tooShort) save.mutate(cleaned);
          }}
        >
          <ol className="flex flex-col gap-2">
            {draft.map((q, i) => (
              // En celular los botones van en una segunda línea: al lado del campo lo dejaban tan estrecho que la pregunta no se leía.
              <li key={i} className="flex min-w-0 flex-wrap items-center gap-1 border-b border-surface-container pb-2 last:border-b-0 sm:flex-nowrap sm:border-b-0 sm:pb-0">
                <span className="w-5 flex-shrink-0 text-right text-[12px] font-semibold text-outline">{i + 1}.</span>
                <input
                  value={q}
                  onChange={(e) => setAt(i, e.target.value)}
                  maxLength={80}
                  aria-label={`Pregunta ${i + 1}`}
                  placeholder="Ej.: ¿Hacen entregas a domicilio?"
                  className="h-11 min-w-0 flex-1 basis-[calc(100%-1.75rem)] rounded-lg sm:basis-0 border border-outline-variant bg-surface-container-lowest px-3 text-[13px] text-on-surface focus:border-tertiary-accent focus:outline-none"
                />
                <span className="ml-auto flex">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir la pregunta ${i + 1}`} className="flex h-11 w-9 flex-shrink-0 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container disabled:opacity-30">
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === draft.length - 1} aria-label={`Bajar la pregunta ${i + 1}`} className="flex h-11 w-9 flex-shrink-0 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container disabled:opacity-30">
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => removeAt(i)} aria-label={`Quitar la pregunta ${i + 1}`} className="flex h-11 w-9 flex-shrink-0 items-center justify-center rounded-lg text-error hover:bg-error/10">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
                </span>
              </li>
            ))}
          </ol>
          {draft.length === 0 && <p className="text-[12.5px] text-outline">Sin preguntas tuyas, el chat usa las automáticas.</p>}
          {tooShort && <p className="mt-2 text-[12px] text-error">Cada pregunta necesita al menos 3 caracteres.</p>}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setDraft((d) => [...d, ""])}
              disabled={draft.length >= max}
              className="flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-outline-variant px-4 text-[12.5px] font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-40"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {draft.length >= max ? `Máximo ${max} preguntas` : "Añadir pregunta"}
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(false)} className="flex min-h-11 items-center rounded-full px-4 text-[12.5px] font-semibold text-on-surface-variant hover:bg-surface-container">
                Cancelar
              </button>
              <button type="submit" disabled={save.isPending || tooShort} className="flex min-h-11 items-center rounded-full bg-primary px-5 text-[12.5px] font-bold text-white hover:bg-primary/90 disabled:opacity-50">
                {save.isPending ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
