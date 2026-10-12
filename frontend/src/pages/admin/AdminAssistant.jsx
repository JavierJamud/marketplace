import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { FileText, Trash2, Bot, ThumbsUp, ThumbsDown, GraduationCap, Power, Sparkles, RefreshCw } from "lucide-react";
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
    <div className="max-w-[760px]">
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
        (y los temas y rubros más pedidos). Con el aprendizaje desactivado se muestran siempre las preguntas base.
      </p>

      {isLoading ? (
        <p className="text-[13px] text-outline">Cargando...</p>
      ) : !snap ? (
        <p className="text-[13px] text-outline">Todavía no hay un resumen calculado. Pulsa "Recalcular ahora".</p>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <div className="mb-2 text-[13px] font-bold text-on-surface">Preguntas sugeridas al abrir el chat</div>
            <div className="flex flex-wrap gap-1.5">
              {snap.suggestions.map((s) => (
                <span key={s} className="rounded-full border border-outline-variant px-3 py-1.5 text-[12px] font-semibold text-on-surface-variant">{s}</span>
              ))}
            </div>
            <div className="mb-2 mt-5 text-[13px] font-bold text-on-surface">Rubros más buscados</div>
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

// Bloque 37 (Parte E): Groq no permite fine-tuning propio — la mejora
// continua se hace revisando conversaciones REALES y curando ejemplos. Cada
// "buena"/"mala" marcada acá crea una fila ChatTrainingExample que se
// inyecta como few-shot real en el prompt del bot correspondiente (ver
// lib/chatTrainingExamples.js) — afecta respuestas futuras, no esta misma.
function ChatReviewSection() {
  const queryClient = useQueryClient();
  const [bot, setBot] = useState("general"); // "general" | "tienda"
  const [correctingId, setCorrectingId] = useState(null);
  const [draft, setDraft] = useState("");
  const [deleteExampleTarget, setDeleteExampleTarget] = useState(null);

  const botTipo = bot === "general" ? "GENERAL" : "TIENDA";

  const { data: conversations, isLoading: loadingConversations } = useQuery({
    queryKey: ["chat-review-conversations", bot],
    queryFn: async () => (await api.get(`/admin/chat-review/conversations?bot=${bot}`)).data.conversations,
  });

  const { data: examples, isLoading: loadingExamples } = useQuery({
    queryKey: ["chat-training-examples", botTipo],
    queryFn: async () => (await api.get(`/admin/chat-review/examples?bot=${botTipo}`)).data.examples,
  });

  const invalidateExamples = () => queryClient.invalidateQueries({ queryKey: ["chat-training-examples", botTipo] });

  const createExample = useMutation({
    mutationFn: async (payload) => (await api.post("/admin/chat-review/examples", payload)).data,
    onSuccess: () => {
      toast.success("Guardado — el bot va a aprender de este ejemplo desde la próxima respuesta.");
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

  function markGood(conv) {
    if (!conv.clienteMensaje) return toast.error("Esta respuesta no tiene un mensaje de cliente asociado.");
    createExample.mutate({ botTipo, entradaCliente: conv.clienteMensaje, respuestaIdeal: conv.botRespuesta });
  }

  function submitCorrection(conv) {
    if (!conv.clienteMensaje) return toast.error("Esta respuesta no tiene un mensaje de cliente asociado.");
    if (!draft.trim()) return toast.error("Escribe la respuesta ideal.");
    createExample.mutate({ botTipo, entradaCliente: conv.clienteMensaje, respuestaIdeal: draft.trim() });
  }

  return (
    <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-6">
      <div className="mb-1 flex items-center gap-2.5">
        <GraduationCap className="h-5 w-5 text-tertiary-accent" />
        <div className="text-[15px] font-bold text-on-surface">Aprendizaje por ejemplos</div>
      </div>
      <p className="mb-3.5 text-[12.5px] text-outline">
        Revisa respuestas reales del bot. Marca una como buena para reforzar ese estilo, o como mala y explica cómo debió responder. El bot no copia tu
        texto: de cada corrección saca un criterio (tono, formato, qué datos consultar) y lo aplica con datos reales y actuales en charlas futuras.
      </p>

      <div className="mb-4 flex gap-2">
        {[
          { id: "general", label: "Bot general" },
          { id: "tienda", label: "Bots de tienda" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setBot(t.id)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${
              bot === t.id ? "bg-primary-container text-white" : "bg-surface-container text-on-surface-variant"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-5">
        <div className="mb-2 text-[13px] font-bold text-on-surface">Conversaciones recientes</div>
        {loadingConversations ? (
          <p className="text-[13px] text-outline">Cargando...</p>
        ) : conversations?.length > 0 ? (
          <div className="flex flex-col gap-3">
            {conversations.map((conv) => (
              <div key={conv.id} className="rounded-xl border border-outline-variant p-3.5">
                {conv.vendorName && <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-tertiary-accent">{conv.vendorName}</div>}
                <div className="mb-1.5 text-[12.5px] text-on-surface-variant">
                  <span className="font-semibold text-on-surface">Cliente: </span>
                  {conv.clienteMensaje ?? <span className="italic text-outline">(sin mensaje previo del cliente en esta sesión)</span>}
                </div>
                <div className="mb-2.5 text-[12.5px] text-on-surface">
                  <span className="font-semibold">Bot: </span>
                  <ChatMarkdown text={conv.botRespuesta} className="mt-1 text-[12.5px]" />
                </div>

                {correctingId === conv.id ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={3}
                      placeholder="Escribe cómo debió responder (sirve de guía; el bot no la copia)..."
                      className="w-full rounded-lg border border-outline-variant p-2.5 text-[12.5px] text-on-surface"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => submitCorrection(conv)}
                        disabled={createExample.isPending}
                        className="rounded bg-primary-container px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
                      >
                        Guardar respuesta ideal
                      </button>
                      <button
                        onClick={() => {
                          setCorrectingId(null);
                          setDraft("");
                        }}
                        className="rounded bg-surface-container px-3 py-1.5 text-[12px] font-semibold text-on-surface-variant"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => markGood(conv)}
                      disabled={createExample.isPending}
                      className="flex items-center gap-1.5 rounded bg-verified/15 px-3 py-1.5 text-[12px] font-bold text-verified disabled:opacity-50"
                    >
                      <ThumbsUp className="h-3.5 w-3.5" /> Buena
                    </button>
                    <button
                      onClick={() => {
                        setCorrectingId(conv.id);
                        setDraft("");
                      }}
                      className="flex items-center gap-1.5 rounded bg-error/10 px-3 py-1.5 text-[12px] font-bold text-error"
                    >
                      <ThumbsDown className="h-3.5 w-3.5" /> Mala — corregir
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-outline">Todavía no hay conversaciones registradas para este bot.</p>
        )}
      </div>

      <div>
        <div className="mb-2 text-[13px] font-bold text-on-surface">Ejemplos guardados ({examples?.length ?? 0})</div>
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
                  <span className="font-semibold">Respuesta ideal:</span> {ex.respuestaIdeal}
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
                      onClick={() => toggleExample.mutate({ id: ex.id, activo: !ex.activo })}
                      title={ex.activo ? "Desactivar" : "Activar"}
                      className={`flex items-center gap-1 text-[11.5px] font-semibold ${ex.activo ? "text-on-surface-variant" : "text-verified"}`}
                    >
                      <Power className="h-3.5 w-3.5" /> {ex.activo ? "Desactivar" : "Activar"}
                    </button>
                    <button onClick={() => setDeleteExampleTarget(ex)} title="Eliminar" className="text-error">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-outline">Todavía no marcaste ninguna respuesta como buena o mala.</p>
        )}
      </div>

      {deleteExampleTarget && (
        <ConfirmDeleteModal
          title="¿Eliminar este ejemplo?"
          description="El bot deja de tener en cuenta esta respuesta ideal en charlas futuras."
          pending={deleteExample.isPending}
          onConfirm={() => deleteExample.mutate(deleteExampleTarget.id)}
          onCancel={() => setDeleteExampleTarget(null)}
        />
      )}
    </div>
  );
}
