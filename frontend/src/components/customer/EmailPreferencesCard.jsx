import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import ToggleSwitch from "../admin/ToggleSwitch.jsx";

// Correos de promoción (User.marketingEmails). Cliente: recordatorios (carrito sin terminar, puntos sin usar, ofertas de
// tiendas que miró o donde compró) y campañas y ofertas de la plataforma. Tienda (audience="vendor"): las campañas y ofertas
// que la plataforma manda a las tiendas, que también traen enlace de baja. Los correos de pedidos, del plan y de la cuenta
// siempre llegan: esto apaga solo los de promoción.
export function EmailPreferencesCard({ audience = "customer" }) {
  const isVendor = audience === "vendor";
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["email-preferences"], queryFn: async () => (await api.get("/loyalty/email-preferences")).data });
  const save = useMutation({
    mutationFn: async (marketingEmails) => (await api.patch("/loyalty/email-preferences", { marketingEmails })).data,
    onSuccess: (r) => {
      queryClient.setQueryData(["email-preferences"], r);
      toast.success(r.marketingEmails ? "Recordatorios y promociones activados." : "Ya no recibirás recordatorios ni promociones por correo.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });
  const on = data?.marketingEmails !== false;

  return (
    <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-[14px] font-bold text-on-surface">
            <Mail className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> {isVendor ? "Promociones de la plataforma por correo" : "Recordatorios y promociones por correo"}
          </div>
          <p className="text-[12.5px] leading-[18px] text-outline">
            {isVendor
              ? "Novedades, campañas y ofertas que la plataforma envía a las tiendas. Los avisos de tus pedidos, de tu plan y de tu cuenta siempre llegan."
              : "Te escribimos si dejas un carrito sin terminar, si una tienda que miraste o donde compraste tiene una oferta o puntos tuyos para usar, y con las promociones de la plataforma. Los de tiendas llegan como mucho uno cada 3 días. Los correos de tus pedidos siempre llegan."}
          </p>
          {isError && <p className="mt-2 text-[12.5px] text-error">No se pudo cargar. Recarga la página.</p>}
        </div>
        <ToggleSwitch isActive={on} label={isVendor ? "Promociones de la plataforma por correo" : "Recordatorios y promociones por correo"} disabled={isLoading || isError || save.isPending} onToggle={() => save.mutate(!on)} />
      </div>
    </div>
  );
}
