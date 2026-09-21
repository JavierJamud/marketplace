import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import toast from "../lib/toast.jsx";
import { api } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { Button } from "./ui/Button.jsx";
import { PasswordInput } from "./ui/PasswordInput.jsx";
import { ConfirmModal } from "./ConfirmModal.jsx";

// Bloque 211 (pedido explícito — auto-eliminación de cuenta con 30 días de
// gracia, para clientes/vendedores/personal: "se le pedirá verificación...
// esa verificación se pedirá dos veces con dos mensajes diferentes"): tarjeta
// compartida por CustomerPanel.jsx/VendorProfile.jsx/StaffProfile.jsx — 2
// pasos de confirmación con textos distintos, el segundo pide la contraseña
// real (la "verificación" de que de verdad es el dueño de la cuenta). No
// cierra sesión al terminar: el propio panel se tapa solo con
// AccountPendingDeletionNotice apenas `user.deletionRequestedAt` llegue por
// /auth/me (ver refetch() más abajo).
export function DeleteAccountCard() {
  const { refetch } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0); // 0 = cerrado, 1 = primer aviso, 2 = confirmación final
  const [password, setPassword] = useState("");

  const requestDeletion = useMutation({
    mutationFn: async () => (await api.post("/auth/delete-account", { password })).data,
    onSuccess: async () => {
      setStep(0);
      setPassword("");
      toast.success("Listo — tu cuenta queda suspendida 30 días. Te mandamos un correo con los detalles.");
      // Mismo motivo que en AccountPendingDeletionNotice.jsx: refetch() de
      // useAuth() solo trae de nuevo /auth/me — VendorLayout.jsx también
      // depende de la query "my-vendor" por separado.
      await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ["my-vendor"] })]);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo procesar tu pedido."),
  });

  return (
    <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
        <ShieldAlert className="h-5 w-5 text-error" /> Zona de peligro
      </div>
      <p className="mb-4 text-[12.5px] text-outline">
        Eliminar tu cuenta la suspende de inmediato por 30 días — puedes reactivarla vos mismo en cualquier momento
        durante ese plazo. Pasados los 30 días sin reactivarla, se elimina para siempre y no hay forma de recuperarla.
      </p>
      <Button variant="outline" className="rounded-xl border-error text-error hover:bg-error/5" onClick={() => setStep(1)}>
        Eliminar mi cuenta
      </Button>

      <ConfirmModal
        open={step === 1}
        title="¿Eliminar tu cuenta?"
        message="Tu cuenta y (si tienes tienda) tu tienda quedan suspendidas ya mismo por 30 días — dejan de ser visibles y de poder usarse. Podrás reactivarla vos mismo en cualquier momento durante ese plazo con solo volver a entrar."
        confirmLabel="Continuar"
        danger
        onConfirm={() => setStep(2)}
        onCancel={() => setStep(0)}
      />

      <ConfirmModal
        open={step === 2}
        title="Última confirmación"
        message="Pasados los 30 días sin reactivarla, tu cuenta se elimina de forma permanente: se borran tus datos personales y no hay ninguna forma de recuperarlos. Escribe tu contraseña para confirmar que sos vos quien pide esto."
        confirmLabel={requestDeletion.isPending ? "Eliminando..." : "Sí, eliminar mi cuenta"}
        danger
        confirmDisabled={!password || requestDeletion.isPending}
        onConfirm={() => requestDeletion.mutate()}
        onCancel={() => {
          setStep(0);
          setPassword("");
        }}
      >
        <PasswordInput
          label="Tu contraseña"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
      </ConfirmModal>
    </div>
  );
}
