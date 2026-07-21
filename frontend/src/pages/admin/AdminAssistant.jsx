import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { FileText, Trash2, Bot, ThumbsUp, ThumbsDown, GraduationCap, Power } from "lucide-react";
import { api } from "../../lib/api.js";

// Bloque 30: entrenar al bot general del marketplace (Home) — a diferencia
// del "Documento de IA" por tienda (VendorSettings.jsx, un solo archivo que
// se reemplaza), acá se permiten VARIOS documentos a la vez porque el bot
// general cubre dos audiencias distintas (clientes y vendedores) que suele
// convenir separar en archivos propios. Mismo mecanismo de extracción de
// texto que ya usa el chat por tienda (nunca se duplica esa lógica).
export default function AdminAssistant() {
  const queryClient = useQueryClient();

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
      queryClient.invalidateQueries({ queryKey: ["assistant-documents"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar el documento."),
  });

  return (
    <div className="max-w-[760px]">
      <div className="mb-1 flex items-center gap-2.5">
        <Bot className="h-6 w-6 text-tertiary-accent" />
        <h1 className="font-display text-[25px] font-bold text-on-surface">Asistente del marketplace</h1>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        El bot general de ZeuDin (botón flotante en el Home) usa estos documentos como fuente de verdad para preguntas institucionales —
        cómo comprar, cómo vender, verificación, planes, medios de pago, etc. — además del catálogo completo de productos. Sin documentos
        cargados, el asistente sigue funcionando solo con el catálogo.
      </p>

      <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
        <div className="mb-1 text-[15px] font-bold text-on-surface">Subir documento</div>
        <p className="mb-3.5 text-[12.5px] text-outline">
          Subí uno para clientes (cómo comprar, políticas generales) y otro para vendedores (cómo vender, verificación, planes) — o los que
          necesites, todos se leen juntos.
        </p>
        <label className={`block rounded-md border-2 border-dashed border-outline-variant p-[22px] text-center ${upload.isPending ? "cursor-wait opacity-70" : "cursor-pointer"}`}>
          <span className="text-[13px] text-outline">
            {upload.isPending ? "Subiendo..." : "Arrastrá un .pdf o .txt · o "}
            {!upload.isPending && <span className="font-semibold text-tertiary-accent">elegí un archivo</span>}
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

      <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
        <div className="mb-3.5 text-[15px] font-bold text-on-surface">Documentos cargados</div>
        {isLoading ? (
          <p className="text-[13px] text-outline">Cargando...</p>
        ) : data?.length > 0 ? (
          <div className="flex flex-col gap-2">
            {data.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 rounded-md border border-outline-variant px-3.5 py-2.5">
                <FileText className="h-4 w-4 flex-shrink-0 text-tertiary-accent" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-on-surface">{doc.originalName}</div>
                  <div className="text-[11.5px] text-outline">{new Date(doc.createdAt).toLocaleDateString("es-CU")}</div>
                </div>
                <button
                  onClick={() => remove.mutate(doc.id)}
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
      invalidateExamples();
    },
    onError: () => toast.error("No se pudo eliminar el ejemplo."),
  });

  function markGood(conv) {
    if (!conv.clienteMensaje) return toast.error("Esta respuesta no tiene un mensaje de cliente asociado.");
    createExample.mutate({ botTipo, entradaCliente: conv.clienteMensaje, respuestaIdeal: conv.botRespuesta });
  }

  function submitCorrection(conv) {
    if (!conv.clienteMensaje) return toast.error("Esta respuesta no tiene un mensaje de cliente asociado.");
    if (!draft.trim()) return toast.error("Escribí la respuesta ideal.");
    createExample.mutate({ botTipo, entradaCliente: conv.clienteMensaje, respuestaIdeal: draft.trim() });
  }

  return (
    <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
      <div className="mb-1 flex items-center gap-2.5">
        <GraduationCap className="h-5 w-5 text-tertiary-accent" />
        <div className="text-[15px] font-bold text-on-surface">Aprendizaje por ejemplos</div>
      </div>
      <p className="mb-3.5 text-[12.5px] text-outline">
        Revisá respuestas reales del bot. Marcá una como buena para reforzarla tal cual, o como mala para escribir la respuesta ideal — en
        ambos casos queda como ejemplo activo que el bot va a tener en cuenta en charlas futuras.
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
              <div key={conv.id} className="rounded-md border border-outline-variant p-3.5">
                {conv.vendorName && <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-tertiary-accent">{conv.vendorName}</div>}
                <div className="mb-1.5 text-[12.5px] text-on-surface-variant">
                  <span className="font-semibold text-on-surface">Cliente: </span>
                  {conv.clienteMensaje ?? <span className="italic text-outline">(sin mensaje previo del cliente en esta sesión)</span>}
                </div>
                <div className="mb-2.5 text-[12.5px] text-on-surface">
                  <span className="font-semibold">Bot: </span>
                  {conv.botRespuesta}
                </div>

                {correctingId === conv.id ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={3}
                      placeholder="Escribí la respuesta ideal para este mensaje del cliente..."
                      className="w-full rounded-md border border-outline-variant p-2.5 text-[12.5px] text-on-surface"
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
              <div key={ex.id} className={`rounded-md border border-outline-variant p-3 ${ex.activo ? "" : "opacity-50"}`}>
                <div className="mb-1 text-[12px] text-on-surface-variant">
                  <span className="font-semibold text-on-surface">Cliente:</span> {ex.entradaCliente}
                </div>
                <div className="mb-2 text-[12px] text-on-surface">
                  <span className="font-semibold">Respuesta ideal:</span> {ex.respuestaIdeal}
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
                    <button onClick={() => deleteExample.mutate(ex.id)} title="Eliminar" className="text-error">
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
    </div>
  );
}
