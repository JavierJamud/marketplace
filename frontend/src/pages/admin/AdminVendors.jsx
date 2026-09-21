import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Search, X, BarChart3, Users, Store } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { AdminVendorStaffModal } from "../../components/admin/AdminVendorStaffModal.jsx";
import { UnsavedChangesModal } from "../../components/UnsavedChangesModal.jsx";
import { useDirtyModal } from "../../lib/useDirtyModal.js";

const FILTERS = [
  { id: "all", label: "Todas" },
  { id: "business", label: "Business" },
  { id: "regular", label: "Regular" },
];

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

// Bloque 165 (pedido explícito — "poder editar datos en tiendas y corregir
// errores... como cambiar la contraseña y correo o nombre o descripción o
// lo que sea que se pueda modificar"): antes solo dejaba tocar 3 campos —
// se suma acá TODO lo de identidad (nombre del responsable, su ID, la
// dirección de la empresa, la descripción pública), justo lo que hacía
// falta para poder corregir una tienda vieja que quedó con esos campos
// vacíos (candado de identidad de updateMyVendor, backend, que el admin no
// tiene por qué respetar — para eso está este formulario). Contraseña y
// correo de LOGIN van aparte, con su propio botón — son acciones sensibles
// de cuenta, no un campo más del formulario general.
function EditVendorModal({ vendor, onSave, onCancel, saving }) {
  const [form, setForm] = useState({
    companyName: vendor.companyName,
    whatsapp: vendor.whatsapp,
    email: vendor.email ?? "",
    ownerName: vendor.ownerName ?? "",
    ownerIdNumber: vendor.ownerIdNumber ?? "",
    companyAddress: vendor.companyAddress ?? "",
    description: vendor.description ?? "",
    color: vendor.color ?? "#232F3E",
  });
  const [newPassword, setNewPassword] = useState("");
  const [newLoginEmail, setNewLoginEmail] = useState("");

  // Bloque 196 (pedido explícito — "si se hace clic fuera de un contenedor
  // mostrado como ventana o popup en el panel debe cerrarse automáticamente,
  // y si necesita que guarden datos debe preguntar si desea guardar o
  // descartar antes de cerrar"): solo el formulario general de arriba
  // (`form`) cuenta como borrador — contraseña/correo de acceso tienen sus
  // propios botones de acción inmediata (Restablecer/Cambiar), separados
  // del "Guardar" de este form, igual que las fotos en ProductModal
  // (VendorProducts.jsx) no cuentan para su isDirty.
  const initialFormSnapshot = useRef(JSON.stringify(form));
  const isDirty = JSON.stringify(form) !== initialFormSnapshot.current;
  const dirtyModal = useDirtyModal({ isDirty, onClose: onCancel, onSave: () => onSave(form) });

  const resetPassword = useMutation({
    mutationFn: async () => (await api.post(`/admin/vendors/${vendor.id}/reset-password`, { newPassword })).data,
    onSuccess: () => {
      toast.success("Contraseña restablecida.");
      setNewPassword("");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo restablecer la contraseña."),
  });

  const changeLoginEmail = useMutation({
    mutationFn: async () => (await api.patch(`/admin/vendors/${vendor.id}/login-email`, { email: newLoginEmail })).data,
    onSuccess: () => {
      toast.success("Correo de acceso actualizado.");
      setNewLoginEmail("");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo cambiar el correo de acceso."),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl bg-surface-container-lowest p-6">
        <h2 className="mb-4 text-title-lg font-bold text-on-surface">Editar tienda</h2>
        <div className="flex flex-col gap-3.5">
          <Input label="Nombre de la tienda" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          <Input label="WhatsApp (con código de país)" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
          <div>
            {/* Bloque 222 (pedido explícito): el color del banner de la
                tienda lo asigna el sistema al crearla — de ahí en más,
                cambiarlo es una acción exclusiva del admin (ya no vive en
                VendorProfile.jsx del propio vendedor). */}
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Color del banner de la tienda</span>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="h-10 w-14 cursor-pointer rounded-lg border border-outline-variant bg-transparent p-0.5"
              />
              <span className="text-[12.5px] font-mono text-on-surface-variant">{form.color.toUpperCase()}</span>
            </div>
          </div>
          <Input label="Correo de la tienda (contacto público)" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Descripción pública</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-md text-on-surface outline-none focus:border-primary-container"
            />
          </div>
          <p className="mt-1 border-t border-surface-container-high pt-3 text-label-sm font-bold text-on-surface-variant">
            Datos de identidad (privados)
          </p>
          <Input label="Nombre del responsable" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
          <Input label="Identificación del responsable" value={form.ownerIdNumber} onChange={(e) => setForm({ ...form, ownerIdNumber: e.target.value })} />
          <Input label="Dirección de la empresa" value={form.companyAddress} onChange={(e) => setForm({ ...form, companyAddress: e.target.value })} />
        </div>
        <div className="mt-5 flex gap-2.5">
          <button onClick={onCancel} disabled={saving} className="flex-1 rounded-full border border-outline-variant py-2.5 text-label-md font-semibold text-on-surface-variant">
            Cancelar
          </button>
          <Button className="flex-1" onClick={() => onSave(form)} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </div>

        <p className="mt-5 border-t border-surface-container-high pt-3 text-label-sm font-bold text-on-surface-variant">
          Acceso a la cuenta
        </p>
        <div className="mt-2.5 flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="Nueva contraseña"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
            />
          </div>
          <button
            onClick={() => resetPassword.mutate()}
            disabled={newPassword.length < 8 || resetPassword.isPending}
            className="h-11 flex-shrink-0 rounded-md bg-surface-container px-3.5 text-label-sm font-bold text-on-surface-variant disabled:opacity-50"
          >
            {resetPassword.isPending ? "..." : "Restablecer"}
          </button>
        </div>
        <div className="mt-2.5 flex items-end gap-2">
          <div className="flex-1">
            <Input label="Nuevo correo de acceso (login)" type="email" value={newLoginEmail} onChange={(e) => setNewLoginEmail(e.target.value)} />
          </div>
          <button
            onClick={() => changeLoginEmail.mutate()}
            disabled={!newLoginEmail.trim() || changeLoginEmail.isPending}
            className="h-11 flex-shrink-0 rounded-md bg-surface-container px-3.5 text-label-sm font-bold text-on-surface-variant disabled:opacity-50"
          >
            {changeLoginEmail.isPending ? "..." : "Cambiar"}
          </button>
        </div>
      </div>

      <UnsavedChangesModal
        open={dirtyModal.confirming}
        saving={dirtyModal.saving}
        onSave={dirtyModal.handleSaveAndClose}
        onDiscard={dirtyModal.handleDiscard}
        onCancel={dirtyModal.handleKeepEditing}
      />
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
    // Bloque 196: solo lectura (estadísticas + pedidos de mesa), cierra
    // directo al hacer clic afuera.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
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
                    <span>
                      Mesa {o.table.tableNumber}
                      {o.customerName ? ` · ${o.customerName}` : ""} · {fmtCUP(o.total)}
                    </span>
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
  // Bloque 183 (pedido explícito — "el administrador general del sistema
  // también puede controlar y verificar lo mismo que pueda hacer el
  // vendedor... poder verificar cuáles son los usuarios que ha creado ese
  // vendedor"): mismo mirror que ya tiene el propio dueño en su panel
  // (VendorUsers.jsx), acá scopeado por vendorId en vez de resolveMyVendor.
  const [viewingStaff, setViewingStaff] = useState(null);
  const [blocking, setBlocking] = useState(null); // tienda a bloquear, para el modal de confirmación
  const [blockReason, setBlockReason] = useState("");

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
      setBlockReason("");
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo actualizar la tienda.");
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
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Store} tone="teal" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Tiendas</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">Gestiona, verifica a dedo, edita o elimina tiendas. El bloqueo oculta, no borra.</p>

      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex h-[42px] max-w-[340px] flex-1 items-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-3">
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

      <div className="overflow-x-auto rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
        <div className="grid grid-cols-[2fr_1.2fr_1fr_1fr_2fr] gap-3 bg-surface-container-low px-[22px] py-3.5 text-[11.5px] font-bold uppercase tracking-wide text-outline min-w-[640px]">
          <span>Tienda</span><span>Provincia</span><span>Plan</span><span>Estado</span><span className="text-right">Acciones</span>
        </div>
        {isLoading && <p className="p-5 text-body-md text-on-surface-variant">Cargando...</p>}
        {!isLoading && rows.length === 0 && <p className="p-5 text-body-md text-on-surface-variant">No hay tiendas para este filtro.</p>}
        {rows.map((v) => (
          <div
            key={v.id}
            className="grid min-w-[640px] grid-cols-[2fr_1.2fr_1fr_1fr_2fr] items-center gap-3 border-t border-surface-container px-[22px] py-3.5"
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
              <button
                onClick={() => setViewingStaff(v)}
                title="Usuarios de sistema de esta tienda"
                className="flex items-center gap-1 rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[12px] font-semibold text-on-surface-variant"
              >
                <Users className="h-3.5 w-3.5" />
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
          // Bloque 196: mutateAsync (misma mutación `update` de siempre, solo
          // la variante que devuelve una promesa) — hace falta para que
          // useDirtyModal (dentro de EditVendorModal) pueda esperar a que el
          // guardado realmente termine antes de cerrar el modal.
          onSave={(form) => update.mutateAsync({ id: editing.id, payload: form })}
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
      {viewingStaff && <AdminVendorStaffModal vendor={viewingStaff} onClose={() => setViewingStaff(null)} />}

      <ConfirmModal
        open={!!blocking}
        title={`¿Bloquear "${blocking?.companyName}"?`}
        message="La tienda se oculta de todo el sitio. El dueño sí puede entrar a su panel, pero ve el motivo que escribas abajo y no puede usar ninguna sección hasta que la desbloquees."
        confirmLabel={update.isPending ? "Bloqueando..." : "Sí, bloquear"}
        danger
        confirmDisabled={blockReason.trim().length < 5 || update.isPending}
        onConfirm={() => update.mutate({ id: blocking.id, payload: { isBlocked: true, blockReason: blockReason.trim() } })}
        onCancel={() => {
          setBlocking(null);
          setBlockReason("");
        }}
      >
        <textarea
          value={blockReason}
          onChange={(e) => setBlockReason(e.target.value)}
          placeholder="Motivo del bloqueo (obligatorio, lo va a ver el vendedor)..."
          rows={3}
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
      </ConfirmModal>
    </div>
  );
}
