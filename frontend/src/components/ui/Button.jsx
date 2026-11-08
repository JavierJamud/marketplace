import clsx from "clsx";

const VARIANTS = {
  primary: "bg-secondary-container text-on-secondary-container hover:brightness-95",
  dark: "bg-primary text-on-primary hover:bg-primary-container",
  outline: "border border-outline text-on-surface hover:bg-surface-container",
  "outline-light": "border border-white/35 text-white hover:bg-white/10",
  ghost: "text-on-surface hover:bg-surface-container",
  danger: "bg-error text-on-error hover:brightness-95",
};

// Alto mínimo, no fijo: con la letra agrandada en el teléfono (o un texto largo) el botón crece con su texto en vez de
// dejarlo salirse por arriba y por abajo.
const SIZES = {
  sm: "min-h-9 px-3 py-1.5 text-label-sm",
  md: "min-h-11 px-5 py-2 text-label-md",
  lg: "min-h-12 px-6 py-2.5 text-title-lg",
};

export function Button({ variant = "primary", size = "md", className, children, ...props }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded text-center font-body font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
