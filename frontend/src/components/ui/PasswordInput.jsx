import { forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import clsx from "clsx";

// Input de contraseña con ojito de mostrar/ocultar — mismo look que Input.jsx,
// se usa en todos los campos de contraseña del sitio (login, registro, reset).
// Bloque 115 (pedido explícito): ver Input.jsx — mismo asterisco de
// obligatorio, mismo criterio.
export const PasswordInput = forwardRef(function PasswordInput({ label, error, required, className, ...props }, ref) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="block">
      {label && (
        <span className="mb-1 block text-label-md text-on-surface-variant">
          {label}
          {required && <span className="text-error"> *</span>}
        </span>
      )}
      <div className="relative">
        <input
          ref={ref}
          required={required}
          type={visible ? "text" : "password"}
          className={clsx(
            "w-full rounded border border-outline-variant bg-surface-container-lowest px-4 py-2.5 pr-11 text-body-md text-on-surface outline-none transition-colors",
            "focus:border-primary-container placeholder:text-outline",
            error && "border-error",
            className
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface-variant"
        >
          {visible ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
        </button>
      </div>
      {error && <span className="mt-1 block text-label-sm text-error">{error}</span>}
    </label>
  );
});
