import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api, setActionCodeHandler } from "../../lib/api.js";
import { OtpInput } from "../ui/OtpInput.jsx";
import { Button } from "../ui/Button.jsx";

// Bloque 272 (pedido explícito — "para eliminar una tienda de forma definitiva y para otras
// modificaciones del sistema siempre se le pide al administrador un código enviado a su
// correo"): cuando el servidor responde 403 ACTION_CODE_REQUIRED a cualquier acción del
// admin, el cliente de la API (lib/api.js) llama a este modal, que envía el código al
// correo, lo pide en casillas, y la acción original se repite con el código. Así ninguna
// pantalla tiene que manejar el código por su cuenta: basta con proteger la ruta en el
// servidor. Se monta una sola vez en AdminLayout.
const RESEND_SECONDS = 30;

export function ActionCodeProvider() {
  const [request, setRequest] = useState(null); // { action, label, wrong }
  const [code, setCode] = useState("");
  const [info, setInfo] = useState({ sentTo: "", error: "" });
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const resolver = useRef(null);

  const sendCode = useCallback(async (action) => {
    setSending(true);
    setInfo((i) => ({ ...i, error: "" }));
    try {
      const { data } = await api.post("/admin/security/action-code", { action });
      setInfo({ sentTo: data.sentTo, error: "" });
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setInfo((i) => ({ ...i, error: err.response?.data?.error ?? "No se pudo enviar el código. Intenta de nuevo." }));
    } finally {
      setSending(false);
    }
  }, []);

  useEffect(() => {
    // La API llama a este manejador y espera el código (o null si se cancela).
    setActionCodeHandler(
      ({ action, label, wrong }) =>
        new Promise((resolve) => {
          resolver.current = resolve;
          setCode("");
          setRequest({ action, label, wrong });
          // Un código equivocado ya tiene uno vigente en el correo: no se manda otro.
          if (!wrong) sendCode(action);
        })
    );
    return () => setActionCodeHandler(null);
  }, [sendCode]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  function finish(value) {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
    setCode("");
  }

  if (!request) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-inverse-surface/50 p-4" role="dialog" aria-modal="true" aria-labelledby="action-code-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6) finish(code);
        }}
        className="w-full max-w-[420px] rounded-3xl bg-surface-container-lowest p-6 shadow-2xl"
      >
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-secondary-container">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 id="action-code-title" className="font-display text-[18px] font-extrabold text-on-surface">
            Confirma con tu código
          </h2>
        </div>
        <p className="mb-4 text-[13.5px] text-on-surface-variant">
          Para {request.label} te enviamos un código de 6 dígitos{info.sentTo ? ` a ${info.sentTo}` : " a tu correo"}. Vence en 10 minutos y sirve una sola vez.
        </p>
        <OtpInput label="Código de confirmación" value={code} onChange={setCode} length={6} autoFocus autoSubmit error={request.wrong ? "El código es incorrecto o venció." : info.error || undefined} />
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={() => sendCode(request.action)}
            disabled={sending || cooldown > 0}
            className="min-h-11 rounded-xl px-3 text-[13px] font-semibold text-tertiary-accent disabled:opacity-50"
          >
            {sending ? "Enviando..." : cooldown > 0 ? `Reenviar en ${cooldown} s` : "Reenviar el código"}
          </button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={code.length !== 6}>
              Confirmar
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
