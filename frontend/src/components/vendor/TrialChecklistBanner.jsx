import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { api } from "../../lib/api.js";

// Bloque 235 (pedido explícito — trial gratuito de 30 días del Plan
// Premium): mismo círculo+check que ya usa VendorVerification.jsx (Step),
// copiado acá en vez de extraído a un componente compartido — son ~10
// líneas y este código ya prefiere duplicar bits chicos de presentación
// antes que abstraer de más (mismo criterio que el resto del proyecto).
function ChecklistItem({ label, done }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full ${
          done ? "bg-verified text-white" : "bg-surface-container-high text-outline"
        }`}
      >
        {done && <Check className="h-3 w-3" strokeWidth={3} />}
      </div>
      <span className={`text-[12.5px] ${done ? "text-on-surface line-through decoration-outline/40" : "font-semibold text-on-surface"}`}>
        {label}
      </span>
    </div>
  );
}

// Banner persistente (no modal) — visible en cualquier sección del panel
// mientras el vendedor aceptó el trial pero todavía no completó el
// checklist. Montado en VendorLayout.jsx cerca de AudioUnlockBanner.jsx.
export function TrialChecklistBanner({ vendor }) {
  const [expanded, setExpanded] = useState(false);
  // Bloque 235: mismo staleTime corto que TrialOfferPopup.jsx — ver el
  // comentario ahí.
  const { data } = useQuery({
    queryKey: ["vendor-trial"],
    queryFn: async () => (await api.get("/vendors/me/trial")).data.trial,
    enabled: !!vendor?.id,
    staleTime: 20_000,
  });

  // Visible solo entre "aceptó la oferta" y "el trial ya se activó" — una
  // vez que trialEndsAt se pone (activación automática), este banner
  // desaparece solo (TrialWelcomePopup toma la posta).
  if (!vendor?.id || !data?.trialStartedAt || data.trialEndsAt) return null;

  const done = data.checklist.filter((item) => item.done).length;
  const total = data.checklist.length;
  const pending = data.checklist.filter((item) => !item.done);

  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-secondary/30 bg-secondary-container/15">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-4 w-4 flex-shrink-0 text-secondary" />
          <span className="text-[13px] font-bold text-on-surface">
            Completá tu perfil para activar tu trial Premium gratis — {done}/{total}
          </span>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-on-surface-variant" /> : <ChevronDown className="h-4 w-4 text-on-surface-variant" />}
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 border-t border-secondary/20 px-4 py-3.5">
          <p className="mb-1 text-[12px] text-on-surface-variant">
            Apenas completes todo esto, tu tienda pasa a verificada y Plan Premium automáticamente — sin esperar revisión de nadie.
          </p>
          {pending.map((item) => (
            <ChecklistItem key={item.key} label={item.label} done={item.done} />
          ))}
        </div>
      )}
    </div>
  );
}
