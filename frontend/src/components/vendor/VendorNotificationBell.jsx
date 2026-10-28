import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Bell, Check } from "lucide-react";
import { api } from "../../lib/api.js";

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Recién";
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Ayer" : `Hace ${days} días`;
}

// A dónde lleva cada tipo de aviso. Los que no tienen un lugar propio solo se dan por atendidos.
function destinationFor(n) {
  if (["NEW_ORDER", "ORDER_CANCELLED_BY_CUSTOMER", "ORDER_EDITED_BY_CUSTOMER", "ORDER_OVERDUE", "ORDER_REMINDER", "ORDER_CANCEL_WARNING", "ORDER_AUTO_CANCELLED", "ORDER_DELAYED"].includes(n.type)) return n.refCode ? `/vendedor/pedidos?buscar=${encodeURIComponent(n.refCode)}` : "/vendedor/pedidos";
  if (n.type === "SUPPORT_CASE") return "/vendedor/pedidos";
  if (n.type === "VENDOR_STAFF_OUT_OF_STOCK" || n.type === "LOW_STOCK") return "/vendedor/productos";
  if (n.type === "NEW_CUSTOMER") return "/vendedor/clientes";
  if (n.type === "NEW_MESSAGE") return "/vendedor/mensajes";
  if (n.type.startsWith("FRAUD_REPORT")) return "/vendedor/reportes";
  if (/^(VERIFICATION|TRIAL|SUBSCRIPTION|VENDOR_CHANGE|VENDOR_SUSPENDED)/.test(n.type)) return "/vendedor/verificacion";
  return null;
}

// Se marca todo como leído cuando el vendedor efectivamente abre el
// dropdown — no cuando la notificación se creó en el backend (mismo patrón
// que VendorMessage/VendorChat.jsx, Bloque 15).
export function VendorNotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const { data } = useQuery({
    queryKey: ["vendor-notifications"],
    queryFn: async () => (await api.get("/vendors/me/notifications")).data,
    refetchInterval: 8000,
  });

  const markRead = useMutation({
    mutationFn: async () => api.patch("/vendors/me/notifications/read"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vendor-notifications"] }),
  });

  // Atendida: al abrir un aviso se resuelve y desaparece de la lista (se quita al instante, sin esperar al servidor).
  const resolveOne = useMutation({
    mutationFn: async (id) => api.patch(`/vendors/me/notifications/${id}/resolve`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["vendor-notifications"] });
      queryClient.setQueryData(["vendor-notifications"], (old) => (old ? { ...old, notifications: old.notifications.filter((n) => n.id !== id) } : old));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["vendor-notifications"] }),
  });
  const resolveAll = useMutation({
    mutationFn: async () => api.patch("/vendors/me/notifications/resolve-all"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vendor-notifications"] }),
  });

  function openNotification(n) {
    resolveOne.mutate(n.id);
    setOpen(false);
    const to = destinationFor(n);
    if (to) navigate(to);
  }

  const unreadCount = data?.unreadCount ?? 0;

  function toggle() {
    setOpen((wasOpen) => {
      if (!wasOpen && unreadCount > 0) markRead.mutate();
      return !wasOpen;
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        title="Notificaciones"
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span
            key={unreadCount}
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] animate-badge-pop items-center justify-center rounded-full bg-secondary px-1 text-[10px] font-bold text-white"
          >
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+10px)] z-20 w-[min(20rem,calc(100vw-24px))] rounded-xl border border-surface-container-high bg-surface-container-lowest shadow-xl">
          <div className="flex items-center justify-between border-b border-surface-container px-3.5 py-2.5">
            <span className="text-[13px] font-bold text-on-surface">Notificaciones</span>
            {data?.notifications?.length > 0 && (
              <button type="button" onClick={() => resolveAll.mutate()} className="inline-flex min-h-8 items-center gap-1 text-[11.5px] font-semibold text-tertiary-accent hover:underline">
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> Marcar todo como atendido
              </button>
            )}
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {data?.notifications?.length ? (
              data.notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openNotification(n)}
                  className={`block w-full border-b border-surface-container px-3.5 py-3 text-left last:border-b-0 hover:bg-surface-container/60 ${!n.readAt ? "bg-secondary/5" : ""}`}
                >
                  <div className="text-[12.5px] font-bold text-on-surface">{n.title}</div>
                  <p className="mt-0.5 text-[12px] leading-4 text-on-surface-variant">{n.body}</p>
                  <div className="mt-1 text-[10.5px] text-outline">{timeAgo(n.createdAt)}</div>
                </button>
              ))
            ) : (
              <p className="px-3.5 py-6 text-center text-[12.5px] text-on-surface-variant">No tienes avisos pendientes.</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate("/vendedor/perfil#avisos");
            }}
            className="block min-h-10 w-full border-t border-surface-container px-3.5 py-2.5 text-left text-[12px] font-semibold text-tertiary-accent hover:bg-surface-container/60"
          >
            Elegir qué avisos recibir en el celular
          </button>
        </div>
      )}
    </div>
  );
}
