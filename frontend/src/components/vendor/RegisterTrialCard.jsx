import { useMutation } from "@tanstack/react-query";
import { CreditCard, Lock } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";

// Último paso de la prueba gratis con tarjeta: registrar la tarjeta en la página de Stripe. Hoy se cobran 0 USD; al terminar
// la prueba Stripe cobra el primer mes solo (salvo que cancele antes). La prueba se activa cuando Stripe lo confirma.
export function RegisterTrialCard({ className = "" }) {
  const start = useMutation({
    mutationFn: async () => (await api.post("/verification/me/trial-card")).data,
    onSuccess: (d) => window.location.assign(d.url),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo abrir Stripe. Prueba de nuevo."),
  });
  return (
    <section className={`rounded-2xl border border-tertiary-accent/40 bg-tertiary-accent/[0.06] p-4 sm:p-5 ${className}`} aria-labelledby="trial-card-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-tertiary-accent/15 text-tertiary-accent">
            <CreditCard className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="trial-card-title" className="font-display text-[16px] font-extrabold text-on-surface">
              Último paso: registra tu tarjeta
            </h2>
            <p className="mt-0.5 text-[12.5px] text-on-surface-variant">Hoy no se cobra nada. Tu prueba gratis de 30 días empieza al registrarla y el día 31 se cobra el primer mes. Puedes cancelar antes desde Suscripción.</p>
          </div>
        </div>
        <button type="button" onClick={() => start.mutate()} disabled={start.isPending} className="flex min-h-11 flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[13.5px] font-bold text-white disabled:opacity-60">
          <Lock className="h-4 w-4" aria-hidden="true" /> {start.isPending ? "Abriendo Stripe..." : "Registrar tarjeta"}
        </button>
      </div>
    </section>
  );
}
