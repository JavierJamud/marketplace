import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Monitor, PackageSearch, Smartphone, Tablet, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { CARD } from "../dashboard/DashboardCard.jsx";
import { Button } from "../ui/Button.jsx";
import { StatTile, StatStrip, SearchField, RowSkeletons, Pagination } from "./ListControls.jsx";
import { useListParams, useDebouncedSearch } from "../../lib/useListParams.js";
import { exactDateTime } from "../../lib/relativeTime.js";
import { orderTotalLabel } from "../../lib/shipping.js";
import { channelLabel } from "../../lib/catalog.js";
import { AdminOrderDetail } from "./AdminOrderDetail.jsx";

// Pestaña "Pedidos" de /admin/tiendas/:id: para dar soporte a una tienda sin salir de ella. Busca por código, cliente,
// teléfono, correo o dirección, y filtra por estado, fechas, monto, producto y forma de pago. Todo vive en la URL, así el
// enlace a una búsqueda (o a un pedido abierto, ?pedido=) se puede pasar a otra persona del equipo.

// Los mismos nombres que ve la tienda en su panel (VendorOrders.jsx), para hablar de lo mismo cuando llama.
export const ORDER_STATUS = {
  NEW: { label: "Pendiente", tone: "bg-secondary-container/25 text-secondary" },
  PREPARING: { label: "Vendido", tone: "bg-tertiary-accent/10 text-tertiary-accent" },
  READY: { label: "En camino", tone: "bg-tertiary-accent/10 text-tertiary-accent" },
  DELIVERED: { label: "Entregado", tone: "bg-verified/10 text-verified-dark" },
  CANCELLED: { label: "Rechazado", tone: "bg-error/10 text-error" },
};
export function orderStatusOf(o) {
  if (o.status === "CANCELLED" && o.autoCancelledAt) return { label: "Cerrado sin respuesta", tone: ORDER_STATUS.CANCELLED.tone };
  return ORDER_STATUS[o.status] ?? { label: o.status, tone: "bg-surface-container text-on-surface-variant" };
}

const DEFAULTS = { q: "", product: "", status: "all", channel: "", range: "all", from: "", to: "", min: "", max: "", sort: "recent", page: 1, pageSize: 25 };

const RANGES = [
  { value: "all", label: "Cualquier fecha" },
  { value: "today", label: "Hoy" },
  { value: "yesterday", label: "Ayer" },
  { value: "7d", label: "Últimos 7 días" },
  { value: "30d", label: "Últimos 30 días" },
  { value: "month", label: "Este mes" },
  { value: "custom", label: "Elegir fechas" },
];
const SORTS = [
  { value: "recent", label: "Más recientes" },
  { value: "oldest", label: "Más antiguos" },
  { value: "totalDesc", label: "Monto más alto" },
  { value: "totalAsc", label: "Monto más bajo" },
];

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};
// Fechas que se mandan al servidor para cada rango (días del calendario; el servidor los toma en la zona horaria del sitio).
function rangeDates(p) {
  const today = new Date();
  switch (p.range) {
    case "today":
      return { from: ymd(today), to: ymd(today) };
    case "yesterday":
      return { from: ymd(daysAgo(1)), to: ymd(daysAgo(1)) };
    case "7d":
      return { from: ymd(daysAgo(6)), to: ymd(today) };
    case "30d":
      return { from: ymd(daysAgo(29)), to: ymd(today) };
    case "month":
      return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today) };
    case "custom":
      return { from: p.from || undefined, to: p.to || undefined };
    default:
      return {};
  }
}

const field = "h-11 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent md:h-10";
const label = "mb-1 block text-[11.5px] font-bold text-on-surface-variant";

function DeviceIcon({ device }) {
  const Icon = device === "Celular" ? Smartphone : device === "Tablet" ? Tablet : Monitor;
  return <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />;
}

// Texto corto de por dónde llegó el pedido, para la fila.
function originText(o) {
  if (o.fromPos) return "Venta de caja";
  if (o.partnerName) return `API de ${o.partnerName}`;
  if (!o.device) return null;
  return [o.device.device, o.device.os].filter(Boolean).join(" · ");
}

