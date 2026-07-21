import clsx from "clsx";

export function Card({ className, children, ...props }) {
  return (
    <div
      className={clsx("rounded-lg bg-surface-container-lowest border border-surface-container-high shadow-sm", className)}
      {...props}
    >
      {children}
    </div>
  );
}
