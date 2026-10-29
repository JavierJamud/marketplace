import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, AlertTriangle, Layers } from "lucide-react";
import toast from "../../../lib/toast.jsx";
import { api } from "../../../lib/api.js";
import { PlanCard, PlanGridSkeleton } from "./PlanCard.jsx";
import { PlanConfigDrawer, invalidatePlanQueries } from "./PlanConfigDrawer.jsx";
import { CreatePlanDialog } from "./CreatePlanDialog.jsx";
import { ArchivePlanDialog } from "./ArchivePlanDialog.jsx";
import { DialogButton } from "./PlanDialog.jsx";
import { apiError } from "./planUtils.js";

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4";

// Sección "Planes" de Configuración > Planes y pagos: una tarjeta por plan (en su orden), con sus cifras y el botón
// Configurar. Nada de listas fijas de planes: todo sale de GET /admin/plans y del catálogo GET /admin/plan-features,
// así un plan creado aquí aparece en la rejilla, en /planes y en los selectores sin tocar código.
export function PlansSection() {
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  // Plan abierto en Configurar: una copia tomada al abrir (la ventana no se reinicia si la rejilla se recarga).
  const [editing, setEditing] = useState(null); // { plan, tab }
  const [creating, setCreating] = useState(null); // { name?, copyFrom? } | null
  const [archiving, setArchiving] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const plansQuery = useQuery({
    queryKey: ["admin-plans", showArchived ? 1 : 0],
    queryFn: async () => (await api.get("/admin/plans", { params: showArchived ? { archived: 1 } : undefined })).data,
    // Al mostrar u ocultar los archivados se cambia de consulta: se sigue viendo la rejilla anterior mientras llega la nueva.
    placeholderData: (previous) => previous,
  });
  const featuresQuery = useQuery({
    queryKey: ["admin-plan-features"],
    queryFn: async () => (await api.get("/admin/plan-features")).data,
    staleTime: 60 * 1000,
  });

  const all = plansQuery.data?.plans ?? [];
  const activePlans = all.filter((p) => !p.archivedAt);
  const archivedPlans = all.filter((p) => p.archivedAt);
  const archivedCount = plansQuery.data?.archivedCount ?? archivedPlans.length;
  const catalog = featuresQuery.data?.features ?? null;
  const groups = featuresQuery.data?.groups ?? [];

  const toggleVisible = useMutation({
    mutationFn: async (plan) => (await api.patch(`/admin/plans/${encodeURIComponent(plan.planType)}`, { isPublic: plan.isPublic === false })).data,
    onMutate: (plan) => setBusyKey(plan.planType),
    onSuccess: (_d, plan) => {
      toast.success(plan.isPublic === false ? `${plan.displayName} ya se muestra en la página de planes.` : `${plan.displayName} quedó oculto. Sus tiendas lo conservan.`);
      invalidatePlanQueries(queryClient);
    },
    onError: (err) => {
      if (!err.actionCodeCancelled) toast.error(apiError(err, "No se pudo cambiar la visibilidad del plan."));
    },
    onSettled: () => setBusyKey(null),
  });

  const restore = useMutation({
    mutationFn: async (plan) => (await api.post(`/admin/plans/${encodeURIComponent(plan.planType)}/restore`)).data,
    onMutate: (plan) => setBusyKey(plan.planType),
    onSuccess: (_d, plan) => {
      toast.success(`${plan.displayName} restaurado. Está oculto hasta que lo muestres.`);
      invalidatePlanQueries(queryClient);
    },
    onError: (err) => {
      if (!err.actionCodeCancelled) toast.error(apiError(err, "No se pudo restaurar el plan."));
    },
    onSettled: () => setBusyKey(null),
  });

  const catalogReady = !!catalog;

  function cardFor(plan) {
    return (
      <PlanCard
        key={plan.planType}
        plan={plan}
        busy={busyKey === plan.planType}
        configureDisabled={!catalogReady}
        onConfigure={() => setEditing({ plan, tab: "resumen" })}
        onDuplicate={() => setCreating({ name: `${plan.displayName} (copia)`.slice(0, 40), copyFrom: plan.planType })}
        onToggleVisible={() => toggleVisible.mutate(plan)}
        onArchive={() => setArchiving(plan)}
        onRestore={() => restore.mutate(plan)}
      />
    );
  }

  return (
    <section aria-labelledby="admin-plans-title">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 id="admin-plans-title" className="font-display text-[22px] font-extrabold tracking-tight text-on-surface">
            Planes
          </h2>
          <p className="mt-0.5 max-w-[560px] text-[13px] text-on-surface-variant">
            Lo que configures aquí es lo que el sistema aplica de verdad y lo que ven todos en la página de planes, en el registro y en el panel de cada tienda.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/planes"
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-outline-variant px-4 text-[13.5px] font-bold text-tertiary-accent hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
          >
            Ver página de planes <ExternalLink className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">(se abre en otra pestaña)</span>
          </Link>
          <DialogButton onClick={() => setCreating({})} disabled={!plansQuery.data}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Crear plan
          </DialogButton>
        </div>
      </div>

      {featuresQuery.isError && (
        <div role="alert" className="mb-4 flex flex-col gap-2 rounded-xl border border-error/30 bg-error-container/40 px-4 py-3 text-[13px] text-on-error-container sm:flex-row sm:items-center sm:justify-between">
          <p>{apiError(featuresQuery.error, "No se pudo cargar el catálogo de funciones. Sin él no se puede configurar un plan.")}</p>
          <DialogButton variant="outline" className="bg-surface-container-lowest" onClick={() => featuresQuery.refetch()} disabled={featuresQuery.isFetching}>
            Reintentar
          </DialogButton>
        </div>
      )}

      {plansQuery.isLoading && <PlanGridSkeleton />}

      {plansQuery.isError && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-error/30 bg-error-container/40 p-5 text-on-error-container">
          <div className="flex gap-2.5">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="text-[14px] font-bold">No se pudieron cargar los planes.</p>
              <p className="mt-0.5 text-[13px]">{apiError(plansQuery.error, "Revisa la conexión e inténtalo de nuevo.")}</p>
            </div>
          </div>
          <DialogButton variant="outline" className="bg-surface-container-lowest" onClick={() => plansQuery.refetch()} disabled={plansQuery.isFetching}>
            {plansQuery.isFetching ? "Reintentando..." : "Reintentar"}
          </DialogButton>
        </div>
      )}

      {plansQuery.data && activePlans.length === 0 && (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-outline-variant bg-surface-container-lowest px-5 py-10 text-center">
          <Layers className="h-8 w-8 text-tertiary-accent" aria-hidden="true" />
          <p className="mt-3 text-[15px] font-bold text-on-surface">Todavía no hay planes.</p>
          <p className="mt-1 max-w-[360px] text-[13px] text-on-surface-variant">Crea el primero: nace oculto para que lo revises antes de mostrarlo.</p>
          <DialogButton className="mt-4" onClick={() => setCreating({})}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Crear plan
          </DialogButton>
        </div>
      )}

      {activePlans.length > 0 && <div className={GRID}>{activePlans.map(cardFor)}</div>}

      {plansQuery.data && archivedCount > 0 && (
        <div className="mt-5">
          <button
            type="button"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            className="min-h-11 rounded-lg px-1 text-[13.5px] font-bold text-tertiary-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-tertiary-accent"
          >
            {showArchived ? "Ocultar planes archivados" : `Ver planes archivados (${archivedCount})`}
          </button>
          {showArchived && archivedPlans.length > 0 && (
            <div className="mt-3">
              <p className="mb-3 text-[12.5px] text-on-surface-variant">No se venden ni se asignan. Sus pagos y su historial se conservan.</p>
              <div className={GRID}>{archivedPlans.map(cardFor)}</div>
            </div>
          )}
        </div>
      )}

      {editing && catalog && (
        <PlanConfigDrawer
          key={editing.plan.planType}
          plan={editing.plan}
          initialTab={editing.tab}
          catalog={catalog}
          groups={groups}
          plans={activePlans}
          onClose={() => setEditing(null)}
        />
      )}

      <CreatePlanDialog
        open={!!creating}
        preset={creating}
        plans={activePlans}
        onClose={() => setCreating(null)}
        onCreated={(plan) => {
          setCreating(null);
          invalidatePlanQueries(queryClient);
          // Recién creado: se abre en "Precio y venta" para revisarlo antes de mostrarlo.
          if (catalog) setEditing({ plan, tab: "precio" });
        }}
      />

      <ArchivePlanDialog plan={archiving} plans={activePlans} onClose={() => setArchiving(null)} onArchived={() => invalidatePlanQueries(queryClient)} />
    </section>
  );
}
