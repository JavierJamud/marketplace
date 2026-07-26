import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Lightbulb } from "lucide-react";
import { api } from "../lib/api.js";
import { usePlatformSettings } from "../lib/usePlatformSettings.js";
import { Button } from "./ui/Button.jsx";

// Buzón de sugerencias (Bloque 12) — usado tanto en VendorSettings.jsx como
// en CustomerPanel.jsx. authorType lo decide el backend a partir del role
// real del JWT, acá no se manda nada que lo identifique.
export function SuggestionBox() {
  const { siteName } = usePlatformSettings();
  const [message, setMessage] = useState("");

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
        <div className="text-[15px] font-bold text-on-surface">Sugerencias para {siteName}</div>
      </div>
      <p className="mb-3.5 text-[12.5px] text-outline">¿Algo que podríamos mejorar? Contanos, lo lee el equipo de {siteName}.</p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Escribe tu idea o mejora acá..."
        className="mb-3.5 min-h-[90px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest px-3.5 py-3 text-body-md outline-none focus:border-primary-container"
      />
      <Button onClick={() => submit.mutate()} disabled={submit.isPending || message.trim().length < 5}>
        {submit.isPending ? "Enviando..." : "Enviar sugerencia"}
      </Button>
    </div>
  );
}
