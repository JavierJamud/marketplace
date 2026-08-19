import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import toast from "../lib/toast.jsx";
import { api } from "../lib/api.js";
import { useAuth, loginPathFor } from "../context/AuthContext.jsx";
import { Input } from "./ui/Input.jsx";
import { PasswordInput } from "./ui/PasswordInput.jsx";
import { Button } from "./ui/Button.jsx";

// Bloque 71 (pedido explícito): compartido entre AdminProfile.jsx,
// VendorProfile.jsx y CustomerPanel.jsx — cambiar de correo ya no es
// directo, son 2 pasos: (1) pide un código, mandado al correo VIEJO (el que
// ya está en la cuenta) — es la prueba de que quien pide el cambio de
// verdad tiene acceso a esa cuenta; (2) confirma ese código. Al confirmar,
// el backend ya revocó TODA sesión/dispositivo de confianza de esta cuenta
// (ver confirmMyEmailChange) — acá solo queda limpiar el lado del cliente y
// mandar a loguearse de nuevo, ya con el correo nuevo.
export function ChangeEmailModal({ currentEmail, onClose }) {
  const { clearLocalSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState("request");
  const [newEmail, setNewEmail] = useState(currentEmail);
  const [currentPassword, setCurrentPassword] = useState("");
  const [code, setCode] = useState("");

  const requestCode = useMutation({
    mutationFn: async () => (await api.post("/auth/me/email/request-code", { newEmail, currentPassword })).data,
    onSuccess: () => {
      toast.success(`Te mandamos un código a ${currentEmail}.`);
      setStep("confirm");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo iniciar el cambio de correo."),
  });

  const confirmCode = useMutation({
    mutationFn: async () => (await api.post("/auth/me/email/confirm", { code })).data,
    onSuccess: () => {
      toast.success("Correo actualizado — inicia sesión de nuevo con tu correo nuevo.");
      clearLocalSession();
      navigate(loginPathFor(location.pathname), { replace: true });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "Código inválido o vencido."),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface-container-lowest p-6">
        {step === "request" ? (
          <>
            <h2 className="mb-1 text-title-lg font-bold text-on-surface">Cambiar correo</h2>
            <p className="mb-4 text-[12.5px] text-outline">
              Te mandamos un código a tu correo actual ({currentEmail}) para confirmar que eres tú.
            </p>
            <div className="flex flex-col gap-3.5">
              <Input label="Correo nuevo" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              <PasswordInput label="Contraseña actual" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div className="mt-5 flex gap-2.5">
              <Button variant="outline" className="flex-1" onClick={onClose} disabled={requestCode.isPending}>Cancelar</Button>
              <Button
                className="flex-1"
                disabled={!newEmail || !currentPassword || requestCode.isPending}
                onClick={() => requestCode.mutate()}
              >
                {requestCode.isPending ? "Enviando..." : "Enviar código"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="mb-1 text-title-lg font-bold text-on-surface">Confirma el código</h2>
            <p className="mb-4 text-[12.5px] text-outline">
              Revisa {currentEmail} y escribe el código que te mandamos (vence en 15 minutos).
            </p>
            <Input
              label="Código"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD1234"
              className="text-center font-mono tracking-[0.3em]"
            />
            <div className="mt-5 flex gap-2.5">
              <Button variant="outline" className="flex-1" onClick={onClose} disabled={confirmCode.isPending}>Cancelar</Button>
              <Button className="flex-1" disabled={!code || confirmCode.isPending} onClick={() => confirmCode.mutate()}>
                {confirmCode.isPending ? "Confirmando..." : "Confirmar"}
              </Button>
            </div>
            <button
              onClick={() => requestCode.mutate()}
              disabled={requestCode.isPending}
              className="mt-3 w-full text-center text-[12px] font-semibold text-tertiary-accent hover:underline disabled:opacity-50"
            >
              {requestCode.isPending ? "Reenviando..." : "¿No te llegó? Reenviar código"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
