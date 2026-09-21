import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { X, Pencil, KeyRound, History, CheckCircle2, Ban } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.jsx";
import { Input } from "../ui/Input.jsx";
import { Select } from "../ui/Select.jsx";
import { ConfirmModal } from "../ConfirmModal.jsx";
import { SectionAccessPicker } from "../vendor/SectionAccessPicker.jsx";
import { vendorSectionLabel } from "../../lib/vendorSections.js";
import { STAFF_TYPES, STAFF_TYPE_DEFAULT_SECTIONS, staffTypeLabel } from "../../lib/staffTypes.js";
import { UnsavedChangesModal } from "../UnsavedChangesModal.jsx";
import { useDirtyModal } from "../../lib/useDirtyModal.js";

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}
function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString("es-CU") : "—";
}

// Bloque 183 (pedido explícito — "el administrador general del sistema
// también puede controlar y verificar lo mismo que pueda hacer el
// vendedor... poder verificar cuáles son los usuarios que ha creado ese
// vendedor, si esos usuarios están activos o no, podrá modificarlos y
// podrá ver todo el seguimiento de cada uno"): mismo espíritu que
// VendorUsers.jsx (panel del propio dueño) pero apuntando a los
// endpoints /admin/vendor-staff/* — un admin no da de alta usuarios ajenos
// (eso lo sigue haciendo solo el dueño desde su panel), pero sí puede ver,
// editar, activar/desactivar, restablecer contraseña y auditar a
// cualquiera.
// Bloque 187 (bug real reportado en vivo — "edité un usuario desde el
// panel y le di más acceso a secciones y configuré los permisos... en el
// panel del usuario no me sale nada": el admin no tenía este mismo control
// — allowedSections/sectionPermissions se guardaba a medias o se perdía en
// silencio del lado del servidor, ver el comentario largo en
// admin.controller.js): mismo SectionAccessPicker que usa el propio
// vendedor desde su panel (VendorUsers.jsx) — ahora ambos caminos guardan
// exactamente lo mismo, en el mismo formato.
function EditStaffModal({ staff, onClose, onSaved, isRestaurant }) {
  const [fullName, setFullName] = useState(staff.fullName);
  const [email, setEmail] = useState(staff.email);
  const [staffType, setStaffType] = useState(staff.staffType ?? "");
  const [sections, setSections] = useState(staff.allowedSections);
  const [permissions, setPermissions] = useState(staff.sectionPermissions ?? {});

  // Bloque 196 (pedido explícito — "si se hace clic fuera de un contenedor
  // mostrado como ventana o popup en el panel debe cerrarse automáticamente,
  // y si necesita que guarden datos debe preguntar si desea guardar o
  // descartar antes de cerrar"): mismo patrón de snapshot-en-ref que
  // ProductModal (VendorProducts.jsx).
  const initialStaffSnapshot = useRef(JSON.stringify({ fullName, email, staffType, sections, permissions }));
  const isDirty = JSON.stringify({ fullName, email, staffType, sections, permissions }) !== initialStaffSnapshot.current;

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/admin/vendor-staff/${staff.id}`, {
          fullName: fullName.trim(),
          email: email.trim(),
          staffType: staffType || null,
          allowedSections: sections,
          sectionPermissions: permissions,
        })
      ).data,
    onSuccess: () => {
      toast.success("Usuario actualizado.");
      onSaved();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar."),
  });

  // Bloque 200: ya no exige sections.length > 0 — mismo criterio que
  // VendorUsers.jsx (un usuario sin ninguna sección es válido).
  const canSaveNow = true;
  const dirtyModal = useDirtyModal({
    isDirty,
    onClose,
    onSave: canSaveNow ? () => save.mutateAsync() : undefined,
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

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-title-lg font-bold text-on-surface">Editar usuario (admin)</h3>
          <button onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 text-outline hover:bg-surface-container">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-3.5">
          <Input label="Nombre completo" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <Input label="Correo electrónico" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Select label="Tipo de usuario" value={staffType} onChange={(e) => handleStaffTypeChange(e.target.value)}>
            {STAFF_TYPES.filter((t) => t.key !== "WAITER" || isRestaurant).map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
          <SectionAccessPicker sections={sections} permissions={permissions} onToggleSection={toggleSection} onSetLevel={setLevel} />
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

function StaffHistoryModal({ staff, onClose }) {
  const [tab, setTab] = useState("activity");
  const { data: activity } = useQuery({
    queryKey: ["admin-staff-activity", staff.id],
    queryFn: async () => (await api.get(`/admin/vendor-staff/${staff.id}/activity`)).data.activity,
    enabled: tab === "activity",
  });
  const { data: sessions } = useQuery({
    queryKey: ["admin-staff-sessions", staff.id],
    queryFn: async () => (await api.get(`/admin/vendor-staff/${staff.id}/sessions`)).data.sessions,
    enabled: tab === "sessions",
  });

  return (
    // Bloque 196: sin borrador propio — solo lectura (actividad/sesiones),
    // cierra directo al hacer clic afuera.
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-inverse-surface/40 p-4"
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
          <button onClick={() => setTab("activity")} className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold ${tab === "activity" ? "bg-tertiary-accent/10 text-tertiary-accent" : "text-outline"}`}>
            Actividad
          </button>
          <button onClick={() => setTab("sessions")} className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold ${tab === "sessions" ? "bg-tertiary-accent/10 text-tertiary-accent" : "text-outline"}`}>
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
                  {s.revokedAt ? <span className="text-error">Cerró: {fmtDate(s.revokedAt)}</span> : <span className="text-verified">Activa</span>}
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

function StaffRow({ staff, onEdit, onHistory, invalidate }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const photo = imgUrl(staff.photoUrl);

  const resetPassword = useMutation({
    mutationFn: async () => (await api.post(`/admin/vendor-staff/${staff.id}/reset-password`)).data,
    onSuccess: () => {
      toast.success("Contraseña restablecida.");
      setConfirmReset(false);
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo restablecer.");
      setConfirmReset(false);
    },
  });

  const toggleActive = useMutation({
    mutationFn: async () => (await api.patch(`/admin/vendor-staff/${staff.id}`, { isActive: !staff.isActive })).data,
    onSuccess: () => {
      toast.success(staff.isActive ? "Usuario desactivado." : "Usuario reactivado.");
      setConfirmToggle(false);
      invalidate();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo actualizar.");
      setConfirmToggle(false);
    },
  });

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-surface-container-high p-3">
      <div className="flex items-center gap-2.5">
        {photo ? (
          <img src={photo} alt={staff.fullName} className="h-10 w-10 flex-shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-secondary-container font-display text-base font-bold text-on-secondary-container">
            {staff.fullName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-on-surface">{staff.fullName}</p>
          <p className="truncate text-[11.5px] text-outline">{staff.email}</p>
        </div>
        <span
          className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
          style={staff.isActive ? { background: "rgba(12,174,83,0.12)", color: "#0A8F42" } : { background: "rgba(186,26,26,0.1)", color: "#ba1a1a" }}
        >
          {staff.isActive ? "Activo" : "Inactivo"}
        </span>
      </div>
      {staff.staffType && (
        <span className="w-fit rounded-full bg-tertiary-accent/10 px-2 py-0.5 text-[10.5px] font-bold text-tertiary-accent">
          {staffTypeLabel(staff.staffType)}
        </span>
      )}
      <div className="flex flex-wrap gap-1.5">
        {staff.allowedSections.map((key) => {
          const isViewOnly = (staff.sectionPermissions?.[key] ?? "manage") === "view";
          return (
            <span
              key={key}
              className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
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
      <p className="text-[11px] text-outline">Último acceso: {staff.lastLoginAt ? fmtDate(staff.lastLoginAt) : "Nunca"}</p>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => onHistory(staff)} className="flex items-center gap-1 rounded-[7px] bg-surface-container px-2 py-1 text-[11px] font-bold text-on-surface-variant">
          <History className="h-3 w-3" /> Actividad
        </button>
        <button onClick={() => onEdit(staff)} className="flex items-center gap-1 rounded-[7px] bg-surface-container px-2 py-1 text-[11px] font-bold text-on-surface-variant">
          <Pencil className="h-3 w-3" /> Editar
        </button>
        <button onClick={() => setConfirmReset(true)} className="flex items-center gap-1 rounded-[7px] bg-tertiary-accent/10 px-2 py-1 text-[11px] font-bold text-tertiary-accent">
          <KeyRound className="h-3 w-3" /> Restablecer contraseña
        </button>
        <button
          onClick={() => setConfirmToggle(true)}
          className={`flex items-center gap-1 rounded-[7px] px-2 py-1 text-[11px] font-bold ${staff.isActive ? "bg-error/10 text-error" : "bg-verified/10 text-verified-dark"}`}
        >
          {staff.isActive ? <Ban className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
          {staff.isActive ? "Desactivar" : "Reactivar"}
        </button>
      </div>

      <ConfirmModal
        open={confirmReset}
        title="¿Restablecer la contraseña?"
        message={`"${staff.fullName}" va a tener que crear una contraseña nueva la próxima vez que intente entrar.`}
        confirmLabel={resetPassword.isPending ? "Restableciendo..." : "Restablecer"}
        confirmDisabled={resetPassword.isPending}
        onConfirm={() => resetPassword.mutate()}
        onCancel={() => setConfirmReset(false)}
      />
      <ConfirmModal
        open={confirmToggle}
        title={staff.isActive ? `¿Desactivar a "${staff.fullName}"?` : `¿Reactivar a "${staff.fullName}"?`}
        message={staff.isActive ? "Pierde el acceso al panel de inmediato." : "Vuelve a poder entrar con las secciones que tenía asignadas."}
        confirmLabel={toggleActive.isPending ? "Guardando..." : staff.isActive ? "Desactivar" : "Reactivar"}
        confirmDisabled={toggleActive.isPending}
        danger={staff.isActive}
        onConfirm={() => toggleActive.mutate()}
        onCancel={() => setConfirmToggle(false)}
      />
    </div>
  );
}

export function AdminVendorStaffModal({ vendor, onClose }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [viewingHistory, setViewingHistory] = useState(null);

  const { data: staff, isLoading } = useQuery({
    queryKey: ["admin-vendor-staff", vendor.id],
    queryFn: async () => (await api.get(`/admin/vendors/${vendor.id}/staff`)).data.staff,
    // Bloque 201 audit: mismos datos (isActive, allowedSections,
    // lastLoginAt) que VendorUsers.jsx ya refresca cada 15s desde el panel
    // del propio dueño — un admin puede dejar este modal abierto mientras
    // el dueño (u otro admin) edita/desactiva al mismo usuario en paralelo.
    refetchInterval: 15000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-vendor-staff", vendor.id] });

  return (
    // Bloque 196: solo lista + acciones (cada una con su propio confirm o
    // sub-modal, sin borrador propio de esta ventana) — cierra directo al
    // hacer clic afuera.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-title-lg font-bold text-on-surface">Usuarios de "{vendor.companyName}"</h2>
          <button onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 text-outline hover:bg-surface-container">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}
        {staff?.length === 0 && <p className="text-body-md text-on-surface-variant">Esta tienda todavía no creó ningún usuario de sistema.</p>}

        <div className="flex flex-col gap-3">
          {staff?.map((s) => (
            <StaffRow key={s.id} staff={s} onEdit={setEditing} onHistory={setViewingHistory} invalidate={invalidate} />
          ))}
        </div>
      </div>

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
    </div>
  );
}
