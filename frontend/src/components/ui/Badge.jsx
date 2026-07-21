import clsx from "clsx";

const VARIANTS = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  primary: "bg-primary-container text-on-primary",
  secondary: "bg-secondary-container text-white",
  tertiary: "bg-tertiary-container text-on-tertiary",
  success: "bg-verified/10 text-verified-dark",
  error: "bg-error-container text-on-error-container",
};

export function Badge({ variant = "neutral", className, children }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-3 py-1 text-label-sm font-semibold", VARIANTS[variant], className)}>
      {children}
    </span>
  );
}
