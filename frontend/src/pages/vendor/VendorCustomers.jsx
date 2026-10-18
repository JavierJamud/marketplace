import { useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Contact, MessageCircle, Mail, Phone, X, ShoppingCart } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { waLink } from "../../lib/whatsapp.js";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { SearchBox } from "../../components/ui/SearchBox.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { canWriteSection } from "../../lib/vendorSections.js";

// Clientes de la tienda: cada persona que compró, con todos sus pedidos y movimientos. El registro se crea solo con cada pedido;
// aquí se consulta, se busca, se contacta y se le pueden dejar notas (por ejemplo, "prefiere entrega en la tarde").
const DAY = 24 * 60 * 60 * 1000;

const SEGMENTS = [
  { id: "all", label: "Todos" },
  { id: "repeat", label: "Recurrentes", hint: "2 pedidos o más" },
  { id: "new", label: "Nuevos", hint: "primer pedido en los últimos 30 días" },
  { id: "inactive", label: "Sin comprar hace tiempo", hint: "más de 60 días sin pedidos" },
  { id: "pending", label: "Con pedidos pendientes" },
];
const SORTS = [
  { id: "recent", label: "Última compra" },
  { id: "orders", label: "Más pedidos" },
  { id: "spent", label: "Mayor gasto" },
];

const STATUS_LABEL = { NEW: "Pendiente", PREPARING: "Vendido", READY: "En camino", DELIVERED: "Entregado", CANCELLED: "Anulado" };
const STATUS_TONE = { NEW: "bg-secondary-container/30 text-on-secondary-container", PREPARING: "bg-verified/10 text-verified-dark", READY: "bg-verified/10 text-verified-dark", DELIVERED: "bg-verified/10 text-verified-dark", CANCELLED: "bg-error/10 text-error" };
const EVENT_LABEL = {
  CREATED: "Pedido recibido",
  CONFIRMED: "Venta confirmada",
  PREPARING: "En preparación",
  READY: "Listo para entregar",
  DELIVERED: "Entregado al cliente",
  CANCELLED: "Pedido cancelado",
  EDITED_BY_CUSTOMER: "Productos modificados por el cliente",
  INVOICE_SENT: "Factura enviada",
  INVOICE_DOWNLOADED: "Factura generada",
  WARRANTY_SENT: "Garantía enviada",
  WARRANTY_DOWNLOADED: "Garantía generada",
};

const money = (n, cur) => `${Number(n).toLocaleString("es-CU")} ${cur}`;
const totalText = (totals) => (totals?.length ? totals.map((t) => money(t.amount, t.currency)).join(" + ") : "0");
const dateText = (d) => (d ? new Date(d).toLocaleDateString("es-CU", { day: "numeric", month: "short", year: "numeric" }) : "-");
const dateTimeText = (d) => new Date(d).toLocaleString("es-CU", { dateStyle: "medium", timeStyle: "short" });
function ago(d) {
  if (!d) return "-";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / DAY);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  return months === 1 ? "hace 1 mes" : `hace ${months} meses`;
}
const spentValue = (c) => (c.totals ?? []).reduce((s, t) => s + t.amount, 0);

function matchesSegment(c, id) {
  if (id === "repeat") return c.validOrdersCount >= 2;
  if (id === "new") return c.firstOrderAt && Date.now() - new Date(c.firstOrderAt).getTime() <= 30 * DAY;
  if (id === "inactive") return c.lastOrderAt && Date.now() - new Date(c.lastOrderAt).getTime() > 60 * DAY;
  if (id === "pending") return c.pendingCount > 0;
  return true;
}

