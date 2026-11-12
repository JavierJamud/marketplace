import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { api, getErrorMessage } from "../lib/api.js";
import toast from "../lib/toast.jsx";
import { Button } from "./ui/Button.jsx";
import { OtpInput } from "./ui/OtpInput.jsx";
import ToggleSwitch from "./admin/ToggleSwitch.jsx";

// Confirmar que un número tiene WhatsApp antes de mandarle avisos. Sirve para la cuenta (target "user", su teléfono) y
// para la tienda (target "vendor", el WhatsApp de la tienda). El número que se confirma es el guardado en el servidor:
// si la persona lo está cambiando en el formulario, primero tiene que guardarlo.
//
// variant "card": tarjeta del perfil con interruptor. variant "step": paso del registro, ya dijo que sí, solo falta el código.

const COPY = {
  user: {
    title: "Avisos por WhatsApp",
    about: "Te escribimos cuando tu pedido cambia de estado: confirmado, en camino, entregado o cancelado.",
  },
  vendor: {
    title: "Avisos de la tienda por WhatsApp",
    about: "Pedidos nuevos, stock bajo, reseñas y mensajes de clientes llegan también al WhatsApp de la tienda, aunque tengas el panel abierto.",
  },
};

export const whatsappStatusKey = (target) => ["whatsapp-status", target];

function useCountdown() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (until <= now) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until, now]);
  return [Math.max(0, Math.ceil((until - now) / 1000)), (sec) => { setNow(Date.now()); setUntil(Date.now() + sec * 1000); }];
}

