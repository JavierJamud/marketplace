import { useEffect, useState } from "react";
import { Link, useOutletContext, useNavigate, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Mail, KeyRound, ShieldCheck, Store as StoreIcon, ArrowRight, UserRound, FileText, User as UserIcon } from "lucide-react";
import { api } from "../../lib/api.js";
import { useAuth, loginPathFor } from "../../context/AuthContext.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { PasswordInput } from "../../components/ui/PasswordInput.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { AiGenerateButton } from "../../components/AiGenerateButton.jsx";
import { CategoryIcon } from "../../components/ui/CategoryIcon.jsx";
import { PrivateDocument } from "../../components/PrivateDocument.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { ChangeEmailModal } from "../../components/ChangeEmailModal.jsx";

function PasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const save = useMutation({
    mutationFn: async () => (await api.patch("/auth/me/password", { currentPassword, newPassword, confirmPassword })).data,
    onSuccess: () => {
      toast.success("Contraseña actualizada.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo cambiar la contraseña."),
  });

  return (
    <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
        <KeyRound className="h-5 w-5 text-tertiary-accent" /> Cambiar contraseña
      </div>
      <p className="mb-4 text-[12.5px] text-outline">Necesitas tu contraseña actual para cambiarla.</p>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <PasswordInput label="Contraseña actual" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        <PasswordInput label="Contraseña nueva" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <PasswordInput label="Confirmar nueva" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
      </div>
      <Button
        className="mt-4 rounded-xl"
        disabled={!currentPassword || newPassword.length < 8 || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? "Guardando..." : "Actualizar contraseña"}
      </Button>
    </div>
  );
}

