import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api.js";
import { Skeleton, SkeletonGroup } from "../../ui/Skeleton.jsx";
import { DialogButton } from "./PlanDialog.jsx";
import { apiError, fmtCup, fmtDate, fmtUsd, periodRange } from "./planUtils.js";

const PERIODS = [
  { id: 30, label: "30 días" },
  { id: 90, label: "90 días" },
  { id: 365, label: "12 meses" },
];

// Dinero por moneda, por separado: nunca se convierte CUP a USD (no hay una tasa oficial configurada).
function Money({ value }) {
  const cup = value?.CUP;
  const usd = value?.USD;
  const parts = [];
  if (cup != null && Number(cup) > 0) parts.push(fmtCup(cup));
  if (usd != null && Number(usd) > 0) parts.push(fmtUsd(usd));
  if (!parts.length) return <span className="text-on-surface-variant">Sin ingresos</span>;
  return parts.map((p) => (
    <span key={p} className="block">
      {p}
    </span>
  ));
}

// Dentro de un <dl> cada grupo solo admite dt y dd: la aclaración va dentro del dd, no en un <p> aparte.
function Tile({ label, children, hint }) {
  return (
    <div className="rounded-xl border border-surface-container-high bg-surface-container-lowest p-3">
      <dt className="text-[12px] text-on-surface-variant">{label}</dt>
      <dd className="mt-1">
        <span className="block font-display text-[18px] font-extrabold leading-tight text-on-surface">{children}</span>
        {hint && <span className="mt-0.5 block text-[11.5px] text-on-surface-variant">{hint}</span>}
      </dd>
    </div>
  );
}

export function PlanSummaryTab({ plan }) {
  const [days, setDays] = useState(30);
  const { from, to } = periodRange(days);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-plan-stats", from, to],
    queryFn: async () => (await api.get("/admin/plan-stats", { params: { from, to } })).data,
    staleTime: 60 * 1000,
  });
  const row = data?.plans?.find((p) => p.planType === plan.planType);
  // GET /admin/plan-stats la manda como historySince; changesSince queda por si alguna versión la llamaba así.
  const since = data?.historySince ?? data?.changesSince ?? null;

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-[14px] font-bold text-on-surface">Cómo va este plan</h3>
        <div role="group" aria-label="Periodo de las estadísticas" className="flex gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={days === p.id}
              onClick={() => setDays(p.id)}
              className={`min-h-11 rounded-full border px-3.5 text-[12.5px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent ${days === p.id ? "border-primary bg-primary text-on-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-container"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <SkeletonGroup label="Cargando estadísticas" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="rounded-xl border border-surface-container-high p-3">
              <Skeleton width="60%" height={11} />
              <Skeleton width="45%" height={20} className="mt-1.5" />
            </div>
          ))}
        </SkeletonGroup>
      )}

      {isError && (
        <div role="alert" className="rounded-xl border border-error/30 bg-error-container/40 px-4 py-3 text-[13px] text-on-error-container">
          <p className="font-semibold">{apiError(error, "No se pudieron cargar las estadísticas del plan.")}</p>
          <DialogButton variant="outline" className="mt-2 bg-surface-container-lowest" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Reintentando..." : "Reintentar"}
          </DialogButton>
        </div>
      )}

      {data && !row && <p className="rounded-xl bg-surface-container-low px-4 py-3 text-[13px] text-on-surface-variant">Este plan todavía no tiene tiendas ni pagos en este periodo.</p>}

      {row && (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Tile label="Tiendas en el plan">{row.vendors ?? 0}</Tile>
            <Tile label="Al día con el pago">{row.upToDate ?? 0}</Tile>
            <Tile label="En prueba gratis">{row.inTrial ?? 0}</Tile>
            <Tile label="Cobro atrasado">{row.overdue ?? 0}</Tile>
            <Tile label="Suspendidas por pago">{row.suspendedForPayment ?? 0}</Tile>
            <Tile label="Activadas a mano" hint="Sin un pago después">
              {row.manualGrants ?? 0}
            </Tile>
            <Tile label="Altas en el periodo">{row.newInPeriod ?? 0}</Tile>
            <Tile label="Bajas en el periodo">{row.leftInPeriod ?? 0}</Tile>
            <Tile label="Ingresos del periodo">
              <Money value={row.revenue} />
            </Tile>
            <Tile label="Ingreso mensual recurrente" hint="Pago vigente dividido por sus meses">
              <Money value={row.mrr} />
            </Tile>
            <Tile label="Ingreso medio por tienda que paga">
              <Money value={row.arpu} />
            </Tile>
          </dl>
          <p className="mt-3 text-[12px] leading-relaxed text-on-surface-variant">
            {since
              ? `Las altas y bajas se registran desde el ${fmtDate(since)}.`
              : "Las altas y bajas se cuentan desde que el sistema empezó a registrar cada cambio de plan; antes de eso no hay datos."}{" "}
            Cada moneda se suma por separado: no se convierte CUP a USD.
          </p>
        </>
      )}

      {plan.includes?.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-2 text-[14px] font-bold text-on-surface">Lo que incluye hoy (guardado)</h3>
          <ul className="grid gap-1.5 text-[13px] text-on-surface">
            {plan.includes.map((line, i) => (
              <li key={`${line}-${i}`} className="flex gap-2">
                <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-tertiary-accent" />
                {line}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-6 text-[12px] text-on-surface-variant">
        Clave interna del plan: <span className="font-mono font-semibold text-on-surface">{plan.planType}</span>. No cambia nunca, aunque cambies el nombre.
      </p>
    </div>
  );
}
