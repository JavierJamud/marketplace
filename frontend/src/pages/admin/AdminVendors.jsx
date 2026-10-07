import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { X, Store, Radar, Star } from "lucide-react";
import { IconCircle, CARD } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { formatPrice } from "../../lib/format.js";
import { useListParams, useDebouncedSearch } from "../../lib/useListParams.js";
import { timeAgo, exactDate } from "../../lib/relativeTime.js";
import { StatTile, StatStrip, SortHeader, SearchField, RowSkeletons, Pagination, ActionMenu } from "../../components/admin/ListControls.jsx";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { AdminVendorStaffModal } from "../../components/admin/AdminVendorStaffModal.jsx";
import { UnsavedChangesModal } from "../../components/UnsavedChangesModal.jsx";
import { useDirtyModal } from "../../lib/useDirtyModal.js";

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


// Bloque 243 (pedido explícito — "mejorar la estructura visual de la sección
// de tiendas y mostrar más datos aprovechando las estadísticas"): misma
// estructura que Productos y Clientes (paginación, filtros y orden en el
// servidor, URL con el estado) y por fila ahora se ve la tienda "de un
// vistazo": plan, verificación, productos, pedidos, ventas de 30 días,
// valoración, último acceso y alertas de ranking pendientes. Las acciones
// pasan al menú "⋮" (antes 6 botones por fila).
const LIST_DEFAULTS = { q: "", status: "all", province: "", sort: "recent", dir: "desc", page: 1, pageSize: 25 };

const SORT_OPTIONS = [
  { value: "recent:desc", label: "Más recientes" },
  { value: "name:asc", label: "Nombre (A a Z)" },
  { value: "products:desc", label: "Más productos" },
  { value: "rating:desc", label: "Mejor valoradas" },
  { value: "lastLogin:desc", label: "Último acceso" },
];

const ROW_GRID =
  "md:grid md:grid-cols-[minmax(0,2.4fr)_128px_64px_96px_112px_60px_92px_44px] md:items-center md:gap-3";

const VERIFICATION_LABEL = {
  NOT_STARTED: "Sin verificar",
  PENDING_DOCS: "Faltan documentos",
  IN_REVIEW: "En revisión",
  PENDING_PAYMENT: "Pago pendiente",
  PAYMENT_FAILED: "Pago fallido",
  REJECTED: "Rechazada",
  SUSPENDED: "Verificación suspendida",
};

