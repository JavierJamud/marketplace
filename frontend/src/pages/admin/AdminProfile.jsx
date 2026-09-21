import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Mail, KeyRound, UserCog } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { PasswordInput } from "../../components/ui/PasswordInput.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { ChangeEmailModal } from "../../components/ChangeEmailModal.jsx";
import AdminBranding from "./AdminBranding.jsx";

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
    <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
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
        className="mt-4"
        disabled={!currentPassword || newPassword.length < 8 || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? "Guardando..." : "Actualizar contraseña"}
      </Button>
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
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Mi perfil</h1>
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
          <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
            <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
              <Mail className="h-5 w-5 text-tertiary-accent" /> Correo de la cuenta
            </div>
            <p className="mb-4 text-[13.5px] text-on-surface-variant">{user?.email}</p>
            <Button variant="outline" onClick={() => setChangingEmail(true)}>Cambiar correo</Button>
          </div>

          <PasswordCard />

          {changingEmail && <ChangeEmailModal currentEmail={user?.email} onClose={() => setChangingEmail(false)} />}
        </div>
      )}

      {tab === "marca" && <AdminBranding />}
    </div>
  );
}
