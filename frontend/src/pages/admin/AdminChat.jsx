import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Send, ShieldCheck, Store as StoreIcon, Mail, Search, X, MessageCircle, ArrowLeft } from "lucide-react";
import { api } from "../../lib/api.js";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { ListSkeleton, ChatSkeleton } from "../../components/ui/Skeleton.jsx";

// Topes del servidor: mensaje a una tienda (adminSendMessageSchema) y correo directo (sendEmailSchema), en
// admin.controller.js. Con maxLength el campo no deja pasarse en vez de fallar al enviar.
const MESSAGE_MAX = 2000;
const SUBJECT_MAX = 150;
const EMAIL_MAX = 5000;

function fmtTime(iso) {
  return new Date(iso).toLocaleString("es-CU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Bloque 47: correo puntual a un cliente o tienda elegido a mano — distinto
// del envío masivo segmentado de AdminCampaigns.jsx. Autocompletar simple
// (filtra en el cliente sobre /admin/customers y /admin/vendors, que ya se
// piden en otras pantallas del admin) en vez de un componente de combobox
// nuevo.
function DirectEmailPanel() {
  const [recipientType, setRecipientType] = useState("customer");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [showResults, setShowResults] = useState(false);

  // Bloque 242: GET /admin/customers ahora pagina — en vez de bajar todos los
  // clientes y filtrar acá, se busca en el servidor mientras se escribe
  // (espera de 300 ms, mínimo 2 letras) y se pide solo la 1ª página de 8.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const { data: customerMatches } = useQuery({
    queryKey: ["admin-list-customer-search", debouncedQuery],
    queryFn: async () => (await api.get("/admin/customers", { params: { q: debouncedQuery, pageSize: 8, sort: "name", dir: "asc" } })).data.customers,
    enabled: recipientType === "customer" && debouncedQuery.length >= 2,
  });
  // Bloque 243: lo mismo para tiendas (GET /admin/vendors también pagina).
  const { data: vendorMatches } = useQuery({
    queryKey: ["admin-list-vendor-search", debouncedQuery],
    queryFn: async () => (await api.get("/admin/vendors", { params: { q: debouncedQuery, pageSize: 8, sort: "name", dir: "asc" } })).data.vendors,
    enabled: recipientType === "vendor" && debouncedQuery.length >= 2,
  });

  const matches = debouncedQuery.length >= 2 ? (recipientType === "customer" ? customerMatches : vendorMatches) ?? [] : [];

  function pick(p) {
    setSelected(p);
    setQuery(recipientType === "customer" ? p.fullName ?? p.email : p.companyName);
    setShowResults(false);
  }

  function resetRecipient(type) {
    setRecipientType(type);
    setSelected(null);
    setQuery("");
  }

  const send = useMutation({
    mutationFn: async () =>
      (
        await api.post("/admin/emails", {
          recipientType,
          recipientId: selected.id,
          subject,
          message,
        })
      ).data,
    onSuccess: () => {
      toast.success("Correo enviado.");
      setSelected(null);
      setQuery("");
      setSubject("");
      setMessage("");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar el correo."),
  });

  return (
    <div className="flex-1 overflow-y-auto rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-6">
      <div className="mb-4 max-w-md">
        <div className="mb-4 flex rounded-full bg-surface-container p-1">
          <button
            onClick={() => resetRecipient("customer")}
            aria-pressed={recipientType === "customer"}
            className={`min-h-11 flex-1 rounded-full py-2 text-[12.5px] font-semibold ${recipientType === "customer" ? "bg-surface-container-lowest text-on-surface shadow-sm" : "text-on-surface-variant"}`}
          >
            Cliente
          </button>
          <button
            onClick={() => resetRecipient("vendor")}
            aria-pressed={recipientType === "vendor"}
            className={`min-h-11 flex-1 rounded-full py-2 text-[12.5px] font-semibold ${recipientType === "vendor" ? "bg-surface-container-lowest text-on-surface shadow-sm" : "text-on-surface-variant"}`}
          >
            Tienda
          </button>
        </div>

        <div className="relative mb-3.5">
          <label htmlFor="direct-email-search" className="mb-1 block text-[12.5px] font-semibold text-on-surface-variant">
            {recipientType === "customer" ? "Buscar cliente (nombre o correo)" : "Buscar tienda (nombre)"}
          </label>
          <div className="flex h-11 items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-3">
            <Search className="h-4 w-4 flex-shrink-0 text-outline" />
            <input
              id="direct-email-search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
                setShowResults(true);
              }}
              onFocus={() => setShowResults(true)}
              placeholder={recipientType === "customer" ? "Ej: María o maria@correo.com" : "Ej: Panadería La Espiga"}
              className="w-full border-none bg-transparent text-[13.5px] outline-none"
            />
            {selected && (
              <button
                type="button"
                onClick={() => resetRecipient(recipientType)}
                aria-label={recipientType === "customer" ? "Quitar el cliente elegido" : "Quitar la tienda elegida"}
                className="-mr-2 flex h-11 w-11 flex-shrink-0 items-center justify-center text-on-surface-variant hover:text-on-surface"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
          {showResults && !selected && matches.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
              {matches.map((p) => (
                <button
                  key={p.id}
                  onClick={() => pick(p)}
                  className="block w-full px-3.5 py-2.5 text-left text-[13px] hover:bg-surface-container"
                >
                  {recipientType === "customer" ? (
                    <>
                      <div className="font-semibold text-on-surface">{p.fullName ?? "Sin nombre"}</div>
                      <div className="text-[11.5px] text-outline">{p.email}</div>
                    </>
                  ) : (
                    <div className="font-semibold text-on-surface">{p.companyName}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mb-3.5">
          <label htmlFor="direct-email-subject" className="mb-1 block text-[12.5px] font-semibold text-on-surface-variant">
            Asunto
          </label>
          <input
            id="direct-email-subject"
            maxLength={SUBJECT_MAX}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-[13.5px] outline-none"
          />
        </div>
        <div className="mb-4">
          <label htmlFor="direct-email-message" className="mb-1 block text-[12.5px] font-semibold text-on-surface-variant">
            Mensaje
          </label>
          <textarea
            id="direct-email-message"
            maxLength={EMAIL_MAX}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="min-h-[130px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest p-3.5 text-[13.5px] outline-none"
          />
        </div>
        <button
          onClick={() => send.mutate()}
          disabled={!selected || !subject.trim() || !message.trim() || send.isPending}
          className="flex min-h-11 items-center gap-1.5 rounded-lg bg-tertiary-accent-light px-5 py-2.5 text-[13px] font-bold text-tertiary disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" /> {send.isPending ? "Enviando..." : "Enviar correo"}
        </button>
      </div>
    </div>
  );
}

// Sin websockets — API REST stateless, mismo criterio que VendorChat.jsx.
export default function AdminChat() {
  const queryClient = useQueryClient();
  const { vendorId: vendorIdParam } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState("messages"); // messages | direct-email
  const [activeVendorId, setActiveVendorId] = useState(vendorIdParam ?? null);
  const [text, setText] = useState("");
  const bottomRef = useRef(null);

  // Bloque 47: deep-link desde la campana de notificaciones
  // (/admin/mensajes/:vendorId) — si llega con un vendorId en la URL, abre
  // ESE hilo directo en vez de la pantalla vacía de "elige una tienda".
  useEffect(() => {
    if (vendorIdParam) {
      setActiveVendorId(vendorIdParam);
      setTab("messages");
    }
  }, [vendorIdParam]);

  // Lista todas las tiendas (con o sin conversación previa) — clickear
  // cualquiera abre el hilo y permite mandar el primer mensaje, así el admin
  // puede tanto responder como escribirle primero a cualquier vendedor.
  const {
    data: conversations,
    isLoading: conversationsLoading,
    isError: conversationsError,
    refetch: refetchConversations,
    isFetching: conversationsFetching,
  } = useQuery({
    queryKey: ["admin-conversations"],
    queryFn: async () => (await api.get("/admin/messages")).data.conversations,
    refetchInterval: 5000,
  });

  const {
    data: thread,
    isLoading: threadLoading,
    isError: threadError,
    refetch: refetchThread,
    isFetching: threadFetching,
  } = useQuery({
    queryKey: ["admin-conversation", activeVendorId],
    queryFn: async () => (await api.get(`/admin/messages/${activeVendorId}`)).data,
    enabled: !!activeVendorId,
    refetchInterval: activeVendorId ? 4000 : false,
  });

  const send = useMutation({
    mutationFn: async (body) => (await api.post(`/admin/messages/${activeVendorId}`, { body })).data,
    onSuccess: () => {
      setText("");
      queryClient.invalidateQueries({ queryKey: ["admin-conversation", activeVendorId] });
      queryClient.invalidateQueries({ queryKey: ["admin-conversations"] });
    },
    // El texto queda en el campo para volver a intentarlo; antes un envío fallido no decía nada y parecía mandado.
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar el mensaje. Inténtalo otra vez."),
  });

  // Se marca leído cuando el admin efectivamente abre el hilo de esa tienda
  // con mensajes del vendedor pendientes — no al recibirlos en el backend.
  useEffect(() => {
    if (!activeVendorId || !thread?.messages?.length) return;
    const hasUnread = thread.messages.some((m) => m.senderRole === "VENDOR" && !m.readAt);
    if (hasUnread) {
      api.patch(`/admin/messages/${activeVendorId}/read`).then(() => {
        queryClient.invalidateQueries({ queryKey: ["admin-conversation", activeVendorId] });
        queryClient.invalidateQueries({ queryKey: ["admin-conversations"] });
      });
    }
  }, [thread, activeVendorId, queryClient]);

  useEffect(() => {
    // Se baja solo dentro de la lista de mensajes: scrollIntoView también movía la página entera y escondía el título
    // y las pestañas debajo de la barra de arriba (sobre todo en el celular).
    const box = bottomRef.current?.parentElement;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [thread]);

  return (
    <div className="flex h-[calc(100dvh-60px)] flex-col gap-4">
      <div className="flex items-center gap-3">
        <IconCircle icon={MessageCircle} tone="teal" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Mensajes</h1>
      </div>
      {/* Botones de dos estados (aria-pressed), como el selector Cliente/Tienda: role="tab" anunciaba pestañas sin panel
          asociado ni flechas para moverse entre ellas. */}
      <div role="group" aria-label="Mensajes o correo directo" className="flex flex-shrink-0 gap-1.5 rounded-full bg-surface-container p-1" style={{ width: "fit-content" }}>
        <button
          type="button"
          aria-pressed={tab === "messages"}
          onClick={() => {
            setTab("messages");
            navigate("/admin/mensajes");
          }}
          className={`flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold ${
            tab === "messages" ? "bg-surface-container-lowest text-on-surface shadow-sm" : "text-on-surface-variant"
          }`}
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> Mensajes
        </button>
        <button
          type="button"
          aria-pressed={tab === "direct-email"}
          onClick={() => setTab("direct-email")}
          className={`flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold ${
            tab === "direct-email" ? "bg-surface-container-lowest text-on-surface shadow-sm" : "text-on-surface-variant"
          }`}
        >
          <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Correo directo
        </button>
      </div>

      {tab === "direct-email" ? (
        <DirectEmailPanel />
      ) : (
    // En el celular se ve una cosa a la vez: la lista, o la conversación abierta con un botón para volver a la lista.
    <div className="flex min-h-0 flex-1 gap-5 overflow-hidden">
      <div className={`${activeVendorId ? "hidden md:flex" : "flex"} w-full flex-shrink-0 flex-col overflow-hidden rounded-2xl md:w-[320px] border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]`}>
        <div className="border-b border-surface-container-high p-4">
          <h2 className="font-display text-[17px] font-bold text-on-surface">Conversaciones</h2>
          <p className="text-[12px] text-on-surface-variant">Todas las tiendas, con o sin mensajes</p>
        </div>
        <div className="flex flex-1 flex-col overflow-y-auto">
          {conversationsLoading && <ListSkeleton rows={6} className="px-4" label="Cargando conversaciones" />}
          {conversationsError && !conversations && (
            <div className="flex flex-col items-start gap-3 p-4">
              <p className="text-[13px] text-error">No se pudieron cargar las conversaciones.</p>
              <button
                type="button"
                onClick={() => refetchConversations()}
                disabled={conversationsFetching}
                className="min-h-11 rounded-lg border border-outline-variant px-4 text-[13px] font-semibold text-on-surface hover:bg-surface-container disabled:opacity-50"
              >
                {conversationsFetching ? "Reintentando..." : "Reintentar"}
              </button>
            </div>
          )}
          {conversations && conversations.length === 0 && (
            <p className="p-4 text-[13px] text-on-surface-variant">Todavía no hay tiendas registradas. Cuando se registre una, podrás escribirle desde aquí.</p>
          )}
          {conversations?.map((c) => (
            <button
              key={c.vendorId}
              onClick={() => setActiveVendorId(c.vendorId)}
              className={`flex items-start gap-2.5 border-b border-surface-container px-4 py-3.5 text-left ${
                activeVendorId === c.vendorId ? "bg-tertiary-accent/10" : "hover:bg-surface-container"
              }`}
            >
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-tertiary/10 text-[13px] font-bold text-tertiary">
                {c.companyName[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-bold text-on-surface">{c.companyName}</span>
                  {c.isVerified && <ShieldCheck className="h-3 w-3 flex-shrink-0 text-verified-dark" />}
                </div>
                <div className="truncate text-[11.5px] text-on-surface-variant">{c.lastMessage ? c.lastMessage.body : "Sin mensajes todavía"}</div>
              </div>
              {c.unreadCount > 0 && (
                <span className="flex h-5 min-w-[20px] flex-shrink-0 items-center justify-center rounded-full bg-secondary px-1.5 text-[10.5px] font-bold text-white">
                  {c.unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className={`${activeVendorId ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]`}>
        {!activeVendorId ? (
          <div className="flex flex-1 items-center justify-center text-body-md text-on-surface-variant">
            Elige una tienda para ver la conversación.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5 border-b border-surface-container-high p-4">
              <button
                type="button"
                onClick={() => {
                  setActiveVendorId(null);
                  navigate("/admin/mensajes");
                }}
                aria-label="Volver a las conversaciones"
                className="-ml-2 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container md:hidden"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <StoreIcon className="h-4 w-4 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
              <span className="min-w-0 truncate text-[14px] font-bold text-on-surface">{thread?.vendor?.companyName}</span>
              {thread?.vendor?.isVerified && <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 text-verified-dark" aria-label="Verificada" />}
            </div>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
              {threadLoading ? (
                <ChatSkeleton />
              ) : threadError && !thread ? (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <p className="text-[13px] text-error">No se pudo cargar la conversación.</p>
                  <button
                    type="button"
                    onClick={() => refetchThread()}
                    disabled={threadFetching}
                    className="min-h-11 rounded-lg border border-outline-variant px-4 text-[13px] font-semibold text-on-surface hover:bg-surface-container disabled:opacity-50"
                  >
                    {threadFetching ? "Reintentando..." : "Reintentar"}
                  </button>
                </div>
              ) : thread?.messages?.length ? (
                thread.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.senderRole === "ADMIN" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`min-w-0 max-w-[85%] rounded-lg px-4 py-2.5 text-[13.5px] leading-5 sm:max-w-[70%] ${
                        m.senderRole === "ADMIN" ? "bg-tertiary-accent/15 text-on-surface" : "bg-surface-container text-on-surface"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.body}</p>
                      <div className="mt-1 text-[10.5px] text-on-surface-variant">{fmtTime(m.createdAt)}</div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="py-6 text-center text-body-md text-on-surface-variant">Todavía no hay mensajes con esta tienda.</p>
              )}
              <div ref={bottomRef} />
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim() && !send.isPending) send.mutate(text.trim());
              }}
              className="flex items-center gap-2.5 border-t border-surface-container-high p-3.5"
            >
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={MESSAGE_MAX}
                aria-label="Mensaje para la tienda"
                placeholder="Escribe un mensaje..."
                className="h-11 min-w-0 flex-1 rounded border border-outline-variant bg-surface px-3.5 text-body-md outline-none"
              />
              <button
                type="submit"
                disabled={!text.trim() || send.isPending}
                aria-label={send.isPending ? "Enviando mensaje" : "Enviar mensaje"}
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded bg-tertiary text-white disabled:opacity-50"
              >
                <Send className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            </form>
          </>
        )}
      </div>
    </div>
      )}
    </div>
  );
}
