import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ArrowRight, Check, History, MessageSquareText, Plus, Trash2, X, ChevronLeft } from "lucide-react";
import { api } from "../../lib/api.js";

// Bloque 246 (pedido explícito — asistente de negocio con IA para el admin y
// para los vendedores): una sola pantalla de chat para los dos paneles. El
// asistente solo LEE datos y recomienda; cuando algo hay que cambiarlo,
// responde con botones a la pantalla exacta (links ya validados por el
// servidor contra la lista de rutas reales). Celular primero: objetivos
// táctiles de 44px y caja de texto fija abajo.
//
// Bloque 260: varias conversaciones por persona (historial, chat nuevo, borrar).
//
// Bloque 262 (pedido explícito): (1) mientras responde muestra, en letra pequeña
// y gris como ChatGPT, en qué paso va (pensando, qué datos o sección consulta,
// verificando) y el tiempo que lleva; (2) muestra productos como tarjetas, igual
// que el chat de la página principal; (3) el panel se queda montado aunque el
// chat esté cerrado y se sincroniza con el servidor cada vez que se abre, así
// siempre muestra lo último que se conversó, en cualquier sección del panel.

// Nombre legible de cada herramienta de lectura que usó el asistente, para
// que la persona vea de dónde salió la respuesta (transparencia, no jerga).
const TOOL_LABELS = {
  resumen_negocio: "Resumen del negocio",
  ventas_por_periodo: "Ventas por periodo",
  productos_mas_vendidos: "Productos más vendidos",
  productos_sin_ventas: "Productos sin ventas",
  inventario_critico: "Inventario",
  pedidos_recientes: "Pedidos recientes",
  resenas: "Reseñas",
  interes_de_clientes: "Interés de clientes",
  mejor_dia_semana: "Mejor día de la semana",
  salud_del_negocio: "Salud del negocio",
  plan_y_suscripcion: "Plan y suscripción",
  actividad_de_la_cuenta: "Actividad de la cuenta",
  algoritmo_de_mi_tienda: "Posición en el algoritmo",
  como_funciona_el_algoritmo: "Reglas del algoritmo",
  mis_productos: "Tus productos",
  detalle_de_producto: "Detalle de producto",
  pedidos_detalle: "Pedidos al detalle",
  pedido_al_detalle: "Un pedido",
  mensajes_y_notificaciones: "Mensajes y avisos",
  ofertas_y_codigos: "Ofertas y códigos",
  personal_y_mesas: "Personal y mesas",
  alertas_de_la_cuenta: "Alertas de la cuenta",
  clientes_y_chat: "Clientes y chat",
  clientes_potenciales: "Clientes potenciales",
  perfil_de_la_tienda: "Perfil de la tienda",
  consultar_datos: "Base de datos del negocio",
  conversaciones_anteriores: "Chats anteriores",
  resumen_plataforma: "Resumen de la plataforma",
  ventas_plataforma: "Ventas de la plataforma",
  tiendas_top: "Tiendas que más venden",
  productos_top_plataforma: "Productos que más se venden",
  detalle_tienda: "Detalle de tienda",
  consultar_tienda: "Datos de una tienda",
  resumen_clientes: "Resumen de clientes",
  pendientes_admin: "Pendientes",
  estado_ia: "Estado de la IA",
  suscripciones_plataforma: "Suscripciones",
  actividad_plataforma: "Actividad de la plataforma",
  errores_recientes: "Errores recientes",
  reportes_de_fraude: "Reportes de fraude",
  resumen_productos: "Catálogo",
};

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("es-CU", { hour: "2-digit", minute: "2-digit" });
}

function formatDay(iso) {
  const d = new Date(iso);
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if (diff <= 0) return "Hoy";
  if (diff === 1) return "Ayer";
  return d.toLocaleDateString("es-CU", { day: "numeric", month: "short" });
}

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

