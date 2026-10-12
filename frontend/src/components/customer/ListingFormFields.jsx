import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

// Piezas del formulario de venta rápida: estado del artículo, palabras clave y precios por cantidad.

export const CONDITIONS = [
  { id: "NEW", label: "Nuevo" },
  { id: "USED", label: "Usado" },
  { id: "REFURBISHED", label: "Reacondicionado" },
];
export const conditionLabel = (id) => CONDITIONS.find((c) => c.id === id)?.label ?? null;

const chip = (active) =>
  `min-h-10 rounded-full border px-3.5 text-[13px] font-semibold ${active ? "border-primary-container bg-primary-container text-white" : "border-outline-variant text-on-surface-variant"}`;

export function ConditionPicker({ value, onChange }) {
  return (
    <div>
      <span className="mb-1.5 block text-label-md text-on-surface-variant">Estado del artículo</span>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Estado del artículo">
        {CONDITIONS.map((c) => (
          <button key={c.id} type="button" aria-pressed={value === c.id} onClick={() => onChange(value === c.id ? "" : c.id)} className={chip(value === c.id)}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TagsInput({ value, onChange, max = 8 }) {
  const [draft, setDraft] = useState("");
  function add(raw) {
    const t = raw.trim().toLowerCase().replace(/^#/, "").slice(0, 24);
    if (t.length < 2 || value.includes(t) || value.length >= max) return;
    onChange([...value, t]);
    setDraft("");
  }
  return (
    <div>
      <label htmlFor="listing-tags" className="mb-1 block text-label-md text-on-surface-variant">
        Palabras clave <span className="font-normal text-outline">({value.length}/{max})</span>
      </label>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-tertiary-accent/10 py-1 pl-3 pr-1.5 text-[12.5px] font-semibold text-tertiary-accent">
            {t}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Quitar ${t}`} className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-tertiary-accent/15">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        id="listing-tags"
        value={draft}
        disabled={value.length >= max}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder="Escribe una palabra y pulsa Enter (ej.: laptop, dell, i5)"
        className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none focus:border-primary-container disabled:opacity-60"
      />
    </div>
  );
}

// Precio por cantidad: "a partir de N unidades, X c/u". Cada fila baja el precio respecto a la anterior y al precio por unidad.
export function PriceTiersEditor({ value, onChange, unitPrice, currency, max = 3 }) {
  const update = (i, patch) => onChange(value.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  return (
    <div>
      <span className="mb-1 block text-label-md text-on-surface-variant">Precio por más de una unidad (opcional)</span>
      {value.length === 0 && <p className="mb-2 text-label-sm text-outline">Si vendes varias unidades, puedes bajar el precio al llevar más. Ejemplo: a partir de 3 unidades, 150 c/u.</p>}
      <ul className="flex flex-col gap-2">
        {value.map((t, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="text-[12.5px] text-on-surface-variant">Desde</span>
            <input type="number" min={2} inputMode="numeric" aria-label="Cantidad mínima" value={t.minQty} onChange={(e) => update(i, { minQty: e.target.value })} className="h-11 w-20 rounded border border-outline-variant bg-surface-container-lowest px-3 text-body-md outline-none focus:border-primary-container" />
            <span className="text-[12.5px] text-on-surface-variant">uds.:</span>
            <input type="number" min={1} inputMode="decimal" aria-label="Precio por unidad desde esa cantidad" value={t.price} onChange={(e) => update(i, { price: e.target.value })} className="h-11 min-w-0 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3 text-body-md outline-none focus:border-primary-container" />
            <span className="text-[12.5px] text-on-surface-variant">{currency} c/u</span>
            <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} aria-label="Quitar este precio" className="flex h-10 w-10 flex-shrink-0 items-center justify-center text-error">
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      {value.length < max && (
        <button
          type="button"
          onClick={() => onChange([...value, { minQty: value.length ? Number(value[value.length - 1].minQty || 1) + 2 : 2, price: "" }])}
          className="mt-2 inline-flex min-h-10 items-center gap-1.5 text-[13px] font-bold text-tertiary-accent"
        >
          <Plus className="h-4 w-4" /> Agregar precio por cantidad
        </button>
      )}
      {unitPrice > 0 && value.some((t) => Number(t.price) >= unitPrice) && <p className="mt-1 text-label-sm text-error">Cada precio por cantidad debe ser menor que el precio por unidad.</p>}
    </div>
  );
}