function VendorRow({ v, onStats, onStaff, onEdit, onTogglePlan, onBlock, onDelete, onRestore, onPermanent }) {
  const place = v.locations?.[0]?.province?.name ?? null;
  const hasSales = v.sales30 > 0;
  const pending = !!v.adminDeletionRequestedAt;
  const menu = (
    <ActionMenu
      label={`Acciones de ${v.companyName}`}
      items={
        pending
          ? [
              // Bloque 272: en eliminación pendiente solo se puede restaurar o eliminar ya.
              { label: "Restaurar tienda", onClick: onRestore },
              { label: "Ver estadísticas", onClick: onStats },
              { label: "Eliminar definitivamente", onClick: onPermanent, danger: true },
            ]
          : [
              { label: "Ver estadísticas", onClick: onStats },
              { label: "Usuarios del sistema", onClick: onStaff },
              { label: "Ver tienda pública", onClick: () => window.open(`/tienda/${v.slug}`, "_blank", "noopener") },
              { label: "Editar", onClick: onEdit },
              { label: v.planType === "BUSINESS" ? "Pasar a plan Regular" : "Pasar a plan Business", onClick: onTogglePlan },
              { label: "Bloquear", onClick: onBlock },
              { label: "Eliminar", onClick: onDelete, danger: true },
            ]
      }
    />
  );
  return (
    <div className={`border-b border-surface-container px-4 py-2.5 last:border-b-0 ${ROW_GRID}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full font-display text-sm font-bold text-white"
          style={{ background: v.color ?? "#232F3E" }}
          aria-hidden="true"
        >
          {v.companyName[0]?.toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold text-on-surface">{v.companyName}</span>
            {v.isVerified && <VerifiedBadge size="sm" />}
            {v.pendingAnomalies > 0 && (
              <Link
                to="/admin/anomalias-ranking"
                title={`${v.pendingAnomalies} anomalía${v.pendingAnomalies === 1 ? "" : "s"} de ranking por revisar`}
                className="flex flex-shrink-0 items-center gap-0.5 rounded-full bg-secondary/10 px-1.5 py-0.5 text-[10px] font-bold text-secondary"
              >
                <Radar className="h-2.5 w-2.5" /> {v.pendingAnomalies}
              </Link>
            )}
          </div>
          <div className="truncate text-[11.5px] text-outline">{[v.category?.name, place].filter(Boolean).join(" · ") || "Sin rubro ni provincia"}</div>
          {pending && v.deletionScheduledFor && (
            <div className="mt-0.5 text-[11.5px] font-semibold text-error">
              Se elimina definitivamente el {new Date(v.deletionScheduledFor).toLocaleDateString("es-CU", { day: "numeric", month: "short", year: "numeric" })}
            </div>
          )}
        </div>
        <div className="md:hidden">{menu}</div>
      </div>

      {/* Celular: plan, verificación y números en una sola línea de datos */}
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[52px] text-[12px] text-on-surface-variant md:hidden">
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${v.planType === "BUSINESS" ? "bg-secondary-container/25 text-secondary" : "bg-surface-container text-on-surface-variant"}`}>
          {v.planType === "BUSINESS" ? "Business" : "Regular"}
        </span>
        {!v.isVerified && <span>{VERIFICATION_LABEL[v.verificationStatus] ?? v.verificationStatus}</span>}
        <span>{v.productCount} {v.productCount === 1 ? "producto" : "productos"}</span>
        <span>{v.orders30} {v.orders30 === 1 ? "pedido" : "pedidos"} (30 d)</span>
        {hasSales && <span className="font-semibold text-on-surface">{formatPrice(v.sales30, v.currency)}</span>}
        {Number(v.rating) > 0 && (
          <span className="flex items-center gap-0.5">
            <Star className="h-3 w-3 fill-secondary-container text-secondary-container" /> {Number(v.rating).toFixed(1)}
          </span>
        )}
        <span>{v.lastLoginAt ? `Entró ${timeAgo(v.lastLoginAt).toLowerCase()}` : "Nunca entró"}</span>
      </div>

      <div className="hidden flex-col items-start gap-1 md:flex">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${v.planType === "BUSINESS" ? "bg-secondary-container/25 text-secondary" : "bg-surface-container text-on-surface-variant"}`}>
          {v.planType === "BUSINESS" ? "Business" : "Regular"}
        </span>
        <span className="text-[11px] text-outline">{v.isVerified ? "Verificada" : VERIFICATION_LABEL[v.verificationStatus] ?? v.verificationStatus}</span>
      </div>
      <div className="hidden text-right text-[13px] text-on-surface md:block">{v.productCount}</div>
      <div className="hidden text-right text-[13px] text-on-surface md:block" title="Pedidos entregados y pedidos de mesa de los últimos 30 días">
        {v.orders30}
      </div>
      <div className="hidden text-right text-[13px] font-semibold text-on-surface md:block">{hasSales ? formatPrice(v.sales30, v.currency) : <span className="font-normal text-outline">—</span>}</div>
      <div className="hidden text-right text-[13px] text-on-surface-variant md:block">
        {Number(v.rating) > 0 ? (
          <span className="inline-flex items-center gap-0.5">
            <Star className="h-3 w-3 fill-secondary-container text-secondary-container" /> {Number(v.rating).toFixed(1)}
          </span>
        ) : (
          "—"
        )}
      </div>
      <div className="hidden text-[13px] text-on-surface-variant md:block" title={exactDate(v.lastLoginAt)}>
        {timeAgo(v.lastLoginAt)}
      </div>
      <div className="hidden justify-end md:flex">{menu}</div>
    </div>
  );
}

export default function AdminVendors() {
  const queryClient = useQueryClient();
  const [params, setParams] = useListParams(LIST_DEFAULTS);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [permanent, setPermanent] = useState(null); // tienda en eliminación pendiente que se va a eliminar ya
  const [viewingStats, setViewingStats] = useState(null);
  // Bloque 183 (pedido explícito — "el administrador general del sistema
  // también puede controlar y verificar lo mismo que pueda hacer el
  // vendedor... poder verificar cuáles son los usuarios que ha creado ese
  // vendedor"): mismo mirror que ya tiene el propio dueño en su panel
  // (VendorUsers.jsx), acá scopeado por vendorId en vez de resolveMyVendor.
  const [viewingStaff, setViewingStaff] = useState(null);
  const [blocking, setBlocking] = useState(null); // tienda a bloquear, para el modal de confirmación
  const [blockReason, setBlockReason] = useState("");

  const commitSearch = useCallback((q) => setParams({ q }), [setParams]);
  const [searchText, setSearchText] = useDebouncedSearch(params.q, commitSearch);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["admin-list-vendors", params],
    queryFn: async () =>
      (
        await api.get("/admin/vendors", {
          params: {
            q: params.q || undefined,
            status: params.status,
            provinceId: params.province || undefined,
            sort: params.sort,
            dir: params.dir,
            page: params.page,
            pageSize: params.pageSize,
          },
        })
      ).data,
    placeholderData: keepPreviousData,
  });

  const { data: provinces } = useQuery({
    queryKey: ["locations-provinces"],
    queryFn: async () => (await api.get("/locations/provinces")).data.provinces,
  });

  const update = useMutation({
    mutationFn: async ({ id, payload }) => (await api.patch(`/admin/vendors/${id}`, payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-list-vendors"] });
      queryClient.invalidateQueries({ queryKey: ["admin-vendor-pick"] });
      setEditing(null);
      setBlocking(null);
      setBlockReason("");
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo actualizar la tienda.");
    },
  });

  // Bloque 272: eliminar = pasar a "eliminación pendiente" (plazo configurable en Seguridad).
  const { data: security } = useQuery({
    queryKey: ["admin-security-settings"],
    queryFn: async () => (await api.get("/admin/security/settings")).data.settings,
  });
  const deletionDays = security?.vendorDeletionDays ?? 30;

  const remove = useMutation({
    mutationFn: async (id) => (await api.delete(`/admin/vendors/${id}`)).data,
    onSuccess: (result) => {
      const when = result?.scheduledFor ? new Date(result.scheduledFor).toLocaleDateString("es-CU", { day: "numeric", month: "long" }) : null;
      toast.success(`La tienda pasó a eliminación pendiente${when ? `: se eliminará el ${when} si no la restauras` : ""}.`);
      queryClient.invalidateQueries({ queryKey: ["admin-list-vendors"] });
      setDeleting(null);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar la tienda."),
  });
  const restore = useMutation({
    mutationFn: async (id) => (await api.post(`/admin/vendors/${id}/restore-deletion`)).data,
    onSuccess: () => {
      toast.success("Tienda restaurada: vuelve a estar visible.");
      queryClient.invalidateQueries({ queryKey: ["admin-list-vendors"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo restaurar la tienda."),
  });
  // Pide el código enviado al correo (lo gestiona ActionCodeProvider al recibir el 403).
  const removeForever = useMutation({
    mutationFn: async (id) => api.delete(`/admin/vendors/${id}/permanent`),
    onSuccess: () => {
      toast.success("Tienda eliminada definitivamente.");
      queryClient.invalidateQueries({ queryKey: ["admin-list-vendors"] });
      setPermanent(null);
    },
    onError: (err) => {
      if (!err.actionCodeCancelled) toast.error(err.response?.data?.error ?? "No se pudo eliminar la tienda.");
      setPermanent(null);
    },
  });

  // Si al borrar o filtrar la página actual queda más allá del final, vuelve
  // a la última que existe.
  useEffect(() => {
    if (data && data.vendors.length === 0 && params.page > 1) setParams({ page: data.pageCount });
  }, [data, params.page, setParams]);

  const kpis = data?.kpis;
  const hasFilters = params.q || params.status !== "all" || params.province;
  const sortValue = `${params.sort}:${params.dir}`;
  const tiles = [
    { key: "all", label: "Todas", value: kpis?.all },
    { key: "verified", label: "Verificadas", value: kpis?.verified },
    { key: "inprocess", label: "En proceso", value: kpis?.inprocess, hint: "Verificación" },
    { key: "unverified", label: "Sin verificar", value: kpis?.unverified },
    { key: "business", label: "Business", value: kpis?.business },
    { key: "inactive", label: "Inactivas", value: kpis?.inactive, hint: "30 días sin entrar", tone: "warn" },
    { key: "flagged", label: "Con alertas", value: kpis?.flagged, hint: "Ranking", tone: "danger" },
    { key: "deletion", label: "Eliminación pendiente", value: kpis?.deletion, hint: `Se borran a los ${deletionDays} días`, tone: "danger" },
  ];
  const onSort = (sort, dir) => setParams({ sort, dir });

  return (
    <div className="max-w-[1180px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Store} tone="teal" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Tiendas</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">Gestiona, verifica a dedo, edita o elimina tiendas. El bloqueo oculta, no borra.</p>

      <StatStrip>
        {tiles.map((t) => (
          <StatTile
            key={t.key}
            label={t.label}
            value={t.value}
            hint={t.hint}
            tone={t.tone}
            active={params.status === t.key}
            onClick={() => setParams({ status: t.key })}
          />
        ))}
      </StatStrip>

      <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <SearchField value={searchText} onChange={setSearchText} placeholder="Buscar por nombre, enlace o correo" className="sm:col-span-2 lg:col-span-1" />
        <select
          value={params.province}
          onChange={(e) => setParams({ province: e.target.value })}
          aria-label="Filtrar por provincia"
          className="h-11 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[13px] md:h-10"
        >
          <option value="">Todas las provincias</option>
          {provinces?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={sortValue}
          onChange={(e) => {
            const [sort, dir] = e.target.value.split(":");
            setParams({ sort, dir });
          }}
          aria-label="Ordenar tiendas"
          className="h-11 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[13px] md:h-10"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {!SORT_OPTIONS.some((o) => o.value === sortValue) && <option value={sortValue}>Orden personalizado</option>}
        </select>
      </div>

      <div className={`${CARD} transition-opacity ${isFetching && !isLoading ? "opacity-70" : ""}`}>
        <div className={`hidden rounded-t-2xl border-b border-surface-container bg-surface-container/50 px-4 py-2 ${ROW_GRID}`}>
          <SortHeader label="Tienda" sortKey="name" sort={params.sort} dir={params.dir} onSort={(s, d) => onSort(s, s === "name" && d === "desc" ? "asc" : d)} />
          <span className="text-[11px] font-bold uppercase tracking-wide text-outline">Plan</span>
          <SortHeader label="Prod." sortKey="products" sort={params.sort} dir={params.dir} onSort={onSort} align="right" />
          <span className="text-right text-[11px] font-bold uppercase tracking-wide text-outline">Pedidos 30 d</span>
          <span className="text-right text-[11px] font-bold uppercase tracking-wide text-outline">Ventas 30 d</span>
          <SortHeader label="Nota" sortKey="rating" sort={params.sort} dir={params.dir} onSort={onSort} align="right" />
          <SortHeader label="Acceso" sortKey="lastLogin" sort={params.sort} dir={params.dir} onSort={onSort} />
          <span />
        </div>

        {isLoading && <RowSkeletons />}

        {isError && !data && (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-body-md text-error">No se pudo cargar la lista de tiendas.</p>
            <Button variant="outline" onClick={() => refetch()}>
              Reintentar
            </Button>
          </div>
        )}

        {data?.vendors.map((v) => (
          <VendorRow
            key={v.id}
            v={v}
            onStats={() => setViewingStats(v)}
            onStaff={() => setViewingStaff(v)}
            onEdit={() => setEditing(v)}
            onTogglePlan={() => update.mutate({ id: v.id, payload: { planType: v.planType === "BUSINESS" ? "REGULAR" : "BUSINESS" } })}
            onBlock={() => setBlocking(v)}
            onDelete={() => setDeleting(v)}
            onRestore={() => restore.mutate(v.id)}
            onPermanent={() => setPermanent(v)}
          />
        ))}

        {data && data.vendors.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <Store className="h-6 w-6 text-outline" />
            <p className="text-body-md text-on-surface-variant">{hasFilters ? "Ninguna tienda coincide con estos filtros." : "Todavía no hay tiendas registradas."}</p>
            {hasFilters && (
              <Button variant="outline" onClick={() => setParams({ q: "", status: "all", province: "" })}>
                Limpiar filtros
              </Button>
            )}
          </div>
        )}
      </div>

      {data && (
        <Pagination
          page={data.page}
          pageCount={data.pageCount}
          total={data.total}
          pageSize={data.pageSize}
          onPage={(page) => setParams({ page })}
          onPageSize={(pageSize) => setParams({ pageSize })}
          noun="tiendas"
        />
      )}

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

      <ConfirmModal
        open={!!deleting}
        title={`¿Eliminar "${deleting?.companyName}"?`}
        message={`La tienda se oculta de todo el sitio y su dueño no podrá entrar. No se borra todavía: queda en "Eliminación pendiente" durante ${deletionDays} días. Si no la restauras en ese plazo, se elimina sola y de forma definitiva. Puedes eliminarla antes desde el filtro "Eliminación pendiente". Para confirmar este cambio se te pedirá un código enviado a tu correo.`}
        confirmLabel={remove.isPending ? "Eliminando..." : "Continuar"}
        danger
        confirmDisabled={remove.isPending}
        onConfirm={() => remove.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
      {permanent && (
        <ConfirmDeleteModal
          title={`¿Eliminar definitivamente "${permanent.companyName}"?`}
          description="Se elimina ya, sin esperar el plazo. Sus pedidos y reseñas históricos se conservan, pero la tienda y su cuenta no se pueden recuperar. Antes de eliminar se te pedirá un código enviado a tu correo."
          confirmLabel="Eliminar definitivamente"
          pending={removeForever.isPending}
          onCancel={() => setPermanent(null)}
          onConfirm={() => removeForever.mutate(permanent.id)}
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
