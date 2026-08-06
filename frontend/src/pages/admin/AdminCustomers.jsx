import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Search } from "lucide-react";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";

const PALETTE = ["#337475", "#8A5100", "#003435", "#643900", "#232F3E", "#2c5b2e"];
function colorFor(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function EditCustomerModal({ customer, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ fullName: customer.fullName ?? "", email: customer.email, phone: customer.phone ?? "" });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-surface-container-lowest p-6">
        <h2 className="mb-4 text-title-lg font-bold text-on-surface">Editar cliente</h2>
        <div className="flex flex-col gap-3.5">
          <Input label="Nombre completo" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <Input label="Correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Teléfono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
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

export default function AdminCustomers() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [suspending, setSuspending] = useState(null); // cliente a suspender, para el modal de confirmación

  const { data, isLoading } = useQuery({
    queryKey: ["admin-customers"],
    queryFn: async () => (await api.get("/admin/customers")).data.customers,
  });

  const toggle = useMutation({
    mutationFn: async ({ id, isSuspended }) => (await api.patch(`/admin/customers/${id}`, { isSuspended })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-customers"] });
      setSuspending(null);
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo actualizar el cliente.");
      setSuspending(null);
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, payload }) => (await api.patch(`/admin/customers/${id}`, payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-customers"] });
      setEditing(null);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar el cliente."),
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/admin/customers/${id}`),
    onSuccess: () => {
      toast.success("Cliente eliminado.");
      queryClient.invalidateQueries({ queryKey: ["admin-customers"] });
      setDeleting(null);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar el cliente."),
  });

  const rows = (data ?? []).filter((c) => c.fullName?.toLowerCase().includes(q.toLowerCase()) || c.email.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Clientes</h1>
      <p className="mb-4 text-[13.5px] text-outline">Compradores registrados. Puedes editar datos, suspender o eliminar cuentas.</p>

      <div className="mb-4 flex h-[42px] max-w-[340px] items-center gap-2 rounded-md border border-outline-variant bg-surface-container-lowest px-3">
        <Search className="h-4 w-4 text-outline" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente..." className="w-full border-none bg-transparent text-[13.5px] outline-none" />
      </div>

      <div className="overflow-x-auto rounded-lg border border-surface-container-high bg-surface-container-lowest">
        <div className="grid grid-cols-[2fr_1.4fr_1fr_1fr_1.6fr] gap-3 bg-surface-container-low px-[22px] py-3.5 text-[11.5px] font-bold uppercase tracking-wide text-outline min-w-[620px]">
          <span>Cliente</span><span>Provincia</span><span>Pedidos</span><span>Estado</span><span className="text-right">Acción</span>
        </div>
        {isLoading && <p className="p-5 text-body-md text-on-surface-variant">Cargando...</p>}
        {!isLoading && rows.length === 0 && <p className="p-5 text-body-md text-on-surface-variant">No hay clientes para esta búsqueda.</p>}
        {rows.map((c) => (
          <div
            key={c.id}
            className="grid min-w-[620px] grid-cols-[2fr_1.4fr_1fr_1fr_1.6fr] items-center gap-3 border-t border-surface-container px-[22px] py-3.5"
            style={{ opacity: c.isSuspended ? 0.55 : 1 }}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
                style={{ background: colorFor(c.id) }}
              >
                {c.fullName?.[0] ?? "?"}
              </span>
              <div>
                <div className="text-[13.5px] font-semibold text-on-surface">{c.fullName}</div>
                <div className="text-[11.5px] text-outline">{c.email}</div>
              </div>
            </div>
            <span className="text-[13px] text-on-surface-variant">{c.province ?? "—"}</span>
            <span className="text-[13px] text-on-surface-variant">{c.orderCount}</span>
            <span
              className="w-fit rounded-full px-2.5 py-1 text-[11.5px] font-bold"
              style={c.isSuspended ? { background: "rgba(186,26,26,0.12)", color: "#ba1a1a" } : { background: "rgba(12,174,83,0.12)", color: "#0A8F42" }}
            >
              {c.isSuspended ? "Suspendido" : "Activo"}
            </span>
            <div className="flex flex-wrap justify-end gap-1.5">
              <button onClick={() => setEditing(c)} className="rounded-[7px] px-3 py-1.5 text-[12px] font-semibold border border-outline-variant text-on-surface-variant">
                Editar
              </button>
              <button
                onClick={() => (c.isSuspended ? toggle.mutate({ id: c.id, isSuspended: false }) : setSuspending(c))}
                className={`rounded-[7px] px-3 py-1.5 text-[12px] font-semibold ${
                  c.isSuspended ? "bg-verified-dark text-white" : "border border-outline-variant text-on-surface-variant"
                }`}
              >
                {c.isSuspended ? "Reactivar" : "Suspender"}
              </button>
              <button onClick={() => setDeleting(c)} className="rounded-[7px] bg-error px-3 py-1.5 text-[12px] font-semibold text-on-error">
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <EditCustomerModal
          customer={editing}
          saving={update.isPending}
          onCancel={() => setEditing(null)}
          onSave={(form) => update.mutate({ id: editing.id, payload: form })}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          title={`¿Eliminar a "${deleting.fullName ?? deleting.email}"?`}
          description="La cuenta no podrá volver a iniciar sesión. Sus pedidos históricos se conservan íntegros en los reportes."
          pending={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.id)}
        />
      )}

      <ConfirmModal
        open={!!suspending}
        title={`¿Suspender a "${suspending?.fullName ?? suspending?.email}"?`}
        message="La cuenta no va a poder iniciar sesión hasta que la reactives."
        confirmLabel={toggle.isPending ? "Suspendiendo..." : "Sí, suspender"}
        danger
        onConfirm={() => toggle.mutate({ id: suspending.id, isSuspended: true })}
        onCancel={() => setSuspending(null)}
      />
    </div>
  );
}
