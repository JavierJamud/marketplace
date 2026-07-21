import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
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

// Se marca todo como leído cuando el vendedor efectivamente abre el
// dropdown — no cuando la notificación se creó en el backend (mismo patrón
// que VendorMessage/VendorChat.jsx, Bloque 15).
export function VendorNotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

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
    refetchInterval: 20000,
  });

  const markRead = useMutation({
    mutationFn: async () => api.patch("/vendors/me/notifications/read"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vendor-notifications"] }),
  });

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
        <div className="absolute right-0 top-[calc(100%+10px)] z-20 w-80 rounded-md border border-surface-container-high bg-surface-container-lowest py-1.5 shadow-lg">
          <div className="border-b border-surface-container px-3.5 py-2.5 text-[13px] font-bold text-on-surface">Notificaciones</div>
          <div className="max-h-80 overflow-y-auto">
            {data?.notifications?.length ? (
              data.notifications.map((n) => (
                <div key={n.id} className={`border-b border-surface-container px-3.5 py-3 last:border-b-0 ${!n.readAt ? "bg-secondary/5" : ""}`}>
                  <div className="text-[12.5px] font-bold text-on-surface">{n.title}</div>
                  <p className="mt-0.5 text-[12px] leading-4 text-on-surface-variant">{n.body}</p>
                  <div className="mt-1 text-[10.5px] text-outline">{timeAgo(n.createdAt)}</div>
                </div>
              ))
            ) : (
              <p className="px-3.5 py-4 text-center text-[12.5px] text-on-surface-variant">No tenés notificaciones todavía.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
