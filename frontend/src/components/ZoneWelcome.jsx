import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { MapPin, X } from "lucide-react";
import { useZone, DECIDED_KEY as SEEN_KEY } from "../context/LocationContext.jsx";
import { useFlow } from "../context/FlowContext.jsx";
import { ZoneDialog } from "./ZonePicker.jsx";

// Al cargar la portada, el catálogo, las tiendas o las ventas rápidas se pregunta el lugar de entrega o recogida mientras el
// visitante no haya decidido (elegir un lugar o "ver todo" se guarda y deja de preguntarse). La página ya está a la vista, con
// todo, detrás de la ventana. Si tiene un lugar elegido, cada cierto tiempo se le avisa que lo que ve depende de ese lugar y cómo
// cambiarlo o quitarlo, pero solo después de que terminó la secuencia de bienvenida (cookies aceptadas).
const NOTICE_KEY = "zeudin_loc_notice";
const REMIND_MS = 24 * 60 * 60 * 1000;
const PAGES = new Set(["/", "/catalogo", "/tiendas", "/ventas-rapidas"]);

const read = (k) => {
  try {
    return Number(localStorage.getItem(k)) || 0;
  } catch {
    return 0;
  }
};
const write = (k) => {
  try {
    localStorage.setItem(k, String(Date.now()));
  } catch {
    /* sin almacenamiento */
  }
};

export function ZoneWelcome() {
  const { pathname } = useLocation();
  const { loading, countries, hasZoneFilter, zoneLabel, clearFilter, decided, decide } = useZone();
  const { zoneStagePending, canShowPopups } = useFlow();
  const [askOpen, setAskOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const onListingPage = PAGES.has(pathname);

  // Se pregunta apenas se conoce la lista de lugares con tiendas, con un instante para que la página ya se vea detrás.
  useEffect(() => {
    if (loading || !onListingPage || countries.length === 0 || decided) return undefined;
    const id = setTimeout(() => setAskOpen(true), 500);
    return () => clearTimeout(id);
  }, [loading, onListingPage, countries.length, decided]);

  // Recordatorio: con un lugar elegido, una vez al día como máximo y solo cuando ya no hay nada más pendiente.
  useEffect(() => {
    if (loading || !onListingPage || !hasZoneFilter || askOpen || zoneStagePending || !canShowPopups) return undefined;
    const last = Math.max(read(SEEN_KEY), read(NOTICE_KEY));
    if (!last || Date.now() - last < REMIND_MS) return undefined;
    const id = setTimeout(() => {
      write(NOTICE_KEY);
      setNoticeOpen(true);
    }, 2500);
    return () => clearTimeout(id);
  }, [loading, onListingPage, hasZoneFilter, askOpen, zoneStagePending, canShowPopups]);

  const closeAsk = () => {
    decide();
    setAskOpen(false);
  };

  return (
    <>
      {askOpen && <ZoneDialog welcome onClose={closeAsk} />}
      {changeOpen && <ZoneDialog onClose={() => setChangeOpen(false)} />}
      {noticeOpen && hasZoneFilter && onListingPage && (
        <div role="status" className="fixed inset-x-3 bottom-3 z-[55] mx-auto max-w-md rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 shadow-[0_18px_44px_-12px_rgba(14,26,40,0.45)] sm:inset-x-auto sm:bottom-6 sm:left-6 sm:mx-0">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent/10 text-tertiary-accent" aria-hidden="true">
              <MapPin className="h-[18px] w-[18px]" />
            </span>
            <p className="min-w-0 flex-1 text-[13px] text-on-surface-variant">
              Los productos y tiendas que ves son de <strong className="text-on-surface">{zoneLabel}</strong>, tu lugar de entrega o recogida. Para ver otros, cambia el lugar o quita el filtro.
            </p>
            <button type="button" onClick={() => setNoticeOpen(false)} aria-label="Cerrar aviso" className="-mr-2 -mt-2 flex h-11 w-11 flex-shrink-0 items-center justify-center text-outline hover:text-on-surface">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setNoticeOpen(false);
                setChangeOpen(true);
              }}
              className="min-h-11 rounded-xl bg-secondary text-[13px] font-bold text-white hover:brightness-95"
            >
              Cambiar lugar
            </button>
            <button
              type="button"
              onClick={() => {
                clearFilter();
                setNoticeOpen(false);
              }}
              className="min-h-11 rounded-xl border border-outline-variant text-[13px] font-bold text-on-surface-variant hover:bg-surface-container"
            >
              Ver todo
            </button>
          </div>
        </div>
      )}
    </>
  );
}
