import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Mail, KeyRound, UserCog, IdCard, Smartphone } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { PasswordInput } from "../../components/ui/PasswordInput.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { ChangeEmailModal } from "../../components/ChangeEmailModal.jsx";
import AdminBranding from "./AdminBranding.jsx";
import { NotificationSettings } from "../../components/pwa/NotificationSettings.jsx";
import { APPS } from "../../lib/pwa.js";
import { PhoneInput } from "../../components/ui/PhoneInput.jsx";
import { WhatsappVerifyCard, whatsappStatusKey } from "../../components/WhatsappVerifyCard.jsx";

// Bloque 76 (pedido explícito): "Marca de la plataforma" pasa de ser una
// entrada propia del menú a vivir acá, como subsección — un admin solo
// tiene UN lugar para toda su configuración (su cuenta + la marca del
// sitio) en vez de 2 secciones separadas en el menú. AdminBranding.jsx
// queda intacto tal cual (mismo componente, sin tocar su lógica interna) —
// solo cambia desde dónde se llega a él.
const TABS = [
  { id: "cuenta", label: "Mi cuenta" },
  { id: "marca", label: "Marca de la plataforma" },
];

// Nombre y apellidos privados del admin: solo se ven acá. No pide código
// por correo (no es una acción sensible).
function PersonalDataCard() {
  const { user, refetch } = useAuth();
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");

  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
  }, [user?.firstName, user?.lastName]);

  const unchanged = firstName.trim() === (user?.firstName ?? "") && lastName.trim() === (user?.lastName ?? "");

  const save = useMutation({
    mutationFn: async () => (await api.patch("/auth/me/personal", { firstName: firstName.trim(), lastName: lastName.trim() })).data,
    onSuccess: async () => {
      await refetch();
      toast.success("Datos personales guardados.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudieron guardar tus datos."),
  });

  return (
    <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
        <IdCard className="h-5 w-5 text-tertiary-accent" /> Datos personales (privados)
      </div>
      <p className="mb-4 text-[12.5px] text-outline">Solo tú los ves. No se muestran a nadie ni se envían a ningún lado.</p>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Input data-guard="name" label="Nombre" value={firstName} maxLength={60} autoComplete="given-name" onChange={(e) => setFirstName(e.target.value)} />
        <Input data-guard="name" label="Apellidos" value={lastName} maxLength={60} autoComplete="family-name" onChange={(e) => setLastName(e.target.value)} />
      </div>
      <Button className="mt-4" disabled={unchanged || save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Guardando..." : "Guardar"}
      </Button>
    </div>
  );
}

function PasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const save = useMutation({
    mutationFn: async () => (await api.patch("/auth/me/password", { currentPassword, newPassword, confirmPassword })).data,
    onSuccess: (data) => {
      // El servidor cierra las sesiones de los otros dispositivos al cambiar la contraseña: se avisa cuántas había.
      toast.success(data?.closedSessions > 0 ? "Contraseña actualizada. Cerramos tu sesión en los demás dispositivos." : "Contraseña actualizada.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo cambiar la contraseña."),
  });

  return (
    <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
        <KeyRound className="h-5 w-5 text-tertiary-accent" /> Cambiar contraseña
      </div>
      <p className="mb-4 text-[12.5px] text-outline">Necesitas tu contraseña actual para cambiarla.</p>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <PasswordInput label="Contraseña actual" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        <PasswordInput label="Contraseña nueva" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <PasswordInput label="Confirmar nueva" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
      </div>
      <Button
        className="mt-4"
        disabled={!currentPassword || newPassword.length < 8 || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? "Guardando..." : "Actualizar contraseña"}
      </Button>
    </div>
  );
}

// Teléfono del admin: a ese número le llegan por WhatsApp los mismos avisos que a su campanita y a su correo (tiendas nuevas,
// verificaciones, reportes, errores, revisión de la IA, resumen semanal). Es distinto del número de la plataforma, que es
// el que envía. Si lo cambia, tiene que confirmarlo otra vez con un código.
function AdminPhoneCard() {
  const { user, refetch } = useAuth();
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState(user?.phone ?? "");

  useEffect(() => {
    setPhone(user?.phone ?? "");
  }, [user?.phone]);

  const dirty = (phone || "") !== (user?.phone || "");

  const save = useMutation({
    mutationFn: async () => (await api.patch("/auth/me/admin-phone", { phone: phone || "" })).data,
    onSuccess: async () => {
      await refetch();
      await queryClient.invalidateQueries({ queryKey: whatsappStatusKey("user") });
      toast.success(phone ? "Teléfono guardado. Confírmalo abajo para recibir los avisos." : "Teléfono quitado.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el teléfono."),
  });

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
          <Smartphone className="h-5 w-5 text-tertiary-accent" /> Tu teléfono
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Pon tu número personal, no el de la plataforma: desde el de la plataforma salen los mensajes y a este llegan tus avisos.
        </p>
        <PhoneInput label="Teléfono con WhatsApp" value={phone} onChange={setPhone} anyCountry />
        <Button className="mt-4" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : "Guardar teléfono"}
        </Button>
      </div>
      <WhatsappVerifyCard
        target="user"
        phoneDirty={dirty}
        title="Tus avisos por WhatsApp"
        about="Tiendas nuevas, verificaciones y pagos por revisar, reportes, mensajes de tiendas, errores, revisión de la IA y el resumen de cada sábado. Lo mismo que te llega al correo, en corto."
      />
    </div>
  );
}

export default function AdminProfile() {
  const { user } = useAuth();
  const [changingEmail, setChangingEmail] = useState(false);
  const [tab, setTab] = useState("cuenta");

  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={UserCog} tone="teal" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Mi perfil</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">Tu cuenta de administrador y la marca de la plataforma.</p>

      <div className="mb-[22px] flex flex-wrap gap-1.5 border-b border-surface-container-high">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-[13.5px] font-bold transition-colors ${
              tab === t.id ? "border-b-2 border-secondary text-on-surface" : "text-outline hover:text-on-surface"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "cuenta" && (
        <div className="max-w-[640px]">
          <div className="mb-5">
            <PersonalDataCard />
          </div>

          <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
            <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
              <Mail className="h-5 w-5 text-tertiary-accent" /> Correo de la cuenta
            </div>
            <p className="mb-4 text-[13.5px] text-on-surface-variant">{user?.email}</p>
            <Button variant="outline" onClick={() => setChangingEmail(true)}>Cambiar correo</Button>
          </div>

          <div className="mb-5">
            <PasswordCard />
          </div>

          <div className="mb-5">
            <AdminPhoneCard />
          </div>

          <div className="mb-5">
            <NotificationSettings app={APPS.admin} />
          </div>

          {changingEmail && <ChangeEmailModal currentEmail={user?.email} onClose={() => setChangingEmail(false)} />}
        </div>
      )}

      {tab === "marca" && <AdminBranding />}
    </div>
  );
}
