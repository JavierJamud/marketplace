import { currencyOption } from "../../lib/catalog.js";
import { Link } from "react-router-dom";
import { Truck } from "lucide-react";
import { Input } from "../ui/Input.jsx";
import { Select } from "../ui/Select.jsx";

// Envío: lo comparten la configuración de la tienda (envío de toda la tienda) y el formulario de producto (envío de ese
// producto). La regla de cuál manda está en lib/shipping.js: con envío de tienda activo, el de cada producto se suspende.

// Precio fijo: uno para la provincia desde donde envía la tienda y otro para el resto, en la moneda que elija.
export function FixedFeeFields({ local, other, currency, currencies, onChange }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Input
        label="En tu provincia"
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        required
        value={local}
        onChange={(e) => onChange({ local: e.target.value })}
      />
      <Input
        label="Fuera de tu provincia"
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        required
        value={other}
        onChange={(e) => onChange({ other: e.target.value })}
      />
      <Select label="Moneda del envío" value={currency} onChange={(e) => onChange({ currency: e.target.value })}>
        {currencies.map((c) => (
          <option key={c} value={c}>
            {currencyOption(c)}
          </option>
        ))}
      </Select>
    </div>
  );
}

// Opción de radio grande (al menos 44 px de alto) con título y explicación.
export function ShippingChoice({ name, value, checked, onChange, title, sub }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 ${checked ? "border-tertiary-accent bg-tertiary-accent/5" : "border-outline-variant"}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} className="mt-1 h-4 w-4 accent-tertiary-accent" />
      <span>
        <span className="block text-[13.5px] font-semibold text-on-surface">{title}</span>
        <span className="block text-[12px] text-outline">{sub}</span>
      </span>
    </label>
  );
}

const STORE_CHOICES = [
  { value: "", title: "Cada producto define su envío", sub: "Por defecto los productos salen con envío gratis. En cada producto puedes poner un envío fijo o a coordinar." },
  { value: "FIXED", title: "Envío fijo para toda la tienda", sub: "Se cobra una sola vez por pedido, sin importar cuántos productos lleve." },
  { value: "COORDINATE", title: "Envío a coordinar con el cliente", sub: "No se cobra al pedir: lo acuerdas con el cliente según dónde lo reciba." },
];

