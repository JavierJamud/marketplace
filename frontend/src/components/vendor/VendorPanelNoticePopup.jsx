import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.jsx";

// Aviso que el admin publica para las tiendas (Admin > Avisos a tiendas). Sale al dueño al entrar a su panel, uno a la vez,
// dentro de las fechas del aviso y como mucho las veces que el admin eligió: cada sesión del navegador cuenta una vez.
// El HTML llega ya limpio desde el servidor (DOMPurify al guardar).

const sessionKey = (id) => `baznova_panel_notice_${id}`;

function readSession(id) {
  try {
    return sessionStorage.getItem(sessionKey(id));
  } catch {
    return null;
  }
}
function writeSession(id, value) {
  try {
    sessionStorage.setItem(sessionKey(id), value);
  } catch {
    /* sin almacenamiento: se cuenta igual en el servidor */
  }
}

export function VendorPanelNoticePopup({ enabled }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [closed, setClosed] = useState(null);
  const counted = useRef(null);

  const { data: notice } = useQuery({
    queryKey: ["vendor-panel-notice"],
    queryFn: async () => (await api.get("/vendor-notices/active")).data.notice,
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  // Espera a que el panel termine de cargar y a que no haya otra ventana abierta (pedido nuevo, oferta de prueba...):
  // nunca dos ventanas una encima de otra. Lo urgente sale primero y este aviso después.
  useEffect(() => {
    if (!notice || ready) return undefined;
    let calm = 0;
    const id = setInterval(() => {
      calm = document.querySelector('[role="dialog"]') ? 0 : calm + 1;
      if (calm >= 2) setReady(true);
    }, 800);
    return () => clearInterval(id);
  }, [notice, ready]);

  // En esta sesión ya se mostró y se cerró: no vuelve hasta la próxima vez que entre.
  const visible = Boolean(enabled && ready && notice && closed !== notice.id && readSession(notice.id) !== "closed");

  useEffect(() => {
    if (!visible || counted.current === notice.id || readSession(notice.id)) return;
    counted.current = notice.id;
    writeSession(notice.id, "shown");
    api.post(`/vendor-notices/${notice.id}/shown`).catch(() => {});
  }, [visible, notice]);

  if (!visible) return null;

  const close = () => {
    writeSession(notice.id, "closed");
    setClosed(notice.id);
  };
  const done = () => {
    close();
    api.post(`/vendor-notices/${notice.id}/done`).catch(() => {});
    queryClient.removeQueries({ queryKey: ["vendor-panel-notice"] });
  };
  const goCta = () => {
    done();
    if (notice.ctaUrl.startsWith("/")) navigate(notice.ctaUrl);
    else window.open(notice.ctaUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className="fixed inset-0 z-[78] flex items-center justify-center bg-black/55 p-4 animate-overlay-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="panel-notice-title"
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[460px] flex-col overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl animate-fade-up"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Cerrar aviso"
          className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-2 pt-6">
          <h2 id="panel-notice-title" className="mb-2 pr-10 font-display text-[19px] font-bold leading-snug text-on-surface">{notice.title}</h2>
          <div className="prose-static break-words text-[14px] [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-xl" dangerouslySetInnerHTML={{ __html: notice.html }} />
        </div>
        <div className="flex flex-col gap-2 border-t border-surface-container-high px-6 py-4 sm:flex-row-reverse sm:items-center">
          {notice.ctaLabel && notice.ctaUrl ? (
            <Button className="w-full sm:w-auto" onClick={goCta}>{notice.ctaLabel}</Button>
          ) : (
            <Button className="w-full sm:w-auto" onClick={close}>Entendido</Button>
          )}
          <button type="button" onClick={done} className="min-h-11 px-2 text-label-md font-semibold text-on-surface-variant hover:text-on-surface sm:mr-auto">
            No volver a mostrar
          </button>
        </div>
      </div>
    </div>
  );
}
