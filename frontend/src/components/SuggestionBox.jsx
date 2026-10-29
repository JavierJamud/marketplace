import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "../lib/toast.jsx";
import { Lightbulb } from "lucide-react";
import { api } from "../lib/api.js";
import { usePlatformSettings } from "../lib/usePlatformSettings.js";
import { Button } from "./ui/Button.jsx";

// Buzón de sugerencias (Bloque 12). Hoy solo lo monta CustomerPanel.jsx: estaba también al final de VendorSettings.jsx y
// se perdió en una reescritura grande de esa página (commit 65a6b57; el import suelto se borró después, en 4e74aa3), aunque
// el backend sigue aceptando VENDOR y el admin las filtra por "Vendedores". Sirve tal cual para el panel de la tienda:
// authorType lo decide el backend a partir del role real del JWT, acá no se manda nada que lo identifique. Ojo: la ruta
// solo deja pasar VENDOR y CUSTOMER, así que en el panel de la tienda va solo para el dueño, no para VENDOR_STAFF.
// Mismo tope que SUGGESTION_MAX en suggestions.routes.js: el campo no deja escribir más de lo que el servidor acepta.
const SUGGESTION_MAX = 2000;
const SUGGESTION_MIN = 5;

export function SuggestionBox() {
  const { siteName } = usePlatformSettings();
  const [message, setMessage] = useState("");
  const titleId = useId();
  const hintId = useId();

  const submit = useMutation({
    mutationFn: async () => (await api.post("/suggestions", { message })).data,
    onSuccess: () => {
      toast.success(`¡Gracias! Tu sugerencia llegó al equipo de ${siteName}.`);
      setMessage("");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar la sugerencia."),
  });

  return (
    <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
      <div className="mb-1 flex items-center gap-2">
        <Lightbulb className="h-[18px] w-[18px] text-secondary" />
        <div id={titleId} className="text-[15px] font-bold text-on-surface">Sugerencias para {siteName}</div>
      </div>
      <p id={hintId} className="mb-3.5 text-[12.5px] text-outline">¿Algo que podríamos mejorar? Cuéntanos, lo lee el equipo de {siteName}.</p>
      {/* El título y la ayuda nombran el campo (antes solo tenía el placeholder, que el lector de pantalla no siempre lee).
          Foco con anillo, como Input.jsx: el borde de 1px solo cambiando de color se veía poco. */}
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={SUGGESTION_MAX}
        aria-labelledby={titleId}
        aria-describedby={hintId}
        placeholder="Escribe tu idea o mejora aquí..."
        className="mb-3.5 min-h-[90px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest px-3.5 py-3 text-body-md outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container"
      />
      <Button onClick={() => submit.mutate()} disabled={submit.isPending || message.trim().length < SUGGESTION_MIN}>
        {submit.isPending ? "Enviando..." : "Enviar sugerencia"}
      </Button>
    </div>
  );
}
