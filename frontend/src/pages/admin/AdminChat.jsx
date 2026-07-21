import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, ShieldCheck, Store as StoreIcon } from "lucide-react";
import { api } from "../../lib/api.js";

function fmtTime(iso) {
  return new Date(iso).toLocaleString("es-CU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Sin websockets — API REST stateless, mismo criterio que VendorChat.jsx.
export default function AdminChat() {
  const queryClient = useQueryClient();
  const [activeVendorId, setActiveVendorId] = useState(null);
  const [text, setText] = useState("");
  const bottomRef = useRef(null);

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
    <div className="flex h-[calc(100vh-60px)] gap-5">
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
  );
}
