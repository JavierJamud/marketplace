import { useId, useMemo } from "react";
import { BadgeCheck } from "lucide-react";
import { featureRows, groupRows } from "./planUtils.js";

// Una fila por función del catálogo: casilla "Incluida" (el interruptor), campo "Hasta" (el tope) o los dos juntos, con
// la descripción de qué hace de verdad en el servidor. Los textos salen del catálogo (GET /admin/plan-features), no de
// una lista fija en esta pantalla.
function FeatureRow({ row, form, setCol }) {
  const descId = useId();
  const hintId = useId();
  const enabled = row.flagCol ? !!form.cols[row.flagCol] : true;
  const limit = row.limitCol ? form.cols[row.limitCol] : null;
  const included = row.limitCol ? enabled && limit !== 0 : enabled;
  // Ofertas de tienda: cada oferta usa un código, así que sin "Códigos de descuento" no funcionan.
  const needsCodes = row.flagKey === "allowStoreOffers" && enabled && form.cols.allowDiscountCodes === false;

  return (
    <li className={`rounded-xl border p-3.5 ${included ? "border-tertiary-accent/40 bg-tertiary-accent/[0.03]" : "border-outline-variant"}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-[240px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13.5px] font-bold text-on-surface">{row.label}</span>
            {row.requiresBadge && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/[0.07] px-2 py-0.5 text-[11px] font-bold text-primary">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Exige insignia
              </span>
            )}
          </div>
          <p id={descId} className="mt-1 text-[12.5px] leading-snug text-on-surface-variant">
            {row.description}
          </p>
          {row.requiresBadge && enabled && !form.grantsBadge && (
            <p className="mt-1.5 text-[12px] font-semibold text-secondary">Este plan no da la insignia: la función solo se activa en tiendas que ya estén verificadas.</p>
          )}
          {needsCodes && <p className="mt-1.5 text-[12px] font-semibold text-secondary">Enciende también "Códigos de descuento": cada oferta usa un código.</p>}
        </div>
        <div className="flex flex-wrap items-start gap-3">
          {row.flagCol && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px] font-semibold text-on-surface">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setCol(row.flagCol, e.target.checked)}
                aria-describedby={descId}
                aria-label={`${row.label}: incluida`}
                className="h-5 w-5 flex-shrink-0 accent-tertiary-accent"
              />
              Incluida
            </label>
          )}
          {row.limitCol && (
            <div>
              <span className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-on-surface" aria-hidden="true">
                  Hasta
                </span>
                <input
                  aria-label={`${row.label}: hasta`}
                  inputMode="numeric"
                  value={limit == null ? "" : String(limit)}
                  disabled={!enabled}
                  placeholder="Ilimitado"
                  aria-describedby={hintId}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setCol(row.limitCol, digits === "" ? null : Number(digits));
                  }}
                  className="h-11 w-28 rounded border border-outline-variant bg-surface-container-lowest px-3 text-[14px] text-on-surface outline-none placeholder:text-on-surface-variant focus:border-tertiary-accent focus-visible:ring-2 focus-visible:ring-tertiary-accent/30 disabled:cursor-not-allowed disabled:bg-surface-container-low"
                />
              </span>
              <span id={hintId} className="mt-1 block text-[11.5px] text-on-surface-variant">
                Vacío = ilimitado, 0 = nada
              </span>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export function PlanFeaturesTab({ form, setForm, catalog, groups, base }) {
  const grouped = useMemo(() => groupRows(featureRows(catalog), groups), [catalog, groups]);
  const setCol = (col, value) => setForm((f) => ({ ...f, cols: { ...f.cols, [col]: value } }));

  if (!grouped.length) {
    return <p className="text-[13.5px] text-on-surface-variant">El catálogo de funciones está vacío. Revisa que el servidor tenga las funciones sembradas.</p>;
  }

  return (
    <div>
      <p className="mb-4 rounded-xl bg-surface-container-low px-3.5 py-3 text-[12.5px] leading-relaxed text-on-surface">
        Lo que marques aquí es lo que el sistema aplica de verdad a las tiendas de este plan y lo que se anuncia en la página de planes.
        {base.isDefault ? " Este es el plan por defecto: estos límites también valen cuando una tienda termina su prueba gratis o baja de plan. Los productos que pasen del límite quedan ocultos, nunca se borran." : ""}
      </p>
      {grouped.map(({ group, rows }) => (
        <section key={group} className="mb-6" aria-labelledby={`plan-group-${group}`}>
          <h3 id={`plan-group-${group}`} className="mb-2 text-[14px] font-bold text-on-surface">
            {group}
          </h3>
          <ul className="grid gap-2">
            {rows.map((row) => (
              <FeatureRow key={row.key} row={row} form={form} setCol={setCol} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
