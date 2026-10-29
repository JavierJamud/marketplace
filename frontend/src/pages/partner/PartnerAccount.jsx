import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, UserCog } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { PasswordInput } from "../../components/ui/PasswordInput.jsx";
import TwoFactorCard from "../../components/TwoFactorCard.jsx";

// Bloque 299: cuenta del socio: sus datos de contacto (los cambia Baznova), contraseña y verificación en dos pasos.
export default function PartnerAccount() {
  const { user } = useAuth();
  const { data: me } = useQuery({ queryKey: ["partner-portal-me", user?.id], queryFn: async () => (await api.get("/partner-portal/me")).data });
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
    <div className="max-w-[820px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={UserCog} tone="teal" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Mi cuenta</h1>
      </div>
      <p className="mb-5 text-[13.5px] text-outline">Tus datos de acceso al panel del socio.</p>

      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <h2 className="mb-3 text-title-lg font-bold text-on-surface">Datos del socio</h2>
        <dl className="grid grid-cols-1 gap-3 text-[13.5px] sm:grid-cols-2">
          <div>
            <dt className="text-[11.5px] text-on-surface-variant">Nombre</dt>
            <dd className="font-semibold text-on-surface">{me?.partner?.name}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-on-surface-variant">Código de socio</dt>
            <dd className="font-mono font-semibold text-on-surface">{me?.partner?.code}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-on-surface-variant">Correo de acceso</dt>
            <dd className="font-semibold text-on-surface">{user?.email}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-on-surface-variant">Sitio web</dt>
            <dd className="font-semibold text-on-surface">{me?.partner?.website || "No indicado"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[12px] text-outline">Para cambiar estos datos, escríbele a Baznova.</p>
      </div>

      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
          <KeyRound className="h-5 w-5 text-tertiary-accent" aria-hidden="true" /> Cambiar contraseña
        </div>
        <p className="mb-4 text-[12.5px] text-outline">Necesitas tu contraseña actual para cambiarla.</p>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <PasswordInput label="Contraseña actual" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
          <PasswordInput label="Contraseña nueva" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          <PasswordInput label="Confirmar nueva" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <Button className="mt-4" disabled={!currentPassword || newPassword.length < 8 || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : "Actualizar contraseña"}
        </Button>
      </div>

      <TwoFactorCard />
    </div>
  );
}