function OrderRow({ o, onOpen }) {
  const st = orderStatusOf(o);
  const items = o.items.map((i) => `${i.quantity} × ${i.name}${i.size ? ` (${i.size})` : ""}`).join(", ");
  const origin = originText(o);
  return (
    <li className="border-b border-surface-container last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(o.id)}
        className="grid w-full grid-cols-1 gap-1 px-4 py-3 text-left hover:bg-surface-container/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tertiary-accent md:grid-cols-[minmax(0,9.5rem)_minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,8rem)] md:items-center md:gap-4"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 md:block">
          <span className="block font-mono text-[13px] font-bold text-on-surface">{o.code}</span>
          <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold md:mt-1 ${st.tone}`}>{st.label}</span>
          <span className="block text-[11.5px] text-outline md:mt-1" title={exactDateTime(o.createdAt)}>
            {exactDateTime(o.createdAt)}
          </span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-on-surface">{o.customerName ?? "Sin nombre"}</span>
          <span className="block truncate text-[12px] text-on-surface-variant">{[o.customerPhone, o.customerEmail].filter(Boolean).join(" · ")}</span>
          {o.recipientName && <span className="block truncate text-[11.5px] text-outline">Recibe {o.recipientName}</span>}
        </span>
        <span className="min-w-0">
          <span className="line-clamp-2 text-[12.5px] text-on-surface">{items}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-outline">
            <span>{channelLabel(o.channel)}</span>
            {origin && (
              <span className="flex items-center gap-1">
                {o.device && !o.fromPos && !o.partnerName && <DeviceIcon device={o.device.device} />} {origin}
              </span>
            )}
          </span>
        </span>
        <span className="text-[14px] font-extrabold text-on-surface md:text-right">{orderTotalLabel(o)}</span>
      </button>
    </li>
  );
}

export function VendorOrdersPanel({ vendorId }) {
  const [params, setParams] = useListParams(DEFAULTS);
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get("pedido");
  const ipFilter = searchParams.get("ip") ?? "";
  const setOpen = useCallback(
    (id) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("pedido", id);
          else next.delete("pedido");
          return next;
        },
        { replace: !id }
      ),
    [setSearchParams]
  );

  const commitQ = useCallback((q) => setParams({ q }), [setParams]);
  const [qText, setQText] = useDebouncedSearch(params.q, commitQ);
  const commitProduct = useCallback((product) => setParams({ product }), [setParams]);
  const [productText, setProductText] = useDebouncedSearch(params.product, commitProduct, 400);
  const commitMin = useCallback((min) => setParams({ min }), [setParams]);
  const [minText, setMinText] = useDebouncedSearch(params.min, commitMin, 500);
  const commitMax = useCallback((max) => setParams({ max }), [setParams]);
  const [maxText, setMaxText] = useDebouncedSearch(params.max, commitMax, 500);

  const dates = useMemo(() => rangeDates(params), [params]);
  const query = {
    q: params.q || undefined,
    product: params.product || undefined,
    channel: params.channel || undefined,
    min: params.min || undefined,
    max: params.max || undefined,
    ip: ipFilter || undefined,
    sort: params.sort,
    page: params.page,
    pageSize: params.pageSize,
    ...dates,
  };
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["admin-vendor-orders", vendorId, { ...query, status: params.status }],
    queryFn: async () => (await api.get(`/admin/vendors/${vendorId}/orders`, { params: { ...query, status: params.status } })).data,
    placeholderData: keepPreviousData,
  });
  const { data: productOptions } = useQuery({
    queryKey: ["admin-vendor-order-products", vendorId],
    queryFn: async () => (await api.get(`/admin/vendors/${vendorId}/order-products`)).data.products,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (data && data.orders.length === 0 && params.page > 1) setParams({ page: data.pageCount });
  }, [data, params.page, setParams]);

  const counts = data?.statusCounts ?? {};
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const tiles = [{ key: "all", label: "Todos", value: data ? allCount : undefined }, ...Object.entries(ORDER_STATUS).map(([key, s]) => ({ key, label: s.label, value: data ? counts[key] ?? 0 : undefined, tone: key === "NEW" ? "warn" : undefined }))];
  const hasFilters = params.q || params.product || params.status !== "all" || params.channel || params.range !== "all" || params.min || params.max || ipFilter;
  const clearAll = () => {
    setParams({ q: "", product: "", status: "all", channel: "", range: "all", from: "", to: "", min: "", max: "" });
    if (ipFilter) setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete("ip"); return next; }, { replace: true });
  };

  return (
    <div>
      <StatStrip>
        {tiles.map((t) => (
          <StatTile key={t.key} label={t.label} value={t.value} tone={t.tone} active={params.status === t.key} onClick={() => setParams({ status: t.key })} />
        ))}
      </StatStrip>

      <div className={`${CARD} mb-4 p-3 sm:p-4`}>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="sm:col-span-2 lg:col-span-1">
            <span className={label}>Buscar</span>
            <SearchField value={qText} onChange={setQText} placeholder="Código, cliente, teléfono o correo" />
          </div>
          <div>
            <label htmlFor="ord-product" className={label}>Producto</label>
            <input id="ord-product" list="ord-product-list" value={productText} onChange={(e) => setProductText(e.target.value)} placeholder="Nombre del producto" className={field} />
            <datalist id="ord-product-list">
              {productOptions?.map((p) => (
                <option key={p.name} value={p.name} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="ord-range" className={label}>Fecha</label>
            <select id="ord-range" value={params.range} onChange={(e) => setParams({ range: e.target.value })} className={field}>
              {RANGES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ord-sort" className={label}>Ordenar</label>
            <select id="ord-sort" value={params.sort} onChange={(e) => setParams({ sort: e.target.value })} className={field}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {params.range === "custom" && (
            <>
              <div>
                <label htmlFor="ord-from" className={label}>Desde</label>
                <input id="ord-from" type="date" value={params.from} max={params.to || undefined} onChange={(e) => setParams({ from: e.target.value })} className={field} />
              </div>
              <div>
                <label htmlFor="ord-to" className={label}>Hasta</label>
                <input id="ord-to" type="date" value={params.to} min={params.from || undefined} onChange={(e) => setParams({ to: e.target.value })} className={field} />
              </div>
            </>
          )}
          <div>
            <label htmlFor="ord-min" className={label}>Monto desde{data?.currency ? ` (${data.currency})` : ""}</label>
            <input id="ord-min" type="number" inputMode="decimal" min="0" value={minText} onChange={(e) => setMinText(e.target.value)} placeholder="0" className={field} />
          </div>
          <div>
            <label htmlFor="ord-max" className={label}>Monto hasta{data?.currency ? ` (${data.currency})` : ""}</label>
            <input id="ord-max" type="number" inputMode="decimal" min="0" value={maxText} onChange={(e) => setMaxText(e.target.value)} placeholder="Sin tope" className={field} />
          </div>
          {data?.channels?.length > 1 && (
            <div className="col-span-2 lg:col-span-1">
              <label htmlFor="ord-channel" className={label}>Forma de pago</label>
              <select id="ord-channel" value={params.channel} onChange={(e) => setParams({ channel: e.target.value })} className={field}>
                <option value="">Todas</option>
                {data.channels.map((c) => (
                  <option key={c.channel} value={c.channel}>{channelLabel(c.channel)} ({c.count})</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {(hasFilters || ipFilter) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {ipFilter && (
              <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-tertiary-accent/10 pl-3 pr-1 text-[12px] font-semibold text-tertiary-accent">
                Desde la IP {ipFilter}
                <button
                  type="button"
                  aria-label="Quitar el filtro de IP"
                  onClick={() => setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete("ip"); return next; }, { replace: true })}
                  className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-tertiary-accent/15"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            )}
            <button type="button" onClick={clearAll} className="min-h-9 rounded-full px-3 text-[12.5px] font-bold text-tertiary-accent hover:bg-surface-container">
              Limpiar filtros
            </button>
          </div>
        )}
      </div>

      <div className={`${CARD} transition-opacity ${isFetching && !isLoading ? "opacity-70" : ""}`}>
        <div className="hidden grid-cols-[minmax(0,9.5rem)_minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,8rem)] gap-4 rounded-t-2xl border-b border-surface-container bg-surface-container/50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-outline md:grid">
          <span>Pedido</span>
          <span>Cliente</span>
          <span>Productos y origen</span>
          <span className="text-right">Total</span>
        </div>
        {isLoading && <RowSkeletons rows={6} />}
        {isError && !data && (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-body-md text-error">No se pudieron cargar los pedidos de esta tienda.</p>
            <Button variant="outline" onClick={() => refetch()}>Reintentar</Button>
          </div>
        )}
        {data && data.orders.length > 0 && (
          <ul>
            {data.orders.map((o) => (
              <OrderRow key={o.id} o={o} onOpen={setOpen} />
            ))}
          </ul>
        )}
        {data && data.orders.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <PackageSearch className="h-6 w-6 text-outline" aria-hidden="true" />
            <p className="text-body-md text-on-surface-variant">{hasFilters ? "Ningún pedido coincide con estos filtros." : "Esta tienda todavía no recibió pedidos."}</p>
            {hasFilters && <Button variant="outline" onClick={clearAll}>Limpiar filtros</Button>}
          </div>
        )}
      </div>

      {data && (
        <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} onPage={(page) => setParams({ page })} onPageSize={(pageSize) => setParams({ pageSize })} noun="pedidos" />
      )}

      {openId && (
        <AdminOrderDetail
          orderId={openId}
          onClose={() => setOpen(null)}
          onFilterIp={(ip) =>
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.delete("pedido");
                next.set("ip", ip);
                next.delete("page");
                return next;
              },
              { replace: true }
            )
          }
        />
      )}
    </div>
  );
}
