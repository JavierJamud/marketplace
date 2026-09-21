import { useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import toast from "../../lib/toast.jsx";
import {
  UserPlus,
  Pencil,
  KeyRound,
  History,
  X,
  CheckCircle2,
  Ban,
  AlertTriangle,
  ArrowRightLeft,
  Trash2,
  Download,
  Eye,
  Users,
} from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { UnsavedChangesModal } from "../../components/UnsavedChangesModal.jsx";
import { useDirtyModal } from "../../lib/useDirtyModal.js";
import { SimplePhotoCapture } from "../../components/vendor/SimplePhotoCapture.jsx";
import { SectionAccessPicker } from "../../components/vendor/SectionAccessPicker.jsx";
import { vendorSectionLabel } from "../../lib/vendorSections.js";
import { STAFF_TYPES, STAFF_TYPE_DEFAULT_SECTIONS, staffTypeLabel } from "../../lib/staffTypes.js";

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}
function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString("es-CU") : "—";
}
function fmtDateShort(iso) {
  return iso ? new Date(iso).toLocaleDateString("es-CU") : "—";
}
function fmtMoney(amount, currency) {
  return `${Number(amount ?? 0).toLocaleString("es-CU")} ${currency || "CUP"}`;
}

const PERIOD_TABS = [
  { key: "today", label: "Hoy" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mes" },
];

function downloadSalesCsv(sales) {
  const header = ["Fecha", "Empleado", "Producto", "Cantidad", "Precio unitario", "Total", "Nota"];
  const rows = sales.map((s) => [fmtDate(s.createdAt), s.staffName, s.productName, s.quantity, s.unitPrice, s.total, s.note ?? ""]);
  const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ventas-manuales-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function SalesTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] px-3 py-2">
      <p className="text-[11px] font-semibold text-outline">{label}</p>
      <p className="text-[13px] font-bold text-on-surface">{fmtMoney(payload[0].value)}</p>
    </div>
  );
}

// Bloque 187: SectionAccessPicker se movió a
// components/vendor/SectionAccessPicker.jsx — lo comparte con
// AdminVendorStaffModal.jsx (antes solo vivía acá, y el admin no tenía
// forma de configurar el nivel view/manage, ver Bloque 185/187 en
// admin.controller.js).