// Texto de cada paso que el servidor avisa mientras trabaja.
function stepLabel(event) {
  if (event.phase === "thinking") return "Pensando";
  if (event.phase === "composing") return "Redactando la respuesta";
  if (event.phase === "verifying") return "Verificando los datos";
  const name = TOOL_LABELS[event.tool] ?? "los datos del negocio";
  const detail = event.detail ? ` (${String(event.detail).replace(/_/g, " ")})` : "";
  return `Consultando ${name}${detail}`;
}

// Respuesta en streaming: el servidor manda una línea JSON por evento. Se usa
// axios (no fetch) para conservar la sesión y la renovación del token; los
// eventos se leen del texto que el navegador va acumulando.
async function askStreaming(endpoint, body, onEvent) {
  let processed = 0;
  let final = null;
  const consume = (text, complete) => {
    const lines = text.split("\n");
    const upTo = complete ? lines.length : lines.length - 1;
    for (; processed < upTo; processed++) {
      const line = lines[processed].trim();
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "progress") onEvent(event);
      else final = event;
    }
  };
  const res = await api.post(`${endpoint}?stream=1`, body, {
    responseType: "text",
    transformResponse: [(data) => data],
    onDownloadProgress: (e) => consume(e.event?.target?.responseText ?? "", false),
  });
  consume(typeof res.data === "string" ? res.data : "", true);
  if (!final) throw new Error("Sin respuesta del asistente.");
  if (final.type === "error") {
    const err = new Error(final.message);
    err.userMessage = final.message;
    throw err;
  }
  return final;
}

function requestErrorMessage(err) {
  if (err.userMessage) return err.userMessage;
  let data = err.response?.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      data = null;
    }
  }
  return data?.error ?? "No se pudo obtener la respuesta. Prueba de nuevo.";
}

// Texto del asistente: párrafos y listas con "- ". Sin dangerouslySetInnerHTML:
// el contenido viene de un modelo y de datos de terceros, nunca se interpreta
// como HTML.
function AssistantText({ text }) {
  const blocks = [];
  let list = null;
  for (const line of text.split("\n")) {
    const item = line.match(/^\s*[-•]\s+(.*)$/);
    if (item) {
      if (!list) blocks.push((list = { type: "list", items: [] }));
      list.items.push(item[1]);
    } else if (line.trim()) {
      list = null;
      blocks.push({ type: "p", text: line.trim() });
    }
  }
  return (
    <div className="space-y-2">
      {blocks.map((b, i) =>
        b.type === "list" ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>{it}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{b.text}</p>
        )
      )}
    </div>
  );
}

