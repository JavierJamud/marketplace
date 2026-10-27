import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ReceiptText } from "lucide-react";
import { api } from "../../lib/api.js";
import { CARD } from "../dashboard/DashboardCard.jsx";

// "Tengo el código del pedido": lleva directo a la tienda con el pedido abierto (/admin/tiendas/:id?tab=pedidos&pedido=),
// sin saber antes de qué tienda es. Con un código incompleto muestra los que coinciden para elegir.
export function OrderLookup({ className = "" }) {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [state, setState] = useState({ status: "idle", matches: [] });

  const open = (m) => navigate(`/admin/tiendas/${m.vendorId}?tab=pedidos&pedido=${m.id}`);

  async function onSubmit(e) {
    e.preventDefault();
    const value = code.trim();
    if (value.length < 3) {
      setState({ status: "short", matches: [] });
      return;
    }
    setState({ status: "loading", matches: [] });
    try {
      const { matches } = (await api.get("/admin/orders/lookup", { params: { code: value } })).data;
      if (matches.length === 1) {
        setState({ status: "idle", matches: [] });
        open(matches[0]);
      } else {
        setState({ status: matches.length ? "many" : "none", matches });
      }
    } catch {
      setState({ status: "error", matches: [] });
    }
  }

  return (
    <div className={`${CARD} p-3 sm:p-4 ${className}`}>
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="order-lookup" className="mb-1 flex items-center gap-1.5 text-[12.5px] font-bold text-on-surface">
            <ReceiptText className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> Buscar un pedido por su código
          </label>
          <input
            id="order-lookup"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Ej.: Z-MFX3K2AB"
            autoComplete="off"
            className="h-11 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 font-mono text-[13px] uppercase outline-none placeholder:normal-case focus:border-tertiary-accent md:h-10"
          />
        </div>
        <button
          type="submit"
          disabled={state.status === "loading"}
          className="h-11 rounded-xl bg-primary px-4 text-[13px] font-bold text-on-primary hover:opacity-90 disabled:opacity-60 md:h-10"
        >
          {state.status === "loading" ? "Buscando..." : "Abrir pedido"}
        </button>
      </form>
      <div aria-live="polite">
        {state.status === "short" && <p className="mt-2 text-[12.5px] text-on-surface-variant">Escribe al menos 3 caracteres del código.</p>}
        {state.status === "none" && <p className="mt-2 text-[12.5px] text-on-surface-variant">No hay ningún pedido con ese código.</p>}
        {state.status === "error" && <p className="mt-2 text-[12.5px] text-error">No se pudo buscar. Prueba otra vez.</p>}
        {state.status === "many" && (
          <ul className="mt-2 divide-y divide-surface-container">
            {state.matches.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => open(m)} className="flex min-h-11 w-full items-center justify-between gap-3 py-1.5 text-left text-[13px] hover:bg-surface-container/50">
                  <span className="font-mono font-bold text-on-surface">{m.code}</span>
                  <span className="truncate text-on-surface-variant">{m.vendor.companyName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
