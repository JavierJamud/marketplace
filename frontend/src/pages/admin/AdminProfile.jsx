import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Mail, KeyRound } from "lucide-react";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { PasswordInput } from "../../components/ui/PasswordInput.jsx";
import { Button } from "../../components/ui/Button.jsx";

function EmailModal({ currentEmail, onClose }) {
  const { refetch } = useAuth();
  const [newEmail, setNewEmail] = useState(currentEmail);
  const [currentPassword, setCurrentPassword] = useState("");

  const save = useMutation({
    mutationFn: async () => (await api.patch("/auth/me/email", { newEmail, currentPassword })).data,
    onSuccess: async () => {
      toast.success("Correo actualizado.");
      await refetch();
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo cambiar el correo."),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface-container-lowest p-6">
        <h2 className="mb-4 text-title-lg font-bold text-on-surface">Cambiar correo</h2>
        <div className="flex flex-col gap-3.5">
          <Input label="Correo nuevo" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          <PasswordInput label="Contraseña actual" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </div>
        <div className="mt-5 flex gap-2.5">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={save.isPending}>Cancelar</Button>
          <Button className="flex-1" disabled={!newEmail || !currentPassword || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

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
      <p className="mb-4 text-[12.5px] text-outline">Necesitás tu contraseña actual para cambiarla.</p>
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

  return (
    <div className="max-w-[640px]">
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Mi perfil</h1>
      <p className="mb-[22px] text-[13.5px] text-outline">Correo y contraseña de tu cuenta de administrador.</p>

      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
          <Mail className="h-5 w-5 text-tertiary-accent" /> Correo de la cuenta
        </div>
        <p className="mb-4 text-[13.5px] text-on-surface-variant">{user?.email}</p>
        <Button variant="outline" onClick={() => setChangingEmail(true)}>Cambiar correo</Button>
      </div>

      <PasswordCard />

      {changingEmail && <EmailModal currentEmail={user?.email} onClose={() => setChangingEmail(false)} />}
    </div>
  );
}
