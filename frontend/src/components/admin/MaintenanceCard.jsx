import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { ConfirmModal } from "../ConfirmModal.jsx";

// Modo mantenimiento del sitio (Admin > Configuración > General). Tres opciones:
// - Desactivado: el sitio funciona con normalidad.
// - Solo la página principal: la portada muestra el aviso y todo lo demás (tiendas, productos y sus enlaces) sigue disponible.
// - Todo el sitio: los visitantes, compradores y vendedores solo ven el aviso. El admin sigue entrando por /admin/ingresar.
const OPTIONS = [
  { value: "OFF", label: "Desactivado", description: "El sitio funciona con normalidad." },
  { value: "HOME", label: "Solo la página principal", description: "La portada muestra el aviso. Las tiendas, los productos y sus enlaces siguen disponibles." },
  { value: "FULL", label: "Todo el sitio", description: "Nadie puede usar el sitio: compradores, vendedores y tiendas ven solo el aviso. Tú sigues entrando por /admin/ingresar." },
];

export function MaintenanceCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["maintenance"],
    queryFn: async () => (await api.get("/settings/maintenance")).data,
    staleTime: 10 * 1000,
  });
  const [mode, setMode] = useState("OFF");
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (data) {
      setMode(data.mode);
      setMessage(data.customMessage ?? "");
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => (await api.patch("/admin/settings/maintenance", { mode, message: message.trim() })).data,
    onSuccess: (saved) => {
      setConfirming(false);
      queryClient.setQueryData(["maintenance"], saved);
      toast.success(saved.mode === "OFF" ? "Mantenimiento desactivado: el sitio vuelve a estar disponible." : "Modo mantenimiento activado.");
    },
    onError: (err) => {
      setConfirming(false);
      if (!err.actionCodeCancelled) toast.error(err.response?.data?.error ?? "No se pudo guardar el modo mantenimiento.");
    },
  });

  const active = data && data.mode !== "OFF";
  const dirty = data && (mode !== data.mode || message.trim() !== (data.customMessage ?? "").trim());
  const current = OPTIONS.find((o) => o.value === data?.mode);

  return (
    <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[14px] font-bold text-on-surface">
        <Wrench className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> Modo mantenimiento
        {data && (
          <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${active ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-high text-on-surface-variant"}`}>
            {active ? `Activo: ${current?.label.toLowerCase()}` : "Desactivado"}
          </span>
        )}
      </div>
      <p className="mb-4 text-[12.5px] text-outline">Muestra un aviso a los visitantes mientras actualizas o arreglas algo. Tú, como administrador, siempre puedes entrar.</p>

      <div role="radiogroup" aria-label="Modo mantenimiento" className="flex flex-col gap-2">
        {OPTIONS.map((o) => (
          <label key={o.value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 ${mode === o.value ? "border-tertiary-accent bg-tertiary-accent/5" : "border-surface-container-high hover:bg-surface-container"}`}>
            <input type="radio" name="maintenance-mode" value={o.value} checked={mode === o.value} onChange={() => setMode(o.value)} className="mt-1 h-4 w-4 accent-[#337475]" />
            <span className="min-w-0">
              <span className="block text-[13.5px] font-bold text-on-surface">{o.label}</span>
              <span className="block text-[12.5px] leading-[18px] text-on-surface-variant">{o.description}</span>
            </span>
          </label>
        ))}
      </div>

      <label className="mt-4 block">
        <span className="mb-1 block text-label-md text-on-surface-variant">Mensaje para los visitantes (opcional)</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={300}
          rows={2}
          placeholder="Estamos mejorando el sitio. Volvemos muy pronto."
          className="w-full resize-none rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[13.5px] outline-none focus:border-tertiary-accent"
        />
        <span className="mt-0.5 block text-right text-[11px] text-outline">{message.length}/300</span>
      </label>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => (mode === "OFF" ? save.mutate() : setConfirming(true))}
          disabled={!dirty || save.isPending}
          className="min-h-11 rounded-xl bg-primary-container px-6 text-[13.5px] font-bold text-white hover:brightness-110 disabled:opacity-45"
        >
          {save.isPending ? "Guardando..." : "Guardar"}
        </button>
      </div>

      <ConfirmModal
        open={confirming}
        title={mode === "FULL" ? "¿Poner todo el sitio en mantenimiento?" : "¿Poner la página principal en mantenimiento?"}
        message={
          mode === "FULL"
            ? "Compradores, vendedores y tiendas dejarán de poder usar el sitio hasta que lo desactives. Los pedidos y pagos en curso no se podrán completar mientras tanto."
            : "La portada mostrará el aviso. Las tiendas, los productos y sus enlaces seguirán disponibles."
        }
        confirmLabel={save.isPending ? "Activando..." : "Activar mantenimiento"}
        danger={mode === "FULL"}
        onConfirm={() => save.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
