import clsx from "clsx";
import { forwardRef } from "react";

export const Select = forwardRef(function Select({ label, error, className, children, ...props }, ref) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-label-md text-on-surface-variant">{label}</span>}
      <select
        ref={ref}
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