// `title` y `about` cambian el texto de arriba (el admin usa target "user" con su propio texto).
export function WhatsappVerifyCard({ target, variant = "card", phoneDirty = false, onVerified, onSkip, title, about }) {
  const queryClient = useQueryClient();
  const copy = { ...COPY[target], ...(title ? { title } : {}), ...(about ? { about } : {}) };
  const [step, setStep] = useState(null); // null | { phone, delayed }
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [wait, startWait] = useCountdown();

  const { data: status, isLoading, isError, refetch } = useQuery({
    queryKey: whatsappStatusKey(target),
    queryFn: () => api.get("/whatsapp/status", { params: { target } }).then((r) => r.data),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: whatsappStatusKey(target) });

  const send = useMutation({
    mutationFn: () => api.post("/whatsapp/verify/start", { target }).then((r) => r.data),
    onMutate: () => setError(""),
    onSuccess: (data) => {
      setStep({ phone: data.phone, delayed: Boolean(data.delayed) });
      setCode("");
      startWait(data.resendInSec ?? 60);
    },
    onError: async (err) => {
      const retry = err?.response?.data?.details?.retryInSec;
      if (retry) {
        startWait(retry);
        // Ya hay un código en camino: se deja escribirlo.
        if (!step && status?.phone) setStep({ phone: status.phone, delayed: false });
      }
      setError(await getErrorMessage(err, "No pudimos enviar el código. Prueba de nuevo."));
    },
  });

  const confirm = useMutation({
    mutationFn: (value) => api.post("/whatsapp/verify/confirm", { target, code: value }).then((r) => r.data),
    onMutate: () => setError(""),
    onSuccess: () => {
      setStep(null);
      setCode("");
      refresh();
      toast.success("WhatsApp confirmado", "Desde ahora los avisos llegan también a ese número.");
      onVerified?.();
    },
    onError: async (err) => {
      setCode("");
      const reason = err?.response?.data?.details?.reason;
      // Código vencido o número cambiado: hay que pedir otro, el de ahora ya no sirve.
      if (reason === "EXPIRED" || reason === "PHONE_CHANGED" || reason === "TOO_MANY") startWait(0);
      setError(await getErrorMessage(err, "No pudimos confirmar el código."));
    },
  });

  const disable = useMutation({
    mutationFn: () => api.post("/whatsapp/disable", { target }).then((r) => r.data),
    onSuccess: () => {
      refresh();
      toast.success("Avisos por WhatsApp desactivados");
    },
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo desactivar.")),
  });

  const active = Boolean(status?.verified && !status?.optedOut);
  const heading = (
    <div className="mb-1 flex flex-wrap items-center gap-2 text-[17px] font-bold leading-snug text-on-surface">
      <MessageCircle className="h-5 w-5 text-tertiary-accent" aria-hidden="true" />
      {copy.title}
      {variant === "card" && status && (
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${active ? "bg-verified/15 text-verified-dark" : "bg-surface-container text-on-surface-variant"}`}>
          {active ? "Activos" : "Apagados"}
        </span>
      )}
    </div>
  );

  let body;
  if (isLoading) {
    body = <p className="text-[13px] text-on-surface-variant">Cargando...</p>;
  } else if (isError) {
    body = (
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-on-surface-variant">
        No se pudo cargar el estado.
        <Button size="sm" variant="outline" onClick={() => refetch()}>Reintentar</Button>
      </div>
    );
  } else if (step) {
    body = (
      <form
        className="space-y-3 rounded-xl border border-surface-container-high bg-surface-container-low p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6) confirm.mutate(code);
        }}
      >
        <p className="text-[13.5px] text-on-surface">
          Te enviamos un código de 6 números por WhatsApp al <span className="whitespace-nowrap font-semibold">{step.phone}</span>.
        </p>
        {step.delayed && (
          <p className="rounded-lg bg-surface-container px-3 py-2 text-[12.5px] text-on-surface-variant">
            Está tardando un poco en salir. Te llegará en cuanto se pueda y sirve igual.
          </p>
        )}
        <OtpInput label="Código de WhatsApp" value={code} onChange={setCode} autoFocus disabled={confirm.isPending} error={error || undefined} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={code.length !== 6 || confirm.isPending}>
            {confirm.isPending ? "Confirmando..." : "Confirmar"}
          </Button>
          <Button type="button" variant="outline" disabled={wait > 0 || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? "Enviando..." : wait > 0 ? `Enviar otro en ${wait} s` : "Enviar otro código"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setStep(null);
              setError("");
              if (variant === "step") onSkip?.();
            }}
          >
            {variant === "step" ? "Ahora no" : "Cancelar"}
          </Button>
        </div>
      </form>
    );
  } else if (phoneDirty && status.hasPhone) {
    body = (
      <p className="text-[13px] text-on-surface-variant">
        Guarda los cambios del número y después confírmalo aquí.
        {active && <> Hasta entonces los avisos siguen llegando al <span className="whitespace-nowrap font-semibold">{status.phone}</span>.</>}
      </p>
    );
  } else if (active) {
    body = (
      <p className="flex items-start gap-2 text-[13.5px] text-on-surface">
        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-verified-dark" aria-hidden="true" />
        <span>
          Confirmado en el <span className="whitespace-nowrap font-semibold">{status.phone}</span>. Para dejar de recibirlos apaga el interruptor o responde BAJA a cualquier aviso.
        </span>
      </p>
    );
  } else if (!status.available) {
    body = <p className="text-[13px] text-on-surface-variant">Ahora mismo no podemos enviar códigos por WhatsApp. Prueba más tarde.</p>;
  } else if (!status.hasPhone) {
    body = <p className="text-[13px] text-on-surface-variant">Guarda primero un número de teléfono para poder activarlos.</p>;
  } else {
    body = (
      <div className="space-y-3">
        <p className="text-[13.5px] text-on-surface">
          {status.optedOut
            ? <>Respondiste BAJA desde el <span className="whitespace-nowrap font-semibold">{status.phone}</span>. Para volver a recibirlos, confírmalo otra vez con un código.</>
            : variant === "card"
              ? <>¿El <span className="whitespace-nowrap font-semibold">{status.phone}</span> tiene WhatsApp? Activa el interruptor y te enviamos un código para confirmarlo.</>
              : <>Pulsa Verificar WhatsApp y te enviamos un código al <span className="whitespace-nowrap font-semibold">{status.phone}</span>.</>}
        </p>
        {error && <p role="alert" className="text-[13px] font-semibold text-error">{error}</p>}
        {variant === "step" && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => send.mutate()} disabled={send.isPending}>{send.isPending ? "Enviando..." : "Verificar WhatsApp"}</Button>
            <Button variant="ghost" onClick={() => onSkip?.()}>Ahora no</Button>
          </div>
        )}
        {variant === "card" && send.isPending && <p className="text-[13px] text-on-surface-variant">Enviando el código...</p>}
      </div>
    );
  }

  // En el paso del registro, si los códigos no están disponibles no hay nada que hacer aquí: se sigue.
  const canToggle = status && !step && !phoneDirty && status.hasPhone && (active || status.available);

  return (
    <section className={variant === "card" ? "rounded-2xl border border-surface-container-high bg-surface-container-lowest p-[22px]" : ""} aria-label={copy.title}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {heading}
          <p className="mb-3 text-[12.5px] leading-5 text-on-surface-variant">{copy.about}</p>
        </div>
        {variant === "card" && canToggle && (
          <ToggleSwitch
            isActive={active}
            disabled={send.isPending || disable.isPending}
            label={active ? "Apagar avisos por WhatsApp" : "Activar avisos por WhatsApp"}
            onToggle={() => (active ? disable.mutate() : send.mutate())}
          />
        )}
      </div>
      {body}
      {variant === "step" && status && !step && (active || !status.available || !status.hasPhone) && (
        <div className="mt-3"><Button onClick={() => onSkip?.()}>Seguir</Button></div>
      )}
    </section>
  );
}
