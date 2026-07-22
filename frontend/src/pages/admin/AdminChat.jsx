import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Send, ShieldCheck, Store as StoreIcon, Mail, Search, X, MessageCircle } from "lucide-react";
import { api } from "../../lib/api.js";

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

  const { data: customers } = useQuery({
    queryKey: ["admin-customers"],
    queryFn: async () => (await api.get("/admin/customers")).data.customers,
    enabled: recipientType === "customer",
  });
  const { data: vendors } = useQuery({
    queryKey: ["admin-vendors", "all"],
    queryFn: async () => (await api.get("/admin/vendors")).data.vendors,
    enabled: recipientType === "vendor",
  });

  const pool = recipientType === "customer" ? customers : vendors;
  const matches = (pool ?? [])
    .filter((p) => {
      if (!query.trim()) return false;
      const label = recipientType === "customer" ? `${p.fullName ?? ""} ${p.email ?? ""}` : p.companyName;
      return label.toLowerCase().includes(query.toLowerCase());
    })
    .slice(0, 8);

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
    <div className="flex-1 overflow-y-auto rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
      <div className="mb-4 max-w-md">
        <div className="mb-4 flex rounded-full bg-surface-container p-1">
          <button
            onClick={() => resetRecipient("customer")}
            className={`flex-1 rounded-full py-2 text-[12.5px] font-semibold ${recipientType === "customer" ? "bg-surface-container-lowest text-on-surface shadow-sm" : "text-outline"}`}
          >
            Cliente
          </button>
          <button
            onClick={() => resetRecipient("vendor")}
            className={`flex-1 rounded-full py-2 text-[12.5px] font-semibold ${recipientType === "vendor" ? "bg-surface-container-lowest text-on-surface shadow-sm" : "text-outline"}`}
          >
            Tienda
          </button>
        </div>

        <div className="relative mb-3.5">
          <label className="mb-1 block text-[12.5px] font-semibold text-on-surface-variant">
            {recipientType === "customer" ? "Buscar cliente (nombre o correo)" : "Buscar tienda (nombre)"}
          </label>
          <div className="flex h-11 items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-3">
            <Search className="h-4 w-4 flex-shrink-0 text-outline" />
            <input
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
              <button onClick={() => resetRecipient(recipientType)} className="flex-shrink-0 text-outline hover:text-on-surface">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {showResults && !selected && matches.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest shadow-lg">
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
          <label className="mb-1 block text-[12.5px] font-semibold text-on-surface-variant">Asunto</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-[13.5px] outline-none"
          />
        </div>
        <div className="mb-4">
          <label className="mb-1 block text-[12.5px] font-semibold text-on-surface-variant">Mensaje</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="min-h-[130px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest p-3.5 text-[13.5px] outline-none"
          />
        </div>
        <button
          onClick={() => send.mutate()}
          disabled={!selected || !subject.trim() || !message.trim() || send.isPending}
          className="flex items-center gap-1.5 rounded-lg bg-tertiary-accent-light px-5 py-2.5 text-[13px] font-bold text-tertiary disabled:opacity-50"
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
  // ESE hilo directo en vez de la pantalla vacía de "elegí una tienda".
  useEffect(() => {
    if (vendorIdParam) {
      setActiveVendorId(vendorIdParam);
      setTab("messages");
    }
  }, [vendorIdParam]);

  // Lista todas las tiendas (con o sin conversación previa) — clickear
  // cualquiera abre el hilo y permite mandar el primer mensaje, así el admin
  // puede tanto responder como escribirle primero a cualquier vendedor.
  const { data: conversations } = useQuery({
    queryKey: ["admin-conversations"],
    queryFn: async () => (await api.get("/admin/messages")).data.conversations,
    refetchInterval: 5000,
  });

  const { data: thread } = useQuery({
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread]);

  return (
    <div className="flex h-[calc(100vh-60px)] flex-col gap-4">
      <div className="flex flex-shrink-0 gap-1.5 rounded-full bg-surface-container p-1" style={{ width: "fit-content" }}>
        <button
          onClick={() => {
            setTab("messages");
            navigate("/admin/mensajes");
          }}
          className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold ${
            tab === "messages" ? "bg-surface-container-lowest text-on-surface shadow-sm" : "text-outline"
          }`}
        >
          <MessageCircle className="h-3.5 w-3.5" /> Mensajes
        </button>
        <button
          onClick={() => setTab("direct-email")}
          className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold ${
            tab === "direct-email" ? "bg-surface-container-lowest text-on-surface shadow-sm" : "text-outline"
          }`}
        >
          <Mail className="h-3.5 w-3.5" /> Correo directo
        </button>
      </div>

      {tab === "direct-email" ? (
        <DirectEmailPanel />
      ) : (
    <div className="flex flex-1 gap-5 overflow-hidden">
      <div className="flex w-[320px] flex-shrink-0 flex-col overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest">
        <div className="border-b border-surface-container-high p-4">
          <h1 className="font-display text-[17px] font-bold text-on-surface">Mensajes</h1>
          <p className="text-[12px] text-outline">Conversaciones con tiendas</p>
        </div>
        <div className="flex flex-1 flex-col overflow-y-auto">
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
                <div className="truncate text-[11.5px] text-outline">{c.lastMessage ? c.lastMessage.body : "Sin mensajes todavía"}</div>
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

      <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest">
        {!activeVendorId ? (
          <div className="flex flex-1 items-center justify-center text-body-md text-on-surface-variant">
            Elegí una tienda para ver la conversación.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5 border-b border-surface-container-high p-4">
              <StoreIcon className="h-4 w-4 text-tertiary-accent" />
              <span className="text-[14px] font-bold text-on-surface">{thread?.vendor?.companyName}</span>
              {thread?.vendor?.isVerified && <ShieldCheck className="h-3.5 w-3.5 text-verified-dark" />}
            </div>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
              {thread?.messages?.length ? (
                thread.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.senderRole === "ADMIN" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[70%] rounded-lg px-4 py-2.5 text-[13.5px] leading-5 ${
                        m.senderRole === "ADMIN" ? "bg-tertiary-accent/15 text-on-surface" : "bg-surface-container text-on-surface"
                      }`}
                    >
                      <p>{m.body}</p>
                      <div className="mt-1 text-[10.5px] text-outline">{fmtTime(m.createdAt)}</div>
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
                placeholder="Escribí un mensaje..."
                className="h-11 flex-1 rounded border border-outline-variant bg-surface px-3.5 text-body-md outline-none"
              />
              <button
                type="submit"
                disabled={!text.trim() || send.isPending}
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded bg-tertiary text-white disabled:opacity-50"
              >
                <Send className="h-[18px] w-[18px]" />
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
