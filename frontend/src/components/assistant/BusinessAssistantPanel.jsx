import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Lock, RotateCcw, ArrowRight } from "lucide-react";
import { api } from "../../lib/api.js";

// Bloque 246 (pedido explícito — asistente de negocio con IA para el admin y
// para los vendedores verificados): una sola pantalla de chat para los dos
// paneles. El asistente solo LEE datos y recomienda; cuando algo hay que
// cambiarlo, responde con botones a la pantalla exacta (links ya validados por
// el servidor contra la lista de rutas reales). Pensada para celular primero:
// preguntas rápidas con objetivo táctil de 44px y caja de texto fija abajo.

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
  resumen_plataforma: "Resumen de la plataforma",
  ventas_plataforma: "Ventas de la plataforma",
  tiendas_top: "Tiendas que más venden",
  productos_top_plataforma: "Productos que más se venden",
  detalle_tienda: "Detalle de tienda",
  resumen_clientes: "Resumen de clientes",
  pendientes_admin: "Pendientes",
  estado_ia: "Estado de la IA",
};

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("es-CU", { hour: "2-digit", minute: "2-digit" });
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

function Message({ m }) {
  const mine = m.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-[14px] leading-[21px] md:max-w-[75%] ${mine ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container text-on-surface"}`}>
        {mine ? <p className="whitespace-pre-wrap break-words">{m.content}</p> : <AssistantText text={m.content} />}
        {!mine && m.toolsUsed?.length > 0 && (
          <p className="mt-2.5 text-[12px] text-on-surface-variant">Consulté: {m.toolsUsed.map((t) => TOOL_LABELS[t] ?? t).join(", ")}</p>
        )}
        {!mine && m.links?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {m.links.map((l) => (
              <Link
                key={l.path}
                to={l.path}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-[13px] font-semibold text-white transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
              >
                Ir a {l.label}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ))}
          </div>
        )}
        <div className={`mt-1.5 text-[11px] ${mine ? "text-on-secondary-container" : "text-on-surface-variant"}`}>{formatTime(m.createdAt)}</div>
      </div>
    </div>
  );
}

// `endpoint`: "/vendors/me/assistant" o "/admin/business-assistant".
// `lockedAction`: qué botón mostrar cuando el plan no incluye el asistente.
export default function BusinessAssistantPanel({ endpoint, quickPrompts, intro, lockedAction }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(null);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);
  const queryKey = ["business-assistant", endpoint];

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: async () => (await api.get(endpoint)).data,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const ask = useMutation({
    mutationFn: async (message) => (await api.post(endpoint, { message })).data,
    onMutate: (message) => {
      setError("");
      setPending({ role: "user", content: message, createdAt: new Date().toISOString() });
    },
    onSuccess: async () => {
      setText("");
      await queryClient.invalidateQueries({ queryKey });
      setPending(null);
    },
    onError: (err) => {
      setPending(null);
      setError(err.response?.data?.error ?? "No se pudo obtener la respuesta. Prueba de nuevo.");
    },
  });

  const clear = useMutation({
    mutationFn: async () => (await api.delete(endpoint)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const messages = data?.messages ?? [];
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending, error]);

  function submit(message) {
    const value = message.trim();
    if (!value || ask.isPending) return;
    ask.mutate(value);
  }

  if (isLoading) {
    return <div className="py-10 text-center text-[13.5px] text-outline">Cargando el asistente...</div>;
  }
  if (isError) {
    return (
      <div className="rounded-2xl border border-error/30 bg-error/5 p-5 text-[13.5px] text-error">
        No se pudo cargar el asistente.{" "}
        <button type="button" onClick={() => refetch()} className="min-h-11 font-semibold underline">
          Reintentar
        </button>
      </div>
    );
  }

  // Plan sin el asistente, negocio sin verificar, etc.: se explica la ventaja
  // y se ofrece el camino, en vez de mostrar un error.
  if (data?.access && !data.access.allowed) {
    return (
      <div className="max-w-[560px] rounded-2xl bg-gradient-to-br from-primary to-primary-container p-6 text-white">
        <div className="mb-2 flex items-center gap-2">
          <Lock className="h-5 w-5" aria-hidden="true" />
          <h2 className="text-[15px] font-bold">Función para negocios verificados con plan de pago</h2>
        </div>
        <p className="mb-2 text-[13.5px] leading-[20px] text-white/85">{data.access.message}</p>
        <p className="mb-4 text-[13.5px] leading-[20px] text-white/85">
          Con el asistente le preguntas a tu negocio en lenguaje normal: cuánto vendiste hoy, qué se está agotando o qué producto conviene promocionar, y te responde con tus datos reales.
        </p>
        {lockedAction && (
          <Link to={lockedAction.to} className="inline-flex min-h-11 items-center rounded-xl bg-secondary-container px-5 text-[13px] font-bold text-primary transition hover:brightness-95">
            {lockedAction.label}
          </Link>
        )}
      </div>
    );
  }

  const shown = pending ? [...messages, pending] : messages;

  return (
    <div className="flex h-[calc(100dvh-270px)] min-h-[420px] flex-col md:h-[calc(100dvh-220px)] overflow-hidden rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
      <div className="flex items-center justify-between gap-3 border-b border-surface-container-high/70 px-4 py-2.5">
        <p className="text-[12.5px] text-on-surface-variant">{intro}</p>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => clear.mutate()}
            disabled={clear.isPending || ask.isPending}
            className="flex min-h-11 flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Nueva conversación
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" role="log" aria-live="polite" aria-label="Conversación con el asistente">
        {shown.length === 0 && (
          <div className="m-auto max-w-[420px] py-6 text-center">
            <p className="mb-1 text-[15px] font-semibold text-on-surface">¿Qué quieres saber de tu negocio?</p>
            <p className="mb-4 text-[13px] text-on-surface-variant">Responde con tus datos reales. No cambia nada por su cuenta: te dice qué hacer y a qué pantalla ir.</p>
            <div className="flex flex-col gap-2">
              {quickPrompts.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => submit(q)}
                  disabled={ask.isPending}
                  className="min-h-11 rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2.5 text-left text-[13.5px] font-medium text-on-surface transition hover:bg-surface-container disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {shown.map((m, i) => (
          <Message key={m.id ?? `pending-${i}`} m={m} />
        ))}
        {ask.isPending && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-surface-container px-4 py-3 text-[13.5px] text-on-surface-variant">Revisando tus datos...</div>
          </div>
        )}
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
          className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-[14px] outline-none placeholder:text-on-surface-variant focus-visible:border-tertiary-accent"
        />
        <button
          type="submit"
          disabled={!text.trim() || ask.isPending}
          aria-label="Enviar pregunta"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-white transition hover:brightness-110 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
        >
          <ArrowUp className="h-5 w-5" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
