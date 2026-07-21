import { useEffect, useRef, useState } from "react";
import { getCountryOptions, toE164, splitE164 } from "../../lib/phone.js";

// Selector de país (Cuba/EE.UU./México primero) + input de teléfono local.
// El valor expuesto vía onChange siempre es E.164 completo (+5355512345),
// listo para guardar y para armar links wa.me/... sin transformación aparte.
// onCountryChange (opcional) recibe el ISO del país elegido — es el mismo
// selector que pide el registro como "país" (Bloque 9), no uno duplicado.
export function PhoneInput({ label, value, onChange, onCountryChange, required, placeholder }) {
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

  return (
    <div className="block">
      {label && <span className="mb-1 block text-label-md text-on-surface-variant">{label}</span>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_84px_1fr]">
        <label className="block">
          <span className="mb-1 block text-label-sm text-outline sm:hidden">País</span>
          <select
            required={required}
            value={country}
            onChange={(e) => handleCountryChange(e.target.value)}
            className="w-full rounded border border-outline-variant bg-surface-container-lowest px-2.5 py-2.5 text-body-md text-on-surface outline-none focus:border-primary-container"
          >
            {options.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-label-sm text-outline sm:hidden">Código</span>
          {/* Nunca editable a mano — solo reacciona a la selección de país. */}
          <input
            readOnly
            disabled
            tabIndex={-1}
            value={`+${callingCode}`}
            className="w-full cursor-not-allowed rounded border border-outline-variant bg-surface-container px-2.5 py-2.5 text-center text-body-md text-on-surface-variant outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-label-sm text-outline sm:hidden">Número</span>
          <input
            required={required}
            value={national}
            onChange={(e) => handleNationalChange(e.target.value)}
            placeholder={placeholder ?? "5XXXXXXX"}
            className="w-full rounded border border-outline-variant bg-surface-container-lowest px-4 py-2.5 text-body-md text-on-surface outline-none focus:border-primary-container"
          />
        </label>
      </div>
    </div>
  );
}
