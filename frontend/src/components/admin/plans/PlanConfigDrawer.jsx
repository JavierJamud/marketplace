import { useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { X, AlertTriangle, Eye } from "lucide-react";
import toast from "../../../lib/toast.jsx";
import { api } from "../../../lib/api.js";
import { useDialogLayer } from "./useDialogLayer.js";
import { PlanDialog, DialogButton } from "./PlanDialog.jsx";
import { PlanChips } from "./PlanCard.jsx";
import { PlanSummaryTab } from "./PlanSummaryTab.jsx";
import { PlanPricingTab } from "./PlanPricingTab.jsx";
import { PlanFeaturesTab } from "./PlanFeaturesTab.jsx";
import { PlanExtrasTab } from "./PlanExtrasTab.jsx";
import { PlanPreviewCard } from "./PlanPreviewCard.jsx";
import { ERROR_TAB, apiError, buildPatchBody, formFromPlan, validateForm } from "./planUtils.js";

// `short`: la etiqueta en el celular, para que las 4 pestañas quepan a 360px sin deslizar.
const TABS = [
  { id: "resumen", label: "Resumen", short: "Resumen" },
  { id: "precio", label: "Precio y venta", short: "Precio" },
  { id: "funciones", label: "Funciones y límites", short: "Funciones" },
  { id: "extras", label: "Beneficios extra", short: "Extras" },
];

// Claves de caché que dependen de un plan: la rejilla, las estadísticas, /settings (nombres y límites en todo el sitio),
// la página pública de planes, la pantalla vieja (mientras exista) y las listas que muestran el plan de cada tienda
// (suscripciones, tiendas, el selector de "Activar un plan a mano", la ficha de la tienda y el panel del admin): archivar
// mueve tiendas de plan y un cambio de nombre o de cobro se ve en todas ellas.
export function invalidatePlanQueries(queryClient) {
  for (const key of [
    "admin-plans",
    "admin-plan-stats",
    "admin-plan-features",
    "site-settings",
    "public-plans",
    "admin-plan-configs",
    "admin-plan-vendor-counts",
    "admin-subscriptions",
    "admin-list-vendors",
    "admin-vendor-pick",
    "admin-vendor-manage",
    "admin-dashboard",
  ]) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

// Confirmaciones que exige applyPlanUpdate (adminPlans.controller.js) para los cambios con efecto sobre tiendas reales: sin
// ellas responde 409 PLAN_IMPACT_CONFIRM_REQUIRED. Solo se mandan al confirmar el resumen, cuando el admin ya vio el impacto.
// Mandarlas de más no cambia nada: el servidor solo las mira si el cambio las necesita.
function confirmFlagsFor(body) {
  return {
    ...(body.grantsBadge !== undefined ? { confirmBadgeImpact: true } : {}),
    ...(body.isFree === true || body.contactOnly === true ? { confirmBillingImpact: true } : {}),
  };
}

const needsConfirm = (err) => err?.response?.status === 409 && err.response.data?.details?.code === "PLAN_IMPACT_CONFIRM_REQUIRED";

// Ventana "Configurar": hoja a pantalla completa en el celular y panel lateral de 720px en escritorio. Se edita una copia
// del plan tomada al abrir (si la rejilla se recarga mientras tanto, no se pierde lo escrito). "Guardar" primero pide el
// resumen de impacto (preview-impact, no escribe nada) y, al confirmar, guarda; el código de acción del admin lo pide
// solo el cliente de la API (ActionCodeProvider) cuando el servidor responde 403.
export function PlanConfigDrawer({ plan, catalog, groups, plans, initialTab = "resumen", onClose }) {
  const queryClient = useQueryClient();
  const panelRef = useRef(null);
  const titleId = useId();
  const [base, setBase] = useState(plan);
  const [form, setForm] = useState(() => formFromPlan(plan, catalog));
  const [tab, setTab] = useState(initialTab);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Resumen de impacto: null | { body, lines, status: "loading" | "ready" | "error" | "invalid", data?, error? }
  // "error" = no se pudo calcular (red o fallo del servidor): se puede guardar sin el resumen. "invalid" = el servidor
  // rechazó el cambio (400/409, p. ej. un nombre repetido): guardarlo daría el mismo error, así que solo queda corregirlo.
  const [impact, setImpact] = useState(null);
  const [saving, setSaving] = useState(false);
  // "Así lo ve la tienda": null | { status: "loading" | "ready" | "error", card?, error? }. Usa preview-impact (no escribe nada)
  // con los cambios sin guardar, o sin cambios para ver el plan tal como está.
  const [preview, setPreview] = useState(null);
  const tabRefs = useRef({});

  const changes = useMemo(() => buildPatchBody(form, base, catalog), [form, base, catalog]);
  const errors = useMemo(() => validateForm(form, base), [form, base]);
  const errorTabs = new Set(Object.keys(errors).map((k) => ERROR_TAB[k]).filter(Boolean));
  const firstError = Object.values(errors)[0];

  function requestClose() {
    if (saving) return;
    if (changes.dirty) setConfirmDiscard(true);
    else onClose();
  }

  useDialogLayer(panelRef, { open: true, onEscape: requestClose });

  async function loadImpact(main, lines) {
    // El texto libre (lista de líneas) no cambia nada para las tiendas: no se manda al cálculo.
    const previewBody = { ...main };
    if (Array.isArray(previewBody.features)) delete previewBody.features;
    setImpact({ body: main, lines, status: "loading" });
    try {
      const { data } = await api.post(`/admin/plans/${encodeURIComponent(base.planType)}/preview-impact`, previewBody);
      setImpact({ body: main, lines, status: "ready", data });
    } catch (err) {
      // preview-impact valida igual que el PATCH (buildPlanPatch + validateNext): un 400/409 es el motivo real del rechazo.
      const status = err?.response?.status;
      if (status === 400 || status === 409) {
        setImpact({ body: main, lines, status: "invalid", error: apiError(err, "El servidor no acepta este cambio. Revísalo antes de guardar.") });
      } else {
        setImpact({ body: main, lines, status: "error", error: apiError(err, "No se pudo calcular a cuántas tiendas afecta el cambio.") });
      }
    }
  }

  async function openPreview() {
    const body = changes.dirty ? { ...changes.main } : {};
    if (Array.isArray(body.features)) delete body.features;
    setPreview({ status: "loading" });
    try {
      const { data } = await api.post(`/admin/plans/${encodeURIComponent(base.planType)}/preview-impact`, body);
      setPreview({ status: "ready", card: data.card });
    } catch (err) {
      setPreview({ status: "error", error: apiError(err, "No se pudo armar la vista previa.") });
    }
  }

  function onSaveClick() {
    if (firstError) {
      const target = ERROR_TAB[Object.keys(errors)[0]];
      if (target) setTab(target);
      return;
    }
    if (!changes.dirty) return;
    loadImpact(changes.main, changes.lines);
  }

  async function confirmSave() {
    if (!impact || impact.status === "invalid") return;
    const { body, lines } = impact;
    setSaving(true);
    let saved = null;
    let linesFailed = false;
    let stripeMessage = null;
    try {
      const key = encodeURIComponent(base.planType);
      if (Object.keys(body).length) {
        const confirmed = { ...body, ...confirmFlagsFor(body) };
        let res;
        try {
          res = await api.patch(`/admin/plans/${key}`, confirmed);
        } catch (err) {
          // Red de seguridad: si el servidor pide otra confirmación que la pantalla no previó, se manda la que nombra
          // (el admin ya aceptó el resumen). Una sola vez, para no entrar en un bucle.
          const fields = needsConfirm(err) ? err.response.data.details.confirmFields : null;
          if (!Array.isArray(fields) || !fields.length) throw err;
          res = await api.patch(`/admin/plans/${key}`, { ...confirmed, ...Object.fromEntries(fields.map((f) => [f, true])) });
        }
        saved = res.data?.plan ?? null;
        // Tarjetas que no se pudieron dejar de renovar al pasar el plan a gratis o por WhatsApp (stripeSummary).
        stripeMessage = res.data?.stripe?.message ?? null;
      }
      // Segundo pedido solo si cambiaron a la vez las funciones del catálogo y las líneas de texto libre (ver buildPatchBody).
      if (lines) {
        try {
          saved = (await api.patch(`/admin/plans/${key}`, lines)).data?.plan ?? saved;
        } catch (err) {
          // Aunque se haya cancelado el código de acción, el primer cambio ya quedó guardado: siempre se avisa.
          linesFailed = true;
          const partial = "Se guardó el plan, pero no las líneas de texto libre. Vuelve a guardarlas.";
          toast.error(err.actionCodeCancelled ? partial : apiError(err, partial));
        }
      }
      const name = form.displayName.trim() || base.displayName;
      if (!linesFailed) toast.success(`Plan ${name} actualizado.`);
      if (stripeMessage) toast.error(stripeMessage);
      invalidatePlanQueries(queryClient);
      setImpact(null);
      if (saved) {
        setBase(saved);
        // Si las líneas no se guardaron, se conservan las que escribió el admin: siguen como cambio pendiente.
        setForm(linesFailed ? { ...formFromPlan(saved, catalog), features: form.features } : formFromPlan(saved, catalog));
      } else if (!linesFailed) {
        // Sin la fila de vuelta no hay con qué comparar: se cierra y la rejilla se recarga con lo guardado. Si fallaron las
        // líneas, la ventana sigue abierta con lo escrito para poder volver a guardarlas.
        onClose();
      }
    } catch (err) {
      if (err.actionCodeCancelled) return;
      toast.error(apiError(err, "No se pudo guardar el plan."));
      setImpact(null);
    } finally {
      setSaving(false);
    }
  }

  function onTabKey(e, index) {
    const last = TABS.length - 1;
    const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  }

  const vendorCount = base.stats?.vendors;
  const body = impact?.body ?? {};
  const goingPaid = base.isFree && body.isFree === false && !form.contactOnly;
  // El cobro con aviso (startBillingForFreePlan) solo arranca en planes sin insignia (billedWithoutBadge en el servidor).
  // En uno con insignia, cada tienda paga al renovar su verificación.
  const goingPaidBilled = goingPaid && !form.grantsBadge;
  const goingPaidBadge = goingPaid && form.grantsBadge;
  const messages = impact?.data?.messages ?? [];

  return createPortal(
    <div
      // Ventana centrada (no un panel pegado al borde derecho a todo el alto): el dueño la veía como una página encima de
      // la otra. En el celular es una hoja que sube desde abajo y deja ver un poco del panel detrás; nunca pasa del 92% del
      // alto y solo su cuerpo se desplaza, así cabecera, pestañas y "Guardar" quedan siempre a la vista.
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="motion-safe:animate-sheet-up flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface shadow-2xl outline-none sm:max-h-[88dvh] sm:max-w-[760px] sm:rounded-3xl"
      >
        <header className="border-b border-surface-container-high bg-surface-container-lowest px-4 pb-0 pt-3 sm:px-6 sm:pt-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-on-surface-variant">Configurar plan</p>
              <h2 id={titleId} className="break-words font-display text-[20px] font-extrabold leading-tight text-on-surface">
                {base.displayName}
              </h2>
              <div className="mt-2">
                <PlanChips plan={base} />
              </div>
            </div>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Cerrar"
              className="-mr-2 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-tertiary-accent"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div role="tablist" aria-label="Secciones del plan" className="-mx-4 mt-3 flex overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6">
            {TABS.map((t, i) => {
              const on = tab === t.id;
              return (
                <button
                  key={t.id}
                  ref={(el) => (tabRefs.current[t.id] = el)}
                  type="button"
                  role="tab"
                  id={`plan-tab-${t.id}`}
                  aria-selected={on}
                  aria-controls="plan-tabpanel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  onKeyDown={(e) => onTabKey(e, i)}
                  className={`relative flex min-h-11 flex-shrink-0 items-center gap-1.5 whitespace-nowrap border-b-[3px] px-2.5 text-[13.5px] sm:px-3 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tertiary-accent ${on ? "border-secondary-container text-on-surface" : "border-transparent text-on-surface-variant hover:text-on-surface"}`}
                >
                  <span className="sm:hidden">{t.short}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                  {errorTabs.has(t.id) && (
                    <>
                      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-error" />
                      <span className="sr-only">(tiene un error)</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </header>

        <div role="tabpanel" id="plan-tabpanel" aria-labelledby={`plan-tab-${tab}`} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 outline-none sm:px-6">
          {tab === "resumen" && <PlanSummaryTab plan={base} />}
          {tab === "precio" && <PlanPricingTab form={form} setForm={setForm} base={base} errors={errors} plans={plans} vendorCount={vendorCount} />}
          {tab === "funciones" && <PlanFeaturesTab form={form} setForm={setForm} catalog={catalog} groups={groups} base={base} />}
          {tab === "extras" && <PlanExtrasTab form={form} setForm={setForm} catalog={catalog} groups={groups} errors={errors} />}
        </div>

        <footer className="flex flex-col gap-2 border-t border-surface-container-high bg-surface-container-lowest px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className={`text-[12.5px] ${firstError && changes.dirty ? "font-semibold text-error" : "text-on-surface-variant"}`} aria-live="polite">
            {firstError && changes.dirty ? firstError : changes.dirty ? "Tienes cambios sin guardar." : "Sin cambios."}
          </p>
          <div className="flex flex-wrap gap-2 sm:flex-nowrap">
            <DialogButton variant="outline" className="w-full sm:w-auto" onClick={openPreview} disabled={saving || preview?.status === "loading" || !!firstError}>
              <Eye className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Vista previa
            </DialogButton>
            {changes.dirty && (
              <DialogButton variant="outline" className="flex-1 sm:flex-none" onClick={() => setForm(formFromPlan(base, catalog))} disabled={saving}>
                Descartar
              </DialogButton>
            )}
            <DialogButton className="flex-1 sm:flex-none" onClick={onSaveClick} disabled={!changes.dirty || saving || impact?.status === "loading"}>
              {impact?.status === "loading" ? "Calculando..." : saving ? "Guardando..." : "Guardar"}
            </DialogButton>
          </div>
        </footer>
      </div>

      <PlanDialog
        open={!!impact}
        wide
        title={`¿Guardar los cambios de ${form.displayName.trim() || base.displayName}?`}
        busy={saving}
        onClose={() => setImpact(null)}
        footer={
          <>
            <DialogButton variant="outline" onClick={() => setImpact(null)} disabled={saving}>
              Seguir editando
            </DialogButton>
            {impact?.status === "error" && (
              <DialogButton variant="outline" onClick={() => loadImpact(impact.body, impact.lines)} disabled={saving}>
                Reintentar
              </DialogButton>
            )}
            {impact?.status !== "invalid" && (
              <DialogButton data-autofocus onClick={confirmSave} disabled={saving || impact?.status === "loading"}>
                {saving ? "Guardando..." : impact?.status === "error" ? "Guardar sin el resumen" : "Confirmar y guardar"}
              </DialogButton>
            )}
          </>
        }
      >
        {impact?.status === "loading" && (
          <p role="status" className="text-[13.5px] text-on-surface-variant">
            Calculando a qué tiendas afecta...
          </p>
        )}
        {(impact?.status === "error" || impact?.status === "invalid") && (
          <p role="alert" className="flex gap-2 rounded-lg bg-error-container/50 px-3 py-2.5 text-[13px] text-on-error-container">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            {impact.error}
          </p>
        )}
        {impact?.status === "ready" &&
          (messages.length ? (
            <ul className="grid gap-1.5 text-[13.5px] text-on-surface">
              {messages.map((m, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden="true" className="mt-[8px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-secondary-container" />
                  {m}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13.5px] text-on-surface">Este cambio no afecta a las tiendas que ya tienen el plan.</p>
          ))}
        {impact?.status !== "invalid" && (goingPaid || body.isDefault || body.isTrialPlan) && (
          <ul className="mt-3 grid gap-1.5 rounded-lg bg-surface-container-low px-3 py-2.5 text-[13px] text-on-surface">
            {goingPaidBilled && <li>El plan deja de ser gratis: cada tienda recibe un aviso con su fecha de pago mensual y, si no paga, pasa a modo limitado y luego a suspendida.</li>}
            {goingPaidBadge && <li>El plan deja de ser gratis. Como da la insignia, sus tiendas no reciben un aviso de cobro ahora: conservan el plan hasta que venza el tiempo que tienen y, para seguir en él, tendrán que pagarlo.</li>}
            {body.isDefault && <li>Las tiendas nuevas se registrarán en este plan, y aquí pasarán las que bajen de plan.</li>}
            {body.isTrialPlan && <li>Las pruebas gratis nuevas usarán este plan.</li>}
          </ul>
        )}
        {impact?.status === "ready" && impact.data?.card && (
          <details className="mt-3 rounded-lg border border-surface-container-high">
            <summary className="flex min-h-11 cursor-pointer items-center px-3 text-[13px] font-bold text-on-surface">Así lo verá la tienda</summary>
            <div className="px-3 pb-3">
              <PlanPreviewCard card={impact.data.card} />
            </div>
          </details>
        )}
        {impact?.status === "invalid" ? (
          <p className="mt-3 text-[12px] text-on-surface-variant">Corrige el cambio con "Seguir editando" y vuelve a guardar.</p>
        ) : (
          <p className="mt-3 text-[12px] text-on-surface-variant">Al confirmar te pediremos tu código de seguridad si hace falta.</p>
        )}
      </PlanDialog>

      <PlanDialog
        open={!!preview}
        title="Así lo ve la tienda"
        description={changes.dirty ? "Con tus cambios sin guardar. Así sale en la página de planes y en el panel de cada tienda." : "Así sale en la página de planes y en el panel de cada tienda."}
        onClose={() => setPreview(null)}
        footer={
          <DialogButton data-autofocus onClick={() => setPreview(null)}>
            Cerrar
          </DialogButton>
        }
      >
        {preview?.status === "loading" && (
          <p role="status" className="text-[13.5px] text-on-surface-variant">
            Armando la vista previa...
          </p>
        )}
        {preview?.status === "error" && (
          <p role="alert" className="flex gap-2 rounded-lg bg-error-container/50 px-3 py-2.5 text-[13px] text-on-error-container">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            {preview.error}
          </p>
        )}
        {preview?.status === "ready" && <PlanPreviewCard card={preview.card} />}
      </PlanDialog>

      <PlanDialog
        open={confirmDiscard}
        title="Tienes cambios sin guardar"
        description="Si cierras ahora, lo que cambiaste en este plan se pierde."
        onClose={() => setConfirmDiscard(false)}
        footer={
          <>
            <DialogButton variant="outline" data-autofocus onClick={() => setConfirmDiscard(false)}>
              Seguir editando
            </DialogButton>
            <DialogButton variant="danger" onClick={onClose}>
              Descartar y cerrar
            </DialogButton>
          </>
        }
      />

    </div>,
    document.body
  );
}
