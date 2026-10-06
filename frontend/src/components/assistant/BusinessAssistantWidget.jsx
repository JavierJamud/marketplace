import { useEffect, useState } from "react";
import { MessageSquareText, X } from "lucide-react";
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
export function BusinessAssistantWidget({ endpoint, quickPrompts, quickPromptsFree, intro = "Conectado a tu negocio, solo lectura" }) {
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
          className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-surface-container-lowest sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(660px,calc(100dvh-7.5rem))] sm:w-[410px] sm:rounded-3xl sm:border sm:border-surface-container-high sm:shadow-[0_24px_60px_-12px_rgba(14,26,40,0.4)]"
        >
          <BusinessAssistantPanel
            endpoint={endpoint}
            quickPrompts={quickPrompts}
            quickPromptsFree={quickPromptsFree}
            intro={intro}
            embedded
            onNavigate={() => setOpen(false)}
            onClose={() => setOpen(false)}
          />
        </div>
      )}

      {/* En celular el botón se oculta mientras la hoja está abierta (la hoja ya
          trae su propio botón de cerrar). */}
      <button
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
