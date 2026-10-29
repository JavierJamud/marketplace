import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Eye, EyeOff, Archive, ArchiveRestore, EllipsisVertical, Info } from "lucide-react";
import { Skeleton, SkeletonGroup } from "../../ui/Skeleton.jsx";
import { CHIP_TONE, fmtCup, fmtDate, fmtUsd, planChips, plural } from "./planUtils.js";

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent";

export function PlanChips({ plan }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Estado del plan">
      {planChips(plan).map((c) => (
        <li key={c.id} className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold leading-none ${CHIP_TONE[c.tone]}`}>
          {c.label}
        </li>
      ))}
    </ul>
  );
}

// Precio mensual en las dos monedas: nunca se convierte una en otra, la tienda paga en la que elige.
function PlanPrice({ plan }) {
  if (plan.contactOnly) {
    return <p className="text-[13px] font-semibold text-on-surface">Precio a convenir por WhatsApp</p>;
  }
  if (plan.isFree) {
    const list = [plan.listPriceCup ? fmtCup(plan.listPriceCup) : null, plan.listPriceUsd ? fmtUsd(plan.listPriceUsd) : null].filter(Boolean);
    return (
      <div>
        <p className="font-display text-[22px] font-extrabold leading-tight text-on-surface">Gratis</p>
        {list.length > 0 && <p className="mt-0.5 text-[12px] text-on-surface-variant">Precio tachado: {list.join(" · ")}</p>}
      </div>
    );
  }
  return (
    <div>
      <p className="font-display text-[22px] font-extrabold leading-tight text-on-surface">{fmtCup(plan.priceCup)}</p>
      <p className="mt-0.5 text-[13px] font-semibold text-on-surface-variant">o {fmtUsd(plan.priceUsd)}, al mes</p>
    </div>
  );
}

// MRR por moneda: solo las monedas con ingreso, sin sumar CUP y USD.
function mrrText(mrr) {
  const parts = [];
  if (Number(mrr?.CUP) > 0) parts.push(fmtCup(mrr.CUP));
  if (Number(mrr?.USD) > 0) parts.push(fmtUsd(mrr.USD));
  return parts.length ? parts.join(" · ") : "Sin ingresos";
}

// Menú de la tarjeta: Duplicar, Ocultar/Mostrar y Archivar. Flechas arriba/abajo recorren las opciones, Escape lo cierra
// y devuelve el foco al botón. El plan por defecto y el de prueba no muestran Archivar: en su lugar dicen por qué.
function PlanCardMenu({ plan, onDuplicate, onToggleVisible, onArchive, busy }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector("[role=menuitem]:not([disabled])")?.focus();
    function onPointer(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function onMenuKey(e) {
    const items = [...(menuRef.current?.querySelectorAll("[role=menuitem]:not([disabled])") ?? [])];
    const index = items.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const run = (fn) => () => {
    close();
    fn();
  };
  const lockedRole = plan.isDefault ? "default" : plan.isTrialPlan ? "trial" : null;
  // El plan por defecto tiene que verse: es donde se registran las tiendas nuevas (el servidor también lo exige).
  const cannotHide = plan.isDefault && plan.isPublic !== false;
  const item = `flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13.5px] font-semibold text-on-surface hover:bg-surface-container focus:bg-surface-container focus:outline-none disabled:cursor-not-allowed disabled:opacity-50`;

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Más acciones de ${plan.displayName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`flex h-11 w-11 items-center justify-center rounded-xl border border-outline-variant text-on-surface hover:bg-surface-container disabled:opacity-50 ${FOCUS}`}
      >
        <EllipsisVertical className="h-5 w-5" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Acciones de ${plan.displayName}`}
          onKeyDown={onMenuKey}
          className="absolute bottom-full right-0 z-20 mb-2 w-[min(17rem,calc(100vw-2rem))] rounded-xl border border-surface-container-high bg-surface-container-lowest p-1.5 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.25)]"
        >
          <button type="button" role="menuitem" tabIndex={-1} className={item} onClick={run(onDuplicate)}>
            <Copy className="h-4 w-4 flex-shrink-0 text-tertiary-accent" aria-hidden="true" /> Duplicar
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className={item} disabled={cannotHide} onClick={run(onToggleVisible)}>
            {plan.isPublic === false ? (
              <Eye className="h-4 w-4 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
            ) : (
              <EyeOff className="h-4 w-4 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
            )}
            {plan.isPublic === false ? "Mostrar en la página de planes" : "Ocultar de la página de planes"}
          </button>
          {cannotHide && <p className="px-3 pb-1 text-[11.5px] text-on-surface-variant">El plan por defecto siempre se muestra: ahí se registran las tiendas nuevas.</p>}
          {lockedRole ? (
            <p role="note" className="mt-1 flex gap-2 rounded-lg bg-surface-container-low px-3 py-2.5 text-[12px] leading-snug text-on-surface-variant">
              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              {lockedRole === "default"
                ? "No se puede archivar el plan por defecto. Si quieres archivarlo, elige antes otro plan por defecto en Configurar."
                : "No se puede archivar el plan de la prueba gratis. Si quieres archivarlo, elige antes otro plan de prueba en Configurar."}
            </p>
          ) : (
            <button type="button" role="menuitem" tabIndex={-1} className={`${item} text-error`} onClick={run(onArchive)}>
              <Archive className="h-4 w-4 flex-shrink-0" aria-hidden="true" /> Archivar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function PlanCard({ plan, onConfigure, onDuplicate, onToggleVisible, onArchive, onRestore, busy, configureDisabled }) {
  const stats = plan.stats ?? {};
  const vendors = stats.vendors ?? 0;
  const archived = !!plan.archivedAt;

  return (
    <article
      aria-label={`Plan ${plan.displayName}`}
      className={`flex min-w-0 flex-col rounded-2xl border bg-surface-container-lowest p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_24px_-12px_rgba(15,23,42,0.14)] sm:p-5 ${plan.highlighted ? "border-secondary-container" : "border-surface-container-high"}`}
    >
      <h3 className="break-words font-display text-[17px] font-extrabold leading-snug text-on-surface">{plan.displayName}</h3>
      {plan.tagline ? (
        <p className="mt-1 break-words text-[12.5px] leading-snug text-on-surface-variant">{plan.tagline}</p>
      ) : (
        <p className="mt-1 text-[12.5px] italic text-on-surface-variant">Sin frase corta</p>
      )}
      <div className="mt-3">
        <PlanChips plan={plan} />
      </div>

      <div className="mt-4">
        <PlanPrice plan={plan} />
      </div>

      <dl className="mt-4 grid gap-2 border-t border-surface-container pt-3 text-[12.5px]">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-on-surface-variant">Tiendas</dt>
          <dd>
            {/* Enlace a Tiendas con el filtro del plan, para ver quiénes son. */}
            <Link to={`/admin/tiendas?plan=${encodeURIComponent(plan.planType)}`} className={`inline-flex min-h-11 items-center font-bold text-tertiary-accent underline-offset-2 hover:underline ${FOCUS}`}>
              {plural(vendors, "tienda", "tiendas")}
            </Link>
          </dd>
        </div>
        {!archived && (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-on-surface-variant">Al día con el pago</dt>
              <dd className="font-semibold text-on-surface">{stats.payingUpToDate ?? 0}</dd>
            </div>
            {Number(stats.inTrial) > 0 && (
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-on-surface-variant">En prueba gratis</dt>
                <dd className="font-semibold text-on-surface">{stats.inTrial}</dd>
              </div>
            )}
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <dt className="text-on-surface-variant">Ingreso mensual</dt>
              <dd className="text-right font-semibold text-on-surface">{mrrText(stats.mrr)}</dd>
            </div>
          </>
        )}
        {/* Un <dl> solo admite dt, dd o div con ellos: el estado de archivado va como un par más. */}
        {archived && (
          <div>
            <dt className="sr-only">Estado</dt>
            <dd className="text-on-surface-variant">Archivado el {fmtDate(plan.archivedAt)}. No se vende ni se asigna.</dd>
          </div>
        )}
      </dl>

      <div className="mt-auto flex gap-2 pt-4">
        {archived ? (
          <button
            type="button"
            onClick={onRestore}
            disabled={busy}
            className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-outline-variant px-4 text-[13.5px] font-bold text-on-surface hover:bg-surface-container disabled:opacity-50 ${FOCUS}`}
          >
            <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> {busy ? "Restaurando..." : "Restaurar"}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onConfigure}
              disabled={configureDisabled}
              className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-primary px-4 text-[13.5px] font-bold text-on-primary hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
            >
              Configurar
            </button>
            <PlanCardMenu plan={plan} busy={busy} onDuplicate={onDuplicate} onToggleVisible={onToggleVisible} onArchive={onArchive} />
          </>
        )}
      </div>
    </article>
  );
}

// Esqueleto con la misma estructura que la tarjeta, para que nada salte al llegar los datos.
export function PlanGridSkeleton() {
  return (
    <SkeletonGroup label="Cargando planes" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 sm:p-5">
          <Skeleton width="55%" height={18} />
          <Skeleton width="85%" height={12} className="mt-2" />
          <div className="mt-3 flex gap-1.5">
            <Skeleton width={64} height={22} borderRadius={999} />
            <Skeleton width={80} height={22} borderRadius={999} />
          </div>
          <Skeleton width="60%" height={24} className="mt-4" />
          <Skeleton width="40%" height={12} />
          <div className="mt-4 border-t border-surface-container pt-3">
            <Skeleton count={3} height={12} />
          </div>
          <Skeleton height={44} borderRadius={12} className="mt-4" />
        </div>
      ))}
    </SkeletonGroup>
  );
}
