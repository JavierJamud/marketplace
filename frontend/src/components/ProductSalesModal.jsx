import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, ChevronDown, Receipt } from "lucide-react";
import { api } from "../lib/api.js";
import { formatPrice } from "../lib/format.js";
import { Spinner } from "./ui/Spinner.jsx";

// Ventas de un producto (backend/src/lib/productSales.js): cuándo se vendió por última vez, en qué pedidos aparece y el
// historial de cada pedido. La usan el vendedor (Productos) y el admin (Productos del admin); cambia solo de dónde se pide.

const fmtDateTime = (d) =>
  new Date(d).toLocaleString("es-CU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

const STATUS_STYLE = {
  NEW: "bg-secondary-container text-on-secondary-container",
  PREPARING: "bg-tertiary-accent/10 text-tertiary-accent",
  READY: "bg-tertiary-accent/10 text-tertiary-accent",
  DELIVERED: "bg-verified/10 text-verified-dark",
  CANCELLED: "bg-error/10 text-error",
};

function Summary({ data }) {
  const s = data.summary;
  const revenue = s.revenue.length ? s.revenue.map((r) => formatPrice(r.amount, r.currency)).join(" + ") : "Sin ventas";
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <div className="col-span-2 rounded-xl bg-surface-container p-3">
        <div className="text-[11.5px] text-outline">Última venta</div>
        {s.lastSoldAt ? (
          <div className="text-[14px] font-bold text-on-surface">
            {fmtDateTime(s.lastSoldAt)} <span className="whitespace-nowrap font-semibold text-on-surface-variant">· pedido {s.lastSoldCode}</span>
          </div>
        ) : (
          <div className="text-[14px] font-semibold text-on-surface-variant">Todavía no se ha vendido</div>
        )}
      </div>
      <div className="rounded-xl bg-surface-container p-3">
        <div className="text-[11.5px] text-outline">Unidades vendidas</div>
        <div className="text-[15px] font-bold text-on-surface">{s.unitsSold.toLocaleString("es-CU")}</div>
        <div className="text-[11px] text-outline">en {s.ordersSold} {s.ordersSold === 1 ? "pedido" : "pedidos"}</div>
      </div>
      <div className="rounded-xl bg-surface-container p-3">
        <div className="text-[11.5px] text-outline">Ingresos</div>
        <div className="truncate text-[15px] font-bold text-on-surface">{revenue}</div>
      </div>
      <div className="rounded-xl bg-surface-container p-3">
        <div className="text-[11.5px] text-outline">Pendientes de confirmar</div>
        <div className="text-[15px] font-bold text-on-surface">{s.pendingUnits} u.</div>
      </div>
      <div className="rounded-xl bg-surface-container p-3">
        <div className="text-[11.5px] text-outline">Stock actual</div>
        <div className="text-[15px] font-bold text-on-surface">{data.product.stock == null ? "Sin límite" : `${data.product.stock} u.`}</div>
        {s.cancelledOrders > 0 && <div className="text-[11px] text-outline">{s.cancelledOrders} cancelado{s.cancelledOrders === 1 ? "" : "s"}</div>}
      </div>
    </div>
  );
}

function OrderRow({ row }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border border-surface-container-high">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-start gap-3 p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13.5px] font-bold text-on-surface">{row.code}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[row.status] ?? "bg-surface-container text-on-surface-variant"}`}>{row.statusLabel}</span>
          </div>
          <div className="mt-0.5 text-[12px] text-outline">
            {fmtDateTime(row.createdAt)} · {row.channel}
            {row.customerName ? ` · ${row.customerName}` : ""}
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-[13px] font-semibold text-on-surface">
            {row.quantity} × {formatPrice(row.unitPrice, row.currency)}
          </div>
          {row.size && <div className="text-[11px] text-outline">Talla {row.size}</div>}
        </div>
        <ChevronDown className={`mt-0.5 h-4 w-4 flex-shrink-0 text-outline transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-surface-container-high px-3 py-2.5">
          {row.soldAt && <p className="mb-2 text-[12px] font-semibold text-verified-dark">Vendido el {fmtDateTime(row.soldAt)}</p>}
          {row.events.length === 0 ? (
            <p className="text-[12px] text-outline">Este pedido no tiene movimientos registrados.</p>
          ) : (
            <ol className="space-y-1.5">
              {row.events.map((e, i) => (
                <li key={i} className="flex gap-2 text-[12px]">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-tertiary-accent" />
                  <span className="min-w-0">
                    <span className="font-semibold text-on-surface">{e.label}</span>
                    <span className="text-outline"> · {fmtDateTime(e.at)}</span>
                    {e.detail && <span className="block text-on-surface-variant">{e.detail}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

// `endpoint`: "/products/me/:id/sales" (vendedor) o "/admin/products/:id/sales" (admin).
export function ProductSalesModal({ productName, endpoint, onClose }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["product-sales", endpoint],
    queryFn: async () => (await api.get(endpoint)).data,
  });

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-inverse-surface/50 sm:items-center sm:p-4 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Ventas de ${productName}`}
        onClick={(e) => e.stopPropagation()}
        className="modal-panel flex w-full max-w-lg flex-col rounded-t-2xl bg-surface-container-lowest shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start gap-3 border-b border-surface-container-high p-4">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent/10 text-tertiary-accent">
            <Receipt className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-bold text-on-surface">Ventas</h2>
            <p className="truncate text-[12.5px] text-outline">{productName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && (
            <div className="flex items-center gap-2 py-8 text-[13px] text-outline">
              <Spinner className="text-tertiary-accent" /> Cargando las ventas...
            </div>
          )}
          {isError && (
            <div className="py-6 text-[13px] text-on-surface">
              No se pudieron cargar las ventas.
              <button type="button" onClick={() => refetch()} className="ml-2 h-11 rounded-xl border border-outline-variant px-4 font-semibold">
                Reintentar
              </button>
            </div>
          )}
          {data && (
            <>
              <Summary data={data} />
              <h3 className="mb-2 mt-5 text-[13px] font-bold text-on-surface">Pedidos con este producto</h3>
              {data.rows.length === 0 ? (
                <p className="rounded-xl bg-surface-container p-4 text-[13px] text-on-surface-variant">Todavía nadie ha pedido este producto.</p>
              ) : (
                <ul className="space-y-2">
                  {data.rows.map((r) => (
                    <OrderRow key={`${r.kind}-${r.id}`} row={r} />
                  ))}
                </ul>
              )}
              {data.truncated && <p className="mt-3 text-[12px] text-outline">Se muestran los pedidos más recientes.</p>}
              <p className="mt-3 text-[11.5px] text-outline">Toca un pedido para ver todo su historial. Cuenta como vendido cuando la tienda confirma el pedido.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
