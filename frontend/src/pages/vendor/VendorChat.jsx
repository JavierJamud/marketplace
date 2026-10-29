import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, Send, ShieldCheck, MessageSquare } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import toast from "../../lib/toast.jsx";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { canWriteSection } from "../../lib/vendorSections.js";
import { PlanUpsell } from "../../components/vendor/PlanUpsell.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

// Mismo tope que sendMessageSchema (vendors.controller.js): sin él, un texto más largo se escribía entero y el servidor lo
// rechazaba al enviar.
const MAX_MESSAGE_LENGTH = 2000;

function fmtTime(iso) {
  return new Date(iso).toLocaleString("es-CU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function VendorChat() {
  const { siteName } = usePlatformSettings();
  const { vendor, isStaff, staffSectionPermissions } = useOutletContext() ?? {};
  // Bug real corregido: chequeaba vendor.verification.status === "APPROVED",
  // un campo que ya no existe (el estado vive en Vendor.verificationStatus
  // desde el Bloque 64) — el chat quedaba bloqueado para SIEMPRE incluso con
  // la tienda verificada. Mismo criterio que el resto del panel (isVerified).
  const isApproved = !!vendor?.isVerified;
  // El servidor también exige allowAdminChat en el plan (requireApprovedVendor). Sin esto, una tienda verificada con un plan
  // sin chat pedía los mensajes cada 4 s y recibía 403 en bucle. Mientras /vendors/me no responde se da por permitido.
  const planAllowsChat = vendor?.planFeatures?.allowAdminChat !== false;
  // Personal con "solo ver" en Mensajes: puede leer el hilo, pero escribir y marcar como leído piden permiso de escritura
  // (requireVendorWrite("mensajes"), vendors.routes.js). Antes el PATCH de leídos salía cada 4 s y volvía con 403.
  const canWrite = canWriteSection(staffSectionPermissions ?? null, "mensajes");
  const chatOpen = isApproved && planAllowsChat;
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const bottomRef = useRef(null);

  // Sin websockets (el proyecto no tiene infraestructura de sockets — es una
  // API REST stateless) — refetchInterval de React Query alcanza para este
  // alcance y no agrega dependencias nuevas.
  const { data: messages, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["vendor-messages"],
    queryFn: async () => (await api.get("/vendors/me/messages")).data.messages,
    enabled: chatOpen,
    refetchInterval: chatOpen ? 4000 : false,
  });

  const send = useMutation({
    mutationFn: async (body) => (await api.post("/vendors/me/messages", { body })).data,
    onSuccess: () => {
      setText("");
      queryClient.invalidateQueries({ queryKey: ["vendor-messages"] });
    },
    // El texto se queda en el campo para poder reintentar sin escribirlo de nuevo.
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar el mensaje."),
  });

  // Se marca como leído cuando el vendedor efectivamente ve el hilo con
  // mensajes del admin pendientes — no cuando el backend los recibió.
  useEffect(() => {
    if (!chatOpen || !canWrite || !messages?.length) return;
    const hasUnread = messages.some((m) => m.senderRole === "ADMIN" && !m.readAt);
    if (hasUnread) {
      // Si falla, el siguiente refresco lo vuelve a intentar; no hace falta avisar.
      api
        .patch("/vendors/me/messages/read")
        .then(() => queryClient.invalidateQueries({ queryKey: ["vendor-messages"] }))
        .catch(() => {});
    }
  }, [messages, chatOpen, canWrite, queryClient]);

  useEffect(() => {
    // Se baja solo dentro de la lista de mensajes: scrollIntoView también movía la página entera y escondía el título
    // y las pestañas debajo de la barra de arriba (sobre todo en el celular).
    const box = bottomRef.current?.parentElement;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [messages]);

  if (!isApproved) {
    return (
      <div>
        <div className="mb-1 flex items-center gap-3">
          <IconCircle icon={MessageSquare} tone="teal" />
          <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Mensajes</h1>
        </div>
        <p className="mb-[26px] text-[13.5px] text-outline">Chat directo con el equipo de {siteName}.</p>
        <div className="max-w-[520px] rounded-lg bg-gradient-to-br from-primary to-primary-container p-[22px] text-white">
          <div className="mb-2 flex items-center gap-2">
            <Lock className="h-5 w-5" />
            <span className="text-[14px] font-bold">Función exclusiva para tiendas verificadas</span>
          </div>
          <p className="mb-4 text-[12.5px] leading-[18px] text-white/80">
            El chat con el equipo de {siteName} se habilita automáticamente cuando tu tienda pasa la verificación KYC.
            {isStaff && " La verificación la hace el dueño de la tienda."}
          </p>
          {/* El personal no entra a Suscripción (es solo del dueño): el enlace lo mandaría de vuelta a otra sección. */}
          {!isStaff && (
            <Link
              to="/vendedor/verificacion"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-secondary-container px-5 text-[13px] font-bold text-primary transition hover:brightness-95"
            >
              Verificar mi tienda
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (!planAllowsChat) {
    return (
      <div>
        <div className="mb-1 flex items-center gap-3">
          <IconCircle icon={MessageSquare} tone="teal" />
          <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Mensajes</h1>
        </div>
        <p className="mb-[26px] text-[13.5px] text-outline">Chat directo con el equipo de {siteName}.</p>
        <div className="max-w-[520px]">
          {/* El personal no entra a Verificación y plan (es solo del dueño): "Ver los planes" lo mandaría a una pantalla que
              no puede abrir. A ellos solo se les explica a quién pedírselo, igual que en el aviso de tienda sin verificar. */}
          {isStaff ? (
            <div role="status" className="rounded-2xl border border-secondary/40 bg-secondary-container/15 p-5">
              <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
                <Lock className="h-4 w-4 text-secondary" aria-hidden="true" /> El chat con el equipo no está en el plan de la tienda
              </div>
              <p className="text-[13px] leading-[19px] text-on-surface-variant">
                El plan lo elige el dueño de la tienda. Si necesitas escribirle al equipo de {siteName}, avísale al dueño.
              </p>
            </div>
          ) : (
            <PlanUpsell
              title="El chat con el equipo no está en tu plan"
              text={`Con el chat le escribes directo al equipo de ${siteName} desde tu panel y ves sus respuestas aquí mismo.`}
            />
          )}
        </div>
      </div>
    );
  }

  // 100dvh y no 100vh: en el celular 100vh cuenta también la barra del navegador. Los 190px son la barra de arriba del
  // panel (el chat empieza a ~110px) más el espacio de los botones flotantes de abajo; con -60px el campo de escribir
  // quedaba por debajo de la pantalla y tapado por esos botones, a 390px y en escritorio.
  return (
    <div className="flex h-[calc(100dvh-190px)] min-h-[420px] flex-col">
      <div className="mb-[18px]">
        <div className="mb-1 flex items-center gap-3">
          <IconCircle icon={MessageSquare} tone="teal" />
          <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Mensajes</h1>
        </div>
        <p className="flex items-center gap-1.5 text-[13.5px] text-outline">
          <ShieldCheck className="h-3.5 w-3.5 text-verified-dark" /> Chat directo con el equipo de {siteName}
        </p>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3.5 sm:p-5">
          {isLoading ? (
            <ListSkeleton rows={3} />
          ) : isError && !messages ? (
            <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-body-md text-on-surface">No se pudieron cargar los mensajes.</p>
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isFetching}
                className="min-h-11 rounded-xl border border-outline px-4 text-[13px] font-bold text-on-surface hover:bg-surface-container disabled:opacity-50"
              >
                {isFetching ? "Cargando..." : "Reintentar"}
              </button>
            </div>
          ) : messages?.length ? (
            messages.map((m) => (
              <div key={m.id} className={`flex ${m.senderRole === "VENDOR" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`min-w-0 max-w-[85%] rounded-lg px-4 py-2.5 text-[13.5px] leading-5 sm:max-w-[70%] ${
                    m.senderRole === "VENDOR" ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container text-on-surface"
                  }`}
                >
                  {/* Una URL o palabra larga sin espacios desbordaba la burbuja a 390px; pre-wrap respeta los saltos de línea. */}
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.body}</p>
                  <div className={`mt-1 text-[10.5px] ${m.senderRole === "VENDOR" ? "text-on-secondary-container/70" : "text-outline"}`}>
                    {fmtTime(m.createdAt)}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="py-6 text-center text-body-md text-on-surface-variant">
              Todavía no hay mensajes. Escríbele al equipo de {siteName} lo que necesites.
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        {canWrite ? (
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
              aria-label="Mensaje para el equipo"
              maxLength={MAX_MESSAGE_LENGTH}
              className="h-11 min-w-0 flex-1 rounded border border-outline-variant bg-surface px-3.5 text-body-md outline-none focus:border-primary-container"
            />
            <button
              type="submit"
              aria-label="Enviar mensaje"
              disabled={!text.trim() || send.isPending}
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded bg-secondary-container text-on-secondary-container disabled:opacity-50"
            >
              <Send className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </form>
        ) : (
          <p className="border-t border-surface-container-high p-3.5 text-[12.5px] text-on-surface-variant">
            Tienes acceso de solo lectura a Mensajes: puedes leer la conversación, pero no escribir. Si necesitas responder, pídele permiso a tu administrador.
          </p>
        )}
      </div>
    </div>
  );
}
