import { useEffect, useMemo, useRef, useState } from "react";
import { isValidPhoneNumber, parsePhoneNumberFromString, getCountryCallingCode, getCountries } from "libphonenumber-js";
import { ComboSelect } from "./ComboSelect.jsx";
import { Flag } from "./Flag.jsx";
import { usePhoneCountries } from "../../lib/usePhoneCountries.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { splitE164, toE164 } from "../../lib/phone.js";

// Teléfono en dos campos: arriba el país (con su bandera) y debajo el número. El código de marcado del país se pone solo, se ve
// delante del número y no se puede editar. Solo se ofrecen los países que el administrador habilitó en su panel; si el del
// cliente no está, se le explica cómo pedir que lo activen. El valor que sale por onChange siempre es E.164 completo
// (+5355512345), listo para guardar y para armar enlaces wa.me sin transformar.
// onCountryChange (opcional) recibe el código ISO del país elegido (el registro lo guarda junto al teléfono).
// anyCountry: acepta números de cualquier país del mundo, no solo los habilitados (contacto de quien compra en el checkout:
// puede estar fuera del país de la tienda).
const PRIORITY = ["CU", "US", "MX", "ES"];
function allCountries() {
  let names;
  try {
    names = new Intl.DisplayNames(["es"], { type: "region" });
  } catch {
    names = null;
  }
  return getCountries()
    .map((code) => ({ code, name: names?.of(code) ?? code, callingCode: getCountryCallingCode(code) }))
    .sort((a, b) => {
      const pa = PRIORITY.indexOf(a.code);
      const pb = PRIORITY.indexOf(b.code);
      if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
      return a.name.localeCompare(b.name, "es");
    });
}

