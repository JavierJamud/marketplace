import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Search, X, BarChart3 } from "lucide-react";
import { api } from "../../lib/api.js";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";

const FILTERS = [
  { id: "all", label: "Todas" },
  { id: "business", label: "Business" },
  { id: "regular", label: "Regular" },
];

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

function EditVendorModal({ vendor, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ companyName: vendor.companyName, whatsapp: vendor.whatsapp, email: vendor.email ?? "" });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-surface-container-lowest p-6">
        <h2 className="mb-4 text-title-lg font-bold text-on-surface">Editar tienda</h2>
        <div className="flex flex-col gap-3.5">
          <Input label="Nombre de la tienda" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          <Input label="WhatsApp (con código de país)" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
          <Input label="Correo de la tienda" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="mt-5 flex gap-2.5">
          <button onClick={onCancel} disabled={saving} className="flex-1 rounded-md border border-outline-variant py-2.5 text-label-md font-semibold text-on-surface-variant">
            Cancelar
          </button>
          <Button className="flex-1" onClick={() => onSave(form)} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const KITCHEN_STATUS_LABEL = { RECEIVED: "Recibido", PREPARING: "Preparando", READY: "Listo" };

function StatsModal({ vendorName, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ["vendor-stats", vendorName.id],
    queryFn: async () => (await api.get(`/admin/vendors/${vendorName.id}/stats`)).data.stats,
  });

  // Auditoría de seguridad: antes el admin solo veía si la tienda "tuvo o
  // no" pedidos de mesa (contado dentro de `data.orderCount` arriba), sin
  // poder ver el contenido real de ninguno — acá se lista el detalle real,
  // de solo lectura, para poder investigar un reclamo puntual.
  const { data: tableOrders } = useQuery({
    queryKey: ["vendor-table-orders", vendorName.id],
    queryFn: async () => (await api.get(`/admin/vendors/${vendorName.id}/table-orders`)).data.tableOrders,
    enabled: !!vendorName.isRestaurant,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-xl bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-title-lg font-bold text-on-surface">{vendorName.companyName}</h2>
          <button onClick={onClose} className="text-outline hover:text-on-surface">
            <X className="h-5 w-5" />
          </button>
        </div>
        {isLoading && <p className="text-body-md text-on-surface-variant">Calculando...</p>}
        {data && (
          <div className="flex flex-col gap-3">
            {[
              ["Ventas totales", fmtCUP(data.salesTotal)],
              ["Pedidos", String(data.orderCount)],
              ["Ticket promedio", fmtCUP(Math.round(data.avgTicket))],
              ["Producto más vendido", data.topProduct ?? "Sin datos todavía"],
              ["Calificación promedio", `${data.rating.toFixed(1)} ★`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between border-b border-surface-container pb-2.5 last:border-b-0">
                <span className="text-[13px] text-outline">{label}</span>
                <span className="text-[13.5px] font-bold text-on-surface">{value}</span>
              </div>
            ))}
          </div>
        )}

        {vendorName.isRestaurant && (
          <div className="mt-5 border-t border-surface-container pt-4">
            <h3 className="mb-2.5 text-[12.5px] font-bold uppercase tracking-wide text-outline">Pedidos de mesa recientes</h3>
            {!tableOrders?.length && <p className="text-[12.5px] text-on-surface-variant">Todavía no hay pedidos de mesa.</p>}
            <div className="flex flex-col gap-2">
              {tableOrders?.slice(0, 15).map((o) => (
                <div key={o.id} className="rounded-md bg-surface-container p-2.5 text-[12px]">
                  <div className="mb-1 flex items-center justify-between font-semibold text-on-surface">
                    <span>Mesa {o.table.tableNumber} · {fmtCUP(o.total)}</span>
                    <span className="text-outline">{KITCHEN_STATUS_LABEL[o.kitchenStatus]}</span>
                  </div>
                  <div className="text-outline">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</div>
                  <div className="mt-1 text-[11px] text-outline">{fmtDateTime(o.createdAt)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminVendors() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [viewingStats, setViewingStats] = useState(null);
  const [blocking, setBlocking] = useState(null); // tienda a bloquear, para el modal de confirmación

  const { data, isLoading } = useQuery({
    queryKey: ["admin-vendors", filter],
    queryFn: async () => (await api.get("/admin/vendors", { params: { plan: filter !== "all" ? filter : undefined } })).data.vendors,
  });

  const update = useMutation({
    mutationFn: async ({ id, payload }) => (await api.patch(`/admin/vendors/${id}`, payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-vendors"] });
      setEditing(null);
      setBlocking(null);
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo actualizar la tienda.");
      setBlocking(null);
    },
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/admin/vendors/${id}`),
    onSuccess: () => {
      toast.success("Tienda eliminada.");
      queryClient.invalidateQueries({ queryKey: ["admin-vendors"] });
      setDeleting(null);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar la tienda."),
  });

  const rows = (data ?? []).filter((v) => v.companyName.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Tiendas</h1>
      <p className="mb-4 text-[13.5px] text-outline">Gestiona, verifica a dedo, edita o elimina tiendas. El bloqueo oculta, no borra.</p>

      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex h-[42px] max-w-[340px] flex-1 items-center gap-2 rounded-md border border-outline-variant bg-surface-container-lowest px-3">
          <Search className="h-4 w-4 text-outline" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tienda..." className="w-full border-none bg-transparent text-[13.5px] outline-none" />
        </div>
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full border px-4 py-2 text-[13px] font-semibold ${
                filter === f.id ? "border-tertiary bg-tertiary text-white" : "border-outline-variant bg-surface-container-lowest text-on-surface-variant"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest">
        <div className="grid grid-cols-[2fr_1.2fr_1fr_1fr_2fr] gap-3 bg-surface-container-low px-[22px] py-3.5 text-[11.5px] font-bold uppercase tracking-wide text-outline">
          <span>Tienda</span><span>Provincia</span><span>Plan</span><span>Estado</span><span className="text-right">Acciones</span>
        </div>
        {isLoading && <p className="p-5 text-body-md text-on-surface-variant">Cargando...</p>}
        {!isLoading && rows.length === 0 && <p className="p-5 text-body-md text-on-surface-variant">No hay tiendas para este filtro.</p>}
        {rows.map((v) => (
          <div
            key={v.id}
            className="grid grid-cols-[2fr_1.2fr_1fr_1fr_2fr] items-center gap-3 border-t border-surface-container px-[22px] py-3.5"
            style={{ opacity: v.isBlocked ? 0.55 : 1 }}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-full font-display text-sm font-bold text-white"
                style={{ background: v.color ?? "#232F3E" }}
              >
                {v.companyName[0]}
              </span>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[13.5px] font-semibold text-on-surface">{v.companyName}</span>
                  {v.isVerified && <VerifiedBadge size="sm" />}
                </div>
                <div className="text-[11.5px] text-outline">{v.category?.name ?? "—"}</div>
              </div>
            </div>
            <span className="text-[13px] text-on-surface-variant">{v.locations?.[0]?.province?.name ?? "—"}</span>
            <button
              title="Click para forzar el cambio de plan"
              onClick={() => update.mutate({ id: v.id, payload: { planType: v.planType === "BUSINESS" ? "REGULAR" : "BUSINESS" } })}
              className="w-fit rounded-full px-2.5 py-1 text-[11.5px] font-bold"
              style={v.planType === "BUSINESS" ? { background: "rgba(254,152,0,0.15)", color: "#8A5100" } : { background: "#f0edee", color: "#75777c" }}
            >
              {v.planType === "BUSINESS" ? "Business" : "Regular"}
            </button>
            <span
              className="w-fit rounded-full px-2.5 py-1 text-[11.5px] font-bold"
              style={v.isBlocked ? { background: "rgba(186,26,26,0.12)", color: "#ba1a1a" } : { background: "rgba(12,174,83,0.12)", color: "#0A8F42" }}
            >
              {v.isBlocked ? "Bloqueada" : "Activa"}
            </span>
            <div className="flex flex-wrap justify-end gap-1.5">
              <button
                onClick={() => setViewingStats(v)}
                title="Ver estadísticas"
                className="flex items-center gap-1 rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[12px] font-semibold text-on-surface-variant"
              >
                <BarChart3 className="h-3.5 w-3.5" />
              </button>
              <Link to={`/tienda/${v.slug}`} target="_blank" className="rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[12px] font-semibold text-on-surface-variant">
                Ver
              </Link>
              <button onClick={() => setEditing(v)} className="rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[12px] font-semibold text-on-surface-variant">
                Editar
              </button>
              <button
                onClick={() => (v.isBlocked ? update.mutate({ id: v.id, payload: { isBlocked: false } }) : setBlocking(v))}
                className={`rounded-[7px] px-2.5 py-1.5 text-[12px] font-semibold ${
                  v.isBlocked ? "bg-verified-dark text-white" : "border border-error text-error"
                }`}
              >
                {v.isBlocked ? "Desbloquear" : "Bloquear"}
              </button>
              <button onClick={() => setDeleting(v)} className="rounded-[7px] bg-error px-2.5 py-1.5 text-[12px] font-semibold text-on-error">
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <EditVendorModal
          vendor={editing}
          saving={update.isPending}
          onCancel={() => setEditing(null)}
          onSave={(form) => update.mutate({ id: editing.id, payload: form })}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          title={`¿Eliminar "${deleting.companyName}"?`}
          description="La tienda se oculta de todo el sitio y el dueño no podrá volver a entrar. Sus pedidos y reseñas históricos se conservan."
          pending={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.id)}
        />
      )}

      {viewingStats && <StatsModal vendorName={viewingStats} onClose={() => setViewingStats(null)} />}

      <ConfirmModal
        open={!!blocking}
        title={`¿Bloquear "${blocking?.companyName}"?`}
        message="La tienda se oculta de todo el sitio y el dueño no va a poder volver a entrar hasta que la desbloquees."
        confirmLabel={update.isPending ? "Bloqueando..." : "Sí, bloquear"}
        danger
        onConfirm={() => update.mutate({ id: blocking.id, payload: { isBlocked: true } })}
        onCancel={() => setBlocking(null)}
      />
    </div>
  );
}
