import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Check, X } from "lucide-react";
import { Skeleton } from "./ui/Skeleton.jsx";
import { usePublicPlans, suggestedUpgradePlan } from "./plans/PlansCatalog.jsx";
import { planComparisonRows } from "../lib/verificationMeta.js";

// Bloque 52 (pedido explícito — "debe haber una concordancia con todo"): antes esta tabla era un array ROWS hardcodeado, sin
// relación con lo que el backend aplicaba. Después se armó con las columnas de PlanConfig, pero con una lista fija de filas y
// dos planes fijos ("REGULAR" contra el que llegaba). Ahora sale entera de GET /settings/plans (misma consulta y caché que la
// página pública de planes): las filas son el catálogo de funciones de cada plan, con las funciones personalizadas que crea
// el admin (planComparisonRows, lib/verificationMeta.js), y los planes se eligen por bandera. Un plan o una función nueva
// aparece sola.

function Cell({ value }) {
  if (value === true)
    return (
      <>
        <Check className="mx-auto h-4 w-4 text-verified" strokeWidth={2.5} aria-hidden="true" />
        <span className="sr-only">Incluido</span>
      </>
    );
  if (value === false)
    return (
      <>
        <X className="mx-auto h-4 w-4 text-outline" strokeWidth={2.5} aria-hidden="true" />
        <span className="sr-only">No incluido</span>
      </>
    );
  return <span className="text-[12.5px] font-semibold text-on-surface">{value}</span>;
}

const planName = (p) => p?.name ?? p?.displayName ?? null;

// Se muestra una sola vez, justo después de crear una tienda (Account.jsx stepper) — nunca en el login, así que no hace falta
// persistir un flag de "ya lo vio": está atado al onSuccess del create.
// `planType`: clave del plan sugerido. El plan con el que se compara sale de suggestedUpgradePlan (PlansCatalog.jsx), la
// misma función que usa Account.jsx: solo planes con insignia que se pagan con la verificación (el servidor rechaza ahí uno
// sin insignia o a medida, así que el botón nunca lleva a un "no se puede") y el mismo orden de reserva en las dos
// pantallas. `businessHref`: adónde lleva el botón mientras los planes cargan.
export function PlanComparisonModal({ onContinueRegular, planType, businessHref }) {
  const { data, isLoading, isError, refetch } = usePublicPlans();
  const dialogRef = useRef(null);
  const titleRef = useRef(null);

  // Al abrirse, el foco pasa al título del modal (si no, se queda en el formulario de registro que hay detrás y el lector de
  // pantalla no anuncia nada). Escape equivale a "Continuar con" el plan de inicio, igual que cerrar en ConfirmModal, y Tab
  // queda dentro del modal mientras está abierto.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onContinueRegular?.();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusables = [...dialogRef.current.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === titleRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
  const plans = data?.plans ?? [];
  const startPlan = plans.find((p) => p.isDefault) ?? null;
  const target = suggestedUpgradePlan(plans, planType);
  const columns = [startPlan, target].filter(Boolean);
  const rows = planComparisonRows(columns);
  const href = target ? `/vendedor/verificacion?plan=${encodeURIComponent(target.planType)}` : businessHref ?? "/vendedor/verificacion";
  const targetCta = target ? `Conocer ${planName(target)}` : null;
  const gridStyle = { gridTemplateColumns: `1.4fr repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))` };

  return (
    <div
      ref={dialogRef}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-compare-title"
    >
      <div className="modal-panel-6 w-full max-w-lg rounded-xl bg-surface-container-lowest p-6 sm:p-8">
        <div className="mb-1 text-center font-display text-[13px] font-bold uppercase tracking-wide text-secondary">
          ¡Tu tienda ya existe!
        </div>
        <h2 id="plan-compare-title" ref={titleRef} tabIndex={-1} className="mb-2 text-center outline-none font-display text-headline-md text-on-surface">
          Elige cómo empezar
        </h2>
        <p className="mb-6 text-center text-[13px] text-on-surface-variant">
          {startPlan ? `Arrancas en el plan ${planName(startPlan)}${startPlan.isFree ? ", gratis" : ""}. ` : ""}
          {target ? `Puedes pasar a ${planName(target)} cuando quieras desde tu panel.` : "Puedes cambiar de plan cuando quieras desde tu panel."}
        </p>

        <div className="mb-6 overflow-hidden rounded-lg border border-surface-container-high">
          {isLoading ? (
            <div className="px-3 py-4">
              <Skeleton count={4} height={14} className="mb-2" />
            </div>
          ) : isError ? (
            <p className="px-3 py-4 text-center text-[13px] text-error">
              No se pudieron cargar los planes.{" "}
              <button type="button" onClick={() => refetch()} className="inline-flex min-h-11 items-center font-semibold underline">
                Reintentar
              </button>
            </p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-4 text-center text-[13px] text-on-surface-variant">Todavía no hay planes para comparar.</p>
          ) : (
            <>
              <div className="grid bg-surface-container text-center text-[11.5px] font-bold text-on-surface-variant" style={gridStyle}>
                <div className="px-3 py-2.5 text-left">Incluye</div>
                {columns.map((p) => (
                  <div key={p.planType} className={`break-words px-2 py-2.5 ${p === target ? "text-secondary" : ""}`}>
                    {planName(p)}
                  </div>
                ))}
              </div>
              {rows.map((row) => (
                <div key={row.key} className="grid items-center border-t border-surface-container-high text-center" style={gridStyle}>
                  <div className="break-words px-3 py-2.5 text-left text-[12px] text-on-surface-variant">{row.label}</div>
                  {row.values.map((value, i) => (
                    <div key={columns[i].planType} className="px-2 py-2.5">
                      <Cell value={value} />
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            onClick={onContinueRegular}
            className="min-h-11 flex-1 rounded bg-primary-container py-3 text-label-md font-bold text-white hover:bg-primary"
          >
            {startPlan ? `Continuar con ${planName(startPlan)}` : "Continuar"}
          </button>
          {(target || isLoading) && (
            <Link
              to={href}
              className="flex min-h-11 flex-1 items-center justify-center rounded bg-secondary-container py-3 text-center text-label-md font-bold text-on-secondary-container hover:brightness-95"
            >
              {targetCta ?? "Conocer los planes de pago"}
            </Link>
          )}
        </div>
        <Link to="/planes" className="mt-3 flex min-h-11 items-center justify-center text-[12.5px] font-semibold text-tertiary-accent hover:underline">
          Ver todos los planes y precios
        </Link>
      </div>
    </div>
  );
}
