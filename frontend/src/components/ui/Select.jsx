import clsx from "clsx";
import { forwardRef } from "react";

// Bloque 115 (pedido explícito): ver Input.jsx — mismo asterisco de
// obligatorio, mismo criterio.
export const Select = forwardRef(function Select({ label, error, required, className, children, ...props }, ref) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1 block text-label-md text-on-surface-variant">
          {label}
          {required && <span className="text-error"> *</span>}
        </span>
      )}
      <select
        ref={ref}
        required={required}
        className={clsx(
          "w-full rounded border border-outline-variant bg-surface-container-lowest px-4 py-2.5 text-body-md text-on-surface outline-none transition-colors",
          "focus:border-primary-container",
          error && "border-error",
          className
        )}
        {...props}
      >
        {children}
      </select>
      {error && <span className="mt-1 block text-label-sm text-error">{error}</span>}
    </label>
  );
});
