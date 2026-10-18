import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Award, ChevronDown } from "lucide-react";
import { api } from "../../lib/api.js";
import { imgUrl } from "../../lib/imgUrl.js";
import { fmtAmount, fmtPoints, TX_LABEL } from "../../lib/loyalty.js";

// "Mis puntos" del panel del cliente: una fila por tienda con su saldo y lo que vale, y el historial de cada una al tocarla.
const dateText = (d) => new Date(d).toLocaleDateString("es-CU", { day: "numeric", month: "short", year: "numeric" });

function History({ vendorId }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["my-points-history", vendorId],
    queryFn: async () => (await api.get(`/loyalty/me/${vendorId}/history`)).data.transactions,
  });
  if (isLoading) return <p className="px-4 pb-3 text-[12.5px] text-on-surface-variant">Cargando...</p>;
  if (isError) return <p className="px-4 pb-3 text-[12.5px] text-error">No se pudo cargar el historial.</p>;
  if (!data?.length) return <p className="px-4 pb-3 text-[12.5px] text-on-surface-variant">Sin movimientos.</p>;
  return (
    <ul className="divide-y divide-surface-container-high border-t border-surface-container-high px-4">
      {data.map((t) => (
        <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-on-surface">{TX_LABEL[t.type] ?? t.type}{t.orderCode ? ` · ${t.orderCode}` : ""}</p>
            {t.note && <p className="text-[12px] text-on-surface-variant">{t.note}</p>}
            <p className="text-[11.5px] text-outline">{dateText(t.createdAt)}</p>
          </div>
          <p className={`flex-shrink-0 text-[13px] font-extrabold ${t.points >= 0 ? "text-verified-dark" : "text-error"}`}>
            {t.points > 0 ? "+" : ""}
            {t.points.toLocaleString("es-CU")}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function MyPoints() {
  const [open, setOpen] = useState(null);
  const { data, isLoading, isError } = useQuery({ queryKey: ["my-points"], queryFn: async () => (await api.get("/loyalty/me")).data.accounts });

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Cargando...</p>;
  if (isError) return <p className="text-body-md text-error">No se pudieron cargar tus puntos. Recarga la página.</p>;
  if (!data?.length) {
    return (
      <div className="rounded-2xl border border-dashed border-outline-variant px-5 py-10 text-center">
        <Award className="mx-auto mb-2 h-9 w-9 text-outline" strokeWidth={1.5} aria-hidden="true" />
        <p className="text-[15px] font-bold text-on-surface">Todavía no tienes puntos</p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-on-surface-variant">Algunas tiendas dan puntos por cada compra. Los ganas cuando recibes el pedido y los usas para pagar parte de la siguiente compra en esa tienda.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[13px] text-on-surface-variant">Los puntos de cada tienda solo se usan en esa tienda, al confirmar el pedido.</p>
      {data.map((a) => {
        const isOpen = open === a.vendor.id;
        const logo = a.vendor.logoUrl ? imgUrl(a.vendor.logoUrl) : null;
        return (
          <div key={a.vendor.id} className="overflow-hidden rounded-2xl border border-surface-container-high bg-surface-container-lowest">
            <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : a.vendor.id)} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-container/40">
              {logo ? (
                <img src={logo} alt="" className="h-10 w-10 flex-shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-[15px] font-extrabold text-white" style={{ background: a.vendor.color || "#337475" }}>
                  {a.vendor.name?.[0] ?? "T"}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold text-on-surface">{a.vendor.name}</span>
                <span className="block text-[12px] text-on-surface-variant">
                  {a.programActive ? `Valen ${fmtAmount(a.value, a.vendor.currency)}` : "La tienda pausó su programa: tus puntos se guardan"}
                </span>
              </span>
              <span className="flex-shrink-0 text-right">
                <span className="block text-[16px] font-extrabold text-on-surface">{a.balance.toLocaleString("es-CU")}</span>
                <span className="block text-[11px] text-outline">puntos</span>
              </span>
              <ChevronDown className={`h-4 w-4 flex-shrink-0 text-outline transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            {isOpen && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-container-high px-4 py-2.5 text-[12px] text-on-surface-variant">
                  <span>Ganados en total: {fmtPoints(a.lifetimeEarned)} · Usados: {fmtPoints(a.lifetimeRedeemed)}</span>
                  {a.programActive && (
                    <Link to={`/tienda/${a.vendor.slug}`} className="flex min-h-10 items-center font-bold text-tertiary-accent">Ir a la tienda</Link>
                  )}
                </div>
                <History vendorId={a.vendor.id} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
