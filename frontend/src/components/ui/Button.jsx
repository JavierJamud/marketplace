import clsx from "clsx";

const VARIANTS = {
  primary: "bg-secondary-container text-on-secondary-container hover:brightness-95",
  dark: "bg-primary text-on-primary hover:bg-primary-container",
  outline: "border border-outline text-on-surface hover:bg-surface-container",
  "outline-light": "border border-white/35 text-white hover:bg-white/10",
  ghost: "text-on-surface hover:bg-surface-container",
  danger: "bg-error text-on-error hover:brightness-95",
};

const SIZES = {
  sm: "h-9 px-3 text-label-sm",
  md: "h-11 px-5 text-label-md",
  lg: "h-13 px-6 text-title-lg",
};

export function Button({ variant = "primary", size = "md", className, children, ...props }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded font-body font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
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
