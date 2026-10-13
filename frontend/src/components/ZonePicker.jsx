import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, ChevronDown, X } from "lucide-react";
import { useZone } from "../context/LocationContext.jsx";

// "¿Dónde quieres comprar?": país, luego provincia o estado, luego municipio. Cada paso se habilita al elegir el anterior y
// solo lista lugares donde hay tiendas (con cuántas). Si se elige solo la provincia, se ven las tiendas de todos sus
// municipios. Lo elegido vale para todo el sitio (ver LocationContext).

const selectClass =
  "h-12 w-full appearance-none rounded-xl border border-outline-variant bg-surface-container-lowest pl-3.5 pr-10 text-[14px] font-semibold text-on-surface outline-none focus:border-tertiary-accent focus:ring-2 focus:ring-tertiary-accent/25 disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-outline";

function Field({ label, hint, children, id }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-bold text-on-surface-variant">{label}</label>
      <div className="relative">
        {children}
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" aria-hidden="true" />
      </div>
      {hint && <p className="mt-1 text-[11.5px] text-outline">{hint}</p>}
    </div>
  );
}

const plural = (n) => `${n} ${n === 1 ? "tienda" : "tiendas"}`;

export function ZoneDialog({ onClose, welcome = false }) {
  const { countries, provinces, municipalities, countryId, provinceId, municipalityId, setCountry, setProvince, setMunicipality, clearFilter, hasZoneFilter } = useZone();
  const uid = useId();
  const first = useRef(null);
  const allStates = provinces.length > 0 && provinces.every((p) => p.type === "STATE");
  const allProvinces = provinces.length > 0 && provinces.every((p) => p.type !== "STATE");
  const level1 = allStates ? "Estado" : allProvinces ? "Provincia" : "Provincia o estado";
  // Cada paso solo aparece cuando hay tiendas registradas en él: sin provincias o estados con tiendas no hay segundo
  // campo, y sin municipios con tiendas no hay tercero. Antes de elegir país se ve el campo genérico, apagado.
  const showLevel1 = !countryId || provinces.length > 0;
  const showLevel2 = !!provinceId && municipalities.length > 0;

  useEffect(() => {
    first.current?.focus();
    const onKey = (e) => e.key === "Escape" && !welcome && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, welcome]);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-inverse-surface/50 sm:items-center sm:p-4" onClick={welcome ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-t`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl bg-surface-container-lowest p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-2xl"
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 id={`${uid}-t`} className="font-display text-[20px] font-extrabold text-on-surface">{welcome ? "¿Dónde quieres recibir o recoger tus pedidos?" : "¿Dónde quieres comprar?"}</h2>
          {!welcome && (
            <button type="button" onClick={onClose} aria-label="Cerrar" className="-mr-2 -mt-1 flex h-11 w-11 items-center justify-center text-outline hover:text-on-surface">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <p className="mb-4 text-[13px] text-on-surface-variant">
          {welcome
            ? "Elige el lugar de entrega o recogida y te mostramos solo los productos, tiendas y anuncios de ahí. Lo recordaremos para tu próxima visita y puedes cambiarlo cuando quieras."
            : "Solo verás productos, tiendas y anuncios de ese lugar. Puedes cambiarlo cuando quieras."}
        </p>

        {countries.length === 0 ? (
          <p className="rounded-xl bg-surface-container p-4 text-[13px] text-on-surface-variant">Todavía no hay tiendas registradas en ningún lugar.</p>
        ) : (
          <div className="flex flex-col gap-3.5">
            <Field label="País" id={`${uid}-c`}>
              <select id={`${uid}-c`} ref={first} value={countryId ?? ""} onChange={(e) => setCountry(e.target.value)} className={selectClass}>
                <option value="">Todos los países</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} · {plural(c.count)}</option>
                ))}
              </select>
            </Field>

            {showLevel1 && (
              <Field label={countryId ? level1 : "Provincia o estado"} id={`${uid}-p`} hint={!countryId ? "Elige un país primero." : undefined}>
                <select id={`${uid}-p`} value={provinceId ?? ""} disabled={!countryId} onChange={(e) => setProvince(e.target.value)} className={selectClass}>
                  <option value="">{allStates ? "Todos los estados" : allProvinces ? "Todas las provincias" : "Todas"}</option>
                  {provinces.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} · {plural(p.count)}</option>
                  ))}
                </select>
              </Field>
            )}

            {showLevel2 && (
              <Field label="Municipio" id={`${uid}-m`} hint="Déjalo en “Todos” para ver toda la provincia o el estado.">
                <select id={`${uid}-m`} value={municipalityId ?? ""} onChange={(e) => setMunicipality(e.target.value)} className={selectClass}>
                  <option value="">Todos los municipios</option>
                  {municipalities.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} · {plural(m.count)}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => {
              clearFilter();
              if (welcome) onClose();
            }}
            disabled={!welcome && !hasZoneFilter}
            className="min-h-12 rounded-xl border border-outline-variant text-[14px] font-bold text-on-surface-variant hover:bg-surface-container disabled:opacity-45"
          >
            {welcome ? "Ver todo por ahora" : "Ver todo"}
          </button>
          <button type="button" onClick={onClose} disabled={welcome && !countryId} className="min-h-12 rounded-xl bg-secondary text-[14px] font-bold text-white hover:brightness-95 disabled:opacity-45">
            {welcome ? "Mostrar mi zona" : "Listo"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Botón con el lugar actual que abre el selector. `className` permite ajustarlo al lugar donde se use.
export function ZoneChip({ className = "" }) {
  const { zoneLabel, hasZoneFilter, loading } = useZone();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={`inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border px-4 text-[13.5px] font-semibold transition-colors ${
          hasZoneFilter ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent" : "border-outline-variant bg-surface-container-lowest text-on-surface hover:border-tertiary-accent"
        } ${className}`}
      >
        <MapPin className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span className="truncate">{loading ? "Cargando lugares..." : hasZoneFilter ? zoneLabel : "¿Dónde quieres comprar?"}</span>
        <ChevronDown className="h-4 w-4 flex-shrink-0 opacity-70" aria-hidden="true" />
      </button>
      {open && <ZoneDialog onClose={() => setOpen(false)} />}
    </>
  );
}
