import { useEffect, useRef } from "react";
import clsx from "clsx";

// Bloque 258 (pedido explícito — "en vez de un solo cuadro donde se insertan los
// números, un cuadro para cada número"): campo de código con una casilla por
// carácter. Comportamiento:
//  - Al escribir, el foco pasa solo a la siguiente casilla.
//  - Borrar en una casilla vacía vuelve a la anterior y borra su carácter.
//  - Flechas izquierda/derecha, Inicio y Fin mueven el foco.
//  - Pegar el código completo (o el autocompletado de SMS del teléfono, que
//    llega a la primera casilla con todos los dígitos) lo reparte en las casillas.
//  - El valor es un único string (`value`/`onChange`), sin huecos: se escribe
//    siempre de izquierda a derecha, igual que el campo único anterior.
// Accesibilidad: el grupo se anuncia con su etiqueta y cada casilla dice "Dígito
// N de M". La primera lleva autocomplete="one-time-code".
export function OtpInput({ label, required, value = "", onChange, length = 6, charset = "numeric", autoFocus = false, disabled = false, error, autoSubmit = false, onComplete }) {
  const refs = useRef([]);
  const previousLength = useRef(value.length);
  const numeric = charset === "numeric";
  const clean = (text) => (numeric ? text.replace(/\D/g, "") : text.replace(/[^a-zA-Z0-9]/g, "").toUpperCase());
  const chars = Array.from({ length }, (_, i) => value[i] ?? "");

  // Bloque 276 (pedido explícito — "al insertar el código el sistema lo valida solo, sin
  // hacer clic en el botón"): al completar el último dígito se avisa (`onComplete`) y, con
  // `autoSubmit`, se envía el formulario que contiene las casillas. Va en un setTimeout 0 para
  // que el valor ya esté guardado en el estado del formulario cuando se envía.
  function notifyComplete(next) {
    if (next.length !== length) return;
    setTimeout(() => {
      onComplete?.(next);
      if (autoSubmit) refs.current[length - 1]?.form?.requestSubmit();
    }, 0);
  }

  // Si el código se borró desde afuera (porque era incorrecto), el cursor vuelve a la primera casilla.
  useEffect(() => {
    if (previousLength.current === length && value.length === 0) refs.current[0]?.focus();
    previousLength.current = value.length;
  }, [value, length]);

  function focusAt(index) {
    const target = refs.current[Math.max(0, Math.min(length - 1, index))];
    target?.focus();
    target?.select();
  }

  // Escribe `text` desde la casilla `index` (una letra al teclear, varias al pegar
  // o al autocompletar). Nunca deja huecos: si la casilla está más allá del final,
  // el texto se agrega justo después del último carácter.
  function write(index, text) {
    const position = Math.min(index, value.length);
    const next = (value.slice(0, position) + text + value.slice(position + text.length)).slice(0, length);
    onChange(next);
    focusAt(position + text.length);
    notifyComplete(next);
  }

  function handleChange(index, raw) {
    const text = clean(raw);
    if (!text) {
      // Se vació la casilla: se quita ese carácter.
      if (index < value.length) onChange(value.slice(0, index) + value.slice(index + 1));
      return;
    }
    write(index, text);
  }

  function handleKeyDown(index, e) {
    if (e.key === "Backspace" && !chars[index] && index > 0) {
      e.preventDefault();
      onChange(value.slice(0, index - 1) + value.slice(index));
      focusAt(index - 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusAt(index - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusAt(index + 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusAt(length - 1);
    }
  }

  function handlePaste(index, e) {
    e.preventDefault();
    const text = clean(e.clipboardData.getData("text"));
    if (text) write(index, text);
  }

  const compact = length > 6;

  return (
    <div role="group" aria-label={label} className="block">
      {label && (
        <span className="mb-1.5 block text-label-md text-on-surface-variant">
          {label}
          {required && <span className="text-error"> *</span>}
        </span>
      )}
      <div className={clsx("flex", compact ? "gap-1" : "gap-1.5")}>
        {chars.map((char, i) => (
          <input
            key={i}
            ref={(el) => (refs.current[i] = el)}
            value={char}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={(e) => handlePaste(i, e)}
            onFocus={(e) => e.target.select()}
            inputMode={numeric ? "numeric" : "text"}
            autoComplete={i === 0 ? "one-time-code" : "off"}
            autoCapitalize={numeric ? undefined : "characters"}
            spellCheck={false}
            autoFocus={autoFocus && i === 0}
            disabled={disabled}
            aria-label={`Dígito ${i + 1} de ${length}`}
            aria-invalid={error ? true : undefined}
            className={clsx(
              "min-w-0 max-w-[3.5rem] flex-1 rounded-[6px] border bg-surface-container-lowest text-center font-bold text-on-surface outline-none transition-colors",
              compact ? "h-11 text-[18px] sm:h-12 sm:text-[19px]" : "h-12 text-[22px] sm:h-14 sm:text-[24px]",
              "focus:border-primary-container focus:ring-2 focus:ring-primary-container/30 disabled:opacity-50",
              error ? "border-error" : char ? "border-primary-container" : "border-outline-variant"
            )}
          />
        ))}
      </div>
      {error && <span className="mt-1 block text-label-sm text-error">{error}</span>}
    </div>
  );
}
