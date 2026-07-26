import { useEffect } from "react";
import { X } from "lucide-react";

// Bloque 52: lightbox simple para abrir en tamaño completo una foto de
// reseña — sin flechas de navegación ni zoom, solo mostrar/cerrar (alcanza
// para el alcance pedido).
export function Lightbox({ src, onClose }) {
  useEffect(() => {
    if (!src) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button onClick={onClose} className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
        <X className="h-5 w-5" />
      </button>
      <img src={src} alt="" className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl" />
    </div>
  );
}
