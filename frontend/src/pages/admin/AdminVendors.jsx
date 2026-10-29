import { useCallback, useEffect, useRef, useState } from "react";
import { RatingBreakdown } from "../../components/RatingBreakdown.jsx";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { ManageVendorMunicipalitiesModal } from "../../components/ZoneMunicipalitiesModal.jsx";
import toast from "../../lib/toast.jsx";
import { X, Store, Radar, Star } from "lucide-react";
import { IconCircle, CARD } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { formatPrice } from "../../lib/format.js";
import { useListParams, useDebouncedSearch } from "../../lib/useListParams.js";
import { timeAgo, exactDate } from "../../lib/relativeTime.js";
import { StatTile, StatStrip, SortHeader, SearchField, RowSkeletons, Pagination } from "../../components/admin/ListControls.jsx";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { RepresentativeFileModal } from "../../components/admin/RepresentativeFileModal.jsx";
import { UnsavedChangesModal } from "../../components/UnsavedChangesModal.jsx";
import { useDirtyModal } from "../../lib/useDirtyModal.js";
import { SuspendedVendorsList, useSuspendedVendors } from "./AdminSuspendedVendors.jsx";
import { OrderLookup } from "../../components/admin/OrderLookup.jsx";
import { VendorAvatar } from "../../components/ui/VendorAvatar.jsx";
import { trialDaysLeft } from "../../lib/planStatus.js";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

