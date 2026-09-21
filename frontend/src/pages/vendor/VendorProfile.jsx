import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext, useNavigate, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Mail, KeyRound, ShieldCheck, Store as StoreIcon, ArrowRight, UserRound, FileText, User as UserIcon, ImagePlus, Link2, X, Clock, Send, UserCog } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
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
import { DeleteAccountCard } from "../../components/DeleteAccountCard.jsx";

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

  // Bloque 153 (pedido explícito — "todos los datos de la tienda no se
  // pueden modificar después de estar verificadas sin aprobación del
  // admin... si se desea cambiar el responsable se debe enviar la
  // solicitud al admin para prevenir fraudes"): el backend ya rechaza este
  // guardado si la tienda está VERIFIED y el valor cambió — acá se bloquea
  // la UI directamente, con la explicación, en vez de dejar que el
  // vendedor escriba algo que el servidor va a rechazar igual.
  // Bloque 165 (mismo criterio aplicado en updateMyVendor, backend — bug
  // real: una tienda vieja sin responsable cargado quedaba sin forma de
  // completarlo): el candado solo aplica si YA hay un nombre real que
  // proteger — completar un campo vacío nunca cuenta como fraude.
  const locked = vendor?.verificationStatus === "VERIFIED" && !!vendor?.ownerName;

  return (
    <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
        <UserRound className="h-5 w-5 text-tertiary-accent" /> Responsable del negocio
      </div>
      <p className="mb-4 text-[12.5px] text-outline">Privado — solo lo ven admin y tú. Nunca se muestra en tu tienda pública.</p>
      {locked && (
        <p className="mb-3 rounded-md bg-tertiary-accent/[0.08] px-3 py-2 text-[12px] text-tertiary-accent">
          Tienda verificada — este dato ya no se edita acá. Para cambiarlo, usa "Solicitar cambio de datos" más abajo.
        </p>
      )}
      <Input label="Nombre del responsable" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} disabled={locked} />
      {!locked && (
        <Button className="mt-4 rounded-xl font-bold" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : "Guardar"}
        </Button>
      )}
    </div>
  );
}