function CustomerDetail({ customerId, canWrite, onClose }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["vendor-customer", customerId],
    queryFn: async () => (await api.get(`/vendors/me/customers/${customerId}`)).data,
  });
  const [notes, setNotes] = useState(null);
  const customer = data?.customer;
  const currentNotes = notes ?? customer?.notes ?? "";

  const save = useMutation({
    mutationFn: async () => (await api.patch(`/vendors/me/customers/${customerId}`, { notes: currentNotes })).data,
    onSuccess: () => {
      toast.success("Notas guardadas.");
      setNotes(null);
      queryClient.invalidateQueries({ queryKey: ["vendor-customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["vendor-customers"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudieron guardar las notas."),
  });

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-inverse-surface/50 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-surface-container-lowest sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-surface-container-high px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-[20px] font-extrabold text-on-surface">{customer?.name ?? "Cliente"}</h2>
            {customer && (
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-on-surface-variant">
                {customer.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {customer.phone}</span>}
                {customer.email && <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {customer.email}</span>}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full hover:bg-surface-container">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}
          {isError && <p className="text-body-md text-error">No se pudo cargar el cliente.</p>}
          {customer && (
            <>
              <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {[
                  ["Pedidos", customer.ordersCount],
                  ["Entregados", customer.deliveredCount],
                  ["Total comprado", totalText(customer.totals)],
                  ["Última compra", ago(customer.lastOrderAt)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-surface-container/60 px-3 py-2.5">
                    <div className="text-[10.5px] font-bold uppercase tracking-wide text-outline">{label}</div>
                    <div className="mt-0.5 text-[14px] font-extrabold text-on-surface">{value}</div>
                  </div>
                ))}
              </div>

              <div className="mb-5">
                <label htmlFor="cliente-notas" className="mb-1 block text-[12px] font-bold uppercase tracking-wide text-outline">Notas del cliente</label>
                <textarea
                  id="cliente-notas"
                  value={currentNotes}
                  onChange={(e) => setNotes(e.target.value)}
                  readOnly={!canWrite}
                  maxLength={2000}
                  rows={3}
                  placeholder="Ej.: prefiere entrega en la tarde, compra al por mayor, cliente frecuente..."
                  className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
                />
                {canWrite && notes !== null && notes !== (customer.notes ?? "") && (
                  <Button type="button" className="mt-2" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Guardando..." : "Guardar notas"}</Button>
                )}
              </div>

              <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-outline">Pedidos y movimientos</h3>
              <ul className="flex flex-col gap-3">
                {data.orders.map((o) => (
                  <li key={o.id} className="rounded-xl border border-surface-container-high p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link to={`/vendedor/pedidos?buscar=${encodeURIComponent(o.code)}`} className="font-mono text-[14px] font-extrabold text-on-surface hover:underline">{o.code}</Link>
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_TONE[o.status] ?? ""}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-outline">{dateTimeText(o.createdAt)}</div>
                    <ul className="mt-2 text-[13px] text-on-surface">
                      {o.items.map((it, i) => (
                        <li key={i} className="flex justify-between gap-3">
                          <span>{it.quantity} × {it.name}{it.size ? ` (${it.size})` : ""}</span>
                          <span className="flex-shrink-0 text-on-surface-variant">{money(Number(it.price) * it.quantity, it.currency)}</span>
                        </li>
                      ))}
                    </ul>
                    {o.shippingAddress && <div className="mt-1.5 text-[12px] text-outline">Entrega: {o.shippingAddress}</div>}
                    {o.events?.length > 0 && (
                      <ul className="mt-2.5 border-t border-surface-container pt-2 text-[12px]">
                        {o.events.map((e) => (
                          <li key={e.id} className="flex justify-between gap-3 py-0.5">
                            <span className="text-on-surface"><span className="font-semibold">{EVENT_LABEL[e.type] ?? e.type}</span>{e.detail ? <span className="text-outline"> · {e.detail}</span> : null}</span>
                            <span className="flex-shrink-0 text-outline">{dateTimeText(e.createdAt)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VendorCustomers() {
  const outlet = useOutletContext?.() ?? {};
  const canWrite = canWriteSection(outlet.staffSectionPermissions ?? null, "clientes");
  // El buscador del panel llega con ?q= (nombre, teléfono o correo del cliente elegido).
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");
  const [segment, setSegment] = useState("all");
  const [sort, setSort] = useState("recent");
  const [openId, setOpenId] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["vendor-customers"],
    queryFn: async () => (await api.get("/vendors/me/customers")).data.customers,
  });

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (data ?? [])
      .filter((c) => matchesSegment(c, segment))
      .filter((c) => !q || q.split(/\s+/).every((p) => [c.name, c.phone, c.email].join(" ").toLowerCase().includes(p)));
    const by = { recent: (a, b) => new Date(b.lastOrderAt) - new Date(a.lastOrderAt), orders: (a, b) => b.validOrdersCount - a.validOrdersCount, spent: (a, b) => spentValue(b) - spentValue(a) };
    return filtered.sort(by[sort]);
  }, [data, search, segment, sort]);

  return (
    <div className="max-w-[920px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Contact} tone="teal" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Clientes</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">Quienes han comprado en tu tienda, con todos sus pedidos y movimientos. Se registran solos con cada pedido.</p>

      <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:items-start">
        <SearchBox
          className="flex-1"
          value={search}
          onChange={setSearch}
          placeholder="Buscar por nombre, teléfono o correo"
          resultText={search.trim() ? `${list.length} de ${(data ?? []).length} clientes` : undefined}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar clientes" className="min-h-11 rounded-full border border-outline-variant bg-surface-container-lowest px-4 text-[13px] text-on-surface outline-none">
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {SEGMENTS.map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.hint}
            onClick={() => setSegment(s.id)}
            aria-pressed={segment === s.id}
            className={`min-h-10 rounded-full border px-4 text-[13px] font-semibold ${segment === s.id ? "border-primary-container bg-primary-container text-white" : "border-outline-variant bg-surface-container-lowest text-on-surface-variant"}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando clientes...</p>}
      {isError && <p className="text-body-md text-error">No se pudieron cargar los clientes.</p>}
      {!isLoading && !isError && !list.length && (
        <p className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5 text-body-md text-on-surface-variant">
          {(data ?? []).length ? "Ningún cliente coincide con ese filtro." : "Todavía no hay clientes: aparecerán aquí cuando alguien haga un pedido en tu tienda."}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {list.map((c) => (
          <li key={c.id} className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <button type="button" onClick={() => setOpenId(c.id)} className="min-w-0 text-left">
                <div className="truncate text-[15px] font-bold text-on-surface hover:underline">{c.name ?? "Cliente sin nombre"}</div>
                <div className="mt-0.5 text-[12.5px] text-on-surface-variant">{[c.phone, c.email].filter(Boolean).join(" · ")}</div>
              </button>
              <div className="text-right">
                <div className="text-[14px] font-extrabold text-on-surface">{totalText(c.totals)}</div>
                <div className="text-[11.5px] text-outline">comprado en total</div>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="rounded-full bg-surface-container px-2.5 py-1 font-semibold text-on-surface-variant">{c.ordersCount} {c.ordersCount === 1 ? "pedido" : "pedidos"}</span>
              <span className="rounded-full bg-surface-container px-2.5 py-1 text-on-surface-variant">Última compra {ago(c.lastOrderAt)}</span>
              {c.pendingCount > 0 && <span className="rounded-full bg-secondary-container/30 px-2.5 py-1 font-semibold text-on-secondary-container">{c.pendingCount} pendiente{c.pendingCount === 1 ? "" : "s"}</span>}
              {c.notes && <span className="rounded-full bg-tertiary-accent/10 px-2.5 py-1 font-semibold text-tertiary-accent">Con notas</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => setOpenId(c.id)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-surface-container px-3.5 text-[12.5px] font-bold text-on-surface">
                <ShoppingCart className="h-4 w-4" /> Ver pedidos y movimientos
              </button>
              {c.phone && (
                <a href={waLink(c.phone, `Hola ${c.name ?? ""}, te escribimos de la tienda.`)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[#25D366]/15 px-3.5 text-[12.5px] font-bold text-[#0a7a3c]">
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </a>
              )}
              {c.email && (
                <a href={`mailto:${c.email}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-surface-container px-3.5 text-[12.5px] font-bold text-on-surface">
                  <Mail className="h-4 w-4" /> Correo
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>

      {openId && <CustomerDetail customerId={openId} canWrite={canWrite} onClose={() => setOpenId(null)} />}
    </div>
  );
}