// Bloque 183 (pedido explícito — "vamos a crear una nueva sección para
// crear usuarios de sistema o administrar... también se podrán administrar
// los usuarios y poder ver el historial de qué ha hecho cada usuario"):
// formulario de alta — nombre + correo + secciones + foto. Se arma como
// FormData porque la foto viaja junto (multipart), igual que
// vendorBrandingUpload en Configuración.
function CreateStaffModal({ onClose, onCreated, isRestaurant }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [staffType, setStaffType] = useState("");
  const [sections, setSections] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [photoBlob, setPhotoBlob] = useState(null);
  // Bloque 205 (pedido explícito — "los meseros la llevarán marcada
  // predeterminadamente, pero los que son agentes de ventas no, salvo que
  // el dueño lo decida"): arranca en false — se recalcula solo apenas se
  // elige un tipo (ver handleStaffTypeChange), y el dueño la puede tocar a
  // mano en cualquier momento después.
  const [receivesOrderNotifications, setReceivesOrderNotifications] = useState(false);

  const create = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("fullName", fullName.trim());
      formData.append("email", email.trim());
      formData.append("phone", phone.trim());
      formData.append("staffType", staffType);
      formData.append("receivesOrderNotifications", String(receivesOrderNotifications));
      formData.append("allowedSections", JSON.stringify(sections));
      formData.append("sectionPermissions", JSON.stringify(permissions));
      if (photoBlob) formData.append("photo", photoBlob, "foto.jpg");
      return (await api.post("/vendor-staff", formData, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success(`Se creó el usuario "${fullName.trim()}" — le mandamos un correo con las instrucciones para entrar.`);
      onCreated();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo crear el usuario."),
  });

  function toggleSection(key) {
    setSections((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));
  }
  function setLevel(key, level) {
    setPermissions((prev) => ({ ...prev, [key]: level }));
  }
  // Bloque 200 (pedido explícito — "cuando se crea un usuario con agente de
  // ventas, automáticamente se debe habilitar una sección en el perfil del
  // usuario"): elegir un tipo PRECARGA su(s) sección(es) por default —
  // union con lo que ya estaba tildado, nunca las saca si el vendedor las
  // destilda después (esto solo agrega, una vez).
  // Bloque 205: también recalcula el default de "recibe notificaciones de
  // pedidos" — mesero -> prendida, agente de ventas -> apagada.
  function handleStaffTypeChange(next) {
    setStaffType(next);
    const defaults = STAFF_TYPE_DEFAULT_SECTIONS[next] ?? [];
    if (defaults.length > 0) setSections((prev) => [...new Set([...prev, ...defaults])]);
    setReceivesOrderNotifications(next === "WAITER");
  }

  // Bloque 200 (pedido explícito — "no es obligatorio asignarle acceso a
  // ninguna de las sesiones, ya que normalmente sin acceso, cuando acceden
  // podrán ver la sección de mi perfil"): ya no exige sections.length > 0.
  const canSubmit = fullName.trim().length > 1 && /\S+@\S+\.\S+/.test(email);

  // Bloque 196: snapshot del borrador (blanco, siempre "crear nuevo") con el
  // que se abrió el modal — photoBlob es un Blob (no serializa bien contra
  // sí mismo con JSON.stringify), así que se compara su sola presencia, no
  // su contenido.
  const initialFormSnapshot = useRef(
    JSON.stringify({ fullName, email, phone, staffType, sections, permissions, receivesOrderNotifications, hasPhoto: !!photoBlob })
  );
  const isDirty =
    JSON.stringify({ fullName, email, phone, staffType, sections, permissions, receivesOrderNotifications, hasPhoto: !!photoBlob }) !==
    initialFormSnapshot.current;
  const dirtyModal = useDirtyModal({ isDirty, onClose, onSave: canSubmit ? () => create.mutateAsync() : undefined });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-title-lg font-bold text-on-surface">Crear usuario de sistema</h3>
          <button onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 text-outline hover:bg-surface-container">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3.5">
          <Input label="Nombre completo" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ej.: Ana Pérez" />
          <Input
            label="Correo electrónico"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ana@ejemplo.com"
          />
          <p className="text-[12px] text-outline">
            Le vamos a mandar un aviso a este correo. La primera vez que intente entrar, el sistema le va a pedir crear su
            propia contraseña con un código — nunca la defines tú.
          </p>
          <Input label="Teléfono" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+53 5555 5555" />

          <Select label="Tipo de usuario" value={staffType} onChange={(e) => handleStaffTypeChange(e.target.value)}>
            {STAFF_TYPES.filter((t) => t.key !== "WAITER" || isRestaurant).map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
          {staffType && (
            <p className="text-[12px] text-outline">
              Le habilitamos ya mismo la sección que necesita — puedes sumarle o sacarle otras abajo.
            </p>
          )}

          {/* Bloque 205 (pedido explícito — "especificar si el usuario
              recibe las notificaciones de nuevos pedidos... los meseros la
              llevarán marcada predeterminadamente, pero los agentes de
              ventas no"): solo tiene sentido en restaurantes/cafeterías
              (NewOrderPopup/StaleOrderAlert son exclusivos de vendor con
              mesas, ver VendorLayout.jsx). */}
          {isRestaurant && (
            <label className="flex items-start gap-2.5 rounded-full border border-outline-variant px-3 py-2.5">
              <input
                type="checkbox"
                checked={receivesOrderNotifications}
                onChange={(e) => setReceivesOrderNotifications(e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-tertiary-accent"
              />
              <span>
                <span className="block text-[13px] font-semibold text-on-surface">Recibe notificaciones de pedidos nuevos</span>
                <span className="block text-[11.5px] text-outline">
                  Le va a sonar y aparecer el aviso en pantalla cada vez que entra un pedido — normalmente para meseros.
                </span>
              </span>
            </label>
          )}

          <SectionAccessPicker sections={sections} permissions={permissions} onToggleSection={toggleSection} onSetLevel={setLevel} />

          {/* Bloque 202: "Agentes de Ventas"/"Productos Asignados" ya no
              vive acá — un agente de ventas recién creado no tiene nada
              asignado todavía; en cuanto se le reasigne stock desde su
              tarjeta más abajo, la sección se le habilita sola. */}

          <SimplePhotoCapture onCaptured={setPhotoBlob} />
        </div>

        <Button className="mt-5 w-full" disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "Creando..." : "Crear usuario"}
        </Button>
      </div>

      <UnsavedChangesModal
        open={dirtyModal.confirming}
        saving={dirtyModal.saving}
        onSave={canSubmit ? dirtyModal.handleSaveAndClose : undefined}
        onDiscard={dirtyModal.handleDiscard}
        onCancel={dirtyModal.handleKeepEditing}
      />
    </div>
  );
}

// Bloque 183: editar nombre/correo/secciones/estado de un usuario ya
// existente — nunca su contraseña (eso es "Restablecer contraseña" aparte,
// ver el botón dedicado en la fila).
// Bloque 200 (pedido explícito — "al editar un usuario se debe poder editar
// todos los datos desde el panel de vendedor y también la foto de perfil
// si el dueño del negocio desea"): antes solo CreateStaffModal tenía
// SimplePhotoCapture — /vendor-staff/:id/photo (uploadMyStaffPhoto,
// backend) ya existía desde Bloque 183, pero ningún botón de acá lo
// llamaba nunca. La foto se sube aparte (multipart, endpoint propio) DESPUÉS
// del PATCH normal (JSON) — 2 llamadas en cadena, solo si el vendedor de
// verdad tocó "Cambiar foto" (photoBlob no queda null si no la tocó).
function EditStaffModal({ staff, onClose, onSaved, isRestaurant }) {
  const [fullName, setFullName] = useState(staff.fullName);
  const [email, setEmail] = useState(staff.email);
  const [phone, setPhone] = useState(staff.phone ?? "");
  const [staffType, setStaffType] = useState(staff.staffType ?? "");
  const [sections, setSections] = useState(staff.allowedSections);
  const [permissions, setPermissions] = useState(staff.sectionPermissions ?? {});
  const [receivesOrderNotifications, setReceivesOrderNotifications] = useState(!!staff.receivesOrderNotifications);
  const [changingPhoto, setChangingPhoto] = useState(false);
  const [photoBlob, setPhotoBlob] = useState(null);

  const save = useMutation({
    mutationFn: async () => {
      const result = (
        await api.patch(`/vendor-staff/${staff.id}`, {
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          staffType: staffType || null,
          receivesOrderNotifications,
          allowedSections: sections,
          sectionPermissions: permissions,
        })
      ).data;
      if (photoBlob) {
        const formData = new FormData();
        formData.append("photo", photoBlob, "foto.jpg");
        await api.post(`/vendor-staff/${staff.id}/photo`, formData, { headers: { "Content-Type": "multipart/form-data" } });
      }
      return result;
    },
    onSuccess: () => {
      toast.success("Usuario actualizado.");
      onSaved();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar."),
  });

  function toggleSection(key) {
    setSections((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));
  }
  function setLevel(key, level) {
    setPermissions((prev) => ({ ...prev, [key]: level }));
  }
  function handleStaffTypeChange(next) {
    setStaffType(next);
    const defaults = STAFF_TYPE_DEFAULT_SECTIONS[next] ?? [];
    if (defaults.length > 0) setSections((prev) => [...new Set([...prev, ...defaults])]);
  }

  // Bloque 196: mismo mecanismo de snapshot-en-ref que ProductModal — el
  // borrador arranca con los datos reales del staff (no en blanco, a
  // diferencia de "crear").
  const initialFormSnapshot = useRef(
    JSON.stringify({ fullName, email, phone, staffType, sections, permissions, receivesOrderNotifications, hasPhoto: false })
  );
  const isDirty =
    JSON.stringify({ fullName, email, phone, staffType, sections, permissions, receivesOrderNotifications, hasPhoto: !!photoBlob }) !==
    initialFormSnapshot.current;
  // Bloque 200: ya no exige sections.length > 0 — ver el mismo criterio en
  // CreateStaffModal.
  const canSaveNow = true;
  const dirtyModal = useDirtyModal({ isDirty, onClose, onSave: canSaveNow ? () => save.mutateAsync() : undefined });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-title-lg font-bold text-on-surface">Editar usuario</h3>
          <button onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 text-outline hover:bg-surface-container">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-3.5">
          <Input label="Nombre completo" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <Input label="Correo electrónico" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Teléfono" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+53 5555 5555" />
          <Select label="Tipo de usuario" value={staffType} onChange={(e) => handleStaffTypeChange(e.target.value)}>
            {STAFF_TYPES.filter((t) => t.key !== "WAITER" || isRestaurant).map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>

          {isRestaurant && (
            <label className="flex items-start gap-2.5 rounded-full border border-outline-variant px-3 py-2.5">
              <input
                type="checkbox"
                checked={receivesOrderNotifications}
                onChange={(e) => setReceivesOrderNotifications(e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-tertiary-accent"
              />
              <span>
                <span className="block text-[13px] font-semibold text-on-surface">Recibe notificaciones de pedidos nuevos</span>
                <span className="block text-[11.5px] text-outline">
                  Le va a sonar y aparecer el aviso en pantalla cada vez que entra un pedido — normalmente para meseros.
                </span>
              </span>
            </label>
          )}

          <SectionAccessPicker sections={sections} permissions={permissions} onToggleSection={toggleSection} onSetLevel={setLevel} />

          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Foto de perfil</span>
            {!changingPhoto ? (
              <div className="flex items-center gap-3">
                {staff.photoUrl ? (
                  <img src={imgUrl(staff.photoUrl)} alt={staff.fullName} className="h-12 w-12 flex-shrink-0 rounded-full object-cover" />
                ) : (
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-secondary-container font-display text-lg font-bold text-on-secondary-container">
                    {staff.fullName.charAt(0).toUpperCase()}
                  </div>
                )}
                <button type="button" onClick={() => setChangingPhoto(true)} className="text-[12.5px] font-bold text-tertiary-accent">
                  Cambiar foto
                </button>
              </div>
            ) : (
              <SimplePhotoCapture onCaptured={setPhotoBlob} />
            )}
          </div>
        </div>
        <Button className="mt-5 w-full" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>

      <UnsavedChangesModal
        open={dirtyModal.confirming}
        saving={dirtyModal.saving}
        onSave={canSaveNow ? dirtyModal.handleSaveAndClose : undefined}
        onDiscard={dirtyModal.handleDiscard}
        onCancel={dirtyModal.handleKeepEditing}
      />
    </div>
  );
}

// Bloque 183 (pedido explícito — "poder ver qué ha hecho cada usuario... a
// qué hora accedió, a qué hora se cerró la sesión"): 2 pestañas chicas en
// vez de 2 modales separados — mismo id, mismo header.
function StaffHistoryModal({ staff, onClose }) {
  const [tab, setTab] = useState("activity");
  const { data: activity } = useQuery({
    queryKey: ["staff-activity", staff.id],
    queryFn: async () => (await api.get(`/vendor-staff/${staff.id}/activity`)).data.activity,
    enabled: tab === "activity",
  });
  const { data: sessions } = useQuery({
    queryKey: ["staff-sessions", staff.id],
    queryFn: async () => (await api.get(`/vendor-staff/${staff.id}/sessions`)).data.sessions,
    enabled: tab === "sessions",
  });

  return (
    // Bloque 196: solo lectura (actividad/sesiones), sin ningún borrador —
    // cierra directo al hacer clic afuera.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <div className="mb-3 flex items-start justify-between">
          <h3 className="text-title-lg font-bold text-on-surface">{staff.fullName}</h3>
          <button onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 text-outline hover:bg-surface-container">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setTab("activity")}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold ${tab === "activity" ? "bg-tertiary-accent/10 text-tertiary-accent" : "text-outline"}`}
          >
            Actividad
          </button>
          <button
            onClick={() => setTab("sessions")}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold ${tab === "sessions" ? "bg-tertiary-accent/10 text-tertiary-accent" : "text-outline"}`}
          >
            Sesiones
          </button>
        </div>

        {tab === "activity" && (
          <div className="flex flex-col gap-2">
            {activity?.length === 0 && <p className="text-body-md text-on-surface-variant">Todavía no hizo nada.</p>}
            {activity?.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-2 rounded-md border border-surface-container-high p-2.5 text-[12.5px]">
                <span className="text-on-surface">{entry.description}</span>
                <span className="flex-shrink-0 text-outline">{fmtDate(entry.createdAt)}</span>
              </div>
            ))}
          </div>
        )}

        {tab === "sessions" && (
          <div className="flex flex-col gap-2">
            {sessions?.length === 0 && <p className="text-body-md text-on-surface-variant">Todavía no inició sesión.</p>}
            {sessions?.map((s) => (
              <div key={s.id} className="rounded-md border border-surface-container-high p-2.5 text-[12.5px]">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-on-surface">Entró: {fmtDate(s.createdAt)}</span>
                  {s.revokedAt ? (
                    <span className="text-error">Cerró: {fmtDate(s.revokedAt)}</span>
                  ) : (
                    <span className="text-verified">Activa</span>
                  )}
                </div>
                <p className="mt-0.5 text-outline">Última actividad: {fmtDate(s.lastUsedAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Bloque 204 (pedido explícito — "no es bueno que se muestre una tarjeta de
// presentación para el usuario cargada de tanta configuración, mejor
// mostrar la tarjeta y un botón de ver para entrar a más configuraciones de
// ese usuario"): tarjeta mínima — foto, nombre, estado, un resumen de una
// línea de su stock si tiene — y un solo botón "Ver" que abre
// StaffDetailModal con todo lo demás (editar, resetear contraseña,
// activar/desactivar, reasignar stock, y el detalle producto por producto).
function StaffCard({ staff, onView }) {
  const photo = imgUrl(staff.photoUrl);
  const hasSalesStats = staff.allocatedTotal !== undefined;

  return (
    <button
      onClick={() => onView(staff)}
      className="flex w-full flex-col gap-3 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-4 text-left transition hover:border-tertiary-accent/40"
    >
      <div className="flex items-center gap-3">
        {photo ? (
          <img src={photo} alt={staff.fullName} className="h-12 w-12 flex-shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-secondary-container font-display text-lg font-bold text-on-secondary-container">
            {staff.fullName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-md font-bold text-on-surface">{staff.fullName}</p>
          <p className="truncate text-[12px] text-outline">{staff.email}</p>
        </div>
        <span
          className="flex-shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold"
          style={staff.isActive ? { background: "rgba(12,174,83,0.12)", color: "#0A8F42" } : { background: "rgba(186,26,26,0.1)", color: "#ba1a1a" }}
        >
          {staff.isActive ? "Activo" : "Inactivo"}
        </span>
      </div>

      {hasSalesStats && staff.productsClaimed > 0 && (
        <p className="text-[12px] text-outline">
          <span className="font-bold text-on-surface">{staff.productsClaimed}</span> producto(s) asignado(s) ·{" "}
          <span className="font-bold text-on-surface">{staff.remainingTotal}</span> unidad(es) le queda(n)
        </p>
      )}

      <span className="flex w-fit items-center gap-1 rounded-[7px] bg-tertiary-accent/10 px-3 py-1.5 text-[11.5px] font-bold text-tertiary-accent">
        <Eye className="h-3.5 w-3.5" /> Ver
      </span>
    </button>
  );
}

// Bloque 204: fila de un producto asignado dentro de StaffDetailModal —
// mismo criterio de siempre (SaleEditModal, etc.): edición inline con su
// propio estado local, sin abrir otro modal encima. "Editar" cambia
// remainingQty directo (setStaffAllocationQuantity, controller — la
// diferencia sale o vuelve sola al pool sin reclamar); "Eliminar" borra la
// fila entera (deleteStaffAllocation).
function StaffAllocationRow({ staffId, allocation, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(allocation.remainingQty);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useMutation({
    mutationFn: async () => (await api.patch(`/vendor-staff-sales/staff/${staffId}/allocations/${allocation.id}`, { remainingQty: Number(qty) })).data,
    onSuccess: () => {
      toast.success("Stock actualizado.");
      setEditing(false);
      onChanged();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar el stock."),
  });

  const del = useMutation({
    mutationFn: async () => (await api.delete(`/vendor-staff-sales/staff/${staffId}/allocations/${allocation.id}`)).data,
    onSuccess: () => {
      toast.success("Producto quitado del usuario.");
      setConfirmDelete(false);
      onChanged();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo quitar el producto.");
      setConfirmDelete(false);
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-md border border-surface-container-high p-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-on-surface">{allocation.product.name}</p>
        <p className="text-[11px] text-outline">Asignado en total: {allocation.allocatedQty}</p>
      </div>

      {editing ? (
        <>
          <input
            type="number"
            min={0}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="w-20 rounded border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-[13px] text-on-surface"
          />
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-[7px] bg-tertiary-accent px-2.5 py-1.5 text-[11.5px] font-bold text-on-tertiary-accent disabled:opacity-60"
          >
            {save.isPending ? "Guardando..." : "Guardar"}
          </button>
          <button
            onClick={() => {
              setEditing(false);
              setQty(allocation.remainingQty);
            }}
            className="rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[11.5px] font-bold text-on-surface-variant"
          >
            Cancelar
          </button>
        </>
      ) : (
        <>
          <span className="text-[14px] font-bold text-on-surface">{allocation.remainingQty}</span>
          <button onClick={() => setEditing(true)} className="rounded p-1.5 text-on-surface-variant hover:bg-surface-container">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setConfirmDelete(true)} className="rounded p-1.5 text-error hover:bg-error/10">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}

      {confirmDelete && (
        <ConfirmDeleteModal
          title={`¿Quitar "${allocation.product.name}" de este usuario?`}
          description="Cualquier unidad que le quedara vuelve sola al pool sin reclamar para el resto del equipo."
          pending={del.isPending}
          onConfirm={() => del.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

// Bloque 204 (pedido explícito — "poder ver también el stock asignado,
// también poder modificar ese stock, poder eliminar productos asignados a
// un usuario, y cambiar y controlar cada parámetro dentro de cada
// usuario"): todo lo que antes vivía suelto en la tarjeta (stats, editar,
// resetear contraseña, activar/desactivar, reasignar stock) más el detalle
// nuevo por producto, en un solo lugar que se abre con "Ver".
function StaffDetailModal({ staff, onClose, onEdit, onHistory, onReassign }) {
  const queryClient = useQueryClient();
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false);

  const invalidateRoster = () => {
    queryClient.invalidateQueries({ queryKey: ["my-staff"] });
    queryClient.invalidateQueries({ queryKey: ["staff-sales-staff"] });
  };
  const invalidateAllocations = () => {
    queryClient.invalidateQueries({ queryKey: ["staff-allocations", staff.id] });
    invalidateRoster();
  };

  const { data: allocationsData, isLoading: loadingAllocations } = useQuery({
    queryKey: ["staff-allocations", staff.id],
    queryFn: async () => (await api.get(`/vendor-staff-sales/staff/${staff.id}/allocations`)).data,
    refetchInterval: 15000,
  });
  const allocations = allocationsData?.allocations ?? [];

  const resetPassword = useMutation({
    mutationFn: async () => (await api.post(`/vendor-staff/${staff.id}/reset-password`)).data,
    onSuccess: () => {
      toast.success("Se restableció la contraseña — la próxima vez que entre, va a tener que crear una nueva.");
      setConfirmReset(false);
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo restablecer la contraseña.");
      setConfirmReset(false);
    },
  });

  const toggleActive = useMutation({
    mutationFn: async () => (await api.patch(`/vendor-staff/${staff.id}`, { isActive: !staff.isActive })).data,
    onSuccess: () => {
      toast.success(staff.isActive ? "Usuario desactivado — ya no puede entrar." : "Usuario reactivado.");
      setConfirmToggle(false);
      invalidateRoster();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo actualizar.");
      setConfirmToggle(false);
    },
  });

  const photo = imgUrl(staff.photoUrl);
  const hasSalesStats = staff.allocatedTotal !== undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {photo ? (
              <img src={photo} alt={staff.fullName} className="h-12 w-12 flex-shrink-0 rounded-full object-cover" />
            ) : (
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-secondary-container font-display text-lg font-bold text-on-secondary-container">
                {staff.fullName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h3 className="truncate text-title-lg font-bold text-on-surface">{staff.fullName}</h3>
              <p className="truncate text-[12px] text-outline">{staff.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 text-outline hover:bg-surface-container">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span
            className="rounded-full px-2.5 py-0.5 text-[10.5px] font-bold"
            style={staff.isActive ? { background: "rgba(12,174,83,0.12)", color: "#0A8F42" } : { background: "rgba(186,26,26,0.1)", color: "#ba1a1a" }}
          >
            {staff.isActive ? "Activo" : "Inactivo"}
          </span>
          {staff.staffType && (
            <span className="rounded-full bg-tertiary-accent/10 px-2.5 py-1 text-[11px] font-bold text-tertiary-accent">
              {staffTypeLabel(staff.staffType)}
            </span>
          )}
          {staff.allowedSections.map((key) => {
            const isViewOnly = (staff.sectionPermissions?.[key] ?? "manage") === "view";
            return (
              <span
                key={key}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  isViewOnly ? "bg-tertiary-accent/10 text-tertiary-accent" : "bg-surface-container text-on-surface-variant"
                }`}
                title={isViewOnly ? "Solo lectura" : "Leer y escribir"}
              >
                {vendorSectionLabel(key)}
                {isViewOnly && " · solo ver"}
              </span>
            );
          })}
        </div>

        {hasSalesStats && (
          <div className="mb-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <div className="rounded-md bg-surface-container p-2">
              <p className="text-[10.5px] text-outline">Reclamado</p>
              <p className="text-[14px] font-bold text-on-surface">{staff.allocatedTotal}</p>
            </div>
            <div className="rounded-md bg-surface-container p-2">
              <p className="text-[10.5px] text-outline">Le queda</p>
              <p className="text-[14px] font-bold text-on-surface">{staff.remainingTotal}</p>
            </div>
            <div className="rounded-md bg-surface-container p-2">
              <p className="text-[10.5px] text-outline">Productos</p>
              <p className="text-[14px] font-bold text-on-surface">{staff.productsClaimed}</p>
            </div>
            <div className="rounded-md bg-surface-container p-2">
              <p className="text-[10.5px] text-outline">Vendido (mes)</p>
              <p className="text-[14px] font-bold text-[#0A8F42]">{staff.unitsSoldThisMonth} u.</p>
            </div>
          </div>
        )}

        <p className="mb-4 text-[11.5px] text-outline">
          Último acceso: {staff.lastLoginAt ? fmtDate(staff.lastLoginAt) : "Nunca inició sesión todavía"}
        </p>

        <div className="mb-5 flex flex-wrap gap-1.5">
          <button onClick={() => onHistory(staff)} className="flex items-center gap-1 rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[11.5px] font-bold text-on-surface-variant">
            <History className="h-3.5 w-3.5" /> Actividad
          </button>
          <button onClick={() => onEdit(staff)} className="flex items-center gap-1 rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[11.5px] font-bold text-on-surface-variant">
            <Pencil className="h-3.5 w-3.5" /> Editar
          </button>
          <button onClick={() => setConfirmReset(true)} className="flex items-center gap-1 rounded-[7px] bg-tertiary-accent/10 px-2.5 py-1.5 text-[11.5px] font-bold text-tertiary-accent">
            <KeyRound className="h-3.5 w-3.5" /> Restablecer contraseña
          </button>
          <button
            onClick={() => setConfirmToggle(true)}
            className={`flex items-center gap-1 rounded-[7px] px-2.5 py-1.5 text-[11.5px] font-bold ${staff.isActive ? "bg-error/10 text-error" : "bg-verified/10 text-verified-dark"}`}
          >
            {staff.isActive ? <Ban className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {staff.isActive ? "Desactivar" : "Reactivar"}
          </button>
          <button onClick={() => onReassign(staff)} className="flex items-center gap-1 rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[11.5px] font-bold text-on-surface-variant">
            <ArrowRightLeft className="h-3.5 w-3.5" /> Reasignar stock
          </button>
        </div>

        <div>
          <h4 className="mb-2 text-[14px] font-bold text-on-surface">Productos asignados</h4>
          {loadingAllocations ? (
            <p className="text-body-md text-on-surface-variant">Cargando...</p>
          ) : allocations.length === 0 ? (
            <p className="rounded-md border border-dashed border-outline-variant p-4 text-center text-[13px] text-on-surface-variant">
              Todavía no tiene productos asignados — usa "Reasignar stock" arriba para darle stock.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {allocations.map((a) => (
                <StaffAllocationRow key={a.id} staffId={staff.id} allocation={a} onChanged={invalidateAllocations} />
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmReset}
        title="¿Restablecer la contraseña?"
        message={`"${staff.fullName}" va a tener que crear una contraseña nueva la próxima vez que intente entrar — le cerramos cualquier sesión activa ahora mismo.`}
        confirmLabel={resetPassword.isPending ? "Restableciendo..." : "Restablecer"}
        confirmDisabled={resetPassword.isPending}
        onConfirm={() => resetPassword.mutate()}
        onCancel={() => setConfirmReset(false)}
      />
      <ConfirmModal
        open={confirmToggle}
        title={staff.isActive ? `¿Desactivar a "${staff.fullName}"?` : `¿Reactivar a "${staff.fullName}"?`}
        message={
          staff.isActive
            ? "Pierde el acceso al panel de inmediato — su historial se conserva igual, por si lo necesitas después."
            : "Vuelve a poder entrar al panel con las secciones que tenía asignadas."
        }
        confirmLabel={toggleActive.isPending ? "Guardando..." : staff.isActive ? "Desactivar" : "Reactivar"}
        confirmDisabled={toggleActive.isPending}
        danger={staff.isActive}
        onConfirm={() => toggleActive.mutate()}
        onCancel={() => setConfirmToggle(false)}
      />
    </div>
  );
}

// GET /vendor-staff-sales/products funciona para CUALQUIER rol con acceso a
// la sección (dueño/admin incluidos) — ya trae unclaimedQty resuelto
// server-side, así el dueño ve cuánto hay disponible en el pool antes de
// reasignar, sin tener que recalcularlo a mano.
function ReassignModal({ staffList, onClose, initialToId }) {
  const [productId, setProductId] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState(initialToId ?? "");
  const [qty, setQty] = useState(1);
  const queryClient = useQueryClient();

  const { data: productsData } = useQuery({
    queryKey: ["staff-sales-claimable-products"],
    queryFn: async () => (await api.get("/vendor-staff-sales/products")).data,
  });
  const products = productsData?.products ?? [];
  const selectedProduct = products.find((p) => p.id === productId);

  const reassign = useMutation({
    mutationFn: async () =>
      (
        await api.post("/vendor-staff-sales/allocations/reassign", {
          productId,
          fromVendorStaffId: fromId || null,
          toVendorStaffId: toId,
          quantity: Number(qty),
        })
      ).data,
    onSuccess: () => {
      toast.success("Stock reasignado — ya está en su inventario, listo para vender.");
      queryClient.invalidateQueries({ queryKey: ["staff-sales-staff"] });
      queryClient.invalidateQueries({ queryKey: ["my-staff"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo reasignar el stock."),
  });

  const canSubmit = productId && toId && toId !== fromId && Number(qty) > 0;
  const selectClass = "w-full rounded border border-outline-variant bg-surface-container-lowest px-4 py-2.5 text-body-md text-on-surface";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-title-lg font-bold text-on-surface">Reasignar stock</h3>
          <button onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 text-outline hover:bg-surface-container">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-3.5">
          <label className="block">
            <span className="mb-1 block text-label-md text-on-surface-variant">Producto</span>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className={selectClass}>
              <option value="">Elige un producto</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-label-md text-on-surface-variant">De</span>
            <select value={fromId} onChange={(e) => setFromId(e.target.value)} className={selectClass}>
              <option value="">Del pool sin reclamar</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
            {!fromId && selectedProduct && (
              <span className="mt-1 block text-[11.5px] text-outline">
                {selectedProduct.unclaimedQty === null ? "Siempre disponible" : `${selectedProduct.unclaimedQty} sin reclamar disponibles`}
              </span>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-label-md text-on-surface-variant">Para</span>
            <select value={toId} onChange={(e) => setToId(e.target.value)} className={selectClass}>
              <option value="">Elige un destino</option>
              {staffList
                .filter((s) => s.id !== fromId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName}
                  </option>
                ))}
            </select>
          </label>
          <Input label="Cantidad" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <Button className="mt-5 w-full" disabled={!canSubmit || reassign.isPending} onClick={() => reassign.mutate()}>
          {reassign.isPending ? "Reasignando..." : "Reasignar"}
        </Button>
      </div>
    </div>
  );
}

function CashCloseCompliance({ status }) {
  if (!status?.frequency) {
    return <p className="text-body-md text-on-surface-variant">Configurá un día de cuadre abajo para ver el cumplimiento acá.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
      <table className="w-full min-w-[420px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-surface-container text-[11px] font-bold uppercase tracking-wide text-outline">
            <th className="px-3.5 py-2.5">Empleado</th>
            <th className="px-3.5 py-2.5">Vendido</th>
            <th className="px-3.5 py-2.5">Reportó</th>
          </tr>
        </thead>
        <tbody>
          {status.staff.length === 0 && (
            <tr>
              <td colSpan={3} className="px-3.5 py-4 text-center text-on-surface-variant">
                Sin usuarios de sistema con ventas manuales todavía.
              </td>
            </tr>
          )}
          {status.staff.map((s) => (
            <tr key={s.id} className={`border-b border-surface-container last:border-b-0 ${!s.reported ? "bg-error/[0.04]" : ""}`}>
              <td className="px-3.5 py-2.5 font-semibold text-on-surface">{s.fullName}</td>
              <td className="px-3.5 py-2.5">{fmtMoney(s.totalSales)}</td>
              <td className="px-3.5 py-2.5">
                {s.reported ? (
                  <span className="flex items-center gap-1 text-[12px] font-bold text-verified-dark">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Sí
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[12px] font-bold text-error">
                    <AlertTriangle className="h-3.5 w-3.5" /> Falta
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const WEEKDAYS = [
  { v: 1, l: "Lunes" },
  { v: 2, l: "Martes" },
  { v: 3, l: "Miércoles" },
  { v: 4, l: "Jueves" },
  { v: 5, l: "Viernes" },
  { v: 6, l: "Sábado" },
  { v: 7, l: "Domingo" },
];

function CashCloseSettingsForm({ settings }) {
  const [frequency, setFrequency] = useState(settings.cashCloseFrequency ?? "");
  const [dayOfWeek, setDayOfWeek] = useState(settings.cashCloseDayOfWeek ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState(settings.cashCloseDayOfMonth ?? 1);
  const queryClient = useQueryClient();
  const selectClass = "rounded border border-outline-variant bg-surface-container-lowest px-4 py-2.5 text-body-md text-on-surface";

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch("/vendor-staff-sales/settings", {
          cashCloseFrequency: frequency || null,
          cashCloseDayOfWeek: frequency === "WEEKLY" ? Number(dayOfWeek) : undefined,
          cashCloseDayOfMonth: frequency === "MONTHLY" ? Number(dayOfMonth) : undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success("Configuración guardada.");
      queryClient.invalidateQueries({ queryKey: ["staff-sales-settings"] });
      queryClient.invalidateQueries({ queryKey: ["staff-sales-cash-close-status"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  return (
    <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-[18px]">
      <p className="mb-3 text-[15px] font-bold text-on-surface">Día de cuadre de caja</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-label-md text-on-surface-variant">Frecuencia</span>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className={selectClass}>
            <option value="">Sin configurar</option>
            <option value="DAILY">Diario</option>
            <option value="WEEKLY">Semanal</option>
            <option value="MONTHLY">Mensual</option>
          </select>
        </label>
        {frequency === "WEEKLY" && (
          <label className="block">
            <span className="mb-1 block text-label-md text-on-surface-variant">Día de la semana</span>
            <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} className={selectClass}>
              {WEEKDAYS.map((d) => (
                <option key={d.v} value={d.v}>
                  {d.l}
                </option>
              ))}
            </select>
          </label>
        )}
        {frequency === "MONTHLY" && (
          <div className="w-24">
            <Input label="Día del mes" type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
          </div>
        )}
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </div>
  );
}

function SaleEditModal({ sale, onClose }) {
  const [quantity, setQuantity] = useState(sale.quantity);
  const [unitPrice, setUnitPrice] = useState(sale.unitPrice);
  const [note, setNote] = useState(sale.note ?? "");
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/vendor-staff-sales/sales/${sale.id}`, {
          quantity: Number(quantity),
          unitPrice: Number(unitPrice),
          note: note.trim(),
        })
      ).data,
    onSuccess: () => {
      toast.success("Venta actualizada.");
      queryClient.invalidateQueries({ queryKey: ["staff-sales-log"] });
      queryClient.invalidateQueries({ queryKey: ["staff-sales-staff"] });
      queryClient.invalidateQueries({ queryKey: ["staff-sales-cash-close-status"] });
      queryClient.invalidateQueries({ queryKey: ["staff-sales-products-tracking"] });
      queryClient.invalidateQueries({ queryKey: ["staff-sales-analytics"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar la venta."),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-lg bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-title-lg font-bold text-on-surface">Editar venta</h3>
          <button onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 text-outline hover:bg-surface-container">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3.5 text-[12.5px] text-outline">
          {sale.productName} · {sale.staffName}
        </p>
        <div className="flex flex-col gap-3.5">
          <Input label="Cantidad" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          <Input label="Precio unitario" type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
          <Input label="Nota" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button className="mt-5 w-full" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>
    </div>
  );
}

function SalesLogSection({ staffList }) {
  const [staffFilter, setStaffFilter] = useState("");
  const [period, setPeriod] = useState("");
  const [editingSale, setEditingSale] = useState(null);
  const [deletingSale, setDeletingSale] = useState(null);
  const queryClient = useQueryClient();

  const { data: sales, isLoading } = useQuery({
    queryKey: ["staff-sales-log", staffFilter, period],
    queryFn: async () =>
      (await api.get("/vendor-staff-sales/sales", { params: { vendorStaffId: staffFilter || undefined, period: period || undefined } })).data.sales,
    refetchInterval: 15000,
  });

  const del = useMutation({
    mutationFn: async (id) => (await api.delete(`/vendor-staff-sales/sales/${id}`)).data,
    onSuccess: () => {
      toast.success("Venta eliminada.");
      setDeletingSale(null);
      queryClient.invalidateQueries({ queryKey: ["staff-sales-log"] });
      queryClient.invalidateQueries({ queryKey: ["staff-sales-staff"] });
      queryClient.invalidateQueries({ queryKey: ["staff-sales-cash-close-status"] });
      queryClient.invalidateQueries({ queryKey: ["staff-sales-products-tracking"] });
      queryClient.invalidateQueries({ queryKey: ["staff-sales-analytics"] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo eliminar la venta.");
      setDeletingSale(null);
    },
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold text-on-surface">Registro completo de ventas</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
            className="rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[12.5px] text-on-surface"
          >
            <option value="">Todo el equipo</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
          <div className="flex gap-1.5">
            <button
              onClick={() => setPeriod("")}
              className={`rounded-full px-3 py-1.5 text-[11.5px] font-bold ${period === "" ? "bg-verified/15 text-verified-dark" : "bg-surface-container text-on-surface-variant"}`}
            >
              Todas
            </button>
            {PERIOD_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setPeriod(t.key)}
                className={`rounded-full px-3 py-1.5 text-[11.5px] font-bold ${period === t.key ? "bg-verified/15 text-verified-dark" : "bg-surface-container text-on-surface-variant"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" disabled={!sales?.length} onClick={() => downloadSalesCsv(sales ?? [])}>
            <Download className="h-3.5 w-3.5" /> Descargar CSV
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-body-md text-on-surface-variant">Cargando...</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
          <table className="w-full min-w-[720px] text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-surface-container text-[11px] font-bold uppercase tracking-wide text-outline">
                <th className="px-3 py-2.5">Fecha</th>
                <th className="px-3 py-2.5">Empleado</th>
                <th className="px-3 py-2.5">Producto</th>
                <th className="px-3 py-2.5">Cant.</th>
                <th className="px-3 py-2.5">Total</th>
                <th className="px-3 py-2.5">Nota</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {(sales ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-5 text-center text-on-surface-variant">
                    Sin ventas para este filtro.
                  </td>
                </tr>
              )}
              {(sales ?? []).map((s) => (
                <tr key={s.id} className="border-b border-surface-container last:border-b-0">
                  <td className="px-3 py-2.5 text-outline">{fmtDate(s.createdAt)}</td>
                  <td className="px-3 py-2.5 font-semibold text-on-surface">{s.staffName}</td>
                  <td className="px-3 py-2.5">{s.productName}</td>
                  <td className="px-3 py-2.5">{s.quantity}</td>
                  <td className="px-3 py-2.5 font-bold text-on-surface">{fmtMoney(s.total)}</td>
                  <td className="px-3 py-2.5 text-outline">{s.note || "—"}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setEditingSale(s)} className="rounded p-1.5 text-on-surface-variant hover:bg-surface-container">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setDeletingSale(s)} className="rounded p-1.5 text-error hover:bg-error/10">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingSale && <SaleEditModal sale={editingSale} onClose={() => setEditingSale(null)} />}
      {deletingSale && (
        <ConfirmDeleteModal
          title="¿Eliminar esta venta?"
          description={`Se revierte el stock y el inventario de "${deletingSale.staffName}" automáticamente.`}
          pending={del.isPending}
          onConfirm={() => del.mutate(deletingSale.id)}
          onCancel={() => setDeletingSale(null)}
        />
      )}
    </div>
  );
}

// Feedback del dueño: "los productos que más se venden y menos se venden en
// una tabla de seguimiento" — círculo numerado + badge, mismo estilo que el
// resto de estas listas chicas.
function ProductTrackingSection() {
  const [period, setPeriod] = useState("month");

  const { data } = useQuery({
    queryKey: ["staff-sales-products-tracking", period],
    queryFn: async () => (await api.get("/vendor-staff-sales/products-tracking", { params: { period } })).data,
    refetchInterval: 8000,
  });

  const products = data?.products ?? [];
  const best = products.slice(0, 5);
  const worst = products.slice(-5).reverse();

  return (
    <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-[22px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold text-on-surface">Productos más y menos vendidos</h2>
        <div className="flex gap-1.5">
          {PERIOD_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setPeriod(t.key)}
              className={`rounded-full px-3 py-1.5 text-[11.5px] font-bold ${
                period === t.key ? "bg-verified/15 text-verified-dark" : "bg-surface-container text-on-surface-variant"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div>
          <p className="mb-3 text-[12.5px] font-semibold text-on-surface-variant">Más vendidos</p>
          {best.length === 0 ? (
            <p className="py-2 text-body-md text-on-surface-variant">Sin ventas suficientes en este período.</p>
          ) : (
            <div className="flex flex-col">
              {best.map((p, i) => (
                <div key={p.productId} className="flex items-center gap-3 border-b border-surface-container py-2.5 last:border-b-0">
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-[11px] font-extrabold text-on-surface-variant">
                    {i + 1}
                  </div>
                  <div className="flex-1 truncate text-[13px] font-semibold text-on-surface">{p.name}</div>
                  <span className="flex-shrink-0 rounded-full bg-verified/15 px-2.5 py-1 text-[11px] font-bold text-verified-dark">
                    {p.soldCount} vendidos
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="mb-3 text-[12.5px] font-semibold text-on-surface-variant">Menos vendidos</p>
          {worst.length === 0 ? (
            <p className="py-2 text-body-md text-on-surface-variant">Sin ventas suficientes en este período.</p>
          ) : (
            <div className="flex flex-col">
              {worst.map((p) => (
                <div key={p.productId} className="flex items-center gap-3 border-b border-surface-container py-2.5 last:border-b-0">
                  <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-on-surface">{p.name}</div>
                  <span className="flex-shrink-0 rounded-full bg-error/10 px-2.5 py-1 text-[11px] font-bold text-error">{p.soldCount} vendidos</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Bloque 202 (pedido explícito — "no será una sección visible en el panel
// del... dueño... será una sección que se habilita sola cuando un usuario
// de venta tiene productos asignados... no hay buena conexión entre las
// secciones de Agentes de Ventas y sus configuraciones y la sección de los
// usuarios"): TODO lo de supervisión (equipo con stock/ventas, reasignar,
// análisis por empleado, más/menos vendidos, cuadre de caja, log completo)
// se mudó acá desde VendorManualSales.jsx — ya no son 2 secciones sueltas,
// es una sola, la que el dueño ya conocía. Solo se muestra si hay al menos
// un usuario de sistema creado (nada que supervisar todavía si no).
function ManualSalesOversight({ staffList }) {
  const [analyticsStaffId, setAnalyticsStaffId] = useState("");

  const selectedStaffId = analyticsStaffId || staffList[0]?.id || "";

  const { data: analytics } = useQuery({
    queryKey: ["staff-sales-analytics", selectedStaffId],
    queryFn: async () => (await api.get(`/vendor-staff-sales/staff/${selectedStaffId}/analytics`)).data,
    enabled: !!selectedStaffId,
    refetchInterval: 15000,
  });

  const { data: cashCloseStatus } = useQuery({
    queryKey: ["staff-sales-cash-close-status"],
    queryFn: async () => (await api.get("/vendor-staff-sales/cash-close-status")).data,
    refetchInterval: 15000,
  });

  const { data: settings } = useQuery({
    queryKey: ["staff-sales-settings"],
    queryFn: async () => (await api.get("/vendor-staff-sales/settings")).data,
    refetchInterval: 15000,
  });

  return (
    <div className="mt-8 flex flex-col gap-6 border-t border-surface-container-high pt-8">
      <div>
        <h2 className="mb-1 text-[18px] font-bold text-on-surface">Ventas manuales del equipo</h2>
        <p className="text-[13px] text-outline">
          Stock reclamado, ventas de campo y cuadre de caja — reasigna stock desde cada tarjeta de arriba.
        </p>
      </div>

      <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-[22px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[15px] font-bold text-on-surface">Análisis por empleado</div>
          <select
            value={selectedStaffId}
            onChange={(e) => setAnalyticsStaffId(e.target.value)}
            className="rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[12.5px] text-on-surface"
          >
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div>
            <p className="mb-3 text-[12.5px] font-semibold text-on-surface-variant">Ventas por día (últimas 8 semanas)</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={analytics?.salesByDay ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e2e1" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
                <Tooltip content={<SalesTooltip />} cursor={{ stroke: "#337475", strokeWidth: 1 }} />
                <Line type="monotone" dataKey="total" stroke="#337475" strokeWidth={2.5} dot={{ r: 2.5, fill: "#337475" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <p className="mb-3 text-[12.5px] font-semibold text-on-surface-variant">Top 5 productos (este mes)</p>
            <div className="flex flex-col">
              {(analytics?.bestProducts ?? []).length === 0 ? (
                <p className="py-2 text-body-md text-on-surface-variant">Sin ventas suficientes este mes.</p>
              ) : (
                analytics.bestProducts.map((p, i) => (
                  <div key={p.productId} className="flex items-center gap-3 border-b border-surface-container py-2.5 last:border-b-0">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-[11px] font-extrabold text-on-surface-variant">
                      {i + 1}
                    </div>
                    <div className="flex-1 truncate text-[13px] font-semibold text-on-surface">{p.name}</div>
                    <span className="flex-shrink-0 rounded-full bg-verified/15 px-2.5 py-1 text-[11px] font-bold text-verified-dark">{p.soldCount} vendidos</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <ProductTrackingSection />

      <div>
        <h2 className="mb-3 text-[15px] font-bold text-on-surface">Cumplimiento de cuadre de caja</h2>
        <CashCloseCompliance status={cashCloseStatus} />
      </div>

      {settings ? <CashCloseSettingsForm settings={settings} /> : <p className="text-body-md text-on-surface-variant">Cargando configuración...</p>}

      <SalesLogSection staffList={staffList} />
    </div>
  );
}

export default function VendorUsers() {
  const { vendor } = useOutletContext();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewingHistory, setViewingHistory] = useState(null);
  // Bloque 204: se guarda solo el id (no el objeto) — así, apenas una
  // mutación invalida ["my-staff"]/["staff-sales-staff"], StaffDetailModal
  // recibe la versión fresca del staff en cada render, en vez de quedarse
  // con la foto vieja tomada en el momento del clic en "Ver".
  const [viewingStaffId, setViewingStaffId] = useState(null);
  const [reassigningStaffId, setReassigningStaffId] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["my-staff"],
    queryFn: async () => (await api.get("/vendor-staff")).data.staff,
    // Bloque 201 (pedido explícito — "todos los cambios realizados se
    // mostrarán en tiempo real siempre"): mismo criterio que el resto de
    // Ventas manuales — esta lista y esa sección se editan cruzado todo
    // el tiempo (reasignar stock desde acá agrega una sección al perfil).
    refetchInterval: 15000,
  });

  // Bloque 202: stock/ventas de cada usuario — se mergea con `data` por id
  // para que cada StaffCard muestre las 2 cosas juntas, sin duplicar la
  // lista ni pedir 2 vueltas de click.
  const { data: salesStaff } = useQuery({
    queryKey: ["staff-sales-staff"],
    queryFn: async () => (await api.get("/vendor-staff-sales/staff")).data.staff,
    refetchInterval: 15000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["my-staff"] });

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Cargando usuarios...</p>;

  const salesStatsById = new Map((salesStaff ?? []).map((s) => [s.id, s]));
  const mergedStaff = (data ?? []).map((s) => ({ ...s, ...salesStatsById.get(s.id) }));
  const viewingStaff = mergedStaff.find((s) => s.id === viewingStaffId) ?? null;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconCircle icon={Users} tone="teal" />
          <div>
            <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-tight text-on-surface">Usuarios</h1>
            <p className="text-[13.5px] text-outline">
              Creá cuentas para tu equipo con acceso solo a las secciones del panel que elijas — cada acción que hagan queda
              registrada a su nombre.
            </p>
          </div>
        </div>
        <Button onClick={() => setCreating(true)}>
          <UserPlus className="h-4 w-4" /> Crear usuario
        </Button>
      </div>

      {mergedStaff.length === 0 && (
        <div className="rounded-lg border border-dashed border-outline-variant p-8 text-center text-body-md text-on-surface-variant">
          Todavía no creaste ningún usuario de sistema.
        </div>
      )}

      {mergedStaff.length > 0 && <ManualSalesOversight staffList={mergedStaff} />}

      {/* Bloque 204 (pedido explícito — "los usuarios registrados bajarán
          hasta el final de esa sección"): antes esta grilla era lo primero
          debajo del encabezado — ahora va al final, después de todo lo de
          supervisión/ventas, que es lo que de verdad se usa seguido. */}
      {mergedStaff.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-[18px] font-bold text-on-surface">Usuarios registrados</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mergedStaff.map((staff) => (
              <StaffCard key={staff.id} staff={staff} onView={(s) => setViewingStaffId(s.id)} />
            ))}
          </div>
        </div>
      )}

      {creating && (
        <CreateStaffModal
          isRestaurant={vendor?.isRestaurant}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            invalidate();
          }}
        />
      )}
      {editing && (
        <EditStaffModal
          staff={editing}
          isRestaurant={vendor?.isRestaurant}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}
      {viewingHistory && <StaffHistoryModal staff={viewingHistory} onClose={() => setViewingHistory(null)} />}
      {viewingStaff && (
        <StaffDetailModal
          staff={viewingStaff}
          onClose={() => setViewingStaffId(null)}
          onEdit={setEditing}
          onHistory={setViewingHistory}
          onReassign={(s) => setReassigningStaffId(s.id)}
        />
      )}
      {reassigningStaffId && (
        <ReassignModal staffList={mergedStaff} initialToId={reassigningStaffId} onClose={() => setReassigningStaffId(null)} />
      )}
    </div>
  );
}
