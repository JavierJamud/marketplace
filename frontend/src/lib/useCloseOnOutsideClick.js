import { useEffect } from "react";

// Cierra el chat flotante al tocar fuera de él. Lo de adentro (el panel) lleva data-chat-panel y el botón redondo que lo abre
// y cierra ya tiene su propio clic, así que ninguno de los dos cuenta como "afuera".
export function useCloseOnOutsideClick(open, close) {
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(e) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-chat-panel], .chat-face-btn")) return;
      // Los avisos y ventanas que se abren desde el chat (aviso de cookies, mensajes) no deben cerrarlo por tocarlos.
      if (target.closest("[role=dialog], [data-toast]")) return;
      close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);
}
