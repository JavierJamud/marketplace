import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, Send, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";

function fmtTime(iso) {
  return new Date(iso).toLocaleString("es-CU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function VendorChat() {
  const { siteName } = usePlatformSettings();
  const { vendor } = useOutletContext();
  // Bug real corregido: chequeaba vendor.verification.status === "APPROVED",
  // un campo que ya no existe (el estado vive en Vendor.verificationStatus
  // desde el Bloque 64) — el chat quedaba bloqueado para SIEMPRE incluso con
  // la tienda verificada. Mismo criterio que el resto del panel (isVerified).
  const isApproved = !!vendor?.isVerified;
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const bottomRef = useRef(null);

  // Sin websockets (el proyecto no tiene infraestructura de sockets — es una
  // API REST stateless) — refetchInterval de React Query alcanza para este
  // alcance y no agrega dependencias nuevas.
  const { data: messages } = useQuery({
    queryKey: ["vendor-messages"],
    queryFn: async () => (await api.get("/vendors/me/messages")).data.messages,
    enabled: isApproved,
    refetchInterval: isApproved ? 4000 : false,
  });

  const send = useMutation({
    mutationFn: async (body) => (await api.post("/vendors/me/messages", { body })).data,
    onSuccess: () => {
      setText("");
      queryClient.invalidateQueries({ queryKey: ["vendor-messages"] });
    },
  });

  // Se marca como leído cuando el vendedor efectivamente ve el hilo con
  // mensajes del admin pendientes — no cuando el backend los recibió.
  useEffect(() => {
    if (!isApproved || !messages?.length) return;
    const hasUnread = messages.some((m) => m.senderRole === "ADMIN" && !m.readAt);
    if (hasUnread) {
      api.patch("/vendors/me/messages/read").then(() => queryClient.invalidateQueries({ queryKey: ["vendor-messages"] }));
    }
  }, [messages, isApproved, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!isApproved) {
    return (
      <div>
        <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Mensajes</h1>
        <p className="mb-[26px] text-[13.5px] text-outline">Chat directo con el equipo de {siteName}.</p>
        <div className="max-w-[520px] rounded-lg bg-gradient-to-br from-primary to-primary-container p-[22px] text-white">
          <div className="mb-2 flex items-center gap-2">
            <Lock className="h-5 w-5" />
            <span className="text-[14px] font-bold">Función exclusiva para tiendas verificadas</span>
          </div>
          <p className="mb-3 text-[12.5px] leading-[18px] text-white/80">
            El chat con el equipo de {siteName} se habilita automáticamente cuando tu tienda pasa la verificación KYC.
          </p>
          <Link to="/vendedor/verificacion" className="text-[12.5px] font-bold text-secondary-container">Verificar mi tienda →</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-60px)] flex-col">
      <div className="mb-[18px]">
        <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Mensajes</h1>
        <p className="flex items-center gap-1.5 text-[13.5px] text-outline">
          <ShieldCheck className="h-3.5 w-3.5 text-verified-dark" /> Chat directo con el equipo de {siteName}
        </p>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest">
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
          {messages?.length ? (
            messages.map((m) => (
              <div key={m.id} className={`flex ${m.senderRole === "VENDOR" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[70%] rounded-lg px-4 py-2.5 text-[13.5px] leading-5 ${
                    m.senderRole === "VENDOR" ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container text-on-surface"
                  }`}
                >
                  <p>{m.body}</p>
                  <div className={`mt-1 text-[10.5px] ${m.senderRole === "VENDOR" ? "text-on-secondary-container/70" : "text-outline"}`}>
                    {fmtTime(m.createdAt)}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="py-6 text-center text-body-md text-on-surface-variant">
              Todavía no hay mensajes. Escribile al equipo de {siteName} lo que necesites.
            </p>
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
            placeholder="Escribe un mensaje..."
            className="h-11 flex-1 rounded border border-outline-variant bg-surface px-3.5 text-body-md outline-none"
          />
          <button
            type="submit"
            disabled={!text.trim() || send.isPending}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded bg-secondary-container text-on-secondary-container disabled:opacity-50"
          >
            <Send className="h-[18px] w-[18px]" />
          </button>
        </form>
      </div>
    </div>
  );
}