// Bloque 153 (pedido explícito): mecanismo real para pedirle al admin un
// cambio a un dato de identidad bloqueado — 1 sola solicitud PENDING a la
// vez (el backend la rechaza si ya hay una, ver requestVendorChange). Fotos
// del nuevo responsable solo se piden si de verdad se está proponiendo
// CAMBIAR quién es esa persona (no para corregir, por ejemplo, la
// dirección) — mismo criterio del backend, reflejado acá para no pedir
// fotos de más.
function ChangeRequestCard() {
  const queryClient = useQueryClient();
  const { vendor } = useOutletContext();
  const [open, setOpen] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerIdNumber, setOwnerIdNumber] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [reason, setReason] = useState("");
  const [newOwnerSelfie, setNewOwnerSelfie] = useState(null);
  const [newOwnerIdPhoto, setNewOwnerIdPhoto] = useState(null);

  const { data: changeRequest } = useQuery({
    queryKey: ["my-change-request"],
    queryFn: async () => (await api.get("/vendors/me/change-request")).data.changeRequest,
    enabled: vendor?.verificationStatus === "VERIFIED",
  });

  const submit = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      if (companyName.trim()) form.append("companyName", companyName.trim());
      if (ownerName.trim()) form.append("ownerName", ownerName.trim());
      if (ownerIdNumber.trim()) form.append("ownerIdNumber", ownerIdNumber.trim());
      if (companyAddress.trim()) form.append("companyAddress", companyAddress.trim());
      if (reason.trim()) form.append("reason", reason.trim());
      if (newOwnerSelfie) form.append("newOwnerSelfie", newOwnerSelfie);
      if (newOwnerIdPhoto) form.append("newOwnerIdPhoto", newOwnerIdPhoto);
      return (await api.post("/vendors/me/change-request", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success("Solicitud enviada — el equipo la revisa pronto.");
      setOpen(false);
      setCompanyName("");
      setOwnerName("");
      setOwnerIdNumber("");
      setCompanyAddress("");
      setReason("");
      setNewOwnerSelfie(null);
      setNewOwnerIdPhoto(null);
      queryClient.invalidateQueries({ queryKey: ["my-change-request"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar la solicitud."),
  });

  if (vendor?.verificationStatus !== "VERIFIED") return null;

  const changingOwner = ownerName.trim() && ownerName.trim() !== vendor.ownerName;
  const hasAnyField = companyName.trim() || ownerName.trim() || ownerIdNumber.trim() || companyAddress.trim();
  const canSubmit = hasAnyField && (!changingOwner || (newOwnerSelfie && newOwnerIdPhoto)) && !submit.isPending;

  return (
    <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
        <Send className="h-5 w-5 text-tertiary-accent" /> Solicitar cambio de datos
      </div>
      <p className="mb-4 text-[12.5px] text-outline">
        El nombre de la tienda, el responsable, su ID y la dirección están bloqueados por seguridad — un admin revisa y aplica
        cualquier cambio, para prevenir fraudes.
      </p>

      {changeRequest?.status === "PENDING" ? (
        <p className="flex items-center gap-2 text-[13px] font-semibold text-tertiary-accent">
          <Clock className="h-4 w-4" /> Tienes una solicitud en revisión — el equipo la resuelve pronto.
        </p>
      ) : !open ? (
        <>
          {changeRequest?.status === "APPROVED" && (
            <p className="mb-3 text-[12.5px] font-semibold text-verified-dark">Tu última solicitud fue aprobada y ya se aplicó.</p>
          )}
          {changeRequest?.status === "REJECTED" && (
            <p className="mb-3 text-[12.5px] text-error">Tu última solicitud fue rechazada{changeRequest.adminNotes ? `: ${changeRequest.adminNotes}` : "."}</p>
          )}
          <Button variant="outline" className="rounded-xl font-bold" onClick={() => setOpen(true)}>
            Solicitar cambio
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-3.5">
          <Input label="Nuevo nombre de la tienda (opcional)" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder={vendor.companyName} />
          <Input label="Nuevo responsable (opcional)" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder={vendor.ownerName ?? "—"} />
          <Input label="Nuevo ID del responsable (opcional)" value={ownerIdNumber} onChange={(e) => setOwnerIdNumber(e.target.value)} placeholder={vendor.ownerIdNumber ?? "—"} />
          <Input label="Nueva dirección (opcional)" value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} placeholder={vendor.companyAddress ?? "—"} />
          <div>
            <span className="mb-1 block text-label-md text-on-surface-variant">Motivo (opcional)</span>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
            />
          </div>
          {changingOwner && (
            <div className="rounded-full border border-outline-variant p-3.5">
              <p className="mb-2.5 text-[12px] text-outline">
                Cambiar el responsable requiere una foto de esa persona y una foto de su identificación.
              </p>
              <div className="flex flex-wrap gap-3">
                <label className="flex h-10 cursor-pointer items-center gap-2 rounded border border-outline-variant px-3 text-[12.5px] font-semibold text-on-surface-variant hover:bg-surface-container">
                  {newOwnerSelfie ? newOwnerSelfie.name : "Foto de la persona"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => setNewOwnerSelfie(e.target.files?.[0] ?? null)} />
                </label>
                <label className="flex h-10 cursor-pointer items-center gap-2 rounded border border-outline-variant px-3 text-[12.5px] font-semibold text-on-surface-variant hover:bg-surface-container">
                  {newOwnerIdPhoto ? newOwnerIdPhoto.name : "Foto de su ID"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => setNewOwnerIdPhoto(e.target.files?.[0] ?? null)} />
                </label>
              </div>
            </div>
          )}
          <div className="flex gap-2.5">
            <Button variant="outline" className="rounded-xl font-bold" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button className="rounded-xl font-bold" disabled={!canSubmit} onClick={() => submit.mutate()}>
              {submit.isPending ? "Enviando..." : "Enviar solicitud"}
            </Button>
          </div>
        </div>
      )}
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
        {/* Bloque 146: solo aparece si el navegador lo pudo grabar al
            enviar la solicitud — nunca obligatorio. */}
        {vendor.verification.selfieVideoUrl && (
          <PrivateDocument vendorId={vendor.id} type="video" kind="video" label="Video (giro de cabeza)" Icon={UserIcon} available />
        )}
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
      {/* Bloque 153 (pedido explícito): el NOMBRE es un dato de identidad —
          se bloquea acá una vez verificada, el resto de esta tarjeta
          (descripción, WhatsApp, rubro) sigue editable libre, no es
          identidad. */}
      {vendor?.verificationStatus === "VERIFIED" && (
        <p className="mb-3 rounded-md bg-tertiary-accent/[0.08] px-3 py-2 text-[12px] text-tertiary-accent">
          Tienda verificada — el nombre ya no se edita acá. Para cambiarlo, solicita un cambio desde la tarjeta de abajo.
        </p>
      )}
      <div className="flex flex-col gap-4">
        <Input
          label="Nombre visible de la tienda"
          value={form.companyName}
          onChange={(e) => setForm({ ...form, companyName: e.target.value })}
          disabled={vendor?.verificationStatus === "VERIFIED"}
        />
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

function resolveVendorImg(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

// Bloque 133: subir archivo (mismo patrón que AdminBranding.jsx para el
// logo de la plataforma) o pegar un link externo (PATCH /vendors/me). El
// logo se ve en el avatar circular de Store.jsx. Bloque 207: la portada
// (foto de fondo del banner) se retiró — el banner de cada tienda ahora es
// siempre el color de marca + un patrón de íconos, ver StoreHeaderBanner.jsx.
function StoreBrandingCard() {
  const queryClient = useQueryClient();
  const { vendor } = useOutletContext();
  const logoFileRef = useRef(null);
  const [logoLinkInput, setLogoLinkInput] = useState("");
  const [logoFilePreview, setLogoFilePreview] = useState(null);

  function invalidateVendor() {
    queryClient.invalidateQueries({ queryKey: ["my-vendor"] });
    queryClient.invalidateQueries({ queryKey: ["my-vendor-settings"] });
  }

  const uploadLogoFile = useMutation({
    mutationFn: async (file) => {
      const form = new FormData();
      form.append("logo", file);
      return (await api.post("/vendors/me/logo", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success("Logo actualizado.");
      setLogoFilePreview(null);
      invalidateVendor();
    },
    onError: (err) => {
      setLogoFilePreview(null);
      toast.error(err.response?.data?.error ?? "No se pudo subir el logo.");
    },
  });

  const saveLogoLink = useMutation({
    mutationFn: async (logoUrl) => (await api.patch("/vendors/me", { logoUrl })).data,
    onSuccess: () => {
      toast.success("Logo actualizado.");
      setLogoLinkInput("");
      invalidateVendor();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el link."),
  });

  function handleLogoFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFilePreview(URL.createObjectURL(file));
    uploadLogoFile.mutate(file);
    e.target.value = "";
  }

  const currentLogoUrl = logoFilePreview ?? resolveVendorImg(vendor?.logoUrl);

  return (
    <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
        <ImagePlus className="h-5 w-5 text-tertiary-accent" /> Logo de tu tienda
      </div>
      <p className="mb-5 text-[12.5px] text-outline">
        Se muestra en el círculo de tu página pública. Sube un archivo o pega el link de una imagen ya alojada en
        otro lugar (ej. Imgur, Google Drive público).
      </p>

      {/* Logo */}
      <div>
        <span className="mb-2 block text-label-md font-semibold text-on-surface-variant">Logo (círculo)</span>
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-container">
            {currentLogoUrl ? (
              <img src={currentLogoUrl} alt="Logo de la tienda" className="h-full w-full object-cover" />
            ) : (
              <span className="font-display text-xl font-extrabold text-white">{vendor?.companyName?.[0]}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => logoFileRef.current?.click()}
              disabled={uploadLogoFile.isPending}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 text-[12.5px] font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
            >
              <ImagePlus className="h-3.5 w-3.5" /> {uploadLogoFile.isPending ? "Subiendo..." : "Subir archivo"}
            </button>
            <input ref={logoFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleLogoFileChange} />
            {vendor?.logoUrl && (
              <button
                type="button"
                onClick={() => saveLogoLink.mutate("")}
                disabled={saveLogoLink.isPending}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-error/30 px-3.5 text-[12.5px] font-semibold text-error hover:bg-error/10 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" /> Quitar
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" />
            <input
              value={logoLinkInput}
              onChange={(e) => setLogoLinkInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && logoLinkInput.trim()) { e.preventDefault(); saveLogoLink.mutate(logoLinkInput.trim()); } }}
              placeholder="O pega el link de una imagen (https://...)"
              className="h-10 w-full rounded-xl border border-outline-variant bg-surface-container-lowest pl-9 pr-3 text-[13px] outline-none focus:border-tertiary-accent"
            />
          </div>
          <Button
            variant="outline"
            className="rounded-xl px-4"
            disabled={saveLogoLink.isPending || !logoLinkInput.trim()}
            onClick={() => saveLogoLink.mutate(logoLinkInput.trim())}
          >
            {saveLogoLink.isPending ? "..." : "Guardar link"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function VendorProfile() {
  const { user } = useAuth();
  const [changingEmail, setChangingEmail] = useState(false);

  return (
    <div className="max-w-[640px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={UserCog} tone="teal" />
        <h1 className="text-display-sm font-extrabold text-on-surface">Mi perfil</h1>
      </div>
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
      <StoreBrandingCard />
      <ChangeRequestCard />
      <KycDocumentsCard />
      <DeleteAccountCard />

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
