import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Search, X, Pencil, Trash2, Wallet } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtAmount(n) {
  return Number(n ?? 0).toLocaleString("es-CU");
}

// Modal de edición — igual patrón que ProductEditModal en AdminProducts.jsx,
// pero sin snapshot de "dirty" (formulario chico, 3 campos): cierra directo
// con Cancelar/afuera, sin advertencia de cambios sin guardar.
function SaleEditModal({ sale, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    quantity: String(sale.quantity),
    unitPrice: String(sale.unitPrice),
    note: sale.note ?? "",
  });

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/admin/vendor-staff-sales/${sale.id}`, {
          quantity: Number(form.quantity),
          unitPrice: Number(form.unitPrice),
          note: form.note || null,
        })
      ).data,
    onSuccess: () => {
      toast.success("Venta actualizada.");
      queryClient.invalidateQueries({ queryKey: ["admin-manual-sales"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !save.isPending) onClose(); }}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-title-lg text-on-surface">Editar venta manual</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-outline hover:bg-surface-variant">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          {sale.productName} · <span className="font-semibold text-on-surface">{sale.vendor?.companyName}</span> · {sale.staffName}
        </p>

        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Cantidad"
              type="number"
              min={0}
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
            <Input
              label="Precio unitario"
              type="number"
              min={0}
              value={form.unitPrice}
              onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
            />
          </div>
          <div>
            <span className="mb-1 block text-label-md text-on-surface-variant">Nota</span>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="min-h-[70px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none"
            />
          </div>
        </div>

        <div className="mt-5 flex gap-2.5">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={save.isPending}>Cancelar</Button>
          <Button className="flex-1" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminManualSales() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const searchTimer = useRef(null);

  // Debounce simple — mismo patrón que AdminProducts.jsx, evita una request
  // por tecla en la búsqueda.
  function handleSearchChange(value) {
    setQ(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedQ(value.trim()), 300);
  }

  const { data: vendors } = useQuery({
    queryKey: ["admin-manual-sales-vendors"],
    queryFn: async () => (await api.get("/admin/vendor-staff-sales/vendors")).data.vendors,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-manual-sales", vendorId, debouncedQ],
    queryFn: async () =>
      (
        await api.get("/admin/vendor-staff-sales", {
          params: {
            ...(vendorId ? { vendorId } : {}),
            ...(debouncedQ ? { q: debouncedQ } : {}),
          },
        })
      ).data.sales,
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/admin/vendor-staff-sales/${id}`),
    onSuccess: () => {
      toast.success("Venta eliminada.");
      queryClient.invalidateQueries({ queryKey: ["admin-manual-sales"] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar."),
  });

  return (
    <div className="max-w-[1080px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Wallet} tone="teal" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Agentes de Ventas</h1>
      </div>
      <p className="mb-[18px] text-[13.5px] text-outline">
        Supervisión de todas las ventas registradas por el personal de tiendas contra su cupo de stock — verifica, corrige o
        elimina cualquier venta de cualquier tienda.
      </p>

      <div className="mb-[18px] flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-[320px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" />
          <input
            value={q}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Buscar por producto..."
            className="h-10 w-full rounded-xl border border-outline-variant bg-surface-container-lowest pl-9 pr-3 text-[13px] outline-none focus:border-tertiary-accent"
          />
        </div>
        <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="sm:max-w-[260px]">
          <option value="">Todas las tiendas</option>
          {vendors?.map((v) => (
            <option key={v.id} value={v.id}>{v.companyName}</option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      {/* Tabla en desktop, tarjetas en mobile — mismo criterio de scroll
          horizontal contenido que el resto de las listas del admin cuando el
          contenido tiene demasiadas columnas para 400px de ancho. */}
      <div className="overflow-hidden rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
        {/* Encabezado — solo desktop */}
        <div className="hidden border-b border-surface-container-high bg-surface-container px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-outline md:grid md:grid-cols-[110px_1fr_1fr_1fr_70px_90px_100px_1fr_70px]">
          <span>Fecha</span>
          <span>Tienda</span>
          <span>Empleado</span>
          <span>Producto</span>
          <span>Cant.</span>
          <span>Precio u.</span>
          <span>Total</span>
          <span>Nota</span>
          <span className="text-right">Acciones</span>
        </div>

        {data?.map((s) => (
          <div
            key={s.id}
            className="flex flex-col gap-1.5 border-b border-surface-container px-4 py-3 last:border-b-0 md:grid md:grid-cols-[110px_1fr_1fr_1fr_70px_90px_100px_1fr_70px] md:items-center md:gap-3"
          >
            <span className="text-[11.5px] text-outline md:text-[12px]">{fmtDate(s.createdAt)}</span>
            <span className="truncate text-[13px] font-semibold text-on-surface">{s.vendor?.companyName}</span>
            <span className="truncate text-[12.5px] text-on-surface-variant">{s.staffName ?? "—"}</span>
            <span className="truncate text-[12.5px] text-on-surface-variant">{s.productName}</span>
            <span className="text-[12.5px] text-on-surface-variant">
              <span className="font-semibold text-on-surface md:hidden">Cant.: </span>
              {s.quantity}
            </span>
            <span className="text-[12.5px] text-on-surface-variant">
              <span className="font-semibold text-on-surface md:hidden">Precio: </span>
              {fmtAmount(s.unitPrice)}
            </span>
            <span className="text-[12.5px] font-semibold text-on-surface">
              <span className="font-semibold text-on-surface md:hidden">Total: </span>
              {fmtAmount(s.total)}
            </span>
            <span className="truncate text-[12px] text-outline" title={s.note ?? ""}>{s.note || "—"}</span>
            <div className="flex items-center gap-3 md:justify-end">
              <button onClick={() => setEditTarget(s)} className="text-tertiary-accent" aria-label="Editar">
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={() => setDeleteTarget(s)} className="text-error" aria-label="Eliminar">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}

        {!isLoading && !data?.length && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <Wallet className="h-6 w-6 text-outline" />
            <p className="text-body-md text-on-surface-variant">
              {debouncedQ || vendorId ? "Sin resultados." : "Todavía no hay ventas manuales registradas."}
            </p>
          </div>
        )}
      </div>

      {editTarget && <SaleEditModal sale={editTarget} onClose={() => setEditTarget(null)} />}
      {deleteTarget && (
        <ConfirmDeleteModal
          title={`¿Eliminar venta de "${deleteTarget.productName}"?`}
          description="Se revierte el impacto en el cupo del empleado y el stock del producto de inmediato."
          pending={remove.isPending}
          onConfirm={() => remove.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