// Zona de servicio de la tienda (provincia y municipios), dentro de "Editar tienda". Antes el admin solo veía la provincia y
// no podía corregirla. Cada cambio se guarda al momento, con su código de acción, como la contraseña y el correo de acceso:
// no forma parte del "Guardar" del formulario. Usa el mismo selector de municipios que la tienda en Configuración.
function VendorZoneEditor({ vendor }) {
  const queryClient = useQueryClient();
  const [managing, setManaging] = useState(null);
  const zoneLocations = vendor.zoneLocations ?? [];
  const { data: provinces } = useQuery({
    queryKey: ["locations-provinces"],
    queryFn: async () => (await api.get("/locations/provinces")).data.provinces,
  });

  // Una fila por provincia: sus municipios, o "toda la provincia" si tiene la zona sin municipio.
  const groups = [];
  for (const l of zoneLocations) {
    if (!l.province) continue;
    let g = groups.find((x) => x.province.id === l.provinceId);
    if (!g) groups.push((g = { province: l.province, whole: false, towns: [] }));
    if (l.municipality) g.towns.push(l.municipality.name);
    else g.whole = true;
  }
  // Solo provincias del país (o países) donde ya opera la tienda; sin zona, las de Cuba. La lista completa traía cientos de
  // provincias de todos los países, con nombres repetidos entre países.
  const { data: countries } = useQuery({
    queryKey: ["locations-countries"],
    queryFn: async () => (await api.get("/locations/countries")).data.countries,
  });
  const zoneCountryIds = new Set(groups.map((g) => g.province.countryId).filter(Boolean));
  if (!zoneCountryIds.size) {
    const cuba = countries?.find((c) => c.code === "CU");
    if (cuba) zoneCountryIds.add(cuba.id);
  }
  const available = (provinces ?? []).filter((p) => zoneCountryIds.has(p.countryId) && !groups.some((g) => g.province.id === p.id));

  const save = useMutation({
    mutationFn: async ({ provinceId, municipalityIds }) => (await api.post(`/admin/vendors/${vendor.id}/zone`, { provinceId, municipalityIds })).data,
    onSuccess: () => {
      toast.success("Zona de servicio actualizada.");
      setManaging(null);
      queryClient.invalidateQueries({ queryKey: ["admin-vendor-manage", vendor.id] });
      queryClient.invalidateQueries({ queryKey: ["admin-list-vendors"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar la zona."),
  });

  return (
    <div className="mt-5 border-t border-surface-container-high pt-3">
      <p className="text-label-sm font-bold text-on-surface-variant">Zona de servicio</p>
      <p className="mt-0.5 text-[12px] text-outline">Dónde presta servicio. Decide en qué filtros por lugar aparece la tienda. Se guarda al momento.</p>
      {groups.length === 0 ? (
        <p className="mt-2.5 rounded-lg bg-error/5 px-3 py-2 text-[12.5px] text-error">Sin zona: no aparece al filtrar por provincia o municipio.</p>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-2">
          {groups.map((g) => (
            <li key={g.province.id} className="flex items-center gap-2 rounded-lg border border-surface-container-high px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-on-surface">{g.province.name}</p>
                <p className="text-[12.5px] text-on-surface-variant">
                  {g.whole ? (g.province.type === "STATE" ? "Todo el estado" : "Toda la provincia") : [...g.towns].sort((a, b) => a.localeCompare(b, "es")).join(", ")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManaging(g.province)}
                className="h-11 flex-shrink-0 rounded-md bg-surface-container px-3.5 text-label-sm font-bold text-on-surface-variant hover:bg-surface-container-high"
              >
                Cambiar
              </button>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            const p = available.find((x) => x.id === e.target.value);
            if (p) setManaging(p);
          }}
          aria-label="Agregar otra provincia a la zona de servicio"
          className="mt-2.5 h-11 w-full rounded-md border border-outline-variant bg-surface-container-lowest px-3 text-[13px] text-on-surface"
        >
          <option value="">Agregar otra provincia...</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {managing && (
        <ManageVendorMunicipalitiesModal
          province={managing}
          vendorLocations={zoneLocations}
          isPending={save.isPending}
          onClose={() => setManaging(null)}
          onSave={({ provinceId, municipalityIds }) => save.mutate({ provinceId, municipalityIds })}
        />
      )}
    </div>
  );
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
export function EditVendorModal({ vendor, onSave, onCancel, saving }) {
  const [form, setForm] = useState({
    companyName: vendor.companyName,
    whatsapp: vendor.whatsapp,
    email: vendor.email ?? "",
    ownerName: vendor.ownerName ?? "",
    ownerIdNumber: vendor.ownerIdNumber ?? "",
    companyAddress: vendor.companyAddress ?? "",
    description: vendor.description ?? "",
    color: vendor.color ?? "#232F3E",
    businessCategoryId: vendor.businessCategoryId ?? "",
  });
  const [newPassword, setNewPassword] = useState("");
  // Rubro de la tienda: todas las categorías de negocio (también las inactivas, por si la tienda ya tiene una).
  const { data: businessCategories } = useQuery({
    queryKey: ["admin-business-categories"],
    queryFn: async () => (await api.get("/admin/business-categories")).data.categories,
  });
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
      <div className="modal-panel-6 w-full max-w-md rounded-xl bg-surface-container-lowest p-6">
        <h2 className="mb-4 text-title-lg font-bold text-on-surface">Editar tienda</h2>
        <div className="flex flex-col gap-3.5">
          <Input label="Nombre de la tienda" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          <Input label="WhatsApp (con código de país)" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
          <div>
            <label htmlFor="edit-vendor-category" className="mb-1.5 block text-label-md text-on-surface-variant">Rubro (categoría de negocio)</label>
            <select
              id="edit-vendor-category"
              value={form.businessCategoryId}
              onChange={(e) => setForm({ ...form, businessCategoryId: e.target.value })}
              className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-body-md text-on-surface outline-none focus:border-primary-container"
            >
              {!form.businessCategoryId && <option value="">Sin rubro</option>}
              {businessCategories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? "" : " (inactiva)"}
                </option>
              ))}
            </select>
          </div>
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
          <Input data-guard="name" label="Nombre del responsable" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
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

        <VendorZoneEditor vendor={vendor} />

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

export function StatsModal({ vendorName, onClose }) {
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
      <div className="modal-panel-6 w-full max-w-sm rounded-xl bg-surface-container-lowest p-6">
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
              ["Calificación promedio", data.reviews?.count ? `${data.rating.toFixed(1)} ★ (${data.reviews.count} ${data.reviews.count === 1 ? "reseña" : "reseñas"})` : "Sin reseñas todavía"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between border-b border-surface-container pb-2.5 last:border-b-0">
                <span className="text-[13px] text-outline">{label}</span>
                <span className="text-[13.5px] font-bold text-on-surface">{value}</span>
              </div>
            ))}
            <div className="border-t border-surface-container pt-3">
              <h3 className="mb-2 text-[12.5px] font-bold uppercase tracking-wide text-outline">Reseñas por estrellas</h3>
              <RatingBreakdown summary={data.reviews} />
            </div>
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
// `plan` es la clave de un plan (?plan=PLAN_RESTAURANTE): la tarjeta de cada plan en Suscripciones enlaza aquí.
const LIST_DEFAULTS = { q: "", status: "all", province: "", municipality: "", plan: "", sort: "recent", dir: "desc", page: 1, pageSize: 25 };

// Planes de la base (los de /settings: sin archivados, con los ocultos), en su orden. Misma queryKey que
// usePlatformSettings, así react-query comparte una sola copia. Ya no hay 4 planes fijos: el admin crea y archiva.
// No se usa usePlatformSettings().plans porque ese hook no expone si /settings sigue cargando o falló, y el modal de
// activar un plan (AdminVendorManage) necesita distinguir "cargando", "no se pudo cargar" y "no hay planes".
export function useAdminPlanList() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
    staleTime: 5 * 60 * 1000,
  });
  const plans = [...(data?.plans ?? [])].filter((p) => !p.archivedAt).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return { plans, isLoading, isError };
}

// Grupos de planes que acepta GET /admin/vendors en ?plan= además de una clave (ver vendorsQuerySchema en admin.controller).
const PLAN_GROUP_FILTERS = ["PAID", "DEFAULT"];
function defaultPlanFilterLabel(plans) {
  const name = plans.find((p) => p.isDefault)?.displayName;
  return name ? `Plan por defecto (${name})` : "Plan por defecto";
}

// Plan en el que está una tienda, como lo ve el admin. Un plan que no es el por defecto está activo si la tienda está
// verificada en él o, en un plan sin insignia, mientras tenga tiempo pagado (mismo criterio que isPremiumActive del
// backend); si no, rige el plan por defecto. El plan por defecto se reconoce por su bandera isDefault, no por su clave.
function vendorPlanLabel(vendor, plans) {
  const defaultPlan = plans.find((p) => p.isDefault);
  const current = plans.find((p) => p.planType === vendor.planType);
  const onDefault = defaultPlan ? vendor.planType === defaultPlan.planType : false;
  const paidTime = !!vendor.nextPaymentDueDate && new Date(vendor.nextPaymentDueDate) > new Date();
  const premium = !onDefault && (vendor.verificationStatus === "VERIFIED" || paidTime);
  const name = current?.displayName ?? vendor.planName ?? vendor.planType;
  const daysLeft = premium ? trialDaysLeft(vendor.trialEndsAt) : null;
  return {
    premium,
    trial: daysLeft != null,
    daysLeft,
    label: premium ? (daysLeft != null ? `${name} · Prueba gratis` : name) : defaultPlan?.displayName ?? name,
    daysLabel: daysLeft == null ? null : daysLeft === 1 ? "Queda 1 día" : `Quedan ${daysLeft} días`,
  };
}

const SORT_OPTIONS = [
  { value: "recent:desc", label: "Más recientes" },
  { value: "name:asc", label: "Nombre (A a Z)" },
  { value: "products:desc", label: "Más productos" },
  { value: "rating:desc", label: "Mejor valoradas" },
  { value: "lastLogin:desc", label: "Último acceso" },
];

const ROW_GRID =
  "md:grid md:grid-cols-[minmax(0,2.4fr)_112px_48px_80px_100px_60px_84px_158px] md:items-center md:gap-3";

const VERIFICATION_LABEL = {
  NOT_STARTED: "Sin verificar",
  PENDING_DOCS: "Faltan documentos",
  IN_REVIEW: "En revisión",
  PENDING_PAYMENT: "Pago pendiente",
  PAYMENT_FAILED: "Pago fallido",
  REJECTED: "Rechazada",
  SUSPENDED: "Verificación suspendida",
  // Volvió al plan por defecto: el nombre real lo pone la fila (sale de la base).
  PLAN_ENDED: "Volvió al plan por defecto",
};

function verificationLabel(status, plans) {
  if (status === "PLAN_ENDED") {
    const name = plans.find((p) => p.isDefault)?.displayName;
    if (name) return `Volvió a ${name}`;
  }
  return VERIFICATION_LABEL[status] ?? status;
}

function VendorRow({ v, plans }) {
  // Provincia y municipios donde presta servicio ("Segundo Frente (Santiago de Cuba)"), armado en el servidor.
  const place = v.zones?.length ? v.zones.join(" · ") : null;
  const hasSales = v.sales30 > 0;
  const pending = !!v.adminDeletionRequestedAt;
  const plan = vendorPlanLabel(v, plans);
  const planChip = (size) => (
    <span className={`rounded-full px-2 py-0.5 ${size} font-bold ${plan.trial ? "bg-tertiary-accent/10 text-tertiary-accent" : plan.premium ? "bg-secondary-container/25 text-secondary" : "bg-surface-container text-on-surface-variant"}`}>
      {plan.label}
    </span>
  );
  // Todas las acciones (editar, plan, bloquear, eliminar, responsable, usuarios, estadísticas) viven en la página Gestionar.
  // "Pedidos" abre esa misma página en la pestaña de pedidos, para dar soporte a la tienda en un clic.
  const linkClass =
    "flex min-h-11 items-center justify-center rounded-lg px-2.5 text-[12.5px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent md:min-h-10";
  const menu = (
    <div className="flex gap-1">
      <Link to={`/admin/tiendas/${v.id}?tab=pedidos`} aria-label={`Pedidos de ${v.companyName}`} className={`${linkClass} border border-outline-variant text-on-surface hover:bg-surface-container`}>
        Pedidos
      </Link>
      <Link to={`/admin/tiendas/${v.id}`} aria-label={`Gestionar ${v.companyName}`} className={`${linkClass} bg-surface-container text-on-surface hover:bg-surface-container-high`}>
        Gestionar
      </Link>
    </div>
  );
  return (
    <div className={`border-b border-surface-container px-4 py-2.5 last:border-b-0 ${ROW_GRID}`}>
      <div className="flex min-w-0 items-center gap-3">
        <VendorAvatar vendor={v} className="h-10 w-10 rounded-full text-sm" />
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
          <div className="truncate text-[11.5px] text-outline" title={place ?? undefined}>{[v.businessCategory?.name ?? v.category?.name, place].filter(Boolean).join(" · ") || "Sin rubro ni zona"}</div>
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
        {planChip("text-[10.5px]")}
        {plan.trial && <span className={plan.daysLeft <= 7 ? "font-semibold text-error" : ""}>{plan.daysLabel}</span>}
        {!v.isVerified && <span>{verificationLabel(v.verificationStatus, plans)}</span>}
        <span>{v.productCount} {v.productCount === 1 ? "producto" : "productos"}</span>
        <span>{v.orders30} {v.orders30 === 1 ? "pedido" : "pedidos"} (30 d)</span>
        {hasSales && <span className="font-semibold text-on-surface">{formatPrice(v.sales30, v.currency)}</span>}
        {v.reviewCount > 0 && (
          <span className="flex items-center gap-0.5">
            <Star className="h-3 w-3 fill-secondary-container text-secondary-container" /> {Number(v.rating).toFixed(1)} ({v.reviewCount})
          </span>
        )}
        <span>{v.lastLoginAt ? `Entró ${timeAgo(v.lastLoginAt).toLowerCase()}` : "Nunca entró"}</span>
      </div>

      <div className="hidden flex-col items-start gap-1 md:flex">
        {planChip("text-[11px]")}
        <span className={`text-[11px] ${plan.trial && plan.daysLeft <= 7 ? "font-semibold text-error" : "text-outline"}`}>
          {plan.trial ? plan.daysLabel : v.isVerified ? "Verificada" : verificationLabel(v.verificationStatus, plans)}
        </span>
      </div>
      <div className="hidden text-right text-[13px] text-on-surface md:block">{v.productCount}</div>
      <div className="hidden text-right text-[13px] text-on-surface md:block" title="Pedidos entregados y pedidos de mesa de los últimos 30 días">
        {v.orders30}
      </div>
      <div className="hidden text-right text-[13px] font-semibold text-on-surface md:block">{hasSales ? formatPrice(v.sales30, v.currency) : <span className="font-normal text-outline">—</span>}</div>
      <div className="hidden text-right text-[13px] text-on-surface-variant md:block">
        {v.reviewCount > 0 ? (
          <span className="inline-flex items-center gap-0.5" title={`${v.reviewCount} ${v.reviewCount === 1 ? "reseña" : "reseñas"}`}>
            <Star className="h-3 w-3 fill-secondary-container text-secondary-container" /> {Number(v.rating).toFixed(1)}
            <span className="text-[11px] text-outline">({v.reviewCount})</span>
          </span>
        ) : (
          <span className="text-[11.5px] text-outline">Sin reseñas</span>
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
  const [params, setParams] = useListParams(LIST_DEFAULTS);
  // Bloque 277: ficha del responsable; también se abre con /admin/tiendas?responsable=<tienda> (enlace del asistente).
  const [viewingRep, setViewingRep] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const repParam = searchParams.get("responsable");
  useEffect(() => {
    if (repParam) setViewingRep({ id: repParam, companyName: "" });
  }, [repParam]);
  const commitSearch = useCallback((q) => setParams({ q }), [setParams]);
  const [searchText, setSearchText] = useDebouncedSearch(params.q, commitSearch);

  // "Suspendidas" (antes una página aparte) usa su propia lista; la consulta principal sigue para los contadores de arriba.
  const showSuspended = params.status === "suspended";
  const listStatus = showSuspended ? "all" : params.status;
  const suspended = useSuspendedVendors();
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["admin-list-vendors", { ...params, status: listStatus }],
    queryFn: async () =>
      (
        await api.get("/admin/vendors", {
          params: {
            q: params.q || undefined,
            status: listStatus,
            provinceId: params.province || undefined,
            municipalityId: (params.province && params.municipality) || undefined,
            plan: params.plan || undefined,
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

  // Bloque 272: plazo de eliminación (configurable en Seguridad), para el texto del filtro.
  const { data: security } = useQuery({
    queryKey: ["admin-security-settings"],
    queryFn: async () => (await api.get("/admin/security/settings")).data.settings,
  });
  const deletionDays = security?.vendorDeletionDays ?? 30;

  // Si al borrar o filtrar la página actual queda más allá del final, vuelve
  // a la última que existe.
  useEffect(() => {
    if (data && data.vendors.length === 0 && params.page > 1) setParams({ page: data.pageCount });
  }, [data, params.page, setParams]);

  const kpis = data?.kpis;
  const { plans, isError: plansError } = useAdminPlanList();
  // Una clave en la URL que ya no está entre los planes (archivado o mal escrito) se muestra igual, para que el filtro
  // activo se vea y se pueda quitar. PAID y DEFAULT no son claves sino los dos grupos que acepta el servidor (planes de
  // pago y plan por defecto), con su propia opción.
  const unknownPlanFilter =
    params.plan && !PLAN_GROUP_FILTERS.includes(params.plan) && plans.length > 0 && !plans.some((p) => p.planType === params.plan);
  const hasFilters = params.q || params.status !== "all" || params.province || params.plan;
  // Municipios de la provincia elegida, para filtrar más fino (Santiago de Cuba > Segundo Frente).
  const { data: municipalities } = useQuery({
    queryKey: ["admin-municipalities", params.province],
    queryFn: async () => (await api.get(`/locations/provinces/${params.province}/municipalities`)).data.municipalities,
    enabled: !!params.province,
  });
  const sortValue = `${params.sort}:${params.dir}`;
  const tiles = [
    { key: "all", label: "Todas", value: kpis?.all },
    { key: "verified", label: "Verificadas", value: kpis?.verified },
    { key: "inprocess", label: "En proceso", value: kpis?.inprocess, hint: "Verificación" },
    { key: "unverified", label: "Sin verificar", value: kpis?.unverified },
    { key: "business", label: "Planes de pago", value: kpis?.business, hint: "Pagado o en prueba" },
    { key: "inactive", label: "Inactivas", value: kpis?.inactive, hint: "30 días sin entrar", tone: "warn" },
    { key: "flagged", label: "Con alertas", value: kpis?.flagged, hint: "Ranking", tone: "danger" },
    { key: "suspended", label: "Suspendidas", value: suspended.data?.length, hint: "Bloqueadas o sin uso", tone: "danger" },
    { key: "deletion", label: "Eliminación pendiente", value: kpis?.deletion, hint: `Se borran a los ${deletionDays} días`, tone: "danger" },
  ];
  const onSort = (sort, dir) => setParams({ sort, dir });

  return (
    <div className="max-w-[1180px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Store} tone="teal" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Tiendas</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">Gestiona, verifica a dedo, edita o elimina tiendas. El bloqueo oculta, no borra.</p>

      <OrderLookup className="mb-4" />

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

      {showSuspended ? (
        <SuspendedVendorsList />
      ) : (
      <>
      <div className={`mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 ${params.province ? "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"}`}>
        <SearchField value={searchText} onChange={setSearchText} placeholder="Buscar por nombre, enlace o correo" className="sm:col-span-2 lg:col-span-1" />
        <select
          value={params.province}
          onChange={(e) => setParams({ province: e.target.value, municipality: "" })}
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
        {params.province && (
          <select
            value={params.municipality}
            onChange={(e) => setParams({ municipality: e.target.value })}
            aria-label="Filtrar por municipio"
            className="h-11 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[13px] md:h-10"
          >
            <option value="">Todos los municipios</option>
            {municipalities?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <select
          value={params.plan}
          onChange={(e) => setParams({ plan: e.target.value })}
          aria-label="Filtrar por plan"
          className="h-11 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[13px] md:h-10"
        >
          <option value="">{plansError ? "Todos los planes (no se pudo cargar la lista)" : "Todos los planes"}</option>
          <option value="PAID">Planes de pago</option>
          <option value="DEFAULT">{defaultPlanFilterLabel(plans)}</option>
          {plans.map((p) => (
            <option key={p.planType} value={p.planType}>
              {p.displayName}
              {p.isPublic === false ? " (oculto)" : ""}
            </option>
          ))}
          {(unknownPlanFilter || (params.plan && !plans.length && !PLAN_GROUP_FILTERS.includes(params.plan))) && (
            <option value={params.plan}>Plan {params.plan}</option>
          )}
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
            {/* Un ?plan= que no existe responde 400: sin este botón el error no tendría salida. */}
            {params.plan && (
              <Button variant="ghost" onClick={() => setParams({ plan: "" })}>
                Quitar el filtro de plan
              </Button>
            )}
          </div>
        )}

        {data?.vendors.map((v) => (
          <VendorRow key={v.id} v={v} plans={plans} />
        ))}

        {data && data.vendors.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <Store className="h-6 w-6 text-outline" />
            <p className="text-body-md text-on-surface-variant">{hasFilters ? "Ninguna tienda coincide con estos filtros." : "Todavía no hay tiendas registradas."}</p>
            {hasFilters && (
              <Button variant="outline" onClick={() => setParams({ q: "", status: "all", province: "", municipality: "", plan: "" })}>
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
      </>
      )}

      {viewingRep && (
        <RepresentativeFileModal
          vendor={viewingRep}
          onClose={() => {
            setViewingRep(null);
            if (repParam) setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete("responsable"); return next; }, { replace: true });
          }}
        />
      )}
    </div>
  );
}