// Bloque 60: reemplaza el switch opt-in de 2FA (ya no aplica — el código de
// login pasa a ser obligatorio para todos, no opcional, ver
// auth.controller.js login()). En su lugar, un control real: cerrar sesión
// en todos los dispositivos/navegadores de la cuenta de una — útil si el
// vendedor sospecha que alguien más tiene acceso. Pide confirmación antes
// de ejecutar (mismo ConfirmModal que ya usa el resto del sitio para
// acciones consecuentes) ya que además de cerrar TODAS las sesiones activas
// también borra los dispositivos "de confianza" — el próximo login, en
// cualquier lado (incluida esta misma pestaña), va a volver a pedir el
// código de verificación.
function SecurityCard() {
  const { logoutAllDevices } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [confirming, setConfirming] = useState(false);

  const logoutAll = useMutation({
    mutationFn: logoutAllDevices,
    onSuccess: () => {
      toast.success("Cerraste sesión en todos los dispositivos.");
      navigate(loginPathFor(location.pathname), { replace: true });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo cerrar la sesión en todos los dispositivos."),
  });

  return (
    <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
        <ShieldCheck className="h-5 w-5 text-tertiary-accent" /> Seguridad de la cuenta
      </div>
      <p className="mb-4 text-[12.5px] text-outline">
        Tu sesión y tus dispositivos recordados están protegidos con un código de verificación por correo, obligatorio
        en cada inicio de sesión desde un navegador nuevo. Si sospechas que alguien más tiene acceso, cierra sesión en
        todos tus dispositivos — vas a tener que volver a iniciar sesión (y verificar el código) en todos lados.
      </p>
      <Button variant="outline" className="rounded-xl border-error text-error hover:bg-error/5" onClick={() => setConfirming(true)}>
        Cerrar sesión en todos los dispositivos
      </Button>

      <ConfirmModal
        open={confirming}
        title="¿Cerrar sesión en todos los dispositivos?"
        message="Esto revoca todas tus sesiones activas y todos los dispositivos recordados — vas a tener que volver a iniciar sesión (con el código de verificación) en cualquier lado, incluida esta pestaña."
        confirmLabel={logoutAll.isPending ? "Cerrando..." : "Sí, cerrar todas"}
        danger
        confirmDisabled={logoutAll.isPending}
        onConfirm={() => logoutAll.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

// Movido acá desde VendorSettings.jsx (antes vivía en una tarjeta "Responsable
// Legal" junto a datos de facturación/entrega) — es un dato de la persona/
// cuenta, no de la operación de la tienda, así que pertenece a Perfil.
// Mutación propia (no comparte form con StoreInfoCard) para poder guardarse
// sola sin tocar el resto de los datos de la tienda.
function OwnerNameCard() {
  const queryClient = useQueryClient();
  const { vendor } = useOutletContext();
  const [ownerName, setOwnerName] = useState("");

  useEffect(() => {
    setOwnerName(vendor?.ownerName ?? "");
  }, [vendor]);

  const save = useMutation({
    mutationFn: async () => (await api.patch("/vendors/me", { ownerName })).data,
    onSuccess: () => {
      toast.success("Responsable del negocio actualizado.");
      queryClient.invalidateQueries({ queryKey: ["my-vendor"] });
      queryClient.invalidateQueries({ queryKey: ["my-vendor-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  return (
    <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
        <UserRound className="h-5 w-5 text-tertiary-accent" /> Responsable del negocio
      </div>
      <p className="mb-4 text-[12.5px] text-outline">Privado — solo lo ven admin y tú. Nunca se muestra en tu tienda pública.</p>
      <Input label="Nombre del responsable" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
      <Button className="mt-4 rounded-xl font-bold" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Guardando..." : "Guardar"}
      </Button>
    </div>
  );
}

// Solo lectura — el vendedor ve sus propias fotos de verificación (mismo
// endpoint/patrón que AdminVerifications.jsx, ver PrivateDocument.jsx: blob
// autenticado, la ownership la valida getVerificationFile en el backend
// porque acá vendor.userId === req.user.id).
function KycDocumentsCard() {
  const { vendor } = useOutletContext();
  if (!vendor?.verification) return null;

  return (
    <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
        <FileText className="h-5 w-5 text-tertiary-accent" /> Documentos de verificación
      </div>
      <p className="mb-4 text-[12.5px] text-outline">Las fotos que enviaste para verificar tu tienda.</p>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <PrivateDocument vendorId={vendor.id} type="selfie" label="Foto del responsable" Icon={UserIcon} available={!!vendor.verification.selfieUrl} />
        <PrivateDocument vendorId={vendor.id} type="id" label="Documento de identidad" Icon={FileText} available={!!vendor.verification.idPhotoFrontUrl} />
      </div>
    </div>
  );
}

function StoreInfoCard() {
  const queryClient = useQueryClient();
  const { vendor } = useOutletContext();
  const [form, setForm] = useState({ companyName: "", description: "", whatsapp: "", businessCategoryId: "" });

  const { data: businessCategories } = useQuery({
    queryKey: ["business-categories"],
    queryFn: async () => (await api.get("/business-categories")).data.categories,
  });

  useEffect(() => {
    if (!vendor) return;
    setForm({
      companyName: vendor.companyName,
      description: vendor.description ?? "",
      whatsapp: vendor.whatsapp,
      businessCategoryId: vendor.businessCategory?.id ?? "",
    });
  }, [vendor]);

  const currentBusinessCategoryMissing =
    businessCategories && vendor?.businessCategory && !businessCategories.some((c) => c.id === vendor.businessCategory.id);
  const businessCategoryOptions = currentBusinessCategoryMissing ? [...businessCategories, vendor.businessCategory] : businessCategories;
  const selectedBusinessCategory = businessCategoryOptions?.find((c) => c.id === form.businessCategoryId);

  const save = useMutation({
    mutationFn: async () => (await api.patch("/vendors/me", form)).data,
    onSuccess: () => {
      toast.success("Datos de la tienda actualizados.");
      queryClient.invalidateQueries({ queryKey: ["my-vendor"] });
      queryClient.invalidateQueries({ queryKey: ["my-vendor-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudieron guardar los cambios."),
  });

  return (
    <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
        <StoreIcon className="h-5 w-5 text-tertiary-accent" /> Datos de la tienda
      </div>
      <p className="mb-4 text-[12.5px] text-outline">Nombre, descripción, WhatsApp y rubro visibles en tu tienda pública.</p>
      <div className="flex flex-col gap-4">
        <Input label="Nombre visible de la tienda" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-label-md font-semibold text-on-surface-variant">Descripción de la marca</span>
            <AiGenerateButton
              kind="store"
              currentText={form.description}
              onGenerated={(text) => setForm((f) => ({ ...f, description: text }))}
            />
          </div>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
            placeholder="Describe lo que vendes y tu propuesta de valor..."
          />
        </div>
        <Input label="WhatsApp de atención al cliente" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="+5350000000" />
        <div className="flex items-center gap-3">
          <Select label="Categoría principal de negocio" value={form.businessCategoryId} onChange={(e) => setForm({ ...form, businessCategoryId: e.target.value })} className="flex-1">
            {businessCategoryOptions?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          {selectedBusinessCategory && (
            <div className="mt-6 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-tertiary-accent/10">
              <CategoryIcon name={selectedBusinessCategory.icon} className="h-5 w-5 text-tertiary-accent" />
            </div>
          )}
        </div>
      </div>
      <Button className="mt-4 rounded-xl font-bold" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Guardando..." : "Guardar datos de la tienda"}
      </Button>
    </div>
  );
}

export default function VendorProfile() {
  const { user } = useAuth();
  const [changingEmail, setChangingEmail] = useState(false);

  return (
    <div className="max-w-[640px]">
      <h1 className="mb-1 text-display-sm font-extrabold text-on-surface">Mi perfil</h1>
      <p className="mb-6 text-body-md text-on-surface-variant">Correo, contraseña y datos de tu cuenta.</p>

      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
          <Mail className="h-5 w-5 text-tertiary-accent" /> Correo de la cuenta
        </div>
        <p className="mb-4 text-[13.5px] text-on-surface-variant">{user?.email}</p>
        <Button variant="outline" className="rounded-xl" onClick={() => setChangingEmail(true)}>Cambiar correo</Button>
      </div>

      <PasswordCard />
      <SecurityCard />
      <OwnerNameCard />
      <StoreInfoCard />
      <KycDocumentsCard />

      <Link
        to="/vendedor/verificacion"
        className="flex items-center justify-between rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5 text-[13.5px] font-semibold text-tertiary-accent shadow-sm hover:bg-surface-container"
      >
        Ver estado de verificación de tienda
        <ArrowRight className="h-4 w-4" />
      </Link>

      {changingEmail && <ChangeEmailModal currentEmail={user?.email} onClose={() => setChangingEmail(false)} />}
    </div>
  );
}
