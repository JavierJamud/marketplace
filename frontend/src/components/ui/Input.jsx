import clsx from "clsx";
import { forwardRef } from "react";

// Bloque 115 (pedido explícito): marca visualmente los campos obligatorios
// (antes solo el atributo `required` nativo, invisible hasta que fallaba el
// submit) — un asterisco junto al label, en el ÚNICO lugar donde se arma el
// label de Input/Select/PasswordInput/PhoneInput, así queda consistente en
// todo el sitio sin tocar cada formulario uno por uno.
export const Input = forwardRef(function Input({ label, error, required, className, ...props }, ref) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1 block text-label-md text-on-surface-variant">
          {label}
          {required && <span className="text-error"> *</span>}
        </span>
      )}
      <input
        required={required}
        ref={ref}
        className={clsx(
          "w-full rounded border border-outline-variant bg-surface-container-lowest px-4 py-2.5 text-body-md text-on-surface outline-none transition-colors",
          "focus:border-primary-container placeholder:text-outline",
          error && "border-error",
          className
        )}
        {...props}
      />
      {error && <span className="mt-1 block text-label-sm text-error">{error}</span>}
    </label>
  );
});
