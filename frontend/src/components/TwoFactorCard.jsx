import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck, Smartphone } from "lucide-react";
import toast from "../lib/toast.jsx";
import { api } from "../lib/api.js";
import { Button } from "./ui/Button.jsx";
import { OtpInput } from "./ui/OtpInput.jsx";
import { PasswordInput } from "./ui/PasswordInput.jsx";

// Bloque 273 (pedido explícito — "la forma de autenticación de doble factor para los inicios de
// sesión de las tiendas, los usuarios y el administrador: al activarla se muestra un QR que se
// escanea con una app autenticadora, que genera un número aleatorio para entrar; el
// predeterminado, si está configurada, es esa app; si no, el código llega al correo"): tarjeta
// para activar o desactivar la verificación en dos pasos con app autenticadora. Es la misma
// para cliente, vendedor y admin (todos usan la misma cuenta).
export default function TwoFactorCard() {
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState(null); // { secret, otpauthUrl } mientras se activa
  const [code, setCode] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["two-factor-app-status"],
    queryFn: async () => (await api.get("/auth/2fa/app/status")).data,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["two-factor-app-status"] });
  const errorMessage = (fallback) => (err) => toast.error(err.response?.data?.error ?? fallback);

  const start = useMutation({
    mutationFn: async () => (await api.post("/auth/2fa/app/setup")).data,
    onSuccess: (result) => {
      setSetup(result);
      setCode("");
      setShowSecret(false);
    },
    onError: errorMessage("No se pudo iniciar la activación."),
  });
  const enable = useMutation({
    mutationFn: async () => (await api.post("/auth/2fa/app/enable", { code })).data,
    onSuccess: () => {
      toast.success("Verificación en dos pasos activada.");
      setSetup(null);
      setCode("");
      refresh();
    },
    onError: errorMessage("No se pudo activar."),
  });
  const disable = useMutation({
    mutationFn: async () => (await api.post("/auth/2fa/app/disable", { password, code: disableCode })).data,
    onSuccess: () => {
      toast.success("Verificación en dos pasos desactivada.");
      setDisabling(false);
      setPassword("");
      setDisableCode("");
      setEmailSent(false);
      refresh();
    },
    onError: errorMessage("No se pudo desactivar."),
  });
  const sendEmail = useMutation({
    mutationFn: async () => (await api.post("/auth/2fa/send-code")).data,
    onSuccess: () => {
      setEmailSent(true);
      toast.success("Te enviamos un código a tu correo.");
    },
    onError: errorMessage("No se pudo enviar el código."),
  });

  const enabled = !!data?.enabled;

  return (
    <section className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2.5">
        <Smartphone className="h-[18px] w-[18px] text-tertiary-accent" aria-hidden="true" />
        <h2 className="text-[15px] font-bold text-on-surface">Verificación en dos pasos con aplicación</h2>
        {!isLoading && (
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${enabled ? "bg-[#0CAE53]/15 text-[#087A38]" : "bg-surface-container text-on-surface-variant"}`}>
            {enabled ? "Activada" : "No activada"}
          </span>
        )}
      </div>
      <p className="mb-4 text-[13px] leading-5 text-on-surface-variant">
        Al iniciar sesión te pediremos un código de 6 dígitos que genera una aplicación como Google Authenticator, Microsoft Authenticator o Authy. Si la activas, ese es el método predeterminado; si no la tienes
        activada, el código siempre se envía a tu correo. Si pierdes el teléfono, puedes pedir el código por correo.
      </p>

      {!enabled && !setup && (
        <Button type="button" onClick={() => start.mutate()} disabled={start.isPending || isLoading}>
          <ShieldCheck className="h-4 w-4" aria-hidden="true" /> {start.isPending ? "Preparando..." : "Activar con aplicación"}
        </Button>
      )}

      {!enabled && setup && (
        <div className="rounded-xl border border-surface-container-high bg-surface-container-low p-4">
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-[13px] text-on-surface-variant">
            <li>Abre tu aplicación de autenticación y elige agregar una cuenta.</li>
            <li>Escanea este código QR (o escribe la clave a mano).</li>
            <li>Escribe aquí el código de 6 dígitos que muestra la aplicación.</li>
          </ol>
          <div className="mb-4 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG value={setup.otpauthUrl} size={168} level="M" title="Código QR para tu aplicación de autenticación" />
            </div>
            <div className="min-w-0 text-[12.5px] text-on-surface-variant">
              <button type="button" onClick={() => setShowSecret((v) => !v)} className="min-h-11 font-semibold text-tertiary-accent">
                {showSecret ? "Ocultar la clave" : "No puedo escanear: ver la clave"}
              </button>
              {showSecret && <p className="mt-1 select-all break-all rounded-lg bg-surface-container px-3 py-2 font-mono text-[13px] tracking-wider text-on-surface">{setup.secret}</p>}
            </div>
          </div>
          <OtpInput label="Código de la aplicación" value={code} onChange={setCode} length={6} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" onClick={() => enable.mutate()} disabled={code.length !== 6 || enable.isPending}>
              {enable.isPending ? "Verificando..." : "Activar"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setSetup(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {enabled && !disabling && (
        <Button type="button" variant="outline" onClick={() => setDisabling(true)}>
          Desactivar
        </Button>
      )}

      {enabled && disabling && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            disable.mutate();
          }}
          className="space-y-4 rounded-xl border border-surface-container-high bg-surface-container-low p-4"
        >
          <PasswordInput label="Tu contraseña" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          <OtpInput label="Código de la aplicación (o el que te enviemos al correo)" value={disableCode} onChange={setDisableCode} length={6} />
          <button type="button" onClick={() => sendEmail.mutate()} disabled={sendEmail.isPending} className="min-h-11 text-[13px] font-semibold text-tertiary-accent disabled:opacity-50">
            {emailSent ? "Código enviado: revisa tu correo (reenviar)" : "No tengo mi teléfono: enviar el código a mi correo"}
          </button>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" disabled={!password || disableCode.length !== 6 || disable.isPending}>
              {disable.isPending ? "Desactivando..." : "Desactivar verificación"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDisabling(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
