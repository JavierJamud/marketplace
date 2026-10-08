import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, MessageSquareText, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import BusinessAssistantPanel from "./BusinessAssistantPanel.jsx";

// Bloque 259 (pedido explícito — "en vez de una sección, un botón de chat
// flotante del asistente de negocio, en todas las pantallas de los paneles"):
// el asistente deja de ser una página del menú y pasa a ser un botón flotante
// montado en AdminLayout y VendorLayout, visible en TODAS las pantallas de esos
// paneles. En celular el chat abre a pantalla completa (hoja); en pantallas
// grandes, como una ventana flotante sobre el botón.
//
// Bloque 260 (pedido explícito — botón "así" como la referencia, pero con los
// colores de la página): el botón pasa de círculo a píldora con el icono en un
// círculo azul marino con el chat en naranja, y el nombre al lado. La cabecera
// del chat (título, historial, chat nuevo, cerrar) ahora vive en el propio
// panel, que solo se monta al abrir.
export function BusinessAssistantWidget({ endpoint, quickPrompts, quickPromptsFree, intro = "Conectado a tu negocio, solo lectura", isAdmin = false }) {
  // Bloque 280 (pedido explícito): si todas las IA están en su límite gratis, el
  // asistente se oculta también en los paneles (mismo dato que usa la tienda).
  const { data: siteSettings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null);
  const toggleRef = useRef(null);
  // Bloque 262: tras la primera apertura el chat se queda montado (solo oculto), así
  // una respuesta en curso no se pierde al cerrarlo; el panel se sincroniza con el
  // servidor cada vez que se vuelve a abrir.
  const [mounted, setMounted] = useState(false);
  // Bloque 265: en escritorio la ventana crece con la pantalla y se puede ampliar más
  // (tablas y listas largas); en celular siempre es la hoja a pantalla completa.
  const [wide, setWide] = useState(() => {
    try {
      return localStorage.getItem("assistant-wide") === "1";
    } catch {
      return false;
    }
  });
  function toggleWide() {
    setWide((v) => {
      try {
        localStorage.setItem("assistant-wide", v ? "0" : "1");
      } catch {
        /* sin almacenamiento: solo dura esta visita */
      }
      return !v;
    });
  }
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Escape cierra, y en celular (hoja a pantalla completa) se bloquea el scroll
  // de la página de atrás mientras está abierto.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    // Bloque 276 (pedido explícito — "si tengo el chat abierto y hago clic fuera, debe cerrarse"):
    // un clic o toque fuera de la ventana la cierra. No cuentan el propio botón (que ya alterna) ni
    // los diálogos modales abiertos encima (p. ej. el código de confirmación del admin).
    function onPointerDown(e) {
      const target = e.target;
      if (dialogRef.current?.contains(target) || toggleRef.current?.contains(target)) return;
      if (target.closest?.('[aria-modal="true"]')) return;
      setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    const previous = document.body.style.overflow;
    if (window.matchMedia("(max-width: 639px)").matches) document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Sin ningún modelo disponible el asistente se oculta para vendedores. El admin no lo pierde
  // de vista: en su lugar ve un aviso que lleva a Integraciones.
  if (siteSettings?.chatbotAvailable === false && !open) {
    if (!isAdmin) return null;
    return (
      <Link
        to="/admin/configuracion?tab=integraciones"
        className="fixed bottom-4 right-4 z-[60] flex min-h-11 items-center gap-2 rounded-full border border-error/40 bg-surface-container-lowest px-4 py-2 text-[13px] font-bold text-error shadow-[0_10px_28px_-8px_rgba(14,26,40,0.38)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent sm:bottom-6 sm:right-6"
      >
        <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        La IA no tiene ningún modelo disponible. Revisar integraciones
      </Link>
    );
  }

  return (
    <>
      {mounted && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-label="Asistente de negocio"
          hidden={!open}
          className={`${open ? "flex" : "hidden"} fixed inset-0 z-[70] flex-col overflow-hidden bg-surface-container-lowest sm:inset-auto sm:bottom-24 sm:right-6 sm:max-w-[calc(100vw-3rem)] sm:rounded-3xl sm:transition-[width,height] sm:duration-200 ${wide ? "sm:h-[min(820px,calc(100dvh-7.5rem))] sm:w-[min(920px,calc(100vw-3rem))]" : "sm:h-[min(700px,calc(100dvh-7.5rem))] sm:w-[440px] lg:w-[560px] 2xl:w-[620px]"} sm:border sm:border-surface-container-high sm:shadow-[0_24px_60px_-12px_rgba(14,26,40,0.4)]`}
        >
          <BusinessAssistantPanel
            endpoint={endpoint}
            quickPrompts={quickPrompts}
            quickPromptsFree={quickPromptsFree}
            intro={intro}
            embedded
            isOpen={open}
            wide={wide}
            onToggleWide={toggleWide}
            onNavigate={() => setOpen(false)}
            onClose={() => setOpen(false)}
            friendlyErrors={!isAdmin}
          />
        </div>
      )}

      {/* En celular el botón se oculta mientras la hoja está abierta (la hoja ya
          trae su propio botón de cerrar). */}
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Cerrar el asistente de negocio" : "Abrir el asistente de negocio"}
        aria-expanded={open}
        className={`group fixed bottom-4 right-4 z-[60] flex h-14 items-center gap-2.5 rounded-full border border-surface-container-high bg-surface-container-lowest py-1.5 pl-1.5 pr-5 text-on-surface shadow-[0_10px_28px_-8px_rgba(14,26,40,0.38)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-8px_rgba(14,26,40,0.45)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent sm:bottom-6 sm:right-6 ${
          open ? "max-sm:hidden" : ""
        }`}
      >
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-primary text-secondary-container">
          {open ? <X className="h-5 w-5" aria-hidden="true" /> : <MessageSquareText className="h-5 w-5" aria-hidden="true" />}
        </span>
        <span className="text-[14px] font-bold leading-none">
          {open ? (
            "Cerrar"
          ) : (
            <>
              <span className="sm:hidden">Asistente</span>
              <span className="hidden sm:inline">Asistente de negocio</span>
            </>
          )}
        </span>
      </button>
    </>
  );
}
