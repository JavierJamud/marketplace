import clsx from "clsx";
import { forwardRef, useId } from "react";

// Bloque 115 (pedido explícito): marca visualmente los campos obligatorios
// (antes solo el atributo `required` nativo, invisible hasta que fallaba el
// submit) — un asterisco junto al label, en el ÚNICO lugar donde se arma el
// label de Input/Select/PasswordInput/PhoneInput, así queda consistente en
// todo el sitio sin tocar cada formulario uno por uno.
export const Input = forwardRef(function Input({ label, error, required, className, ...props }, ref) {
  // El error queda ligado al campo (aria-describedby y aria-invalid): el lector de pantalla lo anuncia al entrar al campo, en
  // vez de quedar como un texto rojo suelto debajo. Si quien usa el Input ya manda su propio aria-describedby, se suman.
  const errorId = useId();
  const describedBy = clsx(props["aria-describedby"], error && errorId) || undefined;
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
        // Correo: el teclado del celular pone mayúscula inicial y corrige la palabra, y eso hacía fallar el login
        // ("Juan@..." no es "juan@..."). El back ya normaliza, esto solo evita que la persona vea su correo cambiado.
        {...(props.type === "email" ? { autoCapitalize: "none", autoCorrect: "off", spellCheck: false } : {})}
        className={clsx(
          "w-full rounded border bg-surface-container-lowest px-4 py-2.5 text-body-md text-on-surface outline-none transition-colors placeholder:text-outline",
          // Foco: antes solo cambiaba el borde de 1px y outline-none quita el contorno naranja global, que sobre blanco no llega
          // a 3:1. El anillo de 1px del mismo color deja una línea de 2px bien visible; con error el foco sigue en rojo para no
          // esconder el aviso justo cuando la persona va a corregirlo.
          error
            ? "border-error focus:border-error focus:ring-1 focus:ring-error"
            : "border-outline-variant focus:border-primary-container focus:ring-1 focus:ring-primary-container",
          className
        )}
        {...props}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={describedBy}
      />
      {error && (
        <span id={errorId} className="mt-1 block text-label-sm text-error">
          {error}
        </span>
      )}
    </label>
  );
});
