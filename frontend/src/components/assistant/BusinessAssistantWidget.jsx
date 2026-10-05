import { useEffect, useState } from "react";
import { MessageSquareText, X } from "lucide-react";
import BusinessAssistantPanel from "./BusinessAssistantPanel.jsx";

// Bloque 259 (pedido explícito — "en vez de una sección, un botón de chat
// flotante del asistente de negocio, en todas las pantallas de los paneles"):
// el asistente deja de ser una página del menú y pasa a ser un botón flotante
// montado en AdminLayout y VendorLayout, visible en TODAS las pantallas de esos
// paneles. En celular el chat abre a pantalla completa (hoja); en pantallas
// grandes, como una ventana flotante sobre el botón. El contenido (chat,
// historial, enlaces "Ir a ...") es BusinessAssistantPanel, que solo se monta
// al abrir.
export function BusinessAssistantWidget({ endpoint, quickPrompts, quickPromptsFree, intro = "Solo lectura: no cambia nada por su cuenta." }) {
  const [open, setOpen] = useState(false);

  // Escape cierra, y en celular (hoja a pantalla completa) se bloquea el scroll
  // de la página de atrás mientras está abierto.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    if (window.matchMedia("(max-width: 639px)").matches) document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="Asistente de negocio"
          className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-surface-container-lowest sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(640px,calc(100dvh-7.5rem))] sm:w-[400px] sm:rounded-2xl sm:border sm:border-surface-container-high sm:shadow-[0_24px_60px_-12px_rgba(15,23,42,0.35)]"
        >
          <div className="flex items-center justify-between gap-3 bg-primary px-4 py-2 text-white">
            <div className="flex items-center gap-2.5">
              <MessageSquareText className="h-5 w-5" aria-hidden="true" />
              <span className="text-[15px] font-bold">Asistente de negocio</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar el asistente"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-white/85 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <BusinessAssistantPanel endpoint={endpoint} quickPrompts={quickPrompts} quickPromptsFree={quickPromptsFree} intro={intro} embedded onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      {/* En celular el botón se oculta mientras la hoja está abierta (la hoja ya
          trae su propio botón de cerrar). */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Cerrar el asistente de negocio" : "Abrir el asistente de negocio"}
        aria-expanded={open}
        className={`fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-[0_10px_30px_-6px_rgba(0,0,0,0.5)] transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-container sm:bottom-6 sm:right-6 ${
          open ? "max-sm:hidden" : ""
        }`}
      >
        {open ? <X className="h-6 w-6" aria-hidden="true" /> : <MessageSquareText className="h-6 w-6" aria-hidden="true" />}
      </button>
    </>
  );
}