// Tarjeta "Envío" de la configuración de la tienda. `form` guarda los valores como texto (inputs controlados).
export function StoreShippingCard({ form, setForm, vendor, currencies }) {
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  // La provincia desde donde envía se elige entre las provincias donde opera la tienda.
  const provinces = [];
  for (const l of vendor?.locations ?? []) {
    if (l.province && !provinces.some((p) => p.id === l.province.id)) provinces.push(l.province);
  }
  const usesStore = !!form.storeShippingMode;
  const wasPerProduct = !vendor?.storeShippingMode;

  return (
    <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
        <Truck className="h-5 w-5 text-tertiary-accent" aria-hidden="true" /> Envío
      </div>
      <p className="mb-4 text-[12.5px] text-outline">
        Elige cómo cobras el envío. Tu cliente lo ve en cada producto y en el resumen de su pedido, separado del precio de los productos.
      </p>

      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Cómo cobras el envío">
        {STORE_CHOICES.map((c) => (
          <ShippingChoice key={c.value || "product"} name="storeShippingMode" value={c.value} checked={(form.storeShippingMode ?? "") === c.value} onChange={(v) => set({ storeShippingMode: v })} title={c.title} sub={c.sub} />
        ))}
      </div>

      {usesStore && wasPerProduct && (
        <p className="mt-3 rounded-xl bg-secondary-container/20 p-3 text-[12.5px] text-on-surface">
          Al guardar, los envíos que hayas puesto en tus productos quedan suspendidos y se cobra solo el de la tienda. No se borran: si vuelves a
          "Cada producto define su envío", cada uno recupera el suyo.
        </p>
      )}

      {form.storeShippingMode === "FIXED" && (
        <div className="mt-4">
          <FixedFeeFields
            local={form.storeShippingLocal}
            other={form.storeShippingOther}
            currency={form.storeShippingCurrency}
            currencies={currencies}
            onChange={(p) =>
              set({
                ...(p.local !== undefined && { storeShippingLocal: p.local }),
                ...(p.other !== undefined && { storeShippingOther: p.other }),
                ...(p.currency !== undefined && { storeShippingCurrency: p.currency }),
              })
            }
          />
        </div>
      )}

      {/* "Tu provincia" de los precios fijos, de la tienda o de cada producto. */}
      {provinces.length > 1 && (
        <div className="mt-4 max-w-sm">
          <Select label="Provincia desde donde envías" value={form.shippingOriginProvinceId} onChange={(e) => set({ shippingOriginProvinceId: e.target.value })}>
            {provinces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[12px] text-outline">El precio "en tu provincia" vale para entregas en esta provincia; el resto cobra el de "fuera".</p>
        </div>
      )}
      {provinces.length === 1 && <p className="mt-3 text-[12px] text-outline">Tu provincia para el envío: {provinces[0].name}.</p>}
    </div>
  );
}

const money = (amount, currency) => `${Number(amount).toLocaleString("es-CU")} ${currency}`;

// Sección "Envío" del formulario de producto. Si la tienda tiene envío propio, queda bloqueada con el aviso (el envío del
// producto está suspendido, no borrado). Si no, el interruptor arranca apagado = envío gratis.
export function ProductShippingSection({ form, setForm, vendor, currencies }) {
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  if (vendor?.storeShippingMode) {
    const s = vendor.storeShippingMode;
    const detail =
      s === "FIXED"
        ? `envío fijo de ${money(vendor.storeShippingLocal, vendor.storeShippingCurrency)} en tu provincia y ${money(vendor.storeShippingOther, vendor.storeShippingCurrency)} fuera, una vez por pedido`
        : "envío a coordinar con el cliente";
    return (
      <div className="rounded-xl border border-outline-variant bg-surface-container-low p-3.5">
        <div className="flex items-center gap-2 text-[13.5px] font-bold text-on-surface">
          <Truck className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> Envío
        </div>
        <p className="mt-1 text-[12.5px] text-on-surface-variant">
          El envío lo define la configuración de tu tienda: {detail}. El envío propio de cada producto queda suspendido mientras esté activo.{" "}
          <Link to="/vendedor/configuracion" className="font-semibold text-tertiary-accent underline">
            Cambiarlo en Configuración
          </Link>
        </p>
      </div>
    );
  }
  const hasCost = form.shippingMode !== "FREE";
  return (
    <div className="rounded-xl border border-outline-variant p-3.5">
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
        <span>
          <span className="flex items-center gap-2 text-[13.5px] font-bold text-on-surface">
            <Truck className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> {hasCost ? "Este producto tiene costo de envío" : "Envío gratis"}
          </span>
          <span className="block text-[12px] text-outline">{hasCost ? "Elige si es un precio fijo o a coordinar." : "Actívalo si este producto cobra envío (por ejemplo, si es pesado)."}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-checked={hasCost}
          checked={hasCost}
          onChange={(e) => set({ shippingMode: e.target.checked ? "FIXED" : "FREE" })}
          className="h-5 w-9 flex-shrink-0 cursor-pointer accent-tertiary-accent"
        />
      </label>
      {hasCost && (
        <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label="Tipo de envío">
          <ShippingChoice name="productShippingMode" value="FIXED" checked={form.shippingMode === "FIXED"} onChange={(v) => set({ shippingMode: v })} title="Precio fijo" sub="Se suma al pedido, separado del precio del producto." />
          <ShippingChoice name="productShippingMode" value="COORDINATE" checked={form.shippingMode === "COORDINATE"} onChange={(v) => set({ shippingMode: v })} title="A coordinar" sub="No se cobra al pedir: lo acuerdas con el cliente según dónde lo reciba." />
        </div>
      )}
      {form.shippingMode === "FIXED" && (
        <div className="mt-3 flex flex-col gap-3">
          <FixedFeeFields
            local={form.shippingLocal}
            other={form.shippingOther}
            currency={form.shippingCurrency}
            currencies={currencies}
            onChange={(p) =>
              set({
                ...(p.local !== undefined && { shippingLocal: p.local }),
                ...(p.other !== undefined && { shippingOther: p.other }),
                ...(p.currency !== undefined && { shippingCurrency: p.currency }),
              })
            }
          />
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input type="checkbox" checked={form.shippingPerUnit} onChange={(e) => set({ shippingPerUnit: e.target.checked })} className="mt-1 h-4 w-4 accent-tertiary-accent" />
            <span>
              <span className="block text-[13.5px] font-semibold text-on-surface">Cobrar por cada unidad</span>
              <span className="block text-[12px] text-outline">Si el cliente lleva 3, el envío se cobra 3 veces. Desmarcado, se cobra una vez sin importar la cantidad.</span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
