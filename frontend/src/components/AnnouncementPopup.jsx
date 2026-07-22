import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { api } from "../lib/api.js";

// Bloque 47: reemplaza el punto 3 del Bloque 46 (banner insertado en el hero
// / franja arriba del header) — los anuncios ahora son un pop-up flotante
// centrado, montado una sola vez acá (no en Home.jsx/Stores.jsx sueltas),
// así que funciona en cualquier página pública. "position" (HERO/TOP_BAR)
// ya no dice DÓNDE se inserta — dice qué anuncio tiene prioridad si hay más
// de uno activo a la vez (HERO primero).
function resolvePage(pathname) {
  if (pathname === "/") return "home";
  if (pathname === "/tiendas") return "stores";
  return undefined;
}

function dismissKey(id) {
  return `zeudin_announcement_dismissed_${id}`;
}

export function AnnouncementPopup() {
  const { pathname } = useLocation();
  const page = resolvePage(pathname);
  // Truco simple para forzar un re-render tras escribir en sessionStorage
  // (sessionStorage no es reactivo por sí solo) — sin esto, cerrar un
  // anuncio no revelaría el siguiente hasta la próxima navegación.
  const [, bump] = useState(0);

  const { data } = useQuery({
    queryKey: ["announcements-active-popup", page],
    queryFn: async () => (await api.get("/announcements/active", { params: { page } })).data.announcements,
  });

  function isDismissed(id) {
    return sessionStorage.getItem(dismissKey(id)) === "1";
  }
  function dismiss(id) {
    sessionStorage.setItem(dismissKey(id), "1");
    bump((n) => n + 1);
  }

  // HERO primero, TOP_BAR después — nunca dos al mismo tiempo (ver brief).
  const ordered = [...(data ?? [])].sort((a, b) => (a.position === "HERO" ? 0 : 1) - (b.position === "HERO" ? 0 : 1));
  const current = ordered.find((a) => !isDismissed(a.id));

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 animate-overlay-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss(current.id);
      }}
    >
      <div className="relative w-full max-w-[420px] overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl animate-fade-up">
        <button
          onClick={() => dismiss(current.id)}
          aria-label="Cerrar aviso"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
        >
          <X className="h-4 w-4" />
        </button>
        {current.imageUrl && (
          <img src={`${api.defaults.baseURL}${current.imageUrl}`} alt="" className="h-[200px] w-full object-cover" />
        )}
        <div className="p-6">
          <h2 className="mb-1.5 font-display text-[19px] font-bold text-on-surface">{current.title}</h2>
          {current.body && <p className="text-[13.5px] leading-relaxed text-on-surface-variant">{current.body}</p>}
        </div>
      </div>
    </div>
  );
}
