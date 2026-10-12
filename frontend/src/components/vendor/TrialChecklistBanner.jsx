import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Check, ChevronDown, ChevronUp, ArrowRight, Sparkles } from "lucide-react";
import { api } from "../../lib/api.js";

// Pasos para completar el perfil y activar el Premium gratis. Se muestra UN paso a la vez: el siguiente pendiente, con un
// botón que lleva directo a la pantalla donde se completa. Al terminarlo, pasa solo al siguiente. Los demás se pueden ver
// desplegando la lista.
// `to` es la pantalla del panel donde se hace cada paso; `action` es lo que dice el botón.
const STEPS = {
  companyName: { to: "/vendedor/perfil", action: "Poner el nombre" },
  ownerName: { to: "/vendedor/perfil", action: "Indicar el responsable" },
  whatsapp: { to: "/vendedor/perfil", action: "Agregar el WhatsApp" },
  email: { to: "/vendedor/perfil", action: "Agregar el correo" },
  businessCategoryId: { to: "/vendedor/perfil", action: "Elegir el tipo de negocio" },
  description: { to: "/vendedor/perfil", action: "Escribir la descripción" },
  locations: { to: "/vendedor/configuracion", action: "Elegir dónde operas" },
  companyAddress: { to: "/vendedor/verificacion", action: "Poner la dirección legal" },
  registrationCountryId: { to: "/vendedor/verificacion", action: "Elegir el país de registro" },
  legalProvinceId: { to: "/vendedor/verificacion", action: "Elegir la provincia de registro" },
  idDocument: { to: "/vendedor/verificacion", action: "Subir el documento" },
  selfie: { to: "/vendedor/verificacion", action: "Tomarme la selfie" },
  logoUrl: { to: "/vendedor/perfil", action: "Subir el logo" },
  hasPublishedProduct: { to: "/vendedor/productos?nuevo=1", action: "Publicar un producto" },
};

// Banner persistente (no modal): visible en cualquier sección del panel mientras el vendedor aceptó el trial pero todavía no
// completó los pasos. Montado en VendorLayout.jsx.
export function TrialChecklistBanner({ vendor }) {
  const [expanded, setExpanded] = useState(false);
  const { data } = useQuery({
    queryKey: ["vendor-trial"],
    queryFn: async () => (await api.get("/vendors/me/trial")).data.trial,
    enabled: !!vendor?.id,
    staleTime: 20_000,
  });

  // Visible solo entre "aceptó la oferta" y "el trial ya se activó".
  if (!vendor?.id || !data?.trialStartedAt || data.trialEndsAt) return null;

  const items = data.checklist;
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const next = items.find((i) => !i.done);
  if (!next) return null;
  const step = STEPS[next.key];
  const percent = Math.round((done / total) * 100);

  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-14px_rgba(15,23,42,0.18)]" aria-label="Pasos para activar tu Premium gratis">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-secondary-container/25 text-secondary">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[11.5px] font-bold uppercase tracking-wide text-secondary">
              Paso {done + 1} de {total} para tu Premium gratis
            </p>
            <h2 className="mt-0.5 font-display text-[17px] font-extrabold leading-tight text-on-surface">{next.label}</h2>
            <p className="mt-1 text-[12.5px] text-on-surface-variant">Cuando completes todos, tu tienda pasa a verificada y Premium sin esperar revisión de nadie.</p>
          </div>
        </div>
        {step && (
          <Link
            to={step.to}
            className="flex min-h-11 flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-secondary-container px-5 text-[13.5px] font-bold text-on-secondary-container hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {step.action} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </div>

      <div className="px-4 pb-4 sm:px-5">
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container-high" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso">
            <div className="h-full rounded-full bg-gradient-to-r from-secondary-container to-secondary transition-all duration-500" style={{ width: `${percent}%` }} />
          </div>
          <span className="text-[12px] font-bold text-on-surface-variant">
            {done}/{total}
          </span>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-tertiary-accent"
          >
            {expanded ? "Ocultar pasos" : "Ver todos"} {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        {expanded && (
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.key} className="flex items-center gap-2">
                <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${item.done ? "bg-verified text-white" : item.key === next.key ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-high text-outline"}`}>
                  {item.done && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className={`text-[12.5px] ${item.done ? "text-outline line-through decoration-outline/40" : item.key === next.key ? "font-bold text-on-surface" : "text-on-surface-variant"}`}>{item.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
