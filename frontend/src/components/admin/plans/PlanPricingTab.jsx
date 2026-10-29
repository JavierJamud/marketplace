import { useId } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "../../ui/Input.jsx";

const FIELD =
  "h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-[14px] text-on-surface outline-none focus:border-tertiary-accent focus-visible:ring-2 focus-visible:ring-tertiary-accent/30";

// Descuentos por pagar varios meses juntos: una fila por escalón (meses, % en CUP, % en USD).
function DiscountEditor({ rows, onChange }) {
  const set = (i, key, value) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  return (
    <div>
      {rows.length > 0 && (
        <div className="mb-1 grid grid-cols-[1fr_1fr_1fr_44px] gap-2 text-[11.5px] font-semibold text-on-surface-variant">
          <span>Desde (meses)</span>
          <span>Desc. CUP (%)</span>
          <span>Desc. USD (%)</span>
          <span />
        </div>
      )}
      {rows.map((r, i) => (
        <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_1fr_44px] items-center gap-2">
          <input aria-label={`Meses del descuento ${i + 1}`} inputMode="numeric" placeholder="2 a 24" value={r.months} onChange={(e) => set(i, "months", e.target.value.replace(/\D/g, "").slice(0, 2))} className={FIELD} />
          <input aria-label={`Descuento en CUP ${i + 1}`} inputMode="numeric" value={r.cup} onChange={(e) => set(i, "cup", e.target.value.replace(/\D/g, "").slice(0, 2))} className={FIELD} />
          <input aria-label={`Descuento en USD ${i + 1}`} inputMode="numeric" value={r.usd} onChange={(e) => set(i, "usd", e.target.value.replace(/\D/g, "").slice(0, 2))} className={FIELD} />
          <button
            type="button"
            aria-label={`Quitar el descuento ${i + 1}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-tertiary-accent"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      {rows.length < 6 && (
        <button
          type="button"
          onClick={() => onChange([...rows, { months: "", cup: "", usd: "" }])}
          className="flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-[13px] font-bold text-tertiary-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-tertiary-accent"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> Agregar descuento
        </button>
      )}
      <p className="mt-1 text-[12px] text-on-surface-variant">Se aplica el escalón más alto alcanzado: con descuentos en 3, 6 y 12 meses, quien paga 8 meses recibe el de 6.</p>
    </div>
  );
}

function Section({ title, children, hint }) {
  return (
    <section className="mb-6">
      <h3 className="text-[14px] font-bold text-on-surface">{title}</h3>
      {hint && <p className="mt-0.5 text-[12.5px] text-on-surface-variant">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function CheckCard({ checked, onChange, label, hint, disabled }) {
  const hintId = useId();
  return (
    <label className={`flex min-h-11 items-start gap-2.5 rounded-xl border p-3 ${checked ? "border-tertiary-accent bg-tertiary-accent/[0.05]" : "border-outline-variant"} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={hintId} className="mt-0.5 h-5 w-5 flex-shrink-0 accent-tertiary-accent" />
      <span>
        <span className="block text-[13.5px] font-semibold text-on-surface">{label}</span>
        <span id={hintId} className="block text-[12px] leading-snug text-on-surface-variant">
          {hint}
        </span>
      </span>
    </label>
  );
}

// Papel del plan (por defecto o de prueba). La bandera solo se enciende: se mueve desde el plan que la tenía.
function RoleBox({ active, wasActive, currentHolder, title, activeText, offerText, buttonLabel, onSet, onUndo }) {
  return (
    <div className={`rounded-xl border p-3.5 ${active ? "border-primary/30 bg-primary/[0.04]" : "border-outline-variant"}`}>
      <p className="text-[13.5px] font-bold text-on-surface">{title}</p>
      {wasActive ? (
        <p className="mt-1 text-[12.5px] text-on-surface-variant">{activeText}</p>
      ) : active ? (
        <div className="mt-1">
          <p className="text-[12.5px] text-on-surface">
            Al guardar, este pasa a ser el {title.toLowerCase()}
            {currentHolder ? ` y ${currentHolder} deja de serlo.` : "."}
          </p>
          <button type="button" onClick={onUndo} className="mt-1 min-h-11 rounded-lg px-1 text-[13px] font-bold text-tertiary-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-tertiary-accent">
            Deshacer
          </button>
        </div>
      ) : (
        <div className="mt-1">
          <p className="text-[12.5px] text-on-surface-variant">
            {offerText}
            {currentHolder ? ` Hoy lo es ${currentHolder}.` : ""}
          </p>
          <button
            type="button"
            onClick={onSet}
            className="mt-2 inline-flex min-h-11 items-center rounded-xl border border-outline-variant px-4 text-[13px] font-bold text-on-surface hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-tertiary-accent"
          >
            {buttonLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export function PlanPricingTab({ form, setForm, base, errors, plans, vendorCount }) {
  const patch = (changes) => setForm((f) => ({ ...f, ...changes }));
  const set = (key) => (e) => patch({ [key]: e.target.value });
  const goingPaid = base.isFree && !form.isFree && !form.contactOnly;
  const charged = !form.isFree && !form.contactOnly;
  const usdChanged = charged && Number(String(form.priceUsd).replace(",", ".")) !== Number(base.priceUsd ?? 0);
  const defaultHolder = plans.find((p) => p.isDefault && p.planType !== base.planType)?.displayName;
  const trialHolder = plans.find((p) => p.isTrialPlan && p.planType !== base.planType)?.displayName;

  return (
    <div>
      <Section title="Nombre y orden">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
          <Input label="Nombre visible del plan" value={form.displayName} maxLength={40} onChange={set("displayName")} error={errors.displayName} />
          <Input
            label="Orden"
            inputMode="numeric"
            value={form.sortOrder}
            error={errors.sortOrder}
            onChange={(e) => patch({ sortOrder: e.target.value.replace(/\D/g, "").slice(0, 3) })}
          />
        </div>
        <div className="mt-3">
          <Input label="Frase corta (página de planes)" value={form.tagline} maxLength={90} onChange={set("tagline")} placeholder="Ej.: Para empezar a vender en línea" error={errors.tagline} />
        </div>
        <p className="mt-1.5 text-[12px] text-on-surface-variant">Los planes se muestran de menor a mayor orden, aquí y en la página de planes.</p>
      </Section>

      <Section title="Cómo se vende">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <CheckCard
            checked={form.isFree}
            onChange={(v) => patch({ isFree: v, ...(v ? { contactOnly: false } : {}) })}
            label="Gratis por ahora"
            hint="Se muestra el precio tachado, si lo pones. Al apagarlo, el plan empieza a cobrarse y se avisa a sus tiendas."
          />
          <CheckCard
            checked={form.contactOnly}
            onChange={(v) => patch({ contactOnly: v, ...(v ? { isFree: false } : {}) })}
            label="Se contrata por WhatsApp"
            hint="Sin precio publicado: el botón abre el WhatsApp de soporte y el plan se activa a mano."
          />
          <CheckCard checked={form.highlighted} onChange={(v) => patch({ highlighted: v })} label="Destacado como el más elegido" hint="Solo un plan a la vez: al marcar este se quita del otro." />
          <CheckCard
            checked={form.grantsBadge}
            onChange={(v) => patch({ grantsBadge: v })}
            label="Da la insignia de verificada"
            hint="Sus tiendas pasan la verificación de documentos. Chat con IA, ofertas de tienda, destacada en la portada, fotos en reseñas y chat con el equipo solo funcionan con la insignia."
          />
          <CheckCard
            checked={form.isPublic}
            onChange={(v) => patch({ isPublic: v })}
            label="Se muestra en la página de planes"
            hint="Apágalo para ocultar el plan sin archivarlo. Las tiendas que ya lo tienen lo conservan."
          />
        </div>
        {errors.sale && <p className="mt-2 text-[12.5px] font-semibold text-error">{errors.sale}</p>}
      </Section>

      {!form.contactOnly && (
        <Section title="Precio al mes" hint={form.isFree ? "Mientras sea gratis, el precio tachado se muestra como referencia." : "La tienda paga en CUP por transferencia o en USD con tarjeta."}>
          <div className="grid grid-cols-2 gap-3">
            {!form.isFree && (
              <>
                <label className="block">
                  <span className="mb-1 block text-[12.5px] font-semibold text-on-surface-variant">Precio (CUP)</span>
                  <input inputMode="numeric" value={form.priceCup} onChange={(e) => patch({ priceCup: e.target.value.replace(/\D/g, "").slice(0, 8) })} className={FIELD} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12.5px] font-semibold text-on-surface-variant">Precio (USD)</span>
                  <input inputMode="decimal" value={form.priceUsd} onChange={(e) => patch({ priceUsd: e.target.value.replace(/[^\d.,]/g, "").slice(0, 9) })} className={FIELD} />
                </label>
              </>
            )}
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-semibold text-on-surface-variant">Precio tachado (CUP)</span>
              <input inputMode="numeric" value={form.listPriceCup} placeholder="Sin tachado" onChange={(e) => patch({ listPriceCup: e.target.value.replace(/\D/g, "").slice(0, 8) })} className={FIELD} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-semibold text-on-surface-variant">Precio tachado (USD)</span>
              <input inputMode="decimal" value={form.listPriceUsd} placeholder="Sin tachado" onChange={(e) => patch({ listPriceUsd: e.target.value.replace(/[^\d.,]/g, "").slice(0, 9) })} className={FIELD} />
            </label>
          </div>
          {errors.price && <p className="mt-2 text-[12.5px] font-semibold text-error">{errors.price}</p>}
          {usdChanged && !base.isFree && (
            <p className="mt-2 rounded-lg bg-surface-container-low px-3 py-2 text-[12.5px] text-on-surface">
              Las suscripciones con tarjeta que ya existen siguen cobrando el precio con el que se crearon. El precio nuevo vale para las suscripciones nuevas y para los pagos por transferencia.
            </p>
          )}
          {/* El cobro con aviso (startBillingForFreePlan) solo arranca en planes sin insignia (billedWithoutBadge en el
              servidor). En uno con insignia, cada tienda paga al renovar su verificación. */}
          {goingPaid && !form.grantsBadge && (
            <p className="mt-2 rounded-lg bg-secondary-container/20 px-3 py-2 text-[12.5px] text-on-surface">
              Al guardar, este plan empieza a cobrarse.{" "}
              {vendorCount != null ? `Se avisa a ${vendorCount === 1 ? "la tienda" : `las ${vendorCount} tiendas`} de este plan` : "Se avisa a sus tiendas"} para que paguen antes de su fecha de cobro mensual
              (contada desde que se registraron). Si no pagan, pasan a modo limitado y luego a suspendidas, según los días que configures.
            </p>
          )}
          {goingPaid && form.grantsBadge && (
            <p className="mt-2 rounded-lg bg-secondary-container/20 px-3 py-2 text-[12.5px] text-on-surface">
              Al guardar, este plan empieza a cobrarse. Como da la insignia, sus tiendas no reciben un aviso de cobro ahora: conservan el plan hasta que venza el
              tiempo que tienen y, para seguir en él, tendrán que pagarlo.
            </p>
          )}
          {charged && (
            <div className="mt-5">
              <h4 className="mb-2 text-[13px] font-bold text-on-surface">Descuentos por pagar varios meses</h4>
              <DiscountEditor rows={form.monthDiscounts} onChange={(monthDiscounts) => patch({ monthDiscounts })} />
              {errors.discounts && <p className="mt-1 text-[12.5px] font-semibold text-error">{errors.discounts}</p>}
            </div>
          )}
        </Section>
      )}

      <Section title="Papel del plan" hint="Cada uno lo tiene un solo plan. Para quitárselo a este, dáselo a otro plan desde su ventana Configurar.">
        <div className="grid gap-2">
          <RoleBox
            title="Plan por defecto"
            active={form.isDefault}
            wasActive={!!base.isDefault}
            currentHolder={defaultHolder}
            activeText="Aquí se registran las tiendas nuevas y aquí pasan las que bajan de plan o terminan la prueba gratis sin pagar."
            offerText="Es el plan de registro y de bajada: las tiendas nuevas empiezan aquí."
            buttonLabel="Usar como plan por defecto"
            onSet={() => patch({ isDefault: true })}
            onUndo={() => patch({ isDefault: false })}
          />
          <RoleBox
            title="Plan de prueba"
            active={form.isTrialPlan}
            wasActive={!!base.isTrialPlan}
            currentHolder={trialHolder}
            activeText="Las pruebas gratis usan este plan durante los días configurados en Datos de pago de la suscripción."
            offerText="Es el plan que reciben las tiendas durante la prueba gratis."
            buttonLabel="Usar como plan de prueba"
            onSet={() => patch({ isTrialPlan: true })}
            onUndo={() => patch({ isTrialPlan: false })}
          />
        </div>
        {errors.role && <p className="mt-2 text-[12.5px] font-semibold text-error">{errors.role}</p>}
      </Section>
    </div>
  );
}