export function PhoneInput({ label, value, onChange, onCountryChange, required, placeholder, error, hideMissingCountryHelp = false, anyCountry = false }) {
  const enabled = usePhoneCountries();
  const world = useMemo(() => (anyCountry ? allCountries() : null), [anyCountry]);
  const countries = world ?? enabled.countries;
  const isLoading = world ? false : enabled.isLoading;
  const isError = world ? false : enabled.isError;
  const { siteName, supportWhatsapp } = usePlatformSettings();
  const initial = splitE164(value);
  const [country, setCountry] = useState(initial.country);
  const [national, setNational] = useState(initial.national);
  // Último E.164 que ESTE componente emitió: distingue "el padre cargó datos reales de forma asíncrona" (hay que resincronizar)
  // de "yo mismo lo acabo de emitir" (no resincronizar, o se pisa lo que la persona está escribiendo).
  const lastEmitted = useRef(value);
  const announced = useRef(false);

  // Si el valor llega después (perfil que se carga por red), se refleja en los campos.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const parsed = splitE164(value);
    setCountry(parsed.country);
    setNational(parsed.nationalNumber ?? parsed.national);
    lastEmitted.current = value;
  }, [value]);

  // Opciones: los países habilitados y, si el número guardado es de otro país, ese también, para no mostrar un campo vacío.
  const options = useMemo(() => {
    const list = countries.map((c) => ({ value: c.code, label: c.name, icon: <Flag code={c.code} />, callingCode: c.callingCode }));
    if (country && !list.some((o) => o.value === country)) {
      try {
        list.unshift({ value: country, label: country, icon: <Flag code={country} />, callingCode: getCountryCallingCode(country) });
      } catch {
        /* código desconocido: no se agrega */
      }
    }
    return list;
  }, [countries, country]);

  // Sin un número guardado, el país inicial es el primero habilitado (Cuba si lo está). Se avisa al padre una sola vez.
  useEffect(() => {
    if (!options.length) return;
    if (!value && !options.some((o) => o.value === country)) {
      setCountry(options[0].value);
      onCountryChange?.(options[0].value);
      announced.current = true;
      return;
    }
    if (!announced.current) {
      announced.current = true;
      onCountryChange?.(country);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.length]);

  const callingCode = options.find((o) => o.value === country)?.callingCode ?? "";
  const maxDigits = Math.max(4, 15 - callingCode.length);

  function emit(nextCountry, nextNational) {
    const next = toE164(nextCountry, nextNational);
    lastEmitted.current = next;
    onChange(next);
  }

  function handleCountry(next) {
    if (!next) return;
    setCountry(next);
    emit(next, national);
    onCountryChange?.(next);
  }

  function handleNational(raw) {
    // Un número pegado completo (con +): se reconoce el país y se separa el código, siempre que ese país esté habilitado.
    if (raw.trim().startsWith("+")) {
      const parsed = parsePhoneNumberFromString(raw.trim());
      if (parsed?.country && options.some((o) => o.value === parsed.country)) {
        setCountry(parsed.country);
        setNational(parsed.nationalNumber);
        emit(parsed.country, parsed.nationalNumber);
        onCountryChange?.(parsed.country);
        return;
      }
    }
    const digits = raw.replace(/\D/g, "").slice(0, maxDigits);
    setNational(digits);
    emit(country, digits);
  }

  const looksInvalid = national.length >= 6 && callingCode && !isValidPhoneNumber(`+${callingCode}${national}`);
  const shownError = error || (looksInvalid ? "Revisa el número: no parece válido para este país." : undefined);
  const contactHref = `/contacto?mensaje=${encodeURIComponent(`Hola, quiero registrarme en ${siteName} y mi país no aparece en la lista. Les pido que lo activen. País: `)}`;
  const waHref = supportWhatsapp ? `https://wa.me/${supportWhatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Hola, mi país no aparece en la lista de ${siteName}. Quiero que lo activen. País: `)}` : null;

  return (
    <div className="space-y-2.5">
      <ComboSelect
        label="País"
        required={required}
        value={country}
        onChange={handleCountry}
        options={options}
        placeholder={isLoading ? "Cargando países..." : "Busca tu país"}
        emptyText="Ese país no está habilitado"
      />

      <div className="block">
        {label && (
          <span className="mb-1 block text-label-md text-on-surface-variant">
            {label}
            {required && <span className="text-error"> *</span>}
          </span>
        )}
        <div
          className={`flex items-stretch overflow-hidden rounded-xl border bg-surface-container-lowest focus-within:border-primary-container ${shownError ? "border-error" : "border-outline-variant"}`}
        >
          <span className="flex shrink-0 select-none items-center gap-2 border-r border-outline-variant bg-surface-container px-3 text-body-md font-semibold text-on-surface" aria-label={callingCode ? `Código del país: más ${callingCode}` : undefined}>
            {callingCode ? `+${callingCode}` : "+"}
          </span>
          <input
            required={required}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={national}
            onChange={(e) => handleNational(e.target.value)}
            placeholder={placeholder ?? "Número sin el código"}
            aria-label="Número de teléfono"
            className="min-h-11 min-w-0 flex-1 bg-transparent px-3 py-2.5 text-body-md text-on-surface outline-none"
          />
        </div>
        {shownError && <span className="mt-1 block text-label-sm text-error">{shownError}</span>}
      </div>

      {isError && <p className="text-label-sm text-error">No pudimos cargar la lista de países. Recarga la página.</p>}
      {!hideMissingCountryHelp && !anyCountry && !isError && (
        <p className="text-[12px] leading-[17px] text-on-surface-variant">
          ¿Tu país no está en la lista? Todavía no lo hemos habilitado: contacta a soporte para pedir que lo activen,{" "}
          <a href={contactHref} target="_blank" rel="noreferrer" className="font-semibold text-tertiary-accent underline">
            escríbenos desde Contacto
          </a>
          {waHref && (
            <>
              {" "}o por{" "}
              <a href={waHref} target="_blank" rel="noreferrer" className="font-semibold text-tertiary-accent underline">
                WhatsApp
              </a>
            </>
          )}
          .
        </p>
      )}
    </div>
  );
}
