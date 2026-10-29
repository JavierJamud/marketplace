import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api.js";
import toast from "../../../lib/toast.jsx";
import { Select } from "../../ui/Select.jsx";
import { PlanDialog, DialogButton } from "./PlanDialog.jsx";
import { apiError, plural } from "./planUtils.js";

// Archivar = el borrado de los planes: nunca se borra la fila porque los pagos y los cambios de plan viejos apuntan a
// ella. Si el plan tiene tiendas hay que elegir a qué plan pasan (el servidor lo exige). El plan por defecto y el de
// prueba no llegan aquí: su menú no muestra Archivar (y el servidor responde 409).
// Usa el código de acción PLAN_ARCHIVE, que pide el cliente de la API cuando el servidor responde 403.
export function ArchivePlanDialog({ plan, plans, onClose, onArchived }) {
  const open = !!plan;
  const vendors = plan?.stats?.vendors ?? 0;
  const targets = plans.filter((p) => p.planType !== plan?.planType && !p.archivedAt);
  const fallback = targets.find((p) => p.isDefault)?.planType ?? targets[0]?.planType ?? "";
  const [moveTo, setMoveTo] = useState(fallback);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setMoveTo(fallback);
    // Solo al abrir otro plan.
  }, [plan?.planType]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsTarget = vendors > 0;
  const dest = targets.find((p) => p.planType === moveTo);
  const destCharged = dest && !dest.isFree && !dest.contactOnly;
  // Lo que hace archivePlan con las tarjetas: si el destino es el plan por defecto aplica la baja completa
  // (applyPlanDowngrade: cancela la tarjeta al momento y quita insignia y prueba); si es otro, solo deja de renovarla
  // (stopCardRenewal: sigue activa hasta el fin de lo pagado).
  const destIsDefault = !!dest?.isDefault;

  // Resumen del servidor: qué pasa con las tiendas al moverlas (productos que quedan ocultos, personal sin acceso...).
  const impact = useQuery({
    queryKey: ["admin-plan-archive-impact", plan?.planType, needsTarget ? moveTo : null],
    queryFn: async () =>
      (await api.post(`/admin/plans/${encodeURIComponent(plan.planType)}/preview-impact`, { archive: true, ...(needsTarget ? { moveTo } : {}) })).data,
    enabled: open && (!needsTarget || !!moveTo),
    staleTime: 30 * 1000,
    retry: false,
  });

  async function archive() {
    if (busy || (needsTarget && !moveTo)) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/plans/${encodeURIComponent(plan.planType)}/archive`, needsTarget ? { moveTo } : {});
      const moved = data?.moved ?? 0;
      const destName = plans.find((p) => p.planType === (data?.moveTo ?? moveTo))?.displayName;
      toast.success(moved > 0 && destName ? `Plan ${plan.displayName} archivado. ${plural(moved, "tienda pasó", "tiendas pasaron")} a ${destName}.` : `Plan ${plan.displayName} archivado.`);
      // El archivado ya está hecho, pero pudo quedar algo a medias: tiendas sin recalcular cupo u ofertas (warning) o
      // tarjetas que siguen renovándose en Stripe (stripe.message). El admin tiene que enterarse para revisarlo.
      if (data?.warning) toast.error(data.warning);
      if (data?.stripe?.message) toast.error(data.stripe.message);
      onArchived?.();
      onClose();
    } catch (err) {
      if (!err.actionCodeCancelled) toast.error(apiError(err, "No se pudo archivar el plan."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PlanDialog
      open={open}
      wide
      title={`¿Archivar el plan ${plan?.displayName ?? ""}?`}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <DialogButton variant="outline" data-autofocus onClick={onClose} disabled={busy}>
            Cancelar
          </DialogButton>
          <DialogButton variant="danger" onClick={archive} disabled={busy || (needsTarget && !moveTo)}>
            {busy ? "Archivando..." : needsTarget ? "Archivar y mover tiendas" : "Archivar plan"}
          </DialogButton>
        </>
      }
    >
      {open && (
        <div className="grid gap-3 text-[13.5px] text-on-surface">
          {needsTarget ? (
            <>
              <p>
                Este plan tiene {plural(vendors, "tienda", "tiendas")}. Elige a qué plan {vendors === 1 ? "pasa" : "pasan"}: es obligatorio para archivarlo.
              </p>
              {targets.length ? (
                <Select label="Mover las tiendas a" required value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                  {targets.map((p) => (
                    <option key={p.planType} value={p.planType}>
                      {p.displayName}
                      {p.isPublic === false ? " (oculto)" : ""}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="font-semibold text-error">No hay otro plan al que mover las tiendas. Crea uno antes de archivar este.</p>
              )}
            </>
          ) : (
            <p>Este plan no tiene tiendas: nadie cambia de plan.</p>
          )}

          <ul className="grid gap-1.5 rounded-lg bg-surface-container-low px-3.5 py-3 text-[13px]">
            {needsTarget && dest && <li>Cada tienda pasa a {dest.displayName}, se le avisa y se recalcula su cupo de productos con los límites de ese plan.</li>}
            {needsTarget && dest && destIsDefault && (
              <li>
                Como {dest.displayName} es el plan por defecto, se cancelan al momento sus suscripciones con tarjeta y pierden la insignia de verificada y la
                prueba gratis, si las tenían.
              </li>
            )}
            {needsTarget && dest && !destIsDefault && destCharged && (
              <li>
                Sus suscripciones con tarjeta dejan de renovarse: siguen activas hasta el fin de lo pagado y después renuevan desde Suscripción con el precio
                de {dest.displayName}. Los pagos por transferencia también se renuevan con ese precio.
              </li>
            )}
            {needsTarget && dest && !destIsDefault && !destCharged && (
              <li>Sus suscripciones con tarjeta dejan de renovarse: siguen activas hasta el fin de lo pagado y no se les vuelve a cobrar en línea.</li>
            )}
            <li>El plan deja de verse y de venderse. Sus pagos y su historial se conservan.</li>
            <li>Puedes restaurarlo después desde "Ver planes archivados": vuelve oculto, para revisarlo antes de mostrarlo.</li>
          </ul>

          {impact.isLoading && impact.fetchStatus !== "idle" && (
            <p role="status" className="text-[12.5px] text-on-surface-variant">
              Calculando el efecto en las tiendas...
            </p>
          )}
          {impact.isError && <p className="text-[12.5px] text-on-surface-variant">{apiError(impact.error, "No se pudo calcular el efecto en las tiendas.")} Puedes archivar igual.</p>}
          {impact.data?.messages?.length > 0 && (
            <div>
              <p className="mb-1 text-[12.5px] font-bold text-on-surface">Lo que cambia para las tiendas</p>
              <ul className="grid gap-1 text-[13px]">
                {impact.data.messages.map((m, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-secondary-container" />
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </PlanDialog>
  );
}
