import { useMutation } from "@tanstack/react-query";
import toast from "../lib/toast.jsx";
import { Sparkles } from "lucide-react";
import { api } from "../lib/api.js";

// Único punto de uso de IA en el proyecto (Bloque 13). Un solo click: toma
// el texto que el vendedor ya escribió en la descripción + el contexto de
// su tienda (y del producto, si aplica — resuelto server-side) y lo mejora
// automáticamente, sin pedir un prompt aparte. Nunca guarda nada solo — el
// vendedor siempre puede seguir editando antes de confirmar el "Guardar".
// Necesita un mínimo de texto ya escrito: la IA no puede inventar de la
// nada qué es el producto/tienda.
export function AiGenerateButton({ kind, currentText, productName, onGenerated }) {
  const hasEnoughText = (currentText ?? "").trim().length >= 5;

  const generate = useMutation({
    mutationFn: async () => (await api.post("/ai/generate-description", { kind, currentText, productName })).data,
    onSuccess: (data) => onGenerated(data.description),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo mejorar la descripción. Intenta de nuevo."),
  });

  function handleClick() {
    if (!hasEnoughText) {
      toast.error("Escribe primero una breve descripción para que la IA la pueda mejorar.");
      return;
    }
    generate.mutate();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={generate.isPending}
      title={!hasEnoughText ? "Escribe primero una breve descripción" : undefined}
      className={`mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold hover:underline disabled:cursor-not-allowed disabled:opacity-60 ${
        hasEnoughText ? "text-tertiary-accent" : "text-outline"
      }`}
    >
      <Sparkles className="h-3.5 w-3.5" /> {generate.isPending ? "Mejorando..." : "Mejorar con IA"}
    </button>
  );
}