// Tarjeta de producto de la respuesta: foto, nombre, precio y estado real, con
// enlace a su ficha pública. Los datos los trae el servidor de la base.
function ProductCard({ product, onNavigate }) {
  const stock = !product.isActive ? "Pausado" : product.unlimitedStock ? "Siempre disponible" : product.stock > 0 ? `${product.stock} en stock` : "Agotado";
  const image = imgUrl(product.image);
  return (
    <Link
      to={product.href}
      onClick={onNavigate}
      className="flex min-h-14 items-center gap-2.5 rounded-xl border border-outline-variant bg-surface-container-lowest p-2 transition hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
    >
      <span className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-surface-container">
        {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-[10px] text-on-surface-variant">Sin foto</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-on-surface">{product.name}</span>
        <span className="block truncate text-[12px] text-on-surface-variant">
          {Number(product.price).toLocaleString("es-CU")} {product.currency} · {stock}
          {product.salesCount > 0 ? ` · ${product.salesCount} vendidos` : ""}
        </span>
        {product.store && <span className="block truncate text-[11.5px] text-on-surface-variant">{product.store}</span>}
      </span>
      <ArrowRight className="h-4 w-4 flex-shrink-0 text-on-surface-variant" aria-hidden="true" />
    </Link>
  );
}

function Message({ m, onNavigate }) {
  const mine = m.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-[14px] leading-[21px] ${mine ? "rounded-br-md bg-primary text-white" : "w-full rounded-bl-md bg-surface-container text-on-surface"}`}>
        {mine ? <p className="whitespace-pre-wrap break-words">{m.content}</p> : <AssistantText text={m.content} />}
        {!mine && m.products?.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {m.products.map((p) => (
              <ProductCard key={p.id} product={p} onNavigate={onNavigate} />
            ))}
          </div>
        )}
        {!mine && m.toolsUsed?.length > 0 && (
          <p className="mt-2.5 text-[12px] text-on-surface-variant">Consulté: {m.toolsUsed.map((t) => TOOL_LABELS[t] ?? t).join(", ")}</p>
        )}
        {!mine && m.links?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {m.links.map((l) => (
              <Link
                key={l.path}
                to={l.path}
                onClick={onNavigate}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-[13px] font-semibold text-white transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
              >
                Ir a {l.label}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ))}
          </div>
        )}
        <div className={`mt-1.5 text-[11px] ${mine ? "text-white/75" : "text-on-surface-variant"}`}>{formatTime(m.createdAt)}</div>
      </div>
    </div>
  );
}

// Indicador de trabajo, en letra pequeña y gris: los pasos ya hechos con una
// marca, el paso actual con un destello suave y los segundos que lleva. Con
// "reducir movimiento" activado no hay destello, solo el texto.
function ThinkingStatus({ steps, seconds }) {
  const current = steps[steps.length - 1];
  const done = steps.slice(0, -1);
  return (
    <div className="flex justify-start" role="status" aria-live="polite">
      <div className="space-y-1 px-1 py-1 text-[12.5px] text-on-surface-variant">
        {done.map((s, i) => (
          <p key={`${s}-${i}`} className="flex items-center gap-1.5 opacity-75">
            <Check className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            {s}
          </p>
        ))}
        <p className="flex items-center gap-1.5">
          <span className="motion-safe:animate-pulse">{current ?? "Pensando"}...</span>
          <span className="tabular-nums opacity-75">{seconds} s</span>
        </p>
      </div>
    </div>
  );
}

const headerButton =
  "flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-2.5 text-[13px] font-semibold text-white/90 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50";

// `endpoint`: "/vendors/me/assistant" o "/admin/business-assistant".
// `quickPromptsFree`: preguntas rápidas para una tienda sin plan de pago (que
// además recibe la recomendación del plan). `embedded`: llena el contenedor del
// botón flotante. `isOpen`, `onNavigate` y `onClose` los pasa el botón flotante.
export default function BusinessAssistantPanel({ endpoint, quickPrompts, quickPromptsFree, intro, embedded = false, isOpen = true, onNavigate, onClose }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(null); // { content, steps: [], startedAt }
  const [seconds, setSeconds] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  const activeIdRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["business-assistant", endpoint],
    queryFn: async () => (await api.get(endpoint)).data,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  // Solo la primera carga rellena el estado local: después manda lo que la
  // persona hace en el chat y la sincronización de abajo.
  useEffect(() => {
    if (!data || initialized.current) return;
    initialized.current = true;
    setConversations(data.conversations ?? []);
    setActiveId(data.active?.id ?? null);
    setMessages(data.active?.messages ?? []);
  }, [data]);

  const startNew = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setError("");
    setShowHistory(false);
  }, []);

  // Pone al día lo que muestra el chat con lo que hay guardado en el servidor
  // (otra pestaña, otra sección del panel, una respuesta que terminó mientras
  // estaba cerrado).
  const refresh = useCallback(async () => {
    try {
      const fresh = (await api.get(endpoint)).data;
      setConversations(fresh.conversations ?? []);
      const id = activeIdRef.current;
      if (id) {
        if (!(fresh.conversations ?? []).some((c) => c.id === id)) return startNew();
        const conversation = (await api.get(`${endpoint}/conversations/${id}`)).data.conversation;
        setMessages(conversation.messages);
      } else if (fresh.active) {
        setActiveId(fresh.active.id);
        setMessages(fresh.active.messages);
      }
    } catch {
      /* sin red: se queda con lo que ya muestra */
    }
  }, [endpoint, startNew]);

  useEffect(() => {
    if (isOpen && initialized.current && !busy) refresh();
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Segundos que lleva respondiendo.
  useEffect(() => {
    if (!pending) return undefined;
    setSeconds(0);
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - pending.startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [pending?.startedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending?.steps.length, error, showHistory, isOpen]);

  async function submit(message) {
    const value = message.trim();
    if (!value || busy) return;
    setError("");
    setBusy(true);
    const startedAt = Date.now();
    setPending({ content: value, steps: ["Pensando"], startedAt });
    try {
      const result = await askStreaming(endpoint, { message: value, conversationId: activeIdRef.current ?? undefined }, (event) => {
        const label = stepLabel(event);
        setPending((p) => (p && p.steps[p.steps.length - 1] !== label ? { ...p, steps: [...p.steps, label] } : p));
      });
      const now = new Date().toISOString();
      setText("");
      setMessages((prev) => [
        ...prev,
        { id: `u-${now}`, role: "user", content: value, createdAt: now },
        { id: `a-${now}`, role: "assistant", content: result.reply, toolsUsed: result.toolsUsed, links: result.links, products: result.products, createdAt: now },
      ]);
      setActiveId(result.conversationId);
      setConversations((prev) => [{ id: result.conversationId, title: result.title, updatedAt: now }, ...prev.filter((c) => c.id !== result.conversationId)]);
    } catch (err) {
      setError(requestErrorMessage(err));
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  async function openConversation(id) {
    try {
      const conversation = (await api.get(`${endpoint}/conversations/${id}`)).data.conversation;
      setError("");
      setActiveId(conversation.id);
      setMessages(conversation.messages);
      setShowHistory(false);
    } catch {
      setError("No se pudo abrir esa conversación.");
    }
  }

  async function removeConversation(id) {
    try {
      await api.delete(`${endpoint}/conversations/${id}`);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === activeId) startNew();
    } catch {
      setError("No se pudo borrar la conversación.");
    }
  }

  async function clearAll() {
    try {
      await api.delete(endpoint);
      setConversations([]);
      startNew();
    } catch {
      setError("No se pudieron borrar las conversaciones.");
    }
  }

  const wrapper = embedded
    ? "flex h-full min-h-0 flex-col bg-surface-container-lowest"
    : "flex h-[calc(100dvh-270px)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest md:h-[calc(100dvh-220px)]";

  if (isLoading) return <div className={`${wrapper} items-center justify-center text-[13.5px] text-on-surface-variant`}>Cargando el asistente...</div>;
  if (isError) {
    return (
      <div className={`${wrapper} items-center justify-center p-5 text-center text-[13.5px] text-error`}>
        No se pudo cargar el asistente.
        <button type="button" onClick={() => refetch()} className="min-h-11 font-semibold underline">
          Reintentar
        </button>
      </div>
    );
  }

  // Una tienda sin plan de pago también lo usa (Bloque 259): el servidor avisa si es
  // premium para que las preguntas rápidas inviten a conocer el plan.
  const prompts = data?.access?.premium === false && quickPromptsFree ? quickPromptsFree : quickPrompts;
  const shown = pending ? [...messages, { role: "user", content: pending.content, createdAt: new Date(pending.startedAt).toISOString() }] : messages;
  const activeTitle = conversations.find((c) => c.id === activeId)?.title;

  return (
    <div className={wrapper}>
      <div className="flex items-center gap-1 bg-primary px-2 py-2 text-white sm:gap-2 sm:px-3">
        {showHistory ? (
          <button type="button" onClick={() => setShowHistory(false)} aria-label="Volver al chat" className={headerButton}>
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : (
          <span className="ml-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-secondary-container text-primary">
            <MessageSquareText className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1 px-1.5">
          <p className="truncate text-[15px] font-bold leading-5">{showHistory ? "Tus conversaciones" : "Asistente de negocio"}</p>
          <p className="truncate text-[12px] leading-4 text-white/75">{showHistory ? `${conversations.length} guardadas` : activeTitle ?? intro}</p>
        </div>
        {!showHistory && (
          <>
            <button type="button" onClick={() => setShowHistory(true)} aria-label="Ver conversaciones anteriores" className={headerButton}>
              <History className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
            <button type="button" onClick={startNew} disabled={busy || (!activeId && messages.length === 0)} aria-label="Empezar una conversación nueva" className={headerButton}>
              <Plus className="h-5 w-5" aria-hidden="true" />
            </button>
          </>
        )}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Cerrar el asistente" className={headerButton}>
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      {showHistory ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
          <button
            type="button"
            onClick={startNew}
            className="mb-2 flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-outline-variant px-4 text-[13.5px] font-semibold text-on-surface transition hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nueva conversación
          </button>
          {conversations.length === 0 ? (
            <p className="m-auto max-w-[260px] py-8 text-center text-[13px] text-on-surface-variant">Todavía no tienes conversaciones guardadas. Haz tu primera pregunta y aparecerá aquí.</p>
          ) : (
            <ul className="space-y-1.5">
              {conversations.map((c) => (
                <li key={c.id} className={`flex items-stretch gap-1 rounded-xl ${c.id === activeId ? "bg-surface-container" : ""}`}>
                  <button
                    type="button"
                    onClick={() => openConversation(c.id)}
                    className="min-h-11 min-w-0 flex-1 rounded-xl px-3 py-2 text-left transition hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
                  >
                    <span className="block truncate text-[13.5px] font-semibold text-on-surface">{c.title}</span>
                    <span className="block text-[12px] text-on-surface-variant">{formatDay(c.updatedAt)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeConversation(c.id)}
                    aria-label={`Borrar la conversación "${c.title}"`}
                    className="flex h-11 w-11 flex-shrink-0 items-center justify-center self-center rounded-xl text-on-surface-variant transition hover:bg-error/10 hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {conversations.length > 1 && (
            <button
              type="button"
              onClick={clearAll}
              className="mt-3 min-h-11 self-start rounded-xl px-3 text-[12.5px] font-semibold text-error transition hover:bg-error/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
            >
              Borrar todas las conversaciones
            </button>
          )}
          {error && <p className="mt-2 text-[13px] text-error">{error}</p>}
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" role="log" aria-label="Conversación con el asistente">
            {shown.length === 0 && (
              <div className="m-auto w-full max-w-[420px] py-4 text-center">
                <p className="mb-1 text-[15px] font-semibold text-on-surface">¿Qué quieres saber de tu negocio?</p>
                <p className="mb-4 text-[13px] text-on-surface-variant">Está conectado a todos los datos del negocio, al algoritmo y a la actividad de la cuenta. No cambia nada por su cuenta: te dice qué hacer y a qué pantalla ir.</p>
                <div className="flex flex-col gap-2">
                  {prompts.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => submit(q)}
                      disabled={busy}
                      className="min-h-11 rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2.5 text-left text-[13.5px] font-medium text-on-surface transition hover:bg-surface-container disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {shown.map((m, i) => (
              <Message key={m.id ?? `pending-${i}`} m={m} onNavigate={onNavigate} />
            ))}
            {pending && <ThinkingStatus steps={pending.steps} seconds={seconds} />}
            {error && (
              <div className="rounded-xl border border-error/30 bg-error/5 px-4 py-3 text-[13.5px] text-error" role="alert">
                {error}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(text);
            }}
            className="flex items-end gap-2 border-t border-surface-container-high/70 p-3"
          >
            <label htmlFor="assistant-input" className="sr-only">
              Escribe tu pregunta
            </label>
            <textarea
              id="assistant-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(text);
                }
              }}
              rows={1}
              maxLength={600}
              placeholder="Escribe tu pregunta"
              className="max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-[14px] outline-none placeholder:text-on-surface-variant focus-visible:border-tertiary-accent"
            />
            <button
              type="submit"
              disabled={!text.trim() || busy}
              aria-label="Enviar pregunta"
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-secondary-container text-primary transition hover:brightness-95 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
            >
              <ArrowUp className="h-5 w-5" aria-hidden="true" />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
