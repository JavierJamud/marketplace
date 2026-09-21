import { useEffect, useRef, useState } from "react";
import { getCountryOptions, toE164, splitE164 } from "../../lib/phone.js";

// Selector de país (Cuba/EE.UU./México primero) + input de teléfono local.
// El valor expuesto vía onChange siempre es E.164 completo (+5355512345),
// listo para guardar y para armar links wa.me/... sin transformación aparte.
// onCountryChange (opcional) recibe el ISO del país elegido — es el mismo
// selector que pide el registro como "país" (Bloque 9), no uno duplicado.
export function PhoneInput({ label, value, onChange, onCountryChange, required, placeholder, error }) {
  const options = getCountryOptions();
  const initial = splitE164(value);
  const [country, setCountry] = useState(initial.country);
  const [national, setNational] = useState(initial.national);
  // Recuerda el último E.164 que ESTE componente emitió, para distinguir
  // "value cambió porque el padre recién cargó datos reales de forma async"
  // (hay que re-sincronizar) de "value cambió porque yo mismo lo acabo de
  // emitir" (no re-sincronizar, o se pisa lo que el usuario está tipeando).
  const lastEmitted = useRef(value);

  // Avisa el país inicial una sola vez al montar, así el form del padre
  // arranca en sync con el default ("CU") sin que el usuario tenga que
  // tocar el selector.
  useEffect(() => {
    onCountryChange?.(initial.country);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cubre el caso de VendorSettings.jsx/Checkout.jsx: el form arranca en ""
  // y recién después de un fetch asíncrono (/vendors/me, /customers/me) el
  // padre pasa el valor real — useState(initial) ya pasó, así que sin este
  // effect el campo se queda vacío para siempre aunque sí haya un teléfono guardado.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const parsed = splitE164(value);
    setCountry(parsed.country);
    setNational(parsed.national);
    lastEmitted.current = value;
  }, [value]);

  function handleCountryChange(nextCountry) {
    setCountry(nextCountry);
    const next = toE164(nextCountry, national);
    lastEmitted.current = next;
    onChange(next);
    onCountryChange?.(nextCountry);
  }

  function handleNationalChange(nextNational) {
    setNational(nextNational);
    const next = toE164(country, nextNational);
    lastEmitted.current = next;
    onChange(next);
  }

  const callingCode = options.find((c) => c.code === country)?.callingCode ?? "";

  // Bloque 114 (pedido explícito): país + código + número, en UN solo
  // contenedor con un único borde (antes eran 3 cajas separadas) — se ve y
  // se comporta como un solo campo, no tres.
  // Bloque 115 (pedido explícito): ver Input.jsx — mismo asterisco de
  // obligatorio, mismo criterio.
  return (
    <div className="block">
      {label && (
        <span className="mb-1 block text-label-md text-on-surface-variant">
          {label}
          {required && <span className="text-error"> *</span>}
        </span>
      )}
      <div
        className={`flex items-stretch overflow-hidden rounded border bg-surface-container-lowest focus-within:border-primary-container ${error ? "border-error" : "border-outline-variant"}`}
      >
        <select
          required={required}
          value={country}
          onChange={(e) => handleCountryChange(e.target.value)}
          aria-label="País"
          className="max-w-[6.5rem] shrink-0 border-r border-outline-variant bg-transparent px-2 py-2.5 text-body-md text-on-surface outline-none sm:max-w-[9rem]"
        >
          {options.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="flex shrink-0 select-none items-center border-r border-outline-variant px-2 text-body-md text-on-surface-variant">
          +{callingCode}
        </span>
        <input
          required={required}
          value={national}
          onChange={(e) => handleNationalChange(e.target.value)}
          placeholder={placeholder ?? "5XXXXXXX"}
          aria-label="Número"
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-body-md text-on-surface outline-none"
        />
      </div>
    </div>
  );
}
