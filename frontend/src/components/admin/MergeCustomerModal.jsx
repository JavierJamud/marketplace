import { useState } from "react";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Store } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.jsx";
import { SearchField } from "./ListControls.jsx";
import { Spinner } from "../ui/Spinner.jsx";
import { useDebouncedSearch } from "../../lib/useListParams.js";

// "Unir con su tienda": para quien se registró como cliente y después abrió su tienda con otra cuenta (antes de que cliente y
// tienda fueran la misma cuenta). Sus compras pasan a la cuenta de la tienda y esta cuenta de cliente se elimina (backend:
// lib/accountMerge.js). Arriba van las cuentas de tienda que parecen suyas; si no está, se busca por correo, nombre o tienda.
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function MergeCustomerModal({ customer, onClose }) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [searchText, setSearchText] = useDebouncedSearch(q, setQ);
  const [targetId, setTargetId] = useState(null);

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ["admin-customer-merge", customer.id, q],
    queryFn: async () => (await api.get(`/admin/customers/${customer.id}/merge`, { params: q.length >= 2 ? { q } : {} })).data,
    placeholderData: keepPreviousData,
  });

  const merge = useMutation({
    mutationFn: async () => (await api.post(`/admin/customers/${customer.id}/merge`, { targetUserId: targetId })).data,
    onSuccess: (res) => {
      toast.success("Cuentas unidas", `${customer.fullName ?? "El cliente"} ya entra con ${res.target.email} para comprar y vender.`);
      queryClient.invalidateQueries({ queryKey: ["admin-list-customers"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudieron unir las cuentas."),
  });

  const s = data?.summary;
  const moving = s
    ? [
        s.orders && plural(s.orders, "pedido", "pedidos"),
        s.loyaltyPoints && `${s.loyaltyPoints.toLocaleString("es-CU")} puntos`,
        s.favorites && plural(s.favorites, "favorito", "favoritos"),
        s.addresses && plural(s.addresses, "dirección", "direcciones"),
        s.reviews && plural(s.reviews, "reseña", "reseñas"),
        s.listings && plural(s.listings, "anuncio", "anuncios"),
      ].filter(Boolean)
    : [];
  // Sugeridas primero; las encontradas por búsqueda que no estén ya arriba, después.
  const suggestedIds = new Set((data?.suggested ?? []).map((u) => u.id));
  const options = [...(data?.suggested ?? []).map((u) => ({ ...u, suggested: true })), ...(data?.found ?? []).filter((u) => !suggestedIds.has(u.id))];
  const chosen = options.find((o) => o.id === targetId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !merge.isPending && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="merge-title" className="modal-panel-6 w-full max-w-md rounded-xl bg-surface-container-lowest p-6" onClick={(e) => e.stopPropagation()}>
        <h2 id="merge-title" className="mb-1 text-title-lg font-bold text-on-surface">Unir con su tienda</h2>
        <p className="mb-4 text-[13.5px] leading-relaxed text-on-surface-variant">
          Para quien abrió su tienda con otra cuenta. Lo que <strong>{customer.fullName ?? customer.email}</strong> tiene como cliente pasa a la cuenta de su tienda, y
          esta cuenta de cliente se elimina. Después entra con el correo de su tienda para comprar y vender.
        </p>

        <div className="mb-4 rounded-xl bg-surface-container/60 p-3 text-[13px] text-on-surface">
          {isLoading ? "Revisando lo que tiene esta cuenta..." : moving.length ? <>Se mueve: {moving.join(" · ")}.</> : "Esta cuenta no tiene compras, puntos ni favoritos: solo se elimina."}
        </div>

        <p className="mb-2 text-label-md font-semibold text-on-surface">¿Cuál es la cuenta de su tienda?</p>
        <SearchField value={searchText} onChange={setSearchText} placeholder="Correo, nombre o tienda" className="mb-3" />

        {isError && <p className="mb-3 text-[13px] text-error">No se pudo cargar la información. Cierra y vuelve a intentarlo.</p>}
        <div className={`space-y-2 transition-opacity ${isFetching && !isLoading ? "opacity-70" : ""}`}>
          {!isLoading && options.length === 0 && (
            <p className="rounded-xl border border-dashed border-outline-variant p-3 text-center text-[13px] text-on-surface-variant">
              {q.length >= 2 ? "Ninguna tienda coincide con esa búsqueda." : "No encontramos una tienda con su mismo teléfono, nombre o correo. Búscala arriba."}
            </p>
          )}
          {options.map((o) => {
            const selected = o.id === targetId;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setTargetId(o.id)}
                aria-pressed={selected}
                className={`flex min-h-11 w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent ${
                  selected ? "border-tertiary-accent bg-tertiary-accent/5" : "border-outline-variant hover:bg-surface-container"
                }`}
              >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent/10 text-tertiary-accent">
                  <Store className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13.5px] font-semibold text-on-surface">{o.vendor?.companyName}</span>
                    {o.suggested && <span className="flex-shrink-0 rounded-full bg-tertiary-accent/10 px-1.5 py-0.5 text-[10px] font-bold text-tertiary-accent">Parece suya</span>}
                  </span>
                  <span className="block truncate text-[12px] text-on-surface-variant">{[o.email, o.vendor?.whatsapp ?? o.phone].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            );
          })}
        </div>

        {chosen && (
          <p className="mt-3 text-[12.5px] text-on-surface-variant">
            Se eliminará la cuenta <strong>{customer.email}</strong> y sus compras quedarán en <strong>{chosen.email}</strong>. No se puede deshacer.
          </p>
        )}

        <div className="mt-5 flex gap-2.5">
          <button type="button" onClick={onClose} disabled={merge.isPending} className="min-h-11 flex-1 rounded-full border border-outline-variant py-2.5 text-label-md font-semibold text-on-surface-variant">
            Cancelar
          </button>
          <Button className="min-h-11 flex-1" onClick={() => merge.mutate()} disabled={!targetId || merge.isPending}>
            {merge.isPending ? (<><Spinner className="text-white" /> Uniendo...</>) : "Unir cuentas"}
          </Button>
        </div>
      </div>
    </div>
  );
}
